#!/usr/bin/env python3
"""验证产物保留、符号链接、进程租约、缓存锁和生命周期接入。"""

import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, MagicMock

import runtime_cleanup as cleanup
import project


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        environment = patch.dict(os.environ, STARTER_ISOLATED_BUILD="0")
        environment.start()
        self.addCleanup(environment.stop)
        self.base = cleanup.runtime_base(self.root)
        self.refs = patch.object(cleanup, "process_references", return_value=([], []))
        self.refs.start()
        self.addCleanup(self.refs.stop)

    def make(self, name="project-abcdefgh", kind="project", status="passed", age=0, **extra):
        path = self.base / name
        path.mkdir()
        record = dict(
            version=1, kind=kind, status=status, completedAt=time.time() - age, cleanupErrors=[]
        )
        record.update(extra)
        cleanup.write_json(path / cleanup.MANIFEST, record)
        (path / "result.json").write_text(json.dumps({"runtime": str(path), "status": status}))
        (path / "test.log").write_text("诊断记录")
        (path / "workspace").mkdir()
        (path / "workspace/main").write_bytes(b"x" * 8192)
        return path

    def test_success_compacts_and_keeps_reports(self):
        path = self.make()
        (path / "mysql").mkdir()
        report = cleanup.maintain(self.root)
        self.assertEqual(report["errors"], [])
        self.assertFalse((path / "workspace").exists())
        self.assertFalse((path / "mysql").exists())
        self.assertTrue((path / "result.json").is_file())
        self.assertTrue((path / "test.log").is_file())
        self.assertFalse(cleanup.read_json(path / cleanup.MANIFEST)["artifactsRetained"])

    def test_preview_is_read_only(self):
        path = self.make()
        before = {
            p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()
        }
        report = cleanup.maintain(self.root, dry_run=True)
        after = {
            p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()
        }
        self.assertEqual(before, after)
        self.assertGreater(report["estimatedReclaimBytes"], 0)
        self.assertEqual(report["entries"][0]["action"], "回收大产物")
        self.assertTrue((path / "workspace").exists())

    def test_preview_empty_root_creates_no_files(self):
        (self.base).rmdir()
        cleanup.maintain(self.root, dry_run=True, cache=True)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_failure_grace_keeps_full_scene(self):
        path = self.make(status="failed", age=47 * 3600)
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").is_dir())

    def test_failure_after_grace_compacts_scene(self):
        path = self.make(status="failed", age=49 * 3600)
        cleanup.maintain(self.root)
        self.assertFalse((path / "workspace").exists())
        self.assertTrue((path / "result.json").is_file())

    def test_expired_success_report_deleted(self):
        path = self.make(age=8 * 86400)
        cleanup.maintain(self.root)
        self.assertFalse(path.exists())

    def test_failed_report_retained_for_fourteen_days(self):
        path = self.make(status="failed", age=8 * 86400)
        cleanup.maintain(self.root)
        self.assertTrue(path.exists())
        self.assertFalse((path / "workspace").exists())
        record = cleanup.read_json(path / cleanup.MANIFEST)
        record["completedAt"] = time.time() - 15 * 86400
        cleanup.write_json(path / cleanup.MANIFEST, record)
        cleanup.maintain(self.root)
        self.assertFalse(path.exists())

    def test_document_reference_keeps_evidence(self):
        for reference in (str(self.base), ".runtime"):
            with self.subTest(reference=reference):
                path = self.make(age=20 * 86400)
                (self.root / "docs").mkdir(exist_ok=True)
                (self.root / "docs/evidence.md").write_text(
                    reference + "/" + path.name + "/result.json"
                )
                cleanup.maintain(self.root)
                self.assertTrue((path / "result.json").is_file())
                self.assertFalse((path / "workspace").exists())
                import shutil

                shutil.rmtree(path)

    def test_latest_json_keeps_evidence(self):
        path = self.make(age=20 * 86400)
        cleanup.write_json(self.base / "project-latest.json", {"runtime": str(path)})
        cleanup.maintain(self.root)
        self.assertTrue((path / "result.json").is_file())
        self.assertFalse((path / "workspace").exists())

    def test_latest_symlink_keeps_evidence(self):
        path = self.make(age=20 * 86400)
        (self.base / "project-latest").symlink_to(path, target_is_directory=True)
        cleanup.maintain(self.root)
        self.assertTrue((path / "result.json").exists())
        self.assertTrue((self.base / "project-latest").is_symlink())

    def test_keep_marker_preserves_full_scene(self):
        path = self.make(age=20 * 86400)
        (path / cleanup.PIN).touch()
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_keep_option_preserves_full_scene(self):
        path = self.make(age=20 * 86400, keepRuntime=True)
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_cleanup_error_preserves_scene(self):
        path = self.make(age=20 * 86400, cleanupErrors=["进程退出待确认"])
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_process_reference_preserves_scene(self):
        path = self.make(age=20 * 86400)
        with patch.object(cleanup, "process_references", return_value=([str(path / "mysql")], [])):
            cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_path_boundary_avoids_prefix_collision(self):
        path = self.make()
        self.assertFalse(cleanup.referenced(path, [str(path) + "-other/bin"]))
        self.assertTrue(cleanup.referenced(path, ["--runtime=" + str(path)]))

    def test_lease_lock_protects_even_completed_record(self):
        path = self.make()
        with (path / ".run.lock").open("a+") as lock:
            import fcntl

            fcntl.flock(lock, fcntl.LOCK_EX)
            report = cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())
        self.assertEqual(report["entries"][0]["reason"], "运行锁占用")

    def test_lease_finish_recycles_immediately(self):
        path = self.base / "project-abcdefgh"
        path.mkdir()
        lease = cleanup.RunLease(self.root, path, "project")
        (path / "workspace").mkdir()
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())
        lease.finish("passed")
        self.assertFalse((path / "workspace").exists())

    def test_lease_finish_cleanup_failure_keeps_scene(self):
        path = self.base / "project-abcdefgh"
        path.mkdir()
        lease = cleanup.RunLease(self.root, path, "project")
        (path / "workspace").mkdir()
        lease.finish("passed", ["待确认进程"])
        self.assertTrue((path / "workspace").exists())

    def test_crashed_run_gets_new_grace_window(self):
        path = self.make(status="running", age=20 * 86400, ownerPID=999999999, ownerStart="1")
        cleanup.maintain(self.root)
        record = cleanup.read_json(path / cleanup.MANIFEST)
        self.assertEqual(record["status"], "failed")
        self.assertTrue(record["interrupted"])
        self.assertLess(time.time() - record["completedAt"], 5)
        self.assertTrue((path / "workspace").exists())

    def test_pid_reuse_is_recognized(self):
        path = self.make(status="running", ownerPID=os.getpid(), ownerStart="旧身份")
        cleanup.maintain(self.root)
        self.assertTrue(cleanup.read_json(path / cleanup.MANIFEST)["interrupted"])

    def test_unknown_manual_directory_preserved(self):
        path = self.base / "manual-backup"
        path.mkdir()
        (path / "main").touch()
        cleanup.maintain(self.root)
        self.assertTrue((path / "main").exists())

    def test_legacy_success_can_be_compacted(self):
        path = self.make()
        (path / cleanup.MANIFEST).unlink()
        cleanup.maintain(self.root)
        self.assertFalse((path / "workspace").exists())
        self.assertTrue((path / "result.json").exists())

    def test_legacy_wrong_runtime_is_preserved(self):
        path = self.make()
        (path / cleanup.MANIFEST).unlink()
        cleanup.write_json(path / "result.json", {"status": "passed", "runtime": "/other/path"})
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_corrupt_manifest_preserves_scene(self):
        path = self.make()
        (path / cleanup.MANIFEST).write_text("broken")
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_invalid_completed_time_preserves_scene(self):
        path = self.make(completedAt="yesterday")
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())

    def test_artifact_symlink_unlinked_without_following(self):
        path = self.make()
        import shutil

        shutil.rmtree(path / "workspace")
        outside = self.root / "shared"
        outside.mkdir()
        (outside / "important").write_text("保留")
        (path / "workspace").symlink_to(outside, target_is_directory=True)
        cleanup.maintain(self.root)
        self.assertTrue((outside / "important").exists())
        self.assertFalse((path / "workspace").is_symlink())

    def test_nested_shared_cache_link_preserved(self):
        path = self.make()
        outside = self.root / "shared"
        outside.mkdir()
        (outside / "important").write_text("保留")
        (path / "workspace/shared").symlink_to(outside, target_is_directory=True)
        cleanup.maintain(self.root)
        self.assertTrue((outside / "important").exists())

    def test_runtime_symlink_preserved(self):
        target = self.root / "outside"
        target.mkdir()
        (target / "important").touch()
        (self.base / "project-abcdefgh").symlink_to(target, target_is_directory=True)
        cleanup.maintain(self.root)
        self.assertTrue((target / "important").exists())

    def test_symlinked_runtime_root_is_rejected(self):
        self.base.rmdir()
        outside = self.root / "outside"
        outside.mkdir()
        self.base.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "真实目录"):
            cleanup.maintain(self.root, dry_run=True)
        self.assertEqual(list(outside.iterdir()), [])

    def test_escaping_only_path_is_preserved(self):
        path = self.root / "outside"
        path.mkdir()
        cleanup.write_json(
            path / cleanup.MANIFEST,
            dict(version=1, kind="project", status="passed", completedAt=time.time()),
        )
        (path / "workspace").mkdir()
        report = cleanup.maintain(self.root, only=path)
        self.assertTrue(report["errors"])
        self.assertTrue((path / "workspace").exists())

    def test_symlinked_run_lock_is_protected(self):
        path = self.make()
        outside = self.root / "lock-target"
        outside.write_text("保留")
        (path / ".run.lock").symlink_to(outside)
        cleanup.maintain(self.root)
        self.assertTrue((path / "workspace").exists())
        self.assertEqual(outside.read_text(), "保留")

    def test_dev_generation_logs_retained(self):
        path = self.make(name="dev-abcdefgh", kind="dev", status="stopped")
        folder = path / "generation-1"
        folder.mkdir()
        (folder / "web").write_bytes(b"binary")
        (folder / "web-build.log").write_text("编译输出")
        (folder / "worker.log").write_text("运行输出")
        cleanup.maintain(self.root)
        self.assertFalse(folder.exists())
        self.assertEqual((path / "generation-1-web-build.log").read_text(), "编译输出")
        self.assertEqual((path / "generation-1-worker.log").read_text(), "运行输出")

    def test_hourly_automatic_throttle(self):
        cleanup.maintain(self.root, automatic=True)
        with patch.object(cleanup, "process_references") as refs:
            result = cleanup.maintain(self.root, automatic=True)
        refs.assert_not_called()
        self.assertIn("每小时", result["skipped"])

    def test_invalid_sweep_timestamp_warns_and_preserves_scene(self):
        path = self.make()
        invalid_values = [
            "invalid",
            None,
            True,
            [],
            {},
            float("nan"),
            float("inf"),
            float("-inf"),
            -1,
            time.time() + 3600,
            10**400,
        ]
        for timestamp in invalid_values:
            with self.subTest(timestamp=timestamp):
                state = self.base / "cleanup-latest.json"
                cleanup.write_json(state, {"sweptAt": timestamp})
                before = state.read_bytes()
                output = io.StringIO()
                with (
                    contextlib.redirect_stdout(output),
                    patch.object(cleanup, "process_references", return_value=([], [])) as refs,
                    patch.object(cleanup, "clean_cache") as cache,
                ):
                    report = cleanup.safe_maintain(self.root, automatic=True, cache=True)
                self.assertIn("待确认", report["skipped"])
                self.assertIn("sweptAt", report["errors"][0])
                self.assertIn("运行产物清理待处理", output.getvalue())
                refs.assert_not_called()
                cache.assert_not_called()
                self.assertEqual(state.read_bytes(), before)
                self.assertTrue((path / "workspace").is_dir())

    def test_manual_sweep_rebuilds_invalid_timestamp(self):
        path = self.make()
        state = self.base / "cleanup-latest.json"
        cleanup.write_json(state, {"sweptAt": None})
        report = cleanup.maintain(self.root)
        self.assertEqual(report["errors"], [])
        self.assertFalse((path / "workspace").exists())
        self.assertIsInstance(cleanup.read_json(state)["sweptAt"], float)
        with patch.object(cleanup, "process_references") as refs:
            report = cleanup.maintain(self.root, automatic=True)
        refs.assert_not_called()
        self.assertIn("每小时", report["skipped"])

    def test_missing_sweep_timestamp_runs_automatic_cleanup(self):
        path = self.make()
        cleanup.write_json(self.base / "cleanup-latest.json", {})
        report = cleanup.maintain(self.root, automatic=True)
        self.assertEqual(report["errors"], [])
        self.assertFalse((path / "workspace").exists())

    def test_isolated_child_skips_global_sweep(self):
        with patch.dict(os.environ, STARTER_ISOLATED_BUILD="1"):
            report = cleanup.maintain(self.root, automatic=True, cache=True)
        self.assertIn("父运行", report["skipped"])

    def test_disk_size_deduplicates_hardlinks(self):
        file = self.base / "first"
        file.write_bytes(b"x" * 8192)
        os.link(file, self.base / "second")
        expected = file.stat().st_blocks * 512 + self.base.stat().st_blocks * 512
        self.assertEqual(cleanup.disk_size(self.base), expected)

    def test_cleanup_failure_is_reported(self):
        self.make()
        with patch.object(cleanup.shutil, "rmtree", side_effect=OSError("测试删除失败")):
            report = cleanup.maintain(self.root)
        self.assertIn("测试删除失败", report["errors"][0])


class CacheTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / ".tools/gocache"
        self.cache.mkdir(parents=True)
        self.go = self.root / ".tools/go/bin/go"
        self.go.parent.mkdir(parents=True)
        self.go.touch()
        for name, value in (("process_references", ([], [])), ("disk_size", 13 * cleanup.GIB)):
            item = patch.object(cleanup, name, return_value=value)
            item.start()
            self.addCleanup(item.stop)

    def test_under_limit_keeps_cache(self):
        with (
            patch.object(cleanup, "disk_size", return_value=cleanup.CACHE_LIMIT),
            patch.object(cleanup.subprocess, "run") as run,
        ):
            report = cleanup.clean_cache(self.root)
        self.assertEqual(report["action"], "保留")
        run.assert_not_called()

    def test_over_limit_uses_official_command_and_scoped_environment(self):
        with (
            patch.object(cleanup.subprocess, "run") as run,
            patch.dict(os.environ, GOFLAGS="-bad", GOCACHEPROG="other"),
        ):
            report = cleanup.clean_cache(self.root)
        self.assertEqual(report["action"], "回收Go缓存")
        self.assertEqual(run.call_args.args[0], [str(self.go), "clean", "-cache"])
        env = run.call_args.kwargs["env"]
        self.assertEqual(env["GOCACHE"], str(self.cache))
        self.assertEqual(env["GOWORK"], "off")
        self.assertNotIn("GOFLAGS", env)
        self.assertNotIn("GOCACHEPROG", env)

    def test_preview_creates_no_lock_or_clear(self):
        with patch.object(cleanup.subprocess, "run") as run:
            report = cleanup.clean_cache(self.root, dry_run=True)
        self.assertEqual(report["action"], "回收Go缓存")
        run.assert_not_called()
        self.assertFalse((self.cache.parent / ".gocache-clean.lock").exists())

    def test_go_process_blocks_clear(self):
        with (
            patch.object(cleanup, "process_references", return_value=([], [("123", "go")])),
            patch.object(cleanup.subprocess, "run") as run,
        ):
            report = cleanup.clean_cache(self.root)
        self.assertIn("活跃", report["reason"])
        run.assert_not_called()

    def test_shared_activity_lock_blocks_clear(self):
        with cleanup.cache_activity(self.root), patch.object(cleanup.subprocess, "run") as run:
            report = cleanup.clean_cache(self.root)
        self.assertIn("缓存锁", report["reason"])
        run.assert_not_called()

    def test_isolated_workspace_uses_original_cache_lock(self):
        snapshot = self.root / "snapshot"
        (snapshot / ".tools").mkdir(parents=True)
        (snapshot / ".tools/gocache").symlink_to(self.cache, target_is_directory=True)
        with cleanup.cache_activity(snapshot), patch.object(cleanup.subprocess, "run") as run:
            report = cleanup.clean_cache(self.root)
        self.assertIn("缓存锁", report["reason"])
        run.assert_not_called()
        self.assertIn("主仓库", cleanup.clean_cache(snapshot)["reason"])

    def test_missing_toolchain_keeps_cache(self):
        self.go.unlink()
        report = cleanup.clean_cache(self.root)
        self.assertIn("尚未准备", report["reason"])

    def test_command_failure_is_visible(self):
        with patch.object(
            cleanup.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "go")
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                cleanup.clean_cache(self.root)


class LifecycleTest(unittest.TestCase):
    def test_isolated_environment_trimpath_preserves_other_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            go = root / ".tools/go/bin/go"
            go.parent.mkdir(parents=True)
            go.touch()
            for flags, expected in (
                ("-tags=demo", "-tags=demo -trimpath"),
                ("-trimpath", "-trimpath"),
                ("-trimpath=false", "-trimpath=false"),
            ):
                with (
                    patch.object(project, "ROOT", root),
                    patch.object(project, "APP", root / "app"),
                    patch.dict(
                        os.environ, {"GOFLAGS": flags, "STARTER_ISOLATED_BUILD": "1"}, clear=True
                    ),
                ):
                    _, env = project.environment()
                self.assertEqual(env["GOFLAGS"], expected)

    def test_parent_verifier_registers_lease_and_recycles_snapshot(self):
        verify = load("verify_cleanup_test", "verify-project.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def workspace(source, destination):
                destination.mkdir()
                cleanup.write_json(
                    destination.parent / "result.json", {"status": "passed", "cleanupErrors": []}
                )
                return destination

            child = MagicMock()
            child.wait.return_value = 0
            with (
                patch.object(verify, "ROOT", root),
                patch.object(verify, "create_workspace", side_effect=workspace),
                patch.object(verify.subprocess, "Popen", return_value=child) as spawn,
                patch.object(verify, "safe_maintain"),
                patch.object(cleanup, "process_references", return_value=([], [])),
                patch.object(sys, "argv", ["verify", "--skip-dev"]),
            ):
                with self.assertRaises(SystemExit) as stopped:
                    verify.main()
            self.assertEqual(stopped.exception.code, 0)
            self.assertEqual(spawn.call_args.kwargs["env"]["STARTER_ISOLATED_BUILD"], "1")
            path = next((root / ".runtime").glob("project-*"))
            self.assertFalse((path / "workspace").exists())
            self.assertEqual(cleanup.read_json(path / cleanup.MANIFEST)["status"], "passed")

    def test_parent_verifier_snapshot_failure_keeps_scene(self):
        verify = load("verify_cleanup_failure_test", "verify-project.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(verify, "ROOT", root),
                patch.object(verify, "create_workspace", side_effect=OSError("测试复制失败")),
                patch.object(verify, "safe_maintain"),
                patch.object(cleanup, "process_references", return_value=([], [])),
                patch.object(sys, "argv", ["verify"]),
            ):
                with self.assertRaisesRegex(OSError, "测试复制失败"):
                    verify.main()
            path = next((root / ".runtime").glob("project-*"))
            self.assertEqual(cleanup.read_json(path / cleanup.MANIFEST)["status"], "failed")


if __name__ == "__main__":
    unittest.main()
