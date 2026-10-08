#!/usr/bin/env python3
"""宿主机统一监管 Vite 与串行重载的 Web／Worker，退出时清理拥有的进程组。"""

import argparse
import ctypes
import errno
import os
from pathlib import Path
from project import environment, APP, config_file
from database_url import database_type
import signal
import socket
import subprocess
import sys
import time
import tempfile
from dev_reload import ReloadSupervisor, runtime_base, stop_process
from dev_processes import startup_guard, stop_owned, takeover_plan
from runtime_cleanup import RunLease, safe_maintain

ROOT = Path(__file__).resolve().parents[1]


def descendant_groups():
    """收集当前监管进程的所有后代进程组，覆盖子进程创建的独立组。"""
    entries = {}
    for stat in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = stat.read_text().rsplit(") ", 1)[1].split()
            entries[int(stat.parent.name)] = (int(fields[1]), int(fields[2]))
        except (OSError, IndexError, ValueError):
            pass
    owned = {os.getpid()}
    while True:
        added = {pid for pid, (parent, group) in entries.items() if parent in owned} - owned
        if not added:
            break
        owned.update(added)
    return {entries[pid][1] for pid in owned if pid in entries and entries[pid][1] != os.getpgrp()}


class PortInUse(RuntimeError):
    pass


def require_free_port(role, host, port):
    """启动前检查监听地址，现有进程与数据保持原状。"""
    address = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
    try:
        addresses = socket.getaddrinfo(
            host or None, port, 0, socket.SOCK_STREAM, 0, socket.AI_PASSIVE
        )
        for family, kind, protocol, _, target in addresses:
            with socket.socket(family, kind, protocol) as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                probe.bind(target)
    except OSError as err:
        if err.errno == errno.EADDRINUSE:
            raise PortInUse(
                f"{role} 开发端口已被占用：{address}。请先退出已有开发服务，再执行 pnpm dev。"
            ) from None
        raise RuntimeError(f"{role} 开发监听地址无法使用：{address}") from None


def dev_ports(env):
    address = env.get("WEB_ADDR", "127.0.0.1:8080")
    host, separator, web_port = address.rpartition(":")
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    try:
        web_port = int(web_port)
        spa_port = int(env.get("SPA_PORT", "5173"))
    except (ValueError, TypeError):
        raise RuntimeError("WEB_ADDR 与 SPA_PORT 需要有效的监听地址及数字端口") from None
    if not separator or not (1 <= web_port <= 65535 and 1 <= spa_port <= 65535):
        raise RuntimeError("开发端口范围为 1–65535，WEB_ADDR 需要 host:port 格式")
    if web_port == spa_port and host in ("", "0.0.0.0", "::", "127.0.0.1", "localhost"):
        raise RuntimeError("Web 与 SPA 需要使用独立的开发端口")
    return [("Web", host, web_port), ("SPA", "127.0.0.1", spa_port)]


def check_dev_ports(env):
    for role, host, port in dev_ports(env):
        require_free_port(role, host, port)


def prepare_dev_ports(env, module):
    conflicts = []
    for role, host, port in dev_ports(env):
        try:
            require_free_port(role, host, port)
        except PortInUse:
            conflicts.append((role, host, port))
    if conflicts:
        try:
            processes, leaders = takeover_plan(conflicts, ROOT, module)
            stop_owned(processes, leaders)
        except (RuntimeError, OSError) as error:
            role, host, port = conflicts[0]
            raise RuntimeError(f"{role} 开发端口已被占用：{host}:{port}。{error}") from None
        check_dev_ports(env)
        print("旧开发服务已退出，开发端口检查通过", flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--module", type=Path, default=APP)
    p.add_argument("--env-file", help="相对仓库根目录或绝对配置文件路径")
    p.add_argument("--keep-runtime", action="store_true", help="完整保留本次源码快照、二进制与日志")
    args = p.parse_args()
    if not sys.platform.startswith("linux"):
        raise RuntimeError("当前监管器在Linux／WSL上验收")
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("启用子进程收养失败")
    module = args.module.resolve()
    go, env = environment(env_file=args.env_file)
    if env.get("APP_MODE") != "development":
        file = Path(env.get("STARTER_ENV_FILE", config_file(args.env_file)))
        raise RuntimeError(f"开发配置需要 APP_MODE=development，请核对 {file} 与进程环境变量")
    database_type(env.get("DB_DSN"))
    with startup_guard(ROOT) as release_startup:
        return run_dev(go, env, module, release_startup, keep_runtime=args.keep_runtime)


def spa_ready(port):
    """确认 Vite 已监听，启动锁覆盖其进程创建到可连接阶段。"""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def run_dev(go, env, module, release_startup, keep_runtime=False):
    prepare_dev_ports(env, module)
    safe_maintain(ROOT, automatic=True, cache=True)
    env["DASHBOARD_SOURCE"] = "1"
    env["WEB_ORIGIN"] = "http://" + env.get("WEB_ADDR", "127.0.0.1:8080")
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, stop)
    runtime = Path(tempfile.mkdtemp(prefix="dev-", dir=runtime_base(ROOT)))
    lease = RunLease(ROOT, runtime, "dev", keep_runtime)
    outcome, cleanup_errors = "failed", []
    env["VITE_CACHE_DIR"] = str(runtime / "vite-cache")
    processes = []
    supervisor = None
    try:
        # 前端构建也受同一进程组监管，Ctrl+C 可以覆盖启动准备阶段。
        build = subprocess.Popen(
            ["pnpm", "exec", "vite", "build", "--outDir", str(runtime / "frontend-dist")],
            cwd=module / "frontend",
            env=env,
            start_new_session=True,
        )
        processes.append(build)
        while build.poll() is None and not stopping:
            time.sleep(0.1)
        if stopping:
            outcome = "stopped"
            return 0
        if build.returncode:
            raise RuntimeError("开发前端构建失败")
        supervisor = ReloadSupervisor(ROOT, module, go, env, runtime)
        print(f"开发运行目录：{runtime}", flush=True)
        print("正在构建并等待 Web／Worker 就绪，再启动界面 HMR", flush=True)
        spa = None
        spa_started = 0
        announced = False
        while not stopping:
            if spa is not None and spa.poll() is not None:
                raise RuntimeError("SPA 子进程结束")
            supervisor.tick()
            if stopping:
                break
            # Vite 会向浏览器公布入口；先确认业务就绪，避免首个会话请求遇到代理 502。
            if spa is None and supervisor.status == "ready":
                spa = subprocess.Popen(
                    ["pnpm", "dev"], cwd=module / "frontend", env=env, start_new_session=True
                )
                processes.append(spa)
                spa_started = time.monotonic()
            if spa is not None and not announced:
                if supervisor.status == "ready" and spa_ready(int(env.get("SPA_PORT", "5173"))):
                    print(f"开发首页：http://127.0.0.1:{env.get('SPA_PORT', '5173')}/", flush=True)
                    print(f"公开 SSR 页面：{env['WEB_ORIGIN']}/", flush=True)
                    print(f"队列测试页面：{env['WEB_ORIGIN']}/test/queue", flush=True)
                    print(
                        f"界面 HMR：http://127.0.0.1:{env.get('SPA_PORT', '5173')}/admin/",
                        flush=True,
                    )
                    print(f"内嵌产物：{env['WEB_ORIGIN']}/admin/", flush=True)
                    release_startup()
                    announced = True
                elif time.monotonic() - spa_started > 30:
                    raise RuntimeError("SPA 开发服务就绪超时")
            time.sleep(0.1)
        # 最新编译失败沿用失败保留窗口，供退出后复现源码和编译日志。
        outcome = "failed" if supervisor.status in {"failed", "build-failed"} else "stopped"
        return 0
    finally:
        try:
            cleanup_error = None
            # 先关闭前端入口，再清理业务进程，缩短退出阶段的代理上游断连窗口。
            for process in reversed(processes):
                try:
                    stop_process(process)
                except Exception as error:
                    cleanup_error = error
            if supervisor:
                try:
                    supervisor.close()
                except Exception as error:
                    cleanup_error = error
            # subreaper 收养的独立子组同样属于本次运行。
            for group in descendant_groups():
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            deadline = time.monotonic() + 5
            while True:
                try:
                    pid, _ = os.waitpid(-1, os.WNOHANG)
                    if pid == 0:
                        if time.monotonic() > deadline:
                            raise RuntimeError("开发后代进程清理超时")
                        time.sleep(0.03)
                        continue
                except ChildProcessError:
                    break
            if cleanup_error:
                raise RuntimeError("开发进程清理失败") from cleanup_error
            print("SPA、Web、Worker 进程组已清理", flush=True)
        except BaseException as error:
            cleanup_errors.append(str(error))
            raise
        finally:
            lease.finish(outcome, cleanup_errors)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        print(f"开发启动失败：{error}", file=sys.stderr)
        sys.exit(1)
