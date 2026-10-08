#!/usr/bin/env python3
"""正式 Docker 验收脚本的范围、门禁、信号、隐私与清理回归。"""

import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from database_url import database_type

spec = importlib.util.spec_from_file_location(
    "docker_verification", Path(__file__).with_name("verify-project-docker.py")
)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class RecipeTests(unittest.TestCase):
    def test_postgresql_selection_discovers_colocated_tests(self):
        self.assertEqual(
            verify.POSTGRESQL_TEST_PACKAGES,
            [
                "./packages/go-server-kit/infra/database/...",
                "./packages/go-server-kit/modules/auth",
                "./projects/multi-database-demo/internal/service",
            ],
        )
        for package in verify.POSTGRESQL_TEST_PACKAGES:
            folder = verify.ROOT / package.removeprefix("./").removesuffix("/...")
            self.assertTrue(list(folder.rglob("*_test.go")), package)

    def test_mysql_settings_use_connection_url_without_driver_variable(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(verify, "ROOT", Path(folder)),
            patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
        ):
            item = verify.Verification(
                argparse.Namespace(
                    runtime_only=True,
                    keep_image=False,
                    build_proxy="",
                    pull_timeout=5,
                    registry="",
                    database="mysql",
                )
            )
            item.web_password, item.worker_password = "web-password", "worker-password"
            item.db_host, item.db_port, item.redis_url = (
                "127.0.0.1",
                3306,
                "redis://127.0.0.1:6379/0",
            )
            item.auth_secret, item.bootstrap = "secret", "bootstrap"
            item.versions, item.origins = ["202610040001"], ["http://127.0.0.1:8081"]
            for role in ("web", "worker"):
                env = item.settings(role, 12345)
                self.assertNotIn("DB_DRIVER", env)
                self.assertEqual(database_type(env["DB_DSN"]), "mysql")
                self.assertIn(f"mysql://{role}_app:", env["DB_DSN"])
                self.assertIn("@127.0.0.1:3306/demo?", env["DB_DSN"])
                self.assertEqual(env["WEB_ADDR"], "127.0.0.1:12345")

    def test_offline_recipe_reuses_formal_runtime_metadata(self):
        source = (verify.APP / "Dockerfile").read_text()
        recipe = verify.runtime_recipe(source)
        self.assertTrue(recipe.startswith("FROM scratch\n"))
        self.assertNotIn("--from=", recipe)
        self.assertNotIn("npm install", recipe)
        self.assertIn("USER 65532:65532", recipe)
        self.assertIn("STOPSIGNAL SIGTERM", recipe)
        self.assertIn('CMD ["/web"]', recipe)
        self.assertIn("COPY worker /worker", recipe)

    def test_offline_recipe_rejects_missing_runtime_stage(self):
        with self.assertRaises(RuntimeError):
            verify.runtime_recipe("FROM alpine")

    def test_offline_recipe_rejects_multiple_runtime_stages(self):
        with self.assertRaises(RuntimeError):
            verify.runtime_recipe("FROM scratch\nFROM scratch")

    def test_offline_recipe_detects_unhandled_copy_changes(self):
        source = (verify.APP / "Dockerfile").read_text()
        with self.assertRaises(RuntimeError):
            verify.runtime_recipe(source.replace("/out/web", "/out/new-web"))
        with self.assertRaises(RuntimeError):
            verify.runtime_recipe(source + "\nCOPY --from=another /file /file\n")
        with self.assertRaises(RuntimeError):
            verify.runtime_recipe(source + "\nFROM alpine\n")

    def test_migrations_include_latest_formal_auth_increment(self):
        mysql = verify.migration_versions(verify.APP / "migrations/mysql")
        sqlite = verify.migration_versions(verify.APP / "migrations/sqlite")
        self.assertEqual(mysql, sqlite)
        self.assertGreaterEqual(mysql[-1], "202610040001")

    def test_migration_versions_reject_empty_invalid_and_duplicates(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            with self.assertRaises(RuntimeError):
                verify.migration_versions(directory)
            (directory / "wrong_name.sql").touch()
            with self.assertRaises(RuntimeError):
                verify.migration_versions(directory)
            (directory / "wrong_name.sql").unlink()
            (directory / "202610040001_one.sql").touch()
            (directory / "202610040001_two.sql").touch()
            with self.assertRaises(RuntimeError):
                verify.migration_versions(directory)

    def test_network_failure_distinguishes_missing_manifest(self):
        self.assertTrue(verify.network_failure("dial tcp: i/o timeout"))
        self.assertTrue(verify.network_failure("lookup registry on DNS:53 failed"))
        self.assertFalse(verify.network_failure("manifest unknown"))
        self.assertFalse(verify.network_failure("unauthorized: authentication required"))

    def test_redaction_hides_secrets_and_registry_signed_query(self):
        text = "secret-token short https://cdn.example/layer?Encoded=temporary-credential"
        safe = verify.redact(text, ["secret-token", "short", "", "secret-token"])
        self.assertNotIn("secret-token", safe)
        self.assertNotIn("temporary-credential", safe)
        self.assertEqual(safe.count("[已隐藏]"), 3)

    def test_registry_prefix_accepts_host_port_and_path(self):
        for prefix in (
            "public.ecr.aws/docker/library",
            "registry.example:5000/library",
            "localhost:5000",
            "127.0.0.1:5000/test",
        ):
            self.assertTrue(verify.valid_registry(prefix), prefix)
        for prefix in (
            "https://registry.example",
            "host:0",
            "host:65536",
            "user:password@host",
            "host//library",
            "host/library:tag",
            "host/library/",
            "host/../library",
        ):
            self.assertFalse(verify.valid_registry(prefix), prefix)

    def test_build_proxy_url_limits_credentials_and_injection(self):
        for proxy in ("http://127.0.0.1:7897", "https://proxy.example", "http://[::1]:7897/"):
            self.assertTrue(verify.valid_build_proxy(proxy), proxy)
        for proxy in (
            "127.0.0.1:7897",
            "socks5://localhost:7897",
            "http://user:password@localhost:7897",
            "http://localhost:7897/path",
            "http://localhost:7897/?token=secret",
            "http://localhost:0",
            "http://localhost:65536",
            "http://localhost:7897\n",
            "http://[::1",
        ):
            self.assertFalse(verify.valid_build_proxy(proxy), proxy)

    def test_image_manifest_agrees_with_dockerfile_and_toolchain(self):
        images = json.loads((verify.APP / "docker-images.json").read_text())
        toolchain = json.loads((verify.ROOT / "toolchain.json").read_text())
        dockerfile = (verify.APP / "Dockerfile").read_text()
        self.assertIn("ARG NODE_IMAGE=" + images["buildImages"]["node"], dockerfile)
        self.assertIn("ARG GO_IMAGE=" + images["buildImages"]["go"], dockerfile)
        self.assertEqual(
            images["buildImages"]["node"],
            "node:" + toolchain["node"].removeprefix("v") + "-bookworm-slim",
        )
        self.assertEqual(
            images["buildImages"]["go"],
            "golang:" + toolchain["go"]["version"].removeprefix("go") + "-bookworm",
        )
        self.assertEqual(images["testImages"]["mysql"], "mysql:" + toolchain["mysql"])

    def test_digest_matches_canonical_repository_and_valid_sha256(self):
        sha = "@sha256:" + "a" * 64
        for ref, repo in (
            ("node:24", "docker.io/library/node"),
            ("docker.io/node:24", "node"),
            ("team/node:24", "docker.io/team/node"),
            ("localhost:5000/node:24", "localhost:5000/node"),
            ("registry.example/library/node:24", "registry.example/library/node"),
        ):
            self.assertEqual(verify.matching_digest(ref, [repo + sha]), repo + sha)
        for digests in ([], ["other/node" + sha], ["node@sha256:abc"]):
            with self.assertRaises(RuntimeError):
                verify.matching_digest("node:24", digests)

    def test_port_allocation_excludes_previous_port(self):
        first = verify.free_port()
        self.assertNotEqual(verify.free_port([first]), first)


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.root_patch = patch.object(verify, "ROOT", self.root)
        self.root_patch.start()
        self.stdout_patch = patch("sys.stdout", new_callable=io.StringIO)
        self.stdout_patch.start()

    def tearDown(self):
        self.stdout_patch.stop()
        self.root_patch.stop()
        self.folder.cleanup()

    def make(self, runtime_only=False, keep_image=False):
        return verify.Verification(
            argparse.Namespace(
                runtime_only=runtime_only,
                keep_image=keep_image,
                pull_timeout=5,
                registry="",
                build_proxy="",
            )
        )

    def read_report(self, runtime_only=False):
        name = (
            "project-docker-runtime-result.json" if runtime_only else "project-docker-result.json"
        )
        return json.loads((self.root / ".runtime" / name).read_text())

    def test_formal_build_uses_pulled_source_digests_and_updates_pending(self):
        item = self.make()
        item.args.registry = "registry.example:5000/library"
        item.args.build_proxy = "http://127.0.0.1:7897"
        sha = "@sha256:" + "a" * 64

        def docker(*command, **kwargs):
            if command[0] == "inspect":
                if command[1] == item.image:
                    return json.dumps(
                        [
                            {
                                "Id": "built-image",
                                "Architecture": "amd64",
                                "Config": {
                                    "User": "65532:65532",
                                    "StopSignal": "SIGTERM",
                                    "Cmd": ["/web"],
                                },
                            }
                        ]
                    )
                return json.dumps(
                    [
                        {
                            "Id": "base-image",
                            "RepoDigests": [verify.image_repository(command[1]) + sha],
                        }
                    ]
                )
            return ""

        with patch.object(item, "docker", side_effect=docker) as mock:
            item.prepare_image()
        pulls = [call.args for call in mock.call_args_list if call.args[0] == "pull"]
        self.assertEqual(len(pulls), 4)
        self.assertTrue(all(call[1].startswith(item.args.registry + "/") for call in pulls))
        builds = [call.args for call in mock.call_args_list if call.args[0] == "build"]
        self.assertEqual(len(builds), 1)
        self.assertIn("NODE_IMAGE=" + item.refs["node"], builds[0])
        self.assertIn("GO_IMAGE=" + item.refs["go"], builds[0])
        self.assertIn("--network=host", builds[0])
        self.assertIn("HTTP_PROXY=http://127.0.0.1:7897", builds[0])
        self.assertIn("HTTPS_PROXY=http://127.0.0.1:7897", builds[0])
        self.assertEqual(item.result["buildNetwork"], "host")
        self.assertEqual(item.result["buildProxy"], item.args.build_proxy)
        self.assertEqual(len(item.result["baseImages"]), 4)
        self.assertNotIn("正式多阶段 Dockerfile 构建与基础镜像摘要", item.result["pending"])
        self.assertIn("MySQL／Redis 依赖容器拓扑", item.result["pending"])
        self.assertTrue(item.built)

    def test_formal_build_rejects_digest_from_another_source(self):
        item = self.make()
        sha = "@sha256:" + "a" * 64

        def docker(*command, **kwargs):
            if command[0] == "inspect":
                return json.dumps(
                    [{"Id": "base-image", "RepoDigests": ["untrusted.example/node" + sha]}]
                )
            return ""

        with patch.object(item, "docker", side_effect=docker) as mock:
            with self.assertRaises(RuntimeError):
                item.prepare_image()
        self.assertFalse(any(call.args[0] == "build" for call in mock.call_args_list))
        self.assertIn("正式多阶段 Dockerfile 构建与基础镜像摘要", item.result["pending"])

    def test_missing_engine_writes_blocked_report_and_exit_two(self):
        item = self.make()
        with patch.object(verify.shutil, "which", return_value=None):
            self.assertEqual(item.execute(), 2)
        self.assertEqual(self.read_report()["status"], "blocked")
        self.assertEqual(self.read_report()["cleanupErrors"], [])

    def test_engine_access_error_writes_blocked_report(self):
        item = self.make()
        with (
            patch.object(verify.shutil, "which", return_value="docker"),
            patch.object(item, "docker", side_effect=RuntimeError("permission denied")),
        ):
            self.assertEqual(item.execute(), 2)
        self.assertIn("permission denied", self.read_report()["reason"])

    def test_scope_reports_remain_separate_and_offline_keeps_pending_items(self):
        full, offline = self.make(), self.make(runtime_only=True)
        for item in (full, offline):
            with (
                patch.object(verify.shutil, "which", return_value="docker"),
                patch.object(item, "docker", return_value="29.1.3"),
                patch.object(item, "prepare_image"),
                patch.object(item, "prepare_database"),
                patch.object(item, "verify_application"),
            ):
                self.assertEqual(item.execute(), 0)
        self.assertEqual(self.read_report()["scope"], "full-build-and-runtime")
        report = self.read_report(True)
        self.assertEqual(report["scope"], "offline-runtime")
        self.assertIn("正式多阶段 Dockerfile 构建与基础镜像摘要", report["pending"])
        self.assertIn("MySQL／Redis 依赖容器拓扑", report["pending"])

    def test_failure_still_cleans_private_environment_files(self):
        item = self.make()
        env = item.envfile({"AUTH_SECRET": "a-test-secret"})
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        self.assertEqual(item.runtime.stat().st_mode & 0o777, 0o700)
        with (
            patch.object(verify.shutil, "which", return_value="docker"),
            patch.object(item, "docker", return_value="29.1.3"),
            patch.object(item, "prepare_image", side_effect=RuntimeError("build failed")),
        ):
            self.assertEqual(item.execute(), 1)
        self.assertFalse(env.exists())
        self.assertEqual(self.read_report()["status"], "failed")

    def test_cleanup_failure_overrides_pass_and_exit_code(self):
        item = self.make()
        item.network = "owned-network"

        def docker(*command, **kwargs):
            if command == ("network", "rm", "owned-network"):
                raise RuntimeError("cleanup failed")
            return "29.1.3"

        with (
            patch.object(verify.shutil, "which", return_value="docker"),
            patch.object(item, "docker", side_effect=docker),
            patch.object(item, "prepare_image"),
            patch.object(item, "prepare_database"),
            patch.object(item, "verify_application"),
        ):
            self.assertEqual(item.execute(), 1)
        self.assertEqual(self.read_report()["status"], "failed")
        self.assertEqual(self.read_report()["cleanupErrors"], ["cleanup failed"])

    def test_docker_cli_proxy_is_scoped_and_overrides_inherited_values(self):
        item = self.make()
        item.args.build_proxy = "http://127.0.0.1:7897"
        inherited = {"HTTP_PROXY": "http://old:1", "no_proxy": "*"}
        with patch.dict(verify.os.environ, inherited), patch.object(item, "run") as run:
            item.docker("build", ".")
            env = run.call_args.kwargs["env"]
            for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
                self.assertEqual(env[key], item.args.build_proxy)
            for key in ("NO_PROXY", "no_proxy"):
                self.assertEqual(env[key], "localhost,127.0.0.1,::1")
            self.assertEqual(verify.os.environ["HTTP_PROXY"], inherited["HTTP_PROXY"])
            self.assertEqual(verify.os.environ["no_proxy"], "*")

    def test_docker_cli_without_proxy_preserves_default_environment(self):
        item = self.make()
        with patch.object(item, "run") as run:
            item.docker("info")
            self.assertIsNone(run.call_args.kwargs["env"])

    def test_image_retention_is_explicit(self):
        for keep in (False, True):
            item = self.make(keep_image=keep)
            item.built = True
            with patch.object(item, "docker") as docker:
                item.cleanup()
            if keep:
                docker.assert_not_called()
            else:
                docker.assert_called_once_with("image", "rm", item.image)

    def test_failed_build_registers_image_cleanup(self):
        item = self.make()

        def docker(*command, **kwargs):
            if command[0] == "build":
                raise RuntimeError("build failed after tagging")

        with patch.object(item, "docker", side_effect=docker) as mock:
            with self.assertRaises(RuntimeError):
                item.build_image("-t", item.image, self.root)
            self.assertTrue(item.build_attempted)
            self.assertFalse(item.built)
            self.assertEqual(item.cleanup(), [])
            mock.assert_called_with("image", "rm", item.image)

    def test_full_build_network_errors_are_blocked_and_keep_pending(self):
        item = self.make()
        with patch.object(item, "docker", side_effect=RuntimeError("download: i/o timeout")):
            with self.assertRaises(verify.Blocked):
                item.build_image("-t", item.image, self.root)
        self.assertTrue(item.build_attempted)
        self.assertFalse(item.built)
        self.assertIn("正式多阶段 Dockerfile 构建与基础镜像摘要", item.result["pending"])
        item = self.make(runtime_only=True)
        with patch.object(item, "docker", side_effect=RuntimeError("download: i/o timeout")):
            with self.assertRaises(RuntimeError) as raised:
                item.build_image("-t", item.image, self.root)
            self.assertNotIsInstance(raised.exception, verify.Blocked)

    def test_cleanup_ignores_only_explicit_missing_owned_resources(self):
        item = self.make()
        item.containers = ["owned-container"]
        item.network = "owned-network"
        item.build_attempted = True

        def docker(*command, **kwargs):
            if command[0] == "rm":
                raise RuntimeError("Error response from daemon: No such container: owned-container")
            if command[0] == "network":
                raise RuntimeError("network owned-network not found")
            raise RuntimeError("No such image: " + item.image)

        with (
            patch.object(item, "docker", side_effect=docker),
            patch.object(verify.subprocess, "run", return_value=Mock(stdout="")),
        ):
            self.assertEqual(item.cleanup(), [])
        with (
            patch.object(item, "docker", side_effect=RuntimeError("permission denied")),
            patch.object(verify.subprocess, "run", return_value=Mock(stdout="")),
        ):
            self.assertEqual(len(item.cleanup()), 3)

    def test_environment_file_rejects_newline_injection(self):
        item = self.make()
        with self.assertRaises(RuntimeError):
            item.envfile({"KEY": "value\nEXTRA=value"})
        with self.assertRaises(RuntimeError):
            item.envfile({"KEY": "value\rEXTRA=value"})
        with self.assertRaises(RuntimeError):
            item.envfile({"KEY\nEXTRA": "value"})

    def test_run_redacts_output_before_writing_failure_log(self):
        item = self.make()
        item.private = ["temporary-secret"]
        completed = Mock(returncode=1, stdout="failed with temporary-secret")
        with patch.object(verify.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "已隐藏"):
                item.run(["dummy"], "test-log")
        self.assertNotIn("temporary-secret", (item.runtime / "test-log.log").read_text())

    def test_source_network_block_records_exit_two(self):
        item = self.make()
        with (
            patch.object(verify.shutil, "which", return_value="docker"),
            patch.object(item, "docker", return_value="29.1.3"),
            patch.object(item, "prepare_image", side_effect=verify.Blocked("network unavailable")),
        ):
            self.assertEqual(item.execute(), 2)
        self.assertEqual(self.read_report()["status"], "blocked")
        self.assertIn("正式多阶段 Dockerfile 构建与基础镜像摘要", self.read_report()["pending"])
        self.assertIn("MySQL／Redis 依赖容器拓扑", self.read_report()["pending"])

    def test_launch_registers_container_before_start_failure(self):
        item = self.make()
        with patch.object(item, "docker", side_effect=RuntimeError("launch failed")):
            with self.assertRaises(RuntimeError):
                item.launch("web", {"AUTH_SECRET": "test"})
        self.assertEqual(len(item.containers), 1)
        self.assertTrue(item.containers[0].endswith("-web"))

    def test_log_timeout_still_removes_all_owned_containers(self):
        item = self.make()
        item.containers = ["owned-a", "owned-b"]
        with (
            patch.object(
                verify.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker logs", 10)
            ),
            patch.object(item, "docker") as docker,
        ):
            errors = item.cleanup()
        self.assertEqual(len(errors), 2)
        self.assertEqual(
            [call.args for call in docker.call_args_list],
            [("rm", "-f", "-v", "owned-b"), ("rm", "-f", "-v", "owned-a")],
        )
        self.assertEqual(item.result["status"], "failed")

    def test_log_write_failure_still_removes_owned_container(self):
        item = self.make()
        item.containers = ["owned-container"]
        with (
            patch.object(verify.subprocess, "run", return_value=Mock(stdout="container logs")),
            patch.object(Path, "write_text", side_effect=OSError("日志磁盘已满")),
            patch.object(item, "docker") as docker,
        ):
            self.assertEqual(item.cleanup(), ["日志磁盘已满"])
        docker.assert_called_once_with("rm", "-f", "-v", "owned-container", timeout=30)

    def test_log_failure_marks_report_failed_after_removal(self):
        item = self.make()
        item.containers = ["owned-container"]
        envfile = item.envfile({"AUTH_SECRET": "synthetic-secret"})
        with (
            patch.object(verify.shutil, "which", return_value="docker"),
            patch.object(item, "docker", return_value="29.1.3") as docker,
            patch.object(item, "prepare_image"),
            patch.object(item, "prepare_database"),
            patch.object(item, "verify_application"),
            patch.object(
                verify.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker logs", 10)
            ),
        ):
            self.assertEqual(item.execute(), 1)
        docker.assert_any_call("rm", "-f", "-v", "owned-container", timeout=30)
        self.assertFalse(envfile.exists())
        self.assertEqual(self.read_report()["status"], "failed")
        self.assertEqual(len(self.read_report()["cleanupErrors"]), 1)

    def test_execute_restores_previous_sigterm_handler(self):
        previous = signal.getsignal(signal.SIGTERM)
        with patch.object(verify.shutil, "which", return_value=None):
            self.assertEqual(self.make().execute(), 2)
        self.assertEqual(signal.getsignal(signal.SIGTERM), previous)

    @unittest.skipUnless(os.name == "posix", "真实信号与依赖进程组需要 POSIX")
    def test_real_sigterm_cleans_process_envfile_and_writes_failed_report(self):
        script = textwrap.dedent(
            """
            import argparse, importlib.util, json, os, signal, sys
            from pathlib import Path
            module, root = Path(sys.argv[1]), Path(sys.argv[2])
            sys.path.insert(0, str(module.parent))
            spec = importlib.util.spec_from_file_location("verifier", module)
            v = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(v)
            v.ROOT = root
            v.shutil.which = lambda tool: "synthetic-docker"
            class Probe(v.Verification):
                def docker(self, *args, **kwargs):
                    return "synthetic-engine"
                def prepare_image(self):
                    child = self.start(
                        [sys.executable, "-c", "import time; time.sleep(60)"], "dependency"
                    )
                    envfile = self.envfile({"AUTH_SECRET": "synthetic-secret"})
                    (root / "ready.tmp").write_text(json.dumps({
                        "pid": child.pid, "envfile": str(envfile), "runtime": str(self.runtime)
                    }))
                    (root / "ready.tmp").replace(root / "ready.json")
                    signal.pause()
                def cleanup(self):
                    # 第二次 SIGTERM 到达清理阶段时仍应完成当前清理。
                    os.kill(os.getpid(), signal.SIGTERM)
                    return super().cleanup()
            args = argparse.Namespace(
                runtime_only=True, keep_image=False, pull_timeout=5, registry="", build_proxy=""
            )
            sys.exit(Probe(args).execute())
            """
        )
        child = subprocess.Popen(
            [sys.executable, "-c", script, verify.__file__, str(self.root)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        info = None
        try:
            ready = self.root / "ready.json"
            deadline = time.monotonic() + 10
            while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(ready.exists(), "信号测试子进程需要创建依赖与凭据文件")
            info = json.loads(ready.read_text())
            child.send_signal(signal.SIGTERM)
            output, _ = child.communicate(timeout=10)
            self.assertEqual(child.returncode, 1, output)
            self.assertFalse(Path(info["envfile"]).exists())
            with self.assertRaises(ProcessLookupError):
                os.kill(info["pid"], 0)
            report = self.read_report(runtime_only=True)
            self.assertEqual(report["status"], "failed")
            self.assertIn("SIGTERM", report["error"])
            self.assertEqual(report["cleanupErrors"], [])
            self.assertEqual(
                json.loads((Path(info["runtime"]) / "result.json").read_text()), report
            )
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)
            if info:
                try:
                    os.killpg(info["pid"], signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def gate_fixture(self, runtime_only):
        item = self.make(runtime_only=runtime_only)
        item.auth_secret, item.bootstrap = "auth-secret", "bootstrap"
        item.web_password, item.worker_password = "web-password", "worker-password"
        item.db_host, item.db_port = "127.0.0.1", 3306
        item.redis_url = "redis://127.0.0.1:6379/0"
        item.versions = ["202610040001"]
        item.origins = ["http://127.0.0.1:18080", "http://127.0.0.1:18081"]
        item.network = None if runtime_only else "owned-network"
        return item

    def exercise_gates(self, item, wrong_error=None, control_ready=True):
        errors = {
            "version": "数据库迁移版本不匹配",
            "mode": "APP_MODE 需要显式选择 development 或 production",
            "missing": "数据库版本检查失败",
        }

        def docker(*command, **kwargs):
            if command[0] == "run" and "-d" not in command:
                name = command[command.index("--name") + 1]
                label = name.rsplit("-", 1)[-1]
                role = "Web" if command[-1] == "/web" else "Worker"
                return json.dumps(
                    {"level": "ERROR", "msg": role + " 退出", "error": wrong_error or errors[label]}
                )
            return ""

        def inspect(name):
            return {
                "State": {
                    "ExitCode": 0 if name.endswith("-gate-valid-web") else 1,
                    "Running": False,
                    "OOMKilled": False,
                }
            }

        with (
            patch.object(item, "docker", side_effect=docker) as run,
            patch.object(item, "inspect", side_effect=inspect),
            patch.object(item, "http", return_value=(200 if control_ready else 503, {}, b"")),
            patch.object(item, "sql", return_value="0"),
            patch.object(item, "wait", side_effect=lambda fn, name: verify.ensure(fn(), name)),
        ):
            item.verify_startup_gates([3306, 6379, 18080, 18081])
        return run

    def test_startup_gates_use_unique_ports_and_expected_error_reasons(self):
        for runtime_only in (False, True):
            with self.subTest(runtime_only=runtime_only):
                item = self.gate_fixture(runtime_only)
                run = self.exercise_gates(item)
                self.assertEqual(len(item.env_files), 7)
                configs = [
                    dict(line.split("=", 1) for line in file.read_text().splitlines())
                    for file in item.env_files
                ]
                ports = [int(config["INSTANCE_ID"].rsplit("-", 1)[-1]) for config in configs]
                self.assertEqual(len(set(ports)), 7)
                self.assertFalse(set(ports) & {3306, 6379, 18080, 18081})
                if runtime_only:
                    self.assertEqual(
                        [config["WEB_ADDR"] for config in configs],
                        [f"127.0.0.1:{port}" for port in ports],
                    )
                calls = [call for call in run.call_args_list if call.args[0] == "run"]
                self.assertEqual(len(calls), 7)
                self.assertIn("-d", calls[0].args)
                self.assertTrue(all(call.kwargs["expected"] == 1 for call in calls[1:]))
                self.assertEqual(configs[1]["DB_VERSION"], "202610040002")
                self.assertEqual(configs[2]["APP_MODE"], "invalid")
                self.assertIn("/missing?", configs[3]["DB_DSN"])
                self.assertEqual(len(item.result["checks"]), 1)

    def test_startup_gates_reject_bind_failure_with_exit_one(self):
        item = self.gate_fixture(runtime_only=True)
        with self.assertRaisesRegex(RuntimeError, "启动门禁错误原因需要匹配 web/version"):
            self.exercise_gates(item, wrong_error="Web 监听失败")
        self.assertEqual(item.result["checks"], [])

    def test_startup_gates_require_healthy_positive_control(self):
        item = self.gate_fixture(runtime_only=True)
        with self.assertRaisesRegex(RuntimeError, "有效配置正向对照"):
            self.exercise_gates(item, control_ready=False)
        self.assertEqual(len(item.env_files), 1)
        self.assertEqual(item.result["checks"], [])


class ArgumentsTests(unittest.TestCase):
    def test_invalid_pull_timeout_exits_before_runtime_created(self):
        for value in ("0", "4", "901"):
            with (
                patch("sys.stderr", new_callable=io.StringIO),
                patch.object(verify, "Verification") as constructor,
            ):
                with self.assertRaises(SystemExit):
                    verify.main(["--pull-timeout", value])
                constructor.assert_not_called()

    def test_url_registry_is_rejected_before_runtime_created(self):
        with (
            patch("sys.stderr", new_callable=io.StringIO),
            patch.object(verify, "Verification") as constructor,
        ):
            with self.assertRaises(SystemExit):
                verify.main(["--registry", "https://registry.example"])
            constructor.assert_not_called()

    def test_invalid_build_proxy_is_rejected_before_runtime_created(self):
        with (
            patch("sys.stderr", new_callable=io.StringIO),
            patch.object(verify, "Verification") as constructor,
        ):
            with self.assertRaises(SystemExit):
                verify.main(["--build-proxy", "http://user:secret@127.0.0.1:7897"])
            constructor.assert_not_called()

    def test_runtime_build_proxy_combination_is_rejected(self):
        with patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit):
                verify.main(["--runtime-only", "--build-proxy", "http://127.0.0.1:7897"])

    def test_runtime_registry_combination_is_rejected(self):
        with patch("sys.stderr", new_callable=io.StringIO):
            with self.assertRaises(SystemExit):
                verify.main(["--runtime-only", "--registry", "registry.example/library"])


if __name__ == "__main__":
    unittest.main()
