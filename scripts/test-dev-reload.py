#!/usr/bin/env python3
"""独立目录与随机端口验证代际切换、构建恢复、单实例及清理边界。"""

import ctypes
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import dev_reload
from dev_reload import ReloadSupervisor, source_fingerprint, stop_process

PROGRAM = r"""#!/usr/bin/env python3
import json, os, signal, socket, time
ROLE = __ROLE__
VERSION = __VERSION__
if os.environ.get("FAIL_ROLE") == ROLE:
    raise SystemExit(7)
if os.environ.get("HANG_ROLE") == ROLE:
    time.sleep(30)
s = None
if ROLE == "web":
    host, port = os.environ["WEB_ADDR"].rsplit(":", 1)
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((host, int(port)))
    s.listen()
print(json.dumps({"msg": ROLE.capitalize() + " 就绪", "pid": os.getpid(), "revision": VERSION}), flush=True)
signal.signal(signal.SIGTERM, lambda *_: exit(0))
while True:
    time.sleep(.1)
"""


class ScriptSupervisor(ReloadSupervisor):
    # 脚本二进制的 /proc/exe 指向解释器，专项测试按日志核验 PID。
    # 实际 Go 可执行文件指纹核验交给正式工程完整验收。
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
                return True
        return False


class ReloadTest(unittest.TestCase):
    def setUp(self):
        ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.module = self.root / "projects/multi-database-demo"
        self.module.mkdir(parents=True)
        (self.root / "packages/go-server-kit").mkdir(parents=True)
        (self.root / "go.work").write_text("workspace")
        (self.module / "go.mod").write_text("module")
        self.source = self.module / "version.go"
        self.source.write_text("one")
        self.template = self.root / "program.txt"
        self.template.write_text(PROGRAM)
        self.go = self.root / "go"
        self.go.write_text(
            "#!/usr/bin/env python3\n"
            "import pathlib, sys, time\n"
            "time.sleep(.08)\n"
            "version = pathlib.Path('version.go').read_text()\n"
            "if version == 'error': raise SystemExit(1)\n"
            "role = sys.argv[-1].split('/')[-1]\n"
            f"text = pathlib.Path({str(self.template)!r}).read_text()\n"
            "text = text.replace('__ROLE__', repr(role)).replace('__VERSION__', repr(version))\n"
            "target = pathlib.Path(sys.argv[sys.argv.index('-o') + 1])\n"
            "target.write_text(text)\n"
            "target.chmod(0o755)\n"
        )
        self.go.chmod(0o755)
        self.supervisors = []
        self.addCleanup(self.close_all)

    def close_all(self):
        for supervisor in self.supervisors:
            supervisor.close()

    def start(self, **env):
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", 0))
            port = holder.getsockname()[1]
        runtime = self.root / ("run-" + str(len(self.supervisors)))
        runtime.mkdir()
        supervisor = ScriptSupervisor(
            self.root,
            self.module,
            str(self.go),
            dict(os.environ, WEB_ADDR=f"127.0.0.1:{port}", **env),
            runtime,
            debounce=0.02,
            startup_timeout=2,
        )
        self.supervisors.append(supervisor)
        return supervisor

    def wait(self, supervisor, predicate, seconds=8):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            supervisor.tick()
            if predicate():
                return
            time.sleep(0.02)
        self.fail("等待代际状态超时：" + supervisor.status)

    def ready(self, supervisor):
        self.wait(supervisor, lambda: supervisor.status == "ready")
        self.assertEqual(set(supervisor.roles), {"web", "worker"})
        self.assertEqual(
            supervisor.state["inputFingerprint"],
            source_fingerprint(self.root, self.module, supervisor.embedded),
        )

    def test_parallel_runtime_exit_preserves_other_generation(self):
        first, second = self.start(), self.start()
        self.ready(first)
        self.ready(second)
        first_pids = [p.pid for p in first.roles.values()]
        second_binaries = [p.read_bytes() for p in second.binaries.values()]
        first.close()
        self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in first_pids))
        self.assertTrue(all(p.poll() is None for p in second.roles.values()))
        self.assertEqual(second_binaries, [p.read_bytes() for p in second.binaries.values()])
        with socket.create_connection(
            ("127.0.0.1", int(second.env["WEB_ADDR"].split(":")[1])), timeout=1
        ):
            pass

    def test_build_changes_discard_intermediate_and_retire_old_pids(self):
        supervisor = self.start()
        self.ready(supervisor)
        old = [p.pid for p in supervisor.roles.values()]
        self.source.write_text("two")
        self.wait(supervisor, lambda: supervisor.build is not None)
        self.source.write_text("three")
        time.sleep(0.03)
        supervisor.tick()
        self.source.write_text("final")
        self.ready(supervisor)
        self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in old))
        self.assertTrue(all("final" in p.read_text() for p in supervisor.binaries.values()))
        self.assertEqual(len(supervisor.roles), 2)

    def test_compile_failure_preserves_current_then_recovers(self):
        supervisor = self.start()
        self.ready(supervisor)
        old = [p.pid for p in supervisor.roles.values()]
        self.source.write_text("error")
        self.wait(supervisor, lambda: supervisor.status == "build-failed")
        self.assertEqual(old, [p.pid for p in supervisor.roles.values()])
        self.assertTrue(all(p.poll() is None for p in supervisor.roles.values()))
        self.source.write_text("recovered")
        self.ready(supervisor)
        self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in old))

    def test_startup_failure_is_visible(self):
        supervisor = self.start(FAIL_ROLE="worker")
        with self.assertRaisesRegex(RuntimeError, "worker 业务进程退出：7"):
            self.ready(supervisor)
        self.assertEqual(supervisor.status, "failed")
        supervisor.close()
        self.assertFalse(supervisor.roles)

    def test_rebuild_startup_failure_retires_old_generation(self):
        supervisor = self.start()
        self.ready(supervisor)
        old_pids = [process.pid for process in supervisor.roles.values()]
        supervisor.env["FAIL_ROLE"] = "worker"
        self.source.write_text("startup-failure")
        with self.assertRaisesRegex(RuntimeError, "worker 业务进程退出：7"):
            self.wait(supervisor, lambda: False)
        self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in old_pids))
        supervisor.close()
        self.assertFalse(supervisor.roles)

    def test_port_race_preserves_unowned_listener(self):
        supervisor = self.start()
        port = int(supervisor.env["WEB_ADDR"].split(":")[1])
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", port))
            holder.listen()
            with self.assertRaisesRegex(RuntimeError, "开发端口已被占用"):
                self.ready(supervisor)
            self.assertEqual(supervisor.status, "failed")
            supervisor.close()
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass

    def test_shutdown_during_build(self):
        supervisor = self.start()
        self.wait(supervisor, lambda: supervisor.build is not None)
        pid = supervisor.build.pid
        supervisor.close()
        self.assertFalse(Path(f"/proc/{pid}").exists())
        self.assertEqual(supervisor.status, "stopped")

    def test_workspace_metadata_and_embedded_assets_are_watched(self):
        initial = source_fingerprint(self.root, self.module)
        (self.root / "go.work").write_text("changed")
        changed = source_fingerprint(self.root, self.module)
        self.assertNotEqual(initial, changed)
        (self.module / "webui/dist").mkdir(parents=True)
        (self.module / "webui/dist/index.html").write_text("html")
        self.assertNotEqual(changed, source_fingerprint(self.root, self.module))
        stable = source_fingerprint(self.root, self.module)
        (self.module / "something_test.go").write_text("test")
        self.assertEqual(stable, source_fingerprint(self.root, self.module))

    def test_ssr_templates_and_theme_are_watched(self):
        pages = self.module / "internal/pages"
        (pages / "templates").mkdir(parents=True)
        initial = source_fingerprint(self.root, self.module)
        (pages / "templates/home.gohtml").write_text("首页")
        changed = source_fingerprint(self.root, self.module)
        self.assertNotEqual(initial, changed)
        (pages / "theme.js").write_text("主题")
        latest = source_fingerprint(self.root, self.module)
        self.assertNotEqual(changed, latest)
        (pages / "pages_test.go").write_text("package pages")
        self.assertEqual(latest, source_fingerprint(self.root, self.module))

    def test_snapshot_mismatch_retries_unchanged_source(self):
        supervisor = self.start()
        original_copy = dev_reload.shutil.copytree
        corrupted = False

        def copy(source, destination, **kwargs):
            nonlocal corrupted
            result = original_copy(source, destination, **kwargs)
            if source == self.module and not corrupted:
                (destination / "version.go").write_text("mixed-copy")
                corrupted = True
            return result

        with patch.object(dev_reload.shutil, "copytree", side_effect=copy):
            self.ready(supervisor)
        self.assertGreater(supervisor.generation, 1)
        self.assertTrue(all("one" in path.read_text() for path in supervisor.binaries.values()))

    def test_deleted_source_during_copy_retries_and_preserves_active_generation(self):
        for aggregate in (False, True):
            with self.subTest(aggregate=aggregate):
                supervisor = self.start()
                self.ready(supervisor)
                active = [process.pid for process in supervisor.roles.values()]
                original_copy = dev_reload.shutil.copytree
                changed = False

                def copy(source, destination, *args, **kwargs):
                    nonlocal changed
                    if Path(source) == self.module and not changed:
                        changed = True
                        self.source.unlink()
                        error = FileNotFoundError(2, "复制期间源文件被删除", str(self.source))
                        if aggregate:
                            raise dev_reload.shutil.Error(
                                [(str(self.source), str(destination), str(error))]
                            )
                        raise error
                    return original_copy(source, destination, *args, **kwargs)

                self.source.write_text("new")
                with patch.object(dev_reload.shutil, "copytree", side_effect=copy):
                    self.wait(supervisor, lambda: supervisor.status == "superseded")
                self.assertEqual(active, [process.pid for process in supervisor.roles.values()])
                self.assertTrue(
                    all(process.poll() is None for process in supervisor.roles.values())
                )
                self.source.write_text("recovered")
                self.ready(supervisor)
                self.assertTrue(all(not Path(f"/proc/{pid}").exists() for pid in active))
                self.assertTrue(
                    all(
                        "recovered" in binary.read_text() for binary in supervisor.binaries.values()
                    )
                )
                supervisor.close()
                self.source.write_text("one")

    def test_snapshot_permission_failure_remains_visible(self):
        supervisor = self.start()
        failure = dev_reload.shutil.Error([("source", "target", "[Errno 13] Permission denied")])
        with patch.object(dev_reload.shutil, "copytree", side_effect=failure):
            with self.assertRaises(dev_reload.shutil.Error):
                supervisor.begin(source_fingerprint(self.root, self.module))

    def test_owned_embedded_assets_match_actual_build_fingerprint(self):
        supervisor = self.start()
        (self.module / "webui/dist").mkdir(parents=True)
        original = self.module / "webui/dist/index.html"
        original.write_text("original")
        owned = supervisor.runtime / "frontend-dist"
        owned.mkdir()
        (owned / "index.html").write_text("owned")
        supervisor.embedded = owned
        self.ready(supervisor)
        copied = supervisor.build_module / "webui/dist/index.html"
        self.assertEqual(copied.read_text(), "owned")
        self.assertEqual(
            supervisor.state["inputFingerprint"],
            source_fingerprint(supervisor.folder / "source", supervisor.build_module),
        )
        self.assertEqual(original.read_text(), "original")

    def test_startup_timeout_and_executable_identity(self):
        supervisor = self.start(HANG_ROLE="worker")
        supervisor.startup_timeout = 0.2
        with self.assertRaisesRegex(RuntimeError, "业务启动就绪超时"):
            self.ready(supervisor)
        self.assertEqual(supervisor.status, "failed")
        supervisor.close()
        ordinary = self.start()
        self.ready(ordinary)
        self.assertFalse(ReloadSupervisor.ready(ordinary, "web", ordinary.roles["web"]))

    def test_forced_cleanup_covers_independent_child_group(self):
        child_pid = self.root / "child.pid"
        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import os, signal, subprocess, sys, time; "
                "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                "p=subprocess.Popen([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)'], start_new_session=True); "
                "open(sys.argv[1], 'w').write(str(p.pid)); time.sleep(30)",
                str(child_pid),
            ],
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 3
            while not child_pid.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            pid = int(child_pid.read_text())
            time.sleep(0.1)
            self.assertTrue(stop_process(process, timeout=0.1))
            self.assertFalse(Path(f"/proc/{process.pid}").exists())
            self.assertFalse(Path(f"/proc/{pid}").exists())
        finally:
            if process.poll() is None:
                stop_process(process, timeout=0.1)


if __name__ == "__main__":
    unittest.main()
