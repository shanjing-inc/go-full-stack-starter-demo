#!/usr/bin/env python3
"""PostgreSQL 入口与隔离数据库选择回归。"""

import argparse
import importlib.util
import io
import hashlib
import hmac
import sys
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wrapper = load("postgresql_wrapper", "verify-postgresql.py")
verify = load("docker_verifier", "verify-project-docker.py")


class PostgreSQLTests(unittest.TestCase):
    def test_wrapper_scope_and_fixed_database(self):
        for options, scope in (([], ["--runtime-only"]), (["--docker-build"], [])):
            fake = Mock()
            fake.main.return_value = 0
            with (
                patch.object(
                    wrapper.importlib.util, "spec_from_file_location", return_value=Mock()
                ),
                patch.object(wrapper.importlib.util, "module_from_spec", return_value=fake),
            ):
                self.assertEqual(wrapper.main(options), 0)
            fake.main.assert_called_once_with(["--database", "postgres", *scope])

    def test_wrapper_rejects_database_override_and_conflicting_scopes(self):
        for options in (
            ["--database=mysql"],
            ["--database", "mysql"],
            ["--docker-build", "--runtime-only"],
        ):
            with (
                self.subTest(options=options),
                patch("sys.stderr", new_callable=io.StringIO),
                self.assertRaises(SystemExit),
            ):
                wrapper.main(options)

    def fixture(self):
        item = verify.Verification(
            argparse.Namespace(
                runtime_only=True,
                keep_image=False,
                build_proxy="",
                pull_timeout=5,
                registry="",
                database="postgres",
            )
        )
        item.web_password, item.worker_password = "web-password", "worker-password"
        item.db_host, item.db_port, item.redis_url = "postgres", 5432, "redis://redis:6379/0"
        item.auth_secret, item.bootstrap = "secret", "bootstrap"
        item.versions, item.origins = ["202610040001"], ["http://127.0.0.1:8081"]
        return item

    def test_postgresql_settings_use_container_network_and_distinct_credentials(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(verify, "ROOT", Path(folder)),
            patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
        ):
            item = self.fixture()
            for role in ("web", "worker"):
                env = item.settings(role, 12345)
                self.assertNotIn("DB_DRIVER", env)
                self.assertEqual(env["WEB_ADDR"], "0.0.0.0:8080")
                self.assertIn(role + "_app:", env["DB_DSN"])
                self.assertIn("@postgres:5432/demo", env["DB_DSN"])
                self.assertIn("search_path=public", env["DB_DSN"])
            self.assertEqual(item.result["project"], "multi-database-demo")
            self.assertTrue(item.image.startswith("multi-database-demo-verify:"))

    def test_postgresql_sql_selects_missing_database_and_public_schema(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(verify, "ROOT", Path(folder)),
            patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
        ):
            item = self.fixture()
            item.postgresql_sql = Mock(return_value="ok")
            self.assertEqual(item.sql("SELECT version FROM demo.atlas_schema_revisions"), "ok")
            item.postgresql_sql.assert_called_with(
                "SELECT version FROM public.atlas_schema_revisions", "demo"
            )
            item.sql(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='missing'"
            )
            item.postgresql_sql.assert_called_with(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
                "missing",
            )

    def test_shared_parser_rejects_abbreviated_database_override(self):
        with (
            patch("sys.stderr", new_callable=io.StringIO),
            patch.object(verify, "Verification") as construct,
        ):
            with self.assertRaises(SystemExit):
                verify.main(["--database", "postgres", "--data=mysql"])
            construct.assert_not_called()

    def test_browser_phase_requires_zero_skips_and_selected_frontend(self):
        for skipped in (0, 1):
            with (
                tempfile.TemporaryDirectory() as folder,
                patch.object(verify, "ROOT", Path(folder)),
                patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
                patch.object(verify, "environment", return_value=("go", {})),
            ):
                item = self.fixture()
                item.reset_browser_auth_limit = Mock()
                item.http = Mock(
                    return_value=(200, {}, b'{"data":{"createUser":[{"id":2,"role":"admin"}]}}')
                )

                def run(command, label, **kwargs):
                    self.assertEqual(command[2], "multi-database-demo-dashboard")
                    self.assertEqual(kwargs["env"]["TEST_ORIGIN"], "http://127.0.0.1:12345")
                    (item.runtime / "browser.json").write_text(
                        '{"stats":{"expected":118,"unexpected":0,"flaky":0,"skipped":'
                        + str(skipped)
                        + "}}"
                    )

                item.run = run
                if skipped:
                    with self.assertRaisesRegex(RuntimeError, "零跳过"):
                        item.verify_browser("http://127.0.0.1:12345", "token")
                else:
                    item.verify_browser("http://127.0.0.1:12345", "token")
                    self.assertEqual(item.result["checks"][-1]["tests"], 118)
                    item.reset_browser_auth_limit.assert_called_once_with()

    def test_browser_reset_targets_only_owned_account_limit_key(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(verify, "ROOT", Path(folder)),
            patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
        ):
            item = self.fixture()
            item.browser_owner_id, item.auth_secret = 42, "isolated-secret"
            item.redis_command = Mock()
            item.reset_browser_auth_limit()
            digest = hmac.new(b"isolated-secret", b"account:42", hashlib.sha256).hexdigest()
            item.redis_command.assert_called_once_with(
                "DEL", "docker-" + item.token + ":auth:limit:" + digest
            )

    def test_postgresql_probe_uses_tcp_to_wait_for_final_server(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(verify, "ROOT", Path(folder)),
            patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
        ):
            item = self.fixture()
            item.mysql_password, item.postgres = "private", "owned-postgres"
            item.docker = Mock(return_value="1")
            item.postgresql_sql("SELECT 1", "postgres")
            command = item.docker.call_args.args
            self.assertEqual(command[command.index("-h") + 1], "127.0.0.1")
            self.assertEqual(command[command.index("-d") + 1], "postgres")

    def test_schema_diff_uses_isolated_copies_and_database_scoped_url(self):
        for drift in (False, True):
            with (
                self.subTest(drift=drift),
                tempfile.TemporaryDirectory() as folder,
                patch.object(verify, "ROOT", Path(folder)),
                patch.object(verify, "APP", Path(folder) / "projects/multi-database-demo"),
                patch.object(verify, "environment", return_value=("go", {})),
            ):
                app = verify.APP
                migrations = app / "migrations/postgres"
                migrations.mkdir(parents=True)
                (migrations / "202610030001_shop.sql").write_text("CREATE TABLE shop (id int);\n")
                (migrations / "atlas.sum").write_text("baseline-checksum\n")
                target = app / "schema/generated/postgres.sql"
                target.parent.mkdir(parents=True)
                target.write_text("CREATE TABLE shop (id int);\n")
                item = self.fixture()
                item.mysql_password, item.mysql_port = "private", 12345
                item.postgresql_sql = Mock()
                labels = []

                def run(command, label, **kwargs):
                    labels.append(label)
                    url = command[command.index("--dev-url") + 1]
                    self.assertIn("/schema_diff?sslmode=disable", url)
                    self.assertNotIn("search_path", url)
                    directory = Path(command[command.index("--dir") + 1].removeprefix("file://"))
                    copied_target = Path(command[command.index("--to") + 1].removeprefix("file://"))
                    self.assertTrue(directory.is_relative_to(item.runtime))
                    self.assertTrue(copied_target.is_relative_to(item.runtime))
                    if drift or label == "postgresql-schema-diff-change":
                        (directory / "202610070001_review_probe.sql").write_text(
                            'ALTER TABLE "shop" ADD COLUMN "review_note" text COLLATE "starter_unicode_ci";\n'
                        )
                    if label == "postgresql-schema-diff-change":
                        self.assertIn('COLLATE "starter_unicode_ci"', copied_target.read_text())

                item.run = run
                if drift:
                    with self.assertRaisesRegex(RuntimeError, "零漂移"):
                        item.verify_postgresql_schema_diff()
                    self.assertEqual(len(labels), 1)
                else:
                    item.verify_postgresql_schema_diff()
                    self.assertEqual(
                        labels,
                        [
                            "postgresql-schema-diff-baseline-0",
                            "postgresql-schema-diff-baseline-1",
                            "postgresql-schema-diff-change",
                            "postgresql-schema-diff-replay",
                        ],
                    )
                    self.assertEqual(item.result["checks"][-1]["status"], "passed")
                item.postgresql_sql.assert_called_once_with(
                    "CREATE DATABASE schema_diff", "postgres"
                )
                self.assertEqual(target.read_text(), "CREATE TABLE shop (id int);\n")
                self.assertEqual(
                    sorted(path.name for path in migrations.iterdir()),
                    ["202610030001_shop.sql", "atlas.sum"],
                )
                self.assertEqual((migrations / "atlas.sum").read_text(), "baseline-checksum\n")

    def test_postgresql_migrations_and_sqlite_versions_match(self):
        app = verify.ROOT / "projects/multi-database-demo"
        self.assertEqual(
            verify.migration_versions(app / "migrations/postgres"),
            verify.migration_versions(app / "migrations/sqlite"),
        )
        self.assertIn(
            "server_version_num", (app / "migrations/postgres/202610030001_shop.sql").read_text()
        )
        self.assertIn("starter_unicode_ci", (app / "schema/generated/postgres.sql").read_text())
        self.assertIn("USER 65532:65532", verify.runtime_recipe((app / "Dockerfile").read_text()))


if __name__ == "__main__":
    unittest.main()
