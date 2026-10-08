"""开发代际监管：内容指纹、串行构建、进程组退出及业务就绪核验。"""

import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import time


def runtime_base(root):
    base = root / ".runtime"
    base.mkdir(exist_ok=True)
    return base


def process_table():
    entries = {}
    for stat in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = stat.read_text().rsplit(") ", 1)[1].split()
            entries[int(stat.parent.name)] = (fields[0], int(fields[1]), int(fields[2]))
        except (OSError, IndexError, ValueError):
            pass
    return entries


def stop_process(process, timeout=10):
    """仅结束该 Popen 拥有的进程组及后代独立组，并收割收养的僵尸。"""
    entries = process_table()
    owned = {process.pid}
    while True:
        added = {pid for pid, (_, parent, _) in entries.items() if parent in owned} - owned
        if not added:
            break
        owned.update(added)
    groups = {process.pid} | {entries[pid][2] for pid in owned if pid in entries}
    groups.discard(os.getpgrp())

    def send(sig):
        for group in groups:
            try:
                os.killpg(group, sig)
            except ProcessLookupError:
                pass

    def alive():
        return any(state != "Z" and group in groups for state, _, group in process_table().values())

    send(signal.SIGTERM)
    deadline = time.monotonic() + timeout
    while alive() and time.monotonic() < deadline:
        process.poll()
        time.sleep(0.03)
    forced = alive()
    if forced:
        send(signal.SIGKILL)
    process.wait(timeout=5)
    deadline = time.monotonic() + 5
    while alive() and time.monotonic() < deadline:
        time.sleep(0.03)
    if alive():
        raise RuntimeError(f"进程组退出失败：{sorted(groups)}")
    for pid, (state, parent, group) in process_table().items():
        if state == "Z" and parent == os.getpid() and group in groups:
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
    return forced


def source_fingerprint(root, module, embedded=None):
    """内容摘要覆盖 module/workspace、Go 源码、SSR 模板与内嵌资源，保存时间保持独立。"""
    files = {root / "go.work", root / "go.work.sum"}
    for directory in (root / "packages/go-server-kit", module):
        files.update(directory.glob("go.*"))
        for current, directories, names in os.walk(directory):
            directories[:] = [
                name
                for name in directories
                if name not in ("node_modules", "tmp", ".runtime", "frontend", ".git")
                and not (embedded is not None and Path(current) / name == module / "webui/dist")
            ]
            for name in names:
                path = Path(current) / name
                if (
                    (name.endswith(".go") and not name.endswith("_test.go"))
                    or (
                        path.is_relative_to(module / "internal/pages")
                        and (name.endswith(".gohtml") or name.endswith(".js"))
                    )
                    or path.is_relative_to(module / "webui")
                ):
                    files.add(path)
    entries = {str(path.relative_to(root)): path for path in files}
    if embedded is not None:
        entries.update(
            {
                str((module / "webui/dist" / path.relative_to(embedded)).relative_to(root)): path
                for path in embedded.rglob("*")
                if path.is_file()
            }
        )
    digest = hashlib.sha256()
    for name, path in sorted(entries.items()):
        digest.update(name.encode() + b"\0")
        try:
            digest.update(path.read_bytes())
        except FileNotFoundError:
            digest.update(b"<absent>")
    return digest.hexdigest()


def binary_fingerprint(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


class ReloadSupervisor:
    """Web 与 Worker 作为一代切换，构建期间继续观测最新输入。"""

    def __init__(self, root, module, go, env, runtime, debounce=0.3, startup_timeout=15):
        self.root, self.module, self.go = root, module, go
        self.env, self.runtime = env, runtime
        self.embedded = runtime / "frontend-dist" if (runtime / "frontend-dist").exists() else None
        self.debounce, self.startup_timeout = debounce, startup_timeout
        self.observed = self.attempted = None
        self.changed_at = 0
        self.generation = 0
        self.build = None
        self.build_output = None
        self.roles = {}
        self.binaries = {}
        self.logs = {}
        self.status = "waiting"
        self.started_at = 0
        self.state = {}

    def publish(self, status, **details):
        self.status = status
        self.state = dict(
            status=status,
            generation=self.generation,
            inputFingerprint=self.attempted,
            supervisorPID=os.getpid(),
            roles={
                role: dict(
                    pid=process.pid,
                    binary=str(self.binaries[role]),
                    binaryFingerprint=binary_fingerprint(self.binaries[role]),
                )
                for role, process in self.roles.items()
            },
            **details,
        )
        temporary = self.runtime / "state.json.part"
        temporary.write_text(json.dumps(self.state, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(self.runtime / "state.json")

    def launch_build(self, role):
        self.build_role = role
        self.build_output = (self.folder / (role + "-build.log")).open("w")
        self.build = subprocess.Popen(
            [
                self.go,
                "build",
                "-mod=readonly",
                "-trimpath",
                "-o",
                str(self.folder / role),
                "./cmd/" + role,
            ],
            cwd=self.build_module,
            env=dict(self.env, GOWORK=str(self.folder / "source/go.work")),
            stdout=self.build_output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    def prune(self):
        active = {binary.parent for binary in self.binaries.values()}
        for folder in self.runtime.glob("generation-*"):
            if folder not in active and int(folder.name.split("-")[-1]) < self.generation - 2:
                shutil.rmtree(folder)

    def begin(self, fingerprint):
        self.attempted = fingerprint
        self.generation += 1
        self.folder = self.runtime / f"generation-{self.generation}"
        self.folder.mkdir()
        self.prune()
        source = self.folder / "source"
        source.mkdir()
        try:
            for name in ("go.work", "go.work.sum"):
                if (self.root / name).exists():
                    shutil.copy2(self.root / name, source / name)
            for original in (self.root / "packages/go-server-kit", self.module):
                destination = source / original.relative_to(self.root)
                shutil.copytree(
                    original,
                    destination,
                    ignore=shutil.ignore_patterns("node_modules", "frontend", "tmp", ".runtime"),
                )
            self.build_module = source / self.module.relative_to(self.root)
            embedded = self.build_module / "webui/dist"
            if (self.runtime / "frontend-dist").exists():
                shutil.rmtree(embedded, ignore_errors=True)
                shutil.copytree(self.runtime / "frontend-dist", embedded)
        except (FileNotFoundError, shutil.Error) as error:
            # 编辑器原子保存或删除文件可打断复制；缺文件的旧快照留待下一轮重试。
            if isinstance(error, shutil.Error) and not all(
                detail.startswith("[Errno 2]") for _, _, detail in error.args[0]
            ):
                raise
            if not (self.root / "packages/go-server-kit").is_dir() or not self.module.is_dir():
                raise
            self.attempted = None
            self.publish("superseded", error="复制期间源码变化，重新准备输入快照")
            return
        # 源码复制期间继续发生编辑时，验证快照内容后再开始编译。
        if source_fingerprint(source, self.build_module) != fingerprint:
            self.attempted = None
            self.publish("superseded")
            return
        # 上一代二进制位置单独保留，供运行 PID 核验及状态展示。
        self.publish("building")
        self.launch_build("web")
        print(f"构建第 {self.generation} 代，输入指纹 {fingerprint}", flush=True)

    def stop_roles(self):
        for role, process in reversed(list(self.roles.items())):
            if stop_process(process):
                print(f"{role} 优雅退出超时，已结束拥有的进程组 {process.pid}", flush=True)
        self.roles.clear()
        self.binaries.clear()
        for file in self.logs.values():
            file.close()
        self.logs.clear()

    def activate(self):
        self.stop_roles()
        # 旧 Web 已退出后再次检查端口，端口竞争立即进入失败状态。
        from dev import require_free_port

        address = self.env.get("WEB_ADDR", "127.0.0.1:8080")
        host, _, number = address.rpartition(":")
        require_free_port("Web", host.strip("[]"), int(number))
        for role in ("web", "worker"):
            output = (self.folder / (role + ".log")).open("w")
            self.logs[role] = output
            process = subprocess.Popen(
                [str(self.folder / role)],
                cwd=self.root,
                env=dict(self.env, INSTANCE_ID=role + "-dev-" + self.runtime.name),
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            self.roles[role] = process
            self.binaries[role] = self.folder / role
        self.started_at = time.monotonic()
        self.prune()
        self.publish("starting")

    def ready(self, role, process):
        for line in (self.folder / (role + ".log")).read_text().splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if (
                record.get("msg") == role.capitalize() + " 就绪"
                and record.get("pid") == process.pid
            ):
                actual = binary_fingerprint(Path(f"/proc/{process.pid}/exe"))
                return actual == binary_fingerprint(self.folder / role)
        return False

    def tick(self):
        now = time.monotonic()
        fingerprint = source_fingerprint(self.root, self.module, self.embedded)
        if fingerprint != self.observed:
            self.observed, self.changed_at = fingerprint, now
        for role, process in self.roles.items():
            if process.poll() is not None:
                self.publish("failed", error=f"{role} 业务进程退出：{process.returncode}")
                raise RuntimeError(self.state["error"] + "，日志：" + str(self.folder))
        if self.build is not None:
            if self.build.poll() is None:
                return
            code = self.build.returncode
            self.build_output.close()
            self.build_output = None
            self.build = None
            if code:
                self.publish("build-failed", error=f"{self.build_role} 编译失败：{code}")
                print(f"编译失败，等待源码更新；日志：{self.folder}", flush=True)
                return
            if fingerprint != self.attempted:
                self.publish("superseded")
                return
            if self.build_role == "web":
                self.launch_build("worker")
                return
            try:
                self.activate()
            except Exception as error:
                self.publish("failed", error=str(error))
                raise
        if self.status == "starting":
            if all(self.ready(role, process) for role, process in self.roles.items()):
                self.publish("ready")
                for role, process in self.roles.items():
                    print(
                        f"{role.capitalize()} 就绪：PID {process.pid}，代际 {self.generation}",
                        flush=True,
                    )
                print(f"业务代际就绪，构建指纹：{self.attempted}", flush=True)
            elif now - self.started_at > self.startup_timeout:
                self.publish("failed", error="业务启动就绪超时")
                raise RuntimeError("业务启动就绪超时，日志：" + str(self.folder))
            return
        if fingerprint != self.attempted and now - self.changed_at >= self.debounce:
            self.begin(fingerprint)

    def close(self):
        if self.build:
            stop_process(self.build)
            self.build = None
        if self.build_output:
            self.build_output.close()
            self.build_output = None
        self.stop_roles()
        if self.status != "failed":
            self.publish("stopped")
