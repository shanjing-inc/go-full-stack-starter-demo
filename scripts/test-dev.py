#!/usr/bin/env python3
"""验证开发端口接管、进程归属、并行启动与其他服务保护。"""

import importlib.util
from dataclasses import replace
import ctypes
import contextlib
import io
import json
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
import socket
import unittest
from unittest.mock import MagicMock, patch

import dev_processes as ownership

spec = importlib.util.spec_from_file_location("development", Path(__file__).with_name("dev.py"))
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class DevelopmentPortsTest(unittest.TestCase):
    def test_free_address(self):
        # 隔离随机端口，测试期间使用当前进程拥有的套接字。
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", 0))
            port = holder.getsockname()[1]
        dev.require_free_port("Web", "127.0.0.1", port)

    def test_busy_address_preserves_listener(self):
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", 0))
            holder.listen()
            port = holder.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, f"Web 开发端口已被占用：127.0.0.1:{port}"):
                dev.require_free_port("Web", "127.0.0.1", port)
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                pass

    def test_defaults_and_ipv6_address(self):
        with patch.object(dev, "require_free_port") as check:
            dev.check_dev_ports({})
            self.assertEqual(
                [call.args for call in check.call_args_list],
                [("Web", "127.0.0.1", 8080), ("SPA", "127.0.0.1", 5173)],
            )
        with patch.object(dev, "require_free_port") as check:
            dev.check_dev_ports({"WEB_ADDR": "[::1]:8081", "SPA_PORT": "5174"})
            self.assertEqual(check.call_args_list[0].args, ("Web", "::1", 8081))

    def test_invalid_or_shared_ports(self):
        for values in (
            {"WEB_ADDR": "localhost"},
            {"WEB_ADDR": "127.0.0.1:0"},
            {"SPA_PORT": "65536"},
            {"SPA_PORT": "invalid"},
            {"WEB_ADDR": "127.0.0.1:5173"},
        ):
            with self.subTest(values=values), patch.object(dev, "require_free_port") as check:
                with self.assertRaises(RuntimeError):
                    dev.check_dev_ports(values)
                check.assert_not_called()

    def test_web_and_spa_busy_stop_before_build_or_spawn(self):
        for role in ("Web", "SPA"):
            with socket.socket() as holder:
                holder.bind(("127.0.0.1", 0))
                holder.listen()
                port = holder.getsockname()[1]
                # 另一个角色仅作地址检查 mock，避免依赖用户实际的监听状态。
                real_check = dev.require_free_port

                def check(name, host, number):
                    if name == role:
                        real_check(name, host, number)

                with (
                    self.subTest(role=role),
                    patch.object(
                        dev,
                        "environment",
                        return_value=(
                            "go",
                            {
                                "APP_MODE": "development",
                                "DB_DSN": "postgres://dev:password@localhost/demo",
                                "WEB_ADDR": f"127.0.0.1:{port}",
                                "SPA_PORT": str(port + 1 if role == "Web" else port),
                            },
                        ),
                    ),
                    patch.object(dev, "require_free_port", side_effect=check),
                    patch.object(dev.ctypes, "CDLL"),
                    patch.object(dev, "startup_guard"),
                    patch.object(dev.subprocess, "run") as build,
                    patch.object(dev.subprocess, "Popen") as spawn,
                    patch("sys.argv", ["dev.py"]),
                ):
                    # SPA 用例使用单独 Web 地址，避免相同端口的配置拒绝。
                    if role == "SPA":
                        dev.environment.return_value[1]["WEB_ADDR"] = f"127.0.0.1:{port + 1}"
                    dev.ctypes.CDLL.return_value.prctl.return_value = 0
                    with self.assertRaisesRegex(RuntimeError, role + " 开发端口已被占用"):
                        dev.main()
                    build.assert_not_called()
                    spawn.assert_not_called()
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    pass

    def test_env_file_reaches_configuration_loader(self):
        with (
            patch.object(dev.ctypes, "CDLL"),
            patch.object(dev, "environment", side_effect=RuntimeError("配置文件缺失")) as load,
            patch.object(dev.subprocess, "Popen") as spawn,
            patch("sys.argv", ["dev.py", "--env-file", "custom.env"]),
        ):
            dev.ctypes.CDLL.return_value.prctl.return_value = 0
            with self.assertRaisesRegex(RuntimeError, "配置文件缺失"):
                dev.main()
            load.assert_called_once_with(env_file="custom.env")
            spawn.assert_not_called()

    def test_missing_development_mode_identifies_selected_file(self):
        with (
            patch.object(dev.ctypes, "CDLL"),
            patch.object(
                dev, "environment", return_value=("go", {"STARTER_ENV_FILE": "/tmp/selected.env"})
            ),
            patch.object(dev.subprocess, "Popen") as spawn,
            patch("sys.argv", ["dev.py"]),
        ):
            dev.ctypes.CDLL.return_value.prctl.return_value = 0
            with self.assertRaisesRegex(RuntimeError, "APP_MODE=development.*selected.env"):
                dev.main()
            spawn.assert_not_called()

    def test_invalid_database_url_fails_before_ports_or_spawn(self):
        with (
            patch.object(dev.ctypes, "CDLL"),
            patch.object(
                dev,
                "environment",
                return_value=("go", {"APP_MODE": "development", "DB_DSN": "invalid"}),
            ),
            patch.object(dev, "check_dev_ports") as ports,
            patch.object(dev.subprocess, "Popen") as spawn,
            patch("sys.argv", ["dev.py"]),
        ):
            dev.ctypes.CDLL.return_value.prctl.return_value = 0
            with self.assertRaisesRegex(RuntimeError, "DB_DSN"):
                dev.main()
            ports.assert_not_called()
            spawn.assert_not_called()


class DevelopmentStartupTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="dev-startup-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.build = MagicMock(returncode=0)
        self.build.poll.return_value = 0
        self.spa = MagicMock()
        self.spa.poll.return_value = None
        self.supervisor = MagicMock(status="waiting")
        self.handlers = {}
        self.events = []
        self.clock = 0
        self.ticks = 0
        self.states = ["building", "starting", "ready", "ready", "ready"]
        self.listening = [False, True, True]
        self.output = io.StringIO()
        self.release = MagicMock(side_effect=lambda: self.events.append("释放启动锁"))
        self.interrupt_at = None
        self.sleep_step = 0.1

    def run_development(self):
        spawned = []

        def spawn(command, **kwargs):
            spawned.append(command)
            if command == ["pnpm", "dev"]:
                self.assertEqual(self.supervisor.status, "ready")
                self.events.append("启动Vite")
                return self.spa
            output = Path(command[-1])
            output.mkdir()
            (output / "index.html").write_text("开发前端产物")
            cache = output.parent / "vite-cache"
            cache.mkdir()
            (cache / "entry").write_text("Vite 缓存")
            self.events.append("前端构建")
            return self.build

        def create_supervisor(root, module, go, env, runtime):
            source = runtime / "generation-1/source"
            source.mkdir(parents=True)
            (source / "main.go").write_text("package main\n")
            (source.parent / "web-build.log").write_text("Go 编译日志")
            return self.supervisor

        def tick():
            state = self.states[self.ticks]
            self.ticks += 1
            if isinstance(state, Exception):
                raise state
            self.supervisor.status = state
            self.events.append(state)
            if self.interrupt_at == self.ticks:
                self.handlers[signal.SIGINT](signal.SIGINT, None)

        def sleep(_):
            self.clock += self.sleep_step
            if self.ticks == len(self.states):
                self.handlers[signal.SIGTERM](signal.SIGTERM, None)

        def listening(_):
            self.assertNotIn("界面 HMR：", self.output.getvalue())
            result = self.listening.pop(0)
            self.events.append("Vite可连接" if result else "Vite启动中")
            return result

        self.supervisor.tick.side_effect = tick
        self.supervisor.close.side_effect = lambda: self.events.append("停止WebWorker")
        with (
            contextlib.redirect_stdout(self.output),
            patch.object(dev, "ROOT", self.root),
            patch.object(dev, "prepare_dev_ports"),
            patch.object(dev.subprocess, "Popen", side_effect=spawn),
            patch.object(dev, "ReloadSupervisor", side_effect=create_supervisor),
            patch.object(dev, "spa_ready", side_effect=listening),
            patch.object(
                dev.signal,
                "signal",
                side_effect=lambda sig, handler: self.handlers.update({sig: handler}),
            ),
            patch.object(dev.time, "sleep", side_effect=sleep),
            patch.object(dev.time, "monotonic", side_effect=lambda: self.clock),
            patch.object(
                dev,
                "stop_process",
                side_effect=lambda process: self.events.append(
                    "停止Vite" if process is self.spa else "停止构建"
                ),
            ) as stop,
            patch.object(dev, "descendant_groups", return_value=set()),
            patch.object(dev.os, "waitpid", side_effect=ChildProcessError),
        ):
            try:
                return dev.run_dev("go", {}, self.root / "projects/demo", self.release)
            finally:
                self.supervisor.close.assert_called_once()
                self.assertEqual(stop.call_count, len(spawned))

    def test_vite_waits_for_backend_and_lock_waits_for_vite(self):
        self.assertEqual(self.run_development(), 0)
        self.assertEqual(self.events[:5], ["前端构建", "building", "starting", "ready", "启动Vite"])
        self.assertLess(self.events.index("Vite启动中"), self.events.index("Vite可连接"))
        self.assertLess(self.events.index("Vite可连接"), self.events.index("释放启动锁"))
        self.release.assert_called_once()
        self.assertEqual(self.output.getvalue().count("界面 HMR："), 1)
        self.assertLess(self.events.index("停止Vite"), self.events.index("停止WebWorker"))

    def test_normal_exit_recycles_frontend_and_registers_retention(self):
        self.assertEqual(self.run_development(), 0)
        path = next((self.root / ".runtime").glob("dev-*"))
        record = json.loads((path / "retention.json").read_text())
        self.assertEqual(record["status"], "stopped")
        self.assertEqual(record["cleanupErrors"], [])
        self.assertFalse((path / "frontend-dist").exists())
        self.assertFalse((path / "vite-cache").exists())
        self.assertFalse((path / "generation-1").exists())
        self.assertEqual((path / "generation-1-web-build.log").read_text(), "Go 编译日志")

    def test_invalid_cleanup_timestamp_keeps_development_startup_working(self):
        base = self.root / ".runtime"
        base.mkdir()
        (base / "cleanup-latest.json").write_text(json.dumps({"sweptAt": "invalid"}))
        with patch.dict(os.environ, STARTER_ISOLATED_BUILD="0"):
            self.assertEqual(self.run_development(), 0)
        self.assertIn("sweptAt", self.output.getvalue())
        path = next(base.glob("dev-*"))
        record = json.loads((path / "retention.json").read_text())
        self.assertEqual(record["status"], "stopped")
        self.assertEqual(record["cleanupErrors"], [])
        self.assertIn("启动Vite", self.events)

    def test_startup_failure_retains_complete_scene(self):
        self.states = ["starting", RuntimeError("Web 启动失败")]
        with self.assertRaisesRegex(RuntimeError, "Web 启动失败"):
            self.run_development()
        path = next((self.root / ".runtime").glob("dev-*"))
        record = json.loads((path / "retention.json").read_text())
        self.assertEqual(record["status"], "failed")

    def test_initial_compile_failure_keeps_vite_closed_and_retains_scene(self):
        self.states = ["building", "build-failed", "build-failed"]
        self.interrupt_at = 3
        self.assertEqual(self.run_development(), 0)
        self.assertNotIn("启动Vite", self.events)
        self.assertNotIn("界面 HMR：", self.output.getvalue())
        self.release.assert_not_called()
        path = next((self.root / ".runtime").glob("dev-*"))
        record = json.loads((path / "retention.json").read_text())
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["cleanupErrors"], [])
        self.assertEqual((path / "generation-1/source/main.go").read_text(), "package main\n")
        self.assertEqual((path / "generation-1/web-build.log").read_text(), "Go 编译日志")
        self.assertTrue((path / "frontend-dist/index.html").is_file())
        self.assertTrue((path / "vite-cache/entry").is_file())

    def test_compile_failure_after_ready_retains_latest_scene(self):
        self.states = ["ready", "ready", "build-failed", "build-failed"]
        self.assertEqual(self.run_development(), 0)
        self.release.assert_called_once()
        path = next((self.root / ".runtime").glob("dev-*"))
        record = json.loads((path / "retention.json").read_text())
        self.assertEqual(record["status"], "failed")
        self.assertTrue((path / "generation-1/source/main.go").is_file())
        self.assertTrue((path / "generation-1/web-build.log").is_file())

    def test_compile_failure_recovery_recycles_on_normal_exit(self):
        self.states = ["building", "build-failed", "building", "starting", "ready", "ready"]
        self.assertEqual(self.run_development(), 0)
        path = next((self.root / ".runtime").glob("dev-*"))
        record = json.loads((path / "retention.json").read_text())
        self.assertEqual(record["status"], "stopped")
        self.assertFalse((path / "generation-1").exists())
        self.assertEqual((path / "generation-1-web-build.log").read_text(), "Go 编译日志")

    def test_backend_startup_failure_cleans_up_before_vite(self):
        self.states = ["starting", RuntimeError("Web 启动失败")]
        with self.assertRaisesRegex(RuntimeError, "Web 启动失败"):
            self.run_development()
        self.assertNotIn("启动Vite", self.events)
        self.release.assert_not_called()

    def test_interrupt_while_waiting_keeps_vite_closed(self):
        self.interrupt_at = 2
        self.assertEqual(self.run_development(), 0)
        self.assertNotIn("启动Vite", self.events)
        self.release.assert_not_called()

    def test_vite_readiness_timeout_cleans_up(self):
        self.states = ["ready"] * 5
        self.listening = [False] * 5
        self.sleep_step = 11
        with self.assertRaisesRegex(RuntimeError, "SPA 开发服务就绪超时"):
            self.run_development()
        self.release.assert_not_called()
        self.assertNotIn("界面 HMR：", self.output.getvalue())

    def test_vite_exit_before_ready_cleans_up(self):
        self.states = ["ready"] * 3
        self.spa.poll.return_value = 1
        with self.assertRaisesRegex(RuntimeError, "SPA 子进程结束"):
            self.run_development()
        self.release.assert_not_called()

    def test_real_spa_listener_readiness(self):
        with socket.socket() as holder:
            holder.bind(("127.0.0.1", 0))
            port = holder.getsockname()[1]
            self.assertFalse(dev.spa_ready(port))
            holder.listen()
            self.assertTrue(dev.spa_ready(port))


class DevelopmentTakeoverTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.libc = ctypes.CDLL(None, use_errno=True)
        cls.previous_subreaper = ctypes.c_int()
        if cls.libc.prctl(37, ctypes.byref(cls.previous_subreaper), 0, 0, 0) != 0:
            raise RuntimeError("读取测试子进程收养状态失败")
        if cls.libc.prctl(36, 1, 0, 0, 0) != 0:
            raise RuntimeError("启用测试子进程收养失败")

    @classmethod
    def tearDownClass(cls):
        cls.libc.prctl(36, cls.previous_subreaper.value, 0, 0, 0)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="dev-takeover-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.module = self.root / "projects/demo"
        (self.root / "scripts").mkdir()
        (self.module / "frontend").mkdir(parents=True)

    def start_stack(self, root=None, stubborn=False):
        """隔离的真实监管进程，Web／SPA 随机端口与独立 Worker 进程组。"""
        root = root or self.root
        (root / "scripts").mkdir(parents=True, exist_ok=True)
        (root / "scripts/dev.py").write_text(
            """
import json, os, signal, socket, subprocess, sys, time
from pathlib import Path
children = []
sockets = []
stopping = False
def stop(*args):
    global stopping
    stopping = True
signal.signal(signal.SIGTERM, signal.SIG_IGN if sys.argv[-1] == 'stubborn' else stop)
try:
    for role in ('web', 'spa', 'worker'):
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        code = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(120)' if sys.argv[-1] == 'stubborn' else 'import time; time.sleep(120)'
        child = subprocess.Popen([sys.executable, '-c', code], pass_fds=(listener.fileno(),), start_new_session=True)
        children.append(child)
        sockets.append({'pid': child.pid, 'port': listener.getsockname()[1]})
        listener.close()
    Path('ready.tmp').write_text(json.dumps(sockets))
    Path('ready.tmp').replace('ready.json')
    while not stopping:
        time.sleep(.02)
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait(timeout=2)
"""
        )
        (root / "ready.json").unlink(missing_ok=True)
        process = subprocess.Popen(
            [sys.executable, "scripts/dev.py", "stubborn" if stubborn else "normal"],
            cwd=root,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        children = []
        identities = []

        def cleanup():
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            for identity in identities:
                ownership.send_signal(identity, signal.SIGKILL)
                try:
                    os.waitpid(identity.pid, 0)
                except ChildProcessError:
                    pass

        self.addCleanup(cleanup)
        deadline = time.monotonic() + 5
        while not (root / "ready.json").exists():
            if process.poll() is not None or time.monotonic() > deadline:
                self.fail("隔离开发进程启动失败")
            time.sleep(0.02)
        children.extend(json.loads((root / "ready.json").read_text()))
        identities.extend(ownership.read_process(child["pid"]) for child in children)
        return process, children

    def values(self, children):
        return {
            "WEB_ADDR": f"127.0.0.1:{children[0]['port']}",
            "SPA_PORT": str(children[1]["port"]),
        }

    def test_real_stack_releases_both_ports_and_worker(self):
        process, children = self.start_stack()
        self.assertTrue(ownership.is_supervisor(ownership.read_process(process.pid), self.root))
        for child in children:
            owners, complete = ownership.port_owners(child["port"])
            self.assertTrue(complete)
            self.assertIn(child["pid"], owners)
        with patch.object(dev, "ROOT", self.root):
            dev.prepare_dev_ports(self.values(children), self.module)
        self.assertEqual(process.wait(timeout=5), 0)
        for child in children:
            self.assertIsNone(ownership.read_process(child["pid"]))
            dev.require_free_port("测试", "127.0.0.1", child["port"])
        # 接管后同地址可再次监听。
        with socket.socket() as replacement:
            replacement.bind(("127.0.0.1", children[0]["port"]))
            replacement.listen()

    def test_restart_builds_after_cleanup_and_releases_startup_lock(self):
        process, children = self.start_stack()
        env = dict(self.values(children), APP_MODE="development")
        build = MagicMock()
        build.poll.return_value = 0
        build.returncode = 0
        spa = MagicMock()
        spa.poll.return_value = None
        supervisor = MagicMock(status="ready")
        handlers = {}
        spawned = []

        def spawn(*args, **kwargs):
            self.assertIsNotNone(process.poll())
            for child in children:
                self.assertIsNone(ownership.read_process(child["pid"]))
            spawned.append(args[0])
            return build if len(spawned) == 1 else spa

        release = MagicMock(side_effect=lambda: handlers[signal.SIGTERM](signal.SIGTERM, None))
        with (
            patch.object(dev, "ROOT", self.root),
            patch.object(dev.subprocess, "Popen", side_effect=spawn),
            patch.object(dev, "ReloadSupervisor", return_value=supervisor),
            patch.object(dev, "spa_ready", return_value=True),
            patch.object(
                dev.signal,
                "signal",
                side_effect=lambda sig, handler: handlers.update({sig: handler}),
            ),
            patch.object(dev, "stop_process") as stop,
            patch.object(dev, "descendant_groups", return_value=set()),
        ):
            self.assertEqual(dev.run_dev("go", env, self.module, release), 0)
        self.assertEqual(spawned[0][:4], ["pnpm", "exec", "vite", "build"])
        self.assertEqual(spawned[1], ["pnpm", "dev"])
        release.assert_called_once()
        supervisor.close.assert_called_once()
        self.assertEqual(stop.call_count, 2)

    def test_stubborn_stack_is_killed_with_owned_children(self):
        process, children = self.start_stack(stubborn=True)
        # 等待所有子进程安装忽略 SIGTERM 的处理器。
        time.sleep(0.1)
        ports = dev.dev_ports(self.values(children))
        processes, leaders = ownership.takeover_plan(ports, self.root, self.module)
        ownership.stop_owned(processes, leaders, timeout=0.1, grace=0.1)
        self.assertEqual(process.wait(timeout=5), -signal.SIGKILL)
        for child in children:
            self.assertIsNone(ownership.read_process(child["pid"]))

    def test_other_checkout_stack_is_preserved(self):
        other = self.root / "other-checkout"
        process, children = self.start_stack(other)
        with patch.object(dev, "ROOT", self.root), patch.object(dev, "stop_owned") as stop:
            with self.assertRaisesRegex(RuntimeError, f"PID {children[0]['pid']}"):
                dev.prepare_dev_ports(self.values(children), self.module)
            stop.assert_not_called()
        self.assertIsNone(process.poll())
        with socket.create_connection(("127.0.0.1", children[0]["port"]), timeout=1):
            pass

    def test_other_ports_in_same_checkout_remain_running(self):
        first, children = self.start_stack()
        parallel, parallel_children = self.start_stack()
        with patch.object(dev, "ROOT", self.root):
            dev.prepare_dev_ports(self.values(children), self.module)
        self.assertEqual(first.wait(timeout=5), 0)
        self.assertIsNone(parallel.poll())
        for child in parallel_children:
            with socket.create_connection(("127.0.0.1", child["port"]), timeout=1):
                pass

    def test_mixed_owned_and_foreign_ports_preserve_both(self):
        process, children = self.start_stack()
        with socket.socket() as foreign:
            foreign.bind(("127.0.0.1", 0))
            foreign.listen()
            env = self.values(children)
            env["SPA_PORT"] = str(foreign.getsockname()[1])
            with patch.object(dev, "ROOT", self.root), patch.object(dev, "stop_owned") as stop:
                with self.assertRaisesRegex(RuntimeError, "进程已保留"):
                    dev.prepare_dev_ports(env, self.module)
                stop.assert_not_called()
            self.assertIsNone(process.poll())
            with socket.create_connection(("127.0.0.1", children[0]["port"]), timeout=1):
                pass
            with socket.create_connection(foreign.getsockname(), timeout=1):
                pass

    def test_unknown_owner_fails_closed(self):
        with patch.object(ownership, "port_owners", return_value=(set(), False)):
            with self.assertRaisesRegex(RuntimeError, "归属信息不完整"):
                ownership.takeover_plan([("Web", "127.0.0.1", 12345)], self.root, self.module)

    def test_real_orphan_web_worker_and_vite_are_cleaned_together(self):
        runtime = self.root / ".runtime/dev-orphans"
        generation = runtime / "generation-1"
        generation.mkdir(parents=True)
        program = (
            "import json,socket,sys,time; from pathlib import Path; "
            "s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); "
            "s.bind(('127.0.0.1',0)); s.listen(); "
            "Path(sys.argv[1]).write_text(json.dumps(s.getsockname()[1])); time.sleep(120)"
        )
        children = []
        ports = []
        for role in ("web", "worker", "vite"):
            executable = generation / ("node" if role == "vite" else role)
            shutil.copyfile(sys.executable, executable)
            executable.chmod(0o700)
            ready = self.root / f"{role}.json"
            args = [str(executable), "-c", program, str(ready)]
            cwd = self.root
            if role == "vite":
                script = self.module / "frontend/node_modules/vite/bin/vite.js"
                script.parent.mkdir(parents=True)
                script.write_text(program)
                args = [str(executable), str(script), str(ready)]
                cwd = self.module / "frontend"
            process = subprocess.Popen(
                args,
                cwd=cwd,
                env=dict(os.environ, VITE_CACHE_DIR=str(runtime / "vite-cache")),
                start_new_session=True,
            )
            children.append(process)
            self.addCleanup(self.reap_child, process)
            deadline = time.monotonic() + 5
            while not ready.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    self.fail("孤立进程夹具启动失败")
                time.sleep(0.02)
            ports.append(json.loads(ready.read_text()))
        with patch.object(dev, "ROOT", self.root):
            dev.prepare_dev_ports(
                {"WEB_ADDR": f"127.0.0.1:{ports[0]}", "SPA_PORT": str(ports[2])}, self.module
            )
        for child in children:
            self.assertEqual(child.wait(timeout=5), -signal.SIGTERM)
        for port in ports:
            dev.require_free_port("测试", "127.0.0.1", port)

    @staticmethod
    def reap_child(process):
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)

    def test_free_ports_skip_takeover(self):
        with (
            patch.object(dev, "require_free_port"),
            patch.object(dev, "takeover_plan") as plan,
            patch.object(dev, "stop_owned") as stop,
        ):
            dev.prepare_dev_ports({}, self.module)
            plan.assert_not_called()
            stop.assert_not_called()

    def test_pidfd_unavailable_preserves_processes(self):
        with (
            patch.object(ownership, "send_signal") as send,
            patch.object(ownership.os, "pidfd_open", create=True),
        ):
            del ownership.os.pidfd_open
            with self.assertRaisesRegex(RuntimeError, "pidfd"):
                ownership.stop_owned({}, set())
            send.assert_not_called()

    def test_pid_reuse_skips_signal(self):
        current = ownership.read_process(os.getpid())
        stale = replace(current, started="旧启动时钟")
        with patch.object(ownership.signal, "pidfd_send_signal") as send:
            ownership.send_signal(stale, signal.SIGTERM)
            send.assert_not_called()

    def test_concurrent_startup_and_release(self):
        with ownership.startup_guard(self.root) as release:
            with self.assertRaisesRegex(RuntimeError, "正在启动"):
                with ownership.startup_guard(self.root):
                    self.fail("启动锁失效")
            release()
            with ownership.startup_guard(self.root):
                pass
        with self.assertRaisesRegex(RuntimeError, "测试异常"):
            with ownership.startup_guard(self.root):
                raise RuntimeError("测试异常")
        with ownership.startup_guard(self.root):
            pass

    def test_orphan_web_worker_share_runtime_only(self):
        def role(pid, name, runtime="dev-one"):
            executable = self.root / f".runtime/{runtime}/generation-1/{name}"
            return ownership.Process(pid, 1, str(pid), self.root, (str(executable),), executable)

        web, worker, other = role(901, "web"), role(902, "worker"), role(903, "worker", "dev-two")
        self.assertEqual(
            ownership.orphan_runtime(web, self.root, self.module), self.root / ".runtime/dev-one"
        )
        processes = {p.pid: p for p in (web, worker, other)}
        with (
            patch.object(ownership, "process_snapshot", return_value=processes),
            patch.object(ownership, "port_owners", return_value=({web.pid}, True)),
        ):
            selected, leaders = ownership.takeover_plan(
                [("Web", "127.0.0.1", 12345)], self.root, self.module
            )
        self.assertEqual(set(selected), {web.pid, worker.pid})
        self.assertFalse(leaders)
        self.assertIsNone(
            ownership.orphan_runtime(replace(web, cwd=self.root.parent), self.root, self.module)
        )
        self.assertIsNone(
            ownership.orphan_runtime(
                replace(web, executable=self.root / "bin/web"), self.root, self.module
            )
        )

    def test_orphan_vite_requires_matching_cache_and_directory(self):
        script = self.module / "frontend/node_modules/vite/bin/vite.js"
        process = ownership.Process(
            901, 1, "1", self.module / "frontend", ("node", str(script)), Path("/usr/bin/node")
        )
        cache = self.root / ".runtime/dev-one/vite-cache"
        with patch.object(Path, "read_bytes", return_value=f"VITE_CACHE_DIR={cache}\0".encode()):
            self.assertEqual(
                ownership.orphan_runtime(process, self.root, self.module), cache.parent
            )
            self.assertIsNone(
                ownership.orphan_runtime(replace(process, cwd=self.root), self.root, self.module)
            )
        with patch.object(Path, "read_bytes", return_value=b""):
            self.assertIsNone(ownership.orphan_runtime(process, self.root, self.module))
        with patch.object(
            Path, "read_bytes", return_value=b"VITE_CACHE_DIR=/other/.runtime/dev-one/vite-cache\0"
        ):
            self.assertIsNone(ownership.orphan_runtime(process, self.root, self.module))

    def test_current_process_is_preserved_even_when_supervisor_shaped(self):
        current = ownership.read_process(os.getpid())
        process = replace(current, cwd=self.root, command=(sys.executable, "scripts/dev.py"))
        with (
            patch.object(ownership, "process_snapshot", return_value={process.pid: process}),
            patch.object(ownership, "port_owners", return_value=({process.pid}, True)),
        ):
            with self.assertRaisesRegex(RuntimeError, "进程已保留"):
                ownership.takeover_plan([("Web", "127.0.0.1", 12345)], self.root, self.module)

    def test_port_race_after_cleanup_is_reported(self):
        with (
            patch.object(
                dev,
                "require_free_port",
                side_effect=[dev.PortInUse("占用"), None, dev.PortInUse("端口再次被占用")],
            ),
            patch.object(dev, "takeover_plan", return_value=({}, set())),
            patch.object(dev, "stop_owned") as stop,
        ):
            with self.assertRaisesRegex(dev.PortInUse, "端口再次被占用"):
                dev.prepare_dev_ports({}, self.module)
            stop.assert_called_once()

    def test_ipv6_and_wildcard_socket_owners(self):
        for family, host in ((socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::1")):
            with self.subTest(host=host), socket.socket(family) as holder:
                try:
                    holder.bind((host, 0))
                except OSError:
                    if family == socket.AF_INET6:
                        continue
                    raise
                holder.listen()
                owners, complete = ownership.port_owners(holder.getsockname()[1])
                self.assertTrue(complete)
                self.assertIn(os.getpid(), owners)


if __name__ == "__main__":
    unittest.main()
