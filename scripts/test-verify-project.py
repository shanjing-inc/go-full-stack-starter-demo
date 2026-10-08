#!/usr/bin/env python3
"""验证完整迁移版本登记和认证请求头，阻止旧验收配置回归。"""

import hashlib
import hmac
import importlib.util
import io
import json
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from verification_workspace import create_workspace

spec = importlib.util.spec_from_file_location(
    "verify_project", Path(__file__).with_name("verify-project.py")
)
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class Response(io.BytesIO):
    status = 200
    headers = {}


class VerificationTest(unittest.TestCase):
    def test_mysql_integration_scope_selects_its_database_and_keeps_driver_tests(self):
        pattern = re.compile(verify.MYSQL_INTEGRATION_SKIP)
        for name in (
            "TestPostgreSQLConcurrentInitialization",
            "TestPostgreSQLSessionManagement",
            "TestPostgreSQLLoginRateLimitCollation",
            "TestPostgreSQLUserManagementTransactions",
            "TestLegacyPasswordAndRolesPostgreSQL",
            "TestUserQueriesPostgreSQL",
            "TestExternalShutdown",
        ):
            self.assertIsNotNone(pattern.search(name), name)
        for name in (
            "TestMySQLConcurrentInitialization",
            "TestMySQLSessionManagement",
            "TestOpenPostgreSQLHandshakeDeadline",
            "TestPostgreSQLDriverAndErrorTranslation",
            "TestLegacyPasswordAndRolesMySQL",
        ):
            self.assertIsNone(pattern.search(name), name)

    def test_snapshot_filters_relative_paths_and_reads_dist_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "tmp/source"
            root.mkdir(parents=True)
            (root / "source.go").write_text("source")
            excluded = ("node_modules", "dist", "tmp", "__pycache__")
            for name in excluded:
                folder = root / name
                folder.mkdir()
                (folder / "artifact.js").write_text("artifact")
            self.assertEqual(
                verify.snapshot(root),
                {"source.go": hashlib.sha256(b"source").hexdigest()},
            )
            self.assertEqual(
                verify.snapshot(root / "dist"),
                {"artifact.js": hashlib.sha256(b"artifact").hexdigest()},
            )
            (root / "dist/artifact.js").write_text("changed")
            self.assertEqual(
                verify.snapshot(root / "dist"),
                {"artifact.js": hashlib.sha256(b"changed").hexdigest()},
            )

    def test_workspace_copies_untracked_env_and_artifacts_and_owns_mutable_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            root.mkdir()
            for name in (
                ".tools/bin",
                ".tools/downloads",
                ".tools/go",
                ".tools/gopath",
                ".tools/gocache",
                "packages/dashboard/dist",
                "projects/app/webui/dist",
                "node_modules",
                ".runtime/dev",
            ):
                (root / name).mkdir(parents=True)
            for name in (
                "untracked.go",
                ".env",
                "packages/dashboard/dist/index.js",
                "projects/app/webui/dist/index.html",
                ".tools/bin/gqlgen",
                ".tools/downloads/ruff.whl",
                "node_modules/dependency",
                ".runtime/dev/state.json",
            ):
                (root / name).write_text("original")
            first = create_workspace(root, Path(directory) / "first")
            second = create_workspace(root, Path(directory) / "second")
            for name in (
                "untracked.go",
                ".env",
                "packages/dashboard/dist/index.js",
                "projects/app/webui/dist/index.html",
                ".tools/bin/gqlgen",
                ".tools/downloads/ruff.whl",
            ):
                self.assertEqual((first / name).read_text(), "original")
                (first / name).write_text("verification")
                self.assertEqual((root / name).read_text(), "original")
                self.assertEqual((second / name).read_text(), "original")
            self.assertFalse((first / "node_modules").exists())
            self.assertFalse((first / ".runtime").exists())
            self.assertEqual((first / ".tools/go").resolve(), root / ".tools/go")
            with self.assertRaisesRegex(RuntimeError, "全新路径"):
                create_workspace(root, first)

    def test_migration_versions_include_latest_and_both_dialects(self):
        mysql = verify.migration_versions(verify.APP / "migrations/mysql")
        self.assertEqual(mysql, verify.migration_versions(verify.APP / "migrations/sqlite"))
        self.assertIn("202610040001", mysql)
        self.assertEqual(mysql, sorted(mysql))
        self.assertEqual(mysql[:2], ["202610030001", "202610040001"])

    def test_versions_are_ordered_and_validate_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "至少一个版本"):
                verify.migration_versions(directory)
            for name in ("202610040002_next.sql", "202610040001_auth.sql"):
                Path(directory, name).touch()
            self.assertEqual(verify.migration_versions(directory), ["202610040001", "202610040002"])
            Path(directory, "202610040001_duplicate.sql").touch()
            with self.assertRaisesRegex(RuntimeError, "唯一"):
                verify.migration_versions(directory)
            Path(directory, "bad.sql").touch()
            with self.assertRaisesRegex(RuntimeError, "文件名无效"):
                verify.migration_versions(directory)

    def test_browser_limit_keys_match_auth_hmac_and_are_scoped(self):
        secret = "test-auth-secret"
        identity = "account:7"
        digest = hmac.new(secret.encode(), identity.encode(), hashlib.sha256).hexdigest()
        key = verify.auth_limit_key("verify-demo", secret, identity)
        self.assertEqual(key, "verify-demo:auth:limit:" + digest)
        self.assertNotEqual(key, verify.auth_limit_key("other", secret, identity))
        self.assertNotEqual(key, verify.auth_limit_key("verify-demo", "other", identity))
        self.assertNotEqual(key, verify.auth_limit_key("verify-demo", secret, "ip:127.0.0.1"))

    def test_browser_stage_reset_uses_registered_account_and_ip_buckets(self):
        keys = verify.browser_auth_limit_keys("verify-demo", "test-secret", "37")
        self.assertEqual(
            keys,
            (
                verify.auth_limit_key("verify-demo", "test-secret", "account:37"),
                verify.auth_limit_key("verify-demo", "test-secret", "ip:127.0.0.1"),
            ),
        )
        self.assertNotIn(
            verify.auth_limit_key("verify-demo", "test-secret", "email:owner@example.com"), keys
        )
        with self.assertRaisesRegex(RuntimeError, "正整数"):
            verify.browser_auth_limit_keys("verify-demo", "test-secret", "0")

    def test_ssr_browser_account_has_independent_credentials_and_admin_permissions(self):
        response = {"data": {"createUser": [{"id": "41", "role": "admin"}]}}
        with patch.object(
            verify, "http", return_value=(200, {}, json.dumps(response).encode())
        ) as send:
            env = verify.create_ssr_browser_account("http://localhost", "owner-token")
        self.assertNotEqual(env["SSR_TEST_EMAIL"], "owner@example.com")
        self.assertTrue(env["SSR_TEST_EMAIL"].startswith("ssr-queue-"))
        self.assertGreaterEqual(len(env["SSR_TEST_PASSWORD"]), 8)
        self.assertEqual(send.call_args.args[:2], ("http://localhost", "/api/graphql/admin"))
        self.assertEqual(send.call_args.kwargs["token"], "owner-token")
        body = send.call_args.args[2]
        self.assertIn("createUser", body["query"])
        self.assertEqual(body["variables"]["set"]["role"], "admin")
        self.assertEqual(body["variables"]["set"]["email"], env["SSR_TEST_EMAIL"])
        self.assertEqual(body["variables"]["set"]["password"], env["SSR_TEST_PASSWORD"])

    def test_ssr_browser_account_creation_failure_stops_verification(self):
        with patch.object(
            verify, "http", return_value=(200, {}, '{"errors":[{"message":"创建失败"}]}'.encode())
        ):
            with self.assertRaisesRegex(RuntimeError, "SSR.*独立账号"):
                verify.create_ssr_browser_account("http://localhost", "owner-token")

    def test_authenticated_http_and_origin(self):
        body = {"query": "{listShops{id}}"}
        with patch.object(verify.urllib.request, "urlopen", return_value=Response(b"{}")) as send:
            self.assertEqual(
                verify.http(
                    "http://localhost",
                    "/api/graphql/admin",
                    body,
                    token="test-token",
                    cookie="session=test-cookie",
                )[0],
                200,
            )
        request = send.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(request.get_header("Cookie"), "session=test-cookie")
        self.assertEqual(request.get_header("Origin"), "http://localhost")
        self.assertEqual(json.loads(request.data), body)

    def test_public_http_omits_credentials_and_reads_error_response(self):
        with patch.object(verify.urllib.request, "urlopen", return_value=Response(b"{}")) as send:
            verify.http("http://localhost")
        request = send.call_args.args[0]
        self.assertIsNone(request.get_header("Authorization"))
        self.assertIsNone(request.get_header("Cookie"))
        error = urllib.error.HTTPError(
            "http://localhost", 401, "Unauthorized", {}, io.BytesIO(b"{}")
        )
        with patch.object(verify.urllib.request, "urlopen", side_effect=error):
            self.assertEqual(verify.http("http://localhost")[0], 401)


if __name__ == "__main__":
    unittest.main()
