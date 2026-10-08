#!/usr/bin/env python3
"""验证全仓库格式范围、本地环境保护与 module 只读检查。"""

import contextlib
import importlib.util
import io
import hashlib
import json
import re
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "project_format", Path(__file__).with_name("format.py")
)
formatter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(formatter)


class FormatTest(unittest.TestCase):
    def test_file_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            included = [
                "packages/server/main.go",
                "projects/demo/internal/graph/generated.go",
                "projects/demo/schema/member.graphqls",
                "scripts/dev.py",
                "scripts/test-project.py",
                "tools/go.mod",
                ".vscode/settings.json",
                "package.json",
                "go.work",
                "docs/architecture-plan.md",
                "poc/demo/main.go",
                "poc/demo/go.mod",
                "poc/delivery/frontend/pnpm-lock.yaml",
                "projects/demo/.env.example",
                "projects/demo/migrations/mysql/initial.sql",
                "projects/demo/schema/generated/mysql.sql",
                "pnpm-lock.yaml",
                "scripts/verify-web-poc.py",
                ".editorconfig",
                "README.md",
            ]
            excluded = [
                "projects/demo/.env",
                "packages/dashboard/node_modules/dependency/index.js",
                "projects/demo/tmp/main.go",
                "packages/dashboard/dist/index.js",
                ".runtime/main.go",
                ".tools/go/main.go",
                "bin/main.go",
                ".cache/main.go",
                "projects/demo/.env.production",
                "poc/demo/.env.local",
            ]
            for name in included + excluded:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("样本\n")
            (root / "linked.go").symlink_to(root / "packages/server/main.go")
            self.assertEqual(set(formatter.files(root)), {root / name for name in included})

    def test_reference_snapshot_hashes(self):
        folder = formatter.ROOT / "poc/web/fixtures"
        fixture = json.loads((folder / "reference-cases.json").read_text())
        expected = {f"reference-{endpoint}.graphql" for endpoint in ("member", "admin")}
        self.assertEqual(set(fixture["snapshots"]), expected)
        for name, digest in fixture["snapshots"].items():
            self.assertEqual(hashlib.sha256((folder / name).read_bytes()).hexdigest(), digest)

    def test_generated_schema_matches_source(self):
        module = formatter.ROOT / "poc/web"
        for endpoint in ("member", "admin"):
            generated = module / f"graph/{endpoint}/generated.go"
            sources = re.findall(r'Name: "([^"]+)", Input: `([^`]+)`', generated.read_text())
            self.assertEqual(len(sources), 2)
            for name, content in sources:
                self.assertEqual((generated.parent / name).read_text(), content)

    def test_module_check_is_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "go.mod"
            source = b"module example.test/demo\n\nrequire (\n\texample.test/lib v1.0.0\n)\n"
            path.write_bytes(source)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertTrue(formatter.modules([path], True))
            self.assertEqual(path.read_bytes(), source)
            self.assertTrue(formatter.modules([path], False))
            self.assertIn(b"\n    example.test/lib", path.read_bytes())
            self.assertFalse(formatter.modules([path], True))


if __name__ == "__main__":
    unittest.main()
