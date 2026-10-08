"""Linux 开发服务归属核验、端口冲突接管与启动互斥。"""

from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import os
from pathlib import Path
import shlex
import signal
import time


@dataclass(frozen=True)
class Process:
    pid: int
    parent: int
    started: str
    cwd: Path
    command: tuple
    executable: Path


def read_process(pid):
    """启动时钟用于校验 PID 身份；读取失败的进程留给用户处理。"""
    directory = Path(f"/proc/{pid}")
    try:
        if directory.stat().st_uid != os.getuid():
            return None
        fields = (directory / "stat").read_text().rsplit(") ", 1)[1].split()
        if fields[0] == "Z":
            return None
        return Process(
            pid,
            int(fields[1]),
            fields[19],
            (directory / "cwd").resolve(strict=True),
            tuple(
                os.fsdecode(part)
                for part in (directory / "cmdline").read_bytes().split(b"\0")
                if part
            ),
            Path(os.readlink(directory / "exe").removesuffix(" (deleted)")),
        )
    except (OSError, ValueError, IndexError):
        return None


def process_snapshot():
    return {
        process.pid: process
        for directory in Path("/proc").glob("[0-9]*")
        if (process := read_process(int(directory.name))) is not None
    }


def descendants(pid, processes):
    owned = {pid}
    while True:
        added = {p.pid for p in processes.values() if p.parent in owned} - owned
        if not added:
            return owned
        owned.update(added)


def is_supervisor(process, root):
    command = process.command
    return (
        process.cwd == root
        and len(command) >= 2
        and Path(command[0]).name.startswith("python")
        and (process.cwd / command[1]).resolve() == root / "scripts/dev.py"
    )


def runtime_directory(path, root):
    try:
        parts = path.relative_to(root / ".runtime").parts
    except ValueError:
        return None
    if len(parts) >= 2 and parts[0].startswith("dev-"):
        return root / ".runtime" / parts[0]
    return None


def orphan_runtime(process, root, module):
    """通过运行目录及精确角色确认失去监管器的 Web／Worker／Vite。"""
    runtime = runtime_directory(process.executable, root)
    if (
        runtime
        and process.cwd == root
        and len(process.executable.relative_to(runtime).parts) == 2
        and process.executable.parent.name.startswith("generation-")
        and process.executable.name in ("web", "worker")
        and process.command
        and Path(process.command[0]) == process.executable
    ):
        return runtime
    command = process.command
    if process.cwd != module / "frontend" or len(command) < 2 or Path(command[0]).name != "node":
        return None
    script = (process.cwd / command[1]).resolve()
    if not script.is_relative_to(root) or script.name != "vite.js":
        return None
    try:
        variables = dict(
            part.split(b"=", 1)
            for part in Path(f"/proc/{process.pid}/environ").read_bytes().split(b"\0")
            if b"=" in part
        )
        cache = Path(os.fsdecode(variables.get(b"VITE_CACHE_DIR", b"")))
    except OSError:
        return None
    runtime = runtime_directory(cache, root)
    return runtime if runtime and cache == runtime / "vite-cache" else None


def port_owners(port):
    """保守收集同端口的全部监听者；覆盖 IPv4／IPv6 与通配监听。"""
    inodes = set()
    for name in ("tcp", "tcp6"):
        try:
            lines = Path(f"/proc/net/{name}").read_text().splitlines()[1:]
        except FileNotFoundError:
            continue
        for line in lines:
            fields = line.split()
            if fields[3] == "0A" and int(fields[1].rsplit(":", 1)[1], 16) == port:
                inodes.add(fields[9])
    owners = set()
    found = set()
    for directory in Path("/proc").glob("[0-9]*"):
        try:
            for fd in (directory / "fd").iterdir():
                try:
                    target = os.readlink(fd)
                except OSError:
                    continue
                if target.startswith("socket:[") and target[8:-1] in inodes:
                    owners.add(int(directory.name))
                    found.add(target[8:-1])
        except OSError:
            continue
    return owners, bool(inodes) and found == inodes


def takeover_plan(ports, root, module):
    """先核验所有冲突，再生成清理计划；任一归属不明都会保留全部进程。"""
    processes = process_snapshot()
    protected = {os.getpid()}
    current = processes.get(os.getpid())
    while current and current.parent not in protected:
        protected.add(current.parent)
        current = processes.get(current.parent)
    supervisors = {
        p.pid: descendants(p.pid, processes)
        for p in processes.values()
        if p.pid not in protected and is_supervisor(p, root)
    }
    orphans = {
        p.pid: runtime
        for p in processes.values()
        if p.pid not in protected and (runtime := orphan_runtime(p, root, module))
    }
    selected = set()
    leaders = set()
    runtimes = set()
    problems = []
    for role, host, port in ports:
        owners, complete = port_owners(port)
        if not complete:
            problems.append(f"{role} {host}:{port} 的监听进程归属信息不完整")
        for pid in sorted(owners):
            process = processes.get(pid)
            leader = next(
                (owner for owner, children in supervisors.items() if pid in children), None
            )
            if pid in protected:
                leader = None
            if leader is not None:
                leaders.add(leader)
                selected.update(supervisors[leader])
            elif pid in orphans:
                runtimes.add(orphans[pid])
            else:
                detail = shlex.join(process.command) if process else "命令不可读取"
                problems.append(f"{role} {host}:{port}：PID {pid}，{detail}")
    if problems:
        raise RuntimeError("端口占用进程已保留，请手动处理：\n" + "\n".join(problems))
    runtimes.update(orphans[pid] for pid in selected if pid in orphans)
    for pid, runtime in orphans.items():
        if runtime in runtimes:
            selected.update(descendants(pid, processes))
    if selected & protected:
        raise RuntimeError("开发服务进程树包含当前启动链，请从独立终端启动")
    return {pid: processes[pid] for pid in selected}, leaders


def same_process(process):
    current = read_process(process.pid)
    return current is not None and current.started == process.started


def send_signal(process, sig):
    """使用 pidfd 定位进程，避免扫描后 PID 被复用造成误杀。"""
    try:
        descriptor = os.pidfd_open(process.pid)
    except ProcessLookupError:
        return
    try:
        if same_process(process):
            signal.pidfd_send_signal(descriptor, sig)
    except ProcessLookupError:
        pass
    finally:
        os.close(descriptor)


def stop_owned(processes, leaders, timeout=30, grace=5):
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("自动重启需要支持 pidfd 的 Python 与 Linux，请手动退出旧开发服务")
    print(
        "正在停止当前项目的旧开发服务，PID：" + ", ".join(map(str, sorted(processes))), flush=True
    )
    for pid in leaders:
        send_signal(processes[pid], signal.SIGTERM)
    # 旧监管器负责正常清理；持续记录其新建后代，覆盖退出期间的构建或重载。
    deadline = time.monotonic() + timeout
    while any(same_process(processes[pid]) for pid in leaders):
        snapshot = process_snapshot()
        for pid in leaders:
            if pid in snapshot and snapshot[pid].started == processes[pid].started:
                processes.update({child: snapshot[child] for child in descendants(pid, snapshot)})
        if time.monotonic() >= deadline:
            break
        time.sleep(0.05)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        remaining = [p for p in processes.values() if same_process(p)]
        if not remaining:
            return
        for process in remaining:
            send_signal(process, sig)
        deadline = time.monotonic() + grace
        while any(same_process(p) for p in remaining) and time.monotonic() < deadline:
            time.sleep(0.05)
    if any(same_process(p) for p in processes.values()):
        raise RuntimeError("旧开发服务退出超时，请检查进程权限和状态")


@contextmanager
def startup_guard(root):
    """串行化接管到就绪阶段，避免并行启动互相清理或抢占端口。"""
    directory = root / ".runtime"
    directory.mkdir(exist_ok=True)
    with (directory / "dev-start.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("当前项目已有开发服务正在启动，请等待就绪后重试") from None
        try:
            yield lambda: fcntl.flock(lock, fcntl.LOCK_UN)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
