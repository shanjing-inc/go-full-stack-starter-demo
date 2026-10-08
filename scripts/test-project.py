#!/usr/bin/env python3
"""验证检查和测试在加载 Go 包前准备内嵌 SPA。"""

import importlib.util
from pathlib import Path
import unittest
import os
import tempfile
import json
from database_url import database_type
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location(
    "project_commands", Path(__file__).with_name("project.py")
)
project = importlib.util.module_from_spec(spec)
spec.loader.exec_module(project)


class ProjectTest(unittest.TestCase):
    def test_application_identity_matches_workspace_and_tooling(self):
        root = Path(__file__).resolve().parents[1]
        application = "projects/multi-database-demo"
        self.assertEqual(project.APP, root / application)
        self.assertEqual(project.config_file(), root / application / ".env")
        module = (project.APP / "go.mod").read_text()
        self.assertIn(".git/" + application, module)
        manifest = json.loads((project.APP / "frontend/package.json").read_text())
        self.assertEqual(manifest["name"], "multi-database-demo-dashboard")
        frontend = (project.APP / "frontend/src/app.tsx").read_text()
        self.assertIn('title="Multi Database Demo"', frontend)
        self.assertIn('storageKey="go-mysql-demo"', frontend)
        for fixture in ("sidebar.spec.ts", "preferences.spec.ts"):
            with self.subTest(preference_fixture=fixture):
                source = (project.APP / "frontend/tests" / fixture).read_text()
                self.assertIn("go-mysql-demo:font-size", source)
                self.assertNotIn("multi-database-demo:font-size", source)
        for relative in (
            "go.work",
            "pnpm-workspace.yaml",
            "pnpm-lock.yaml",
            "package.json",
            application + "/Dockerfile",
            application + "/air-web.toml",
            application + "/air-worker.toml",
            application + "/gqlgen-admin.yml",
            application + "/gqlgen-member.yml",
            "scripts/setup.py",
            "scripts/verify-project.py",
            "scripts/verify-project-docker.py",
        ):
            with self.subTest(file=relative):
                source = (root / relative).read_text()
                self.assertIn("multi-database-demo", source)
                self.assertNotIn("go-mysql-demo", source)

    def test_frontend_build_precedes_go_package_loading(self):
        for action in ("check", "test", "test-go"):
            with self.subTest(action=action):
                with (
                    patch.object(project, "environment", return_value=("go", {})),
                    patch.object(project, "run") as run,
                    patch("sys.argv", ["project.py", action]),
                ):
                    project.main()
                commands = [call.args[0] for call in run.call_args_list]
                self.assertEqual(commands[0], ["pnpm", "build:frontend"])
                package_commands = [
                    index
                    for index, command in enumerate(commands)
                    if command[:2] == ["go", "vet"] or command[:2] == ["go", "test"]
                ]
                self.assertTrue(package_commands)
                self.assertTrue(all(index > 0 for index in package_commands))
                self.assertEqual(commands.count(["pnpm", "build:frontend"]), 1)

    def test_failed_frontend_build_stops_go_commands(self):
        for action in ("check", "test", "test-go"):
            with self.subTest(action=action):
                with (
                    patch.object(project, "environment", return_value=("go", {})),
                    patch.object(project, "run", side_effect=RuntimeError("前端构建失败")) as run,
                    patch("sys.argv", ["project.py", action]),
                ):
                    with self.assertRaisesRegex(RuntimeError, "前端构建失败"):
                        project.main()
                run.assert_called_once_with(["pnpm", "build:frontend"], env={})


class GoTestLayoutTest(unittest.TestCase):
    def test_module_patterns_discover_colocated_tests(self):
        self.assertEqual(
            project.GO_TEST_PACKAGES,
            ["./packages/go-server-kit/...", "./projects/multi-database-demo/..."],
        )
        with patch.object(project, "run") as run:
            project.go_tests("go", {})
        run.assert_called_once_with(
            ["go", "test", "-count=1", "-timeout=90s"] + project.GO_TEST_PACKAGES,
            env={},
        )

    def test_package_tests_are_colocated_with_business_sources(self):
        project.validate_go_test_layout()
        for module in project.MODULES:
            self.assertTrue(list(module.rglob("*_test.go")), str(module))

    def test_layout_accepts_both_package_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            module = Path(temporary)
            folder = module / "infra/queue"
            folder.mkdir(parents=True)
            (folder / "queue.go").write_text("package queue\n")
            for package in ("queue", "queue_test"):
                with self.subTest(package=package):
                    (folder / "queue_test.go").write_text(f"package {package}\n")
                    project.validate_go_test_layout([module])
            fixture = folder / "testdata"
            fixture.mkdir()
            (fixture / "fixture_test.go").write_text("fixture content\n")
            project.validate_go_test_layout([module])

    def test_layout_rejects_split_tests_and_invalid_names(self):
        for case, message in (
            ("centralized", "业务目录"),
            ("test_only", "业务源码目录"),
            ("wrong_package", "测试包声明"),
            ("missing_package", "测试包声明"),
            ("wrong_suffix", r"请使用 \*_test"),
        ):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                module = Path(temporary)
                folder = module / "infra/queue"
                folder.mkdir(parents=True)
                if case == "centralized":
                    (module / "tests").mkdir()
                elif case == "test_only":
                    (folder / "queue_test.go").write_text("package queue_test\n")
                else:
                    (folder / "queue.go").write_text("package queue\n")
                    if case == "wrong_suffix":
                        (folder / "queue.test.go").write_text("package queue\n")
                    else:
                        package = "package other_test" if case == "wrong_package" else ""
                        (folder / "queue_test.go").write_text(package + "\n")
                with self.assertRaisesRegex(RuntimeError, message):
                    project.validate_go_test_layout([module])

    def test_layout_rejects_repository_level_tests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "tests").mkdir()
            with patch.object(project, "ROOT", root), patch.object(project, "MODULES", []):
                with self.assertRaisesRegex(RuntimeError, "业务目录"):
                    project.validate_go_test_layout()

    def test_layout_failure_stops_all_check_and_test_entries(self):
        for action in ("check", "test", "test-go"):
            with (
                self.subTest(action=action),
                patch.object(project, "environment", return_value=("go", {})),
                patch.object(
                    project, "validate_go_test_layout", side_effect=RuntimeError("布局检查失败")
                ) as validate,
                patch.object(project, "run") as run,
                patch("sys.argv", ["project.py", action]),
            ):
                with self.assertRaisesRegex(RuntimeError, "布局检查失败"):
                    project.main()
                validate.assert_called_once_with()
                run.assert_not_called()

    def test_coverage_targets_business_packages(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(project, "ROOT", Path(folder)),
            patch.object(project, "run") as run,
        ):
            project.go_tests("go", {"CHECK": "1"}, coverage=True)
            command = run.call_args.args[0]
            self.assertIn("-coverprofile=" + str(Path(folder) / "coverage/go.out"), command)
            self.assertIn("-coverpkg=" + ",".join(project.GO_COVER_PACKAGES), command)
            self.assertTrue((Path(folder) / "coverage").is_dir())
            self.assertTrue(all("/tests" not in package for package in project.GO_COVER_PACKAGES))
            self.assertEqual(command[-2:], project.GO_TEST_PACKAGES)
            self.assertEqual(run.call_args.kwargs, {"env": {"CHECK": "1"}})

    def test_standalone_go_action_forwards_coverage(self):
        with (
            patch.object(project, "environment", return_value=("go", {})),
            patch.object(project, "run") as run,
            patch.object(project, "go_tests") as go_tests,
            patch("sys.argv", ["project.py", "test-go", "--coverage"]),
        ):
            project.main()
        run.assert_called_once_with(["pnpm", "build:frontend"], env={})
        go_tests.assert_called_once_with("go", {}, coverage=True)

    def test_full_test_action_keeps_go_test_discovery(self):
        with (
            patch.object(project, "environment", return_value=("go", {})),
            patch.object(project, "run") as run,
            patch.object(project, "go_tests") as go_tests,
            patch("sys.argv", ["project.py", "test"]),
        ):
            project.main()
        go_tests.assert_called_once_with("go", {}, coverage=False)
        self.assertEqual(run.call_args.args[0], ["pnpm", "test:ui"])

    def test_npm_commands_use_the_shared_runner(self):
        manifest = json.loads((project.ROOT / "package.json").read_text())
        self.assertEqual(manifest["scripts"]["test:go"], "python3 scripts/project.py test-go")
        self.assertEqual(
            manifest["scripts"]["test:go:coverage"],
            "python3 scripts/project.py test-go --coverage",
        )

    def test_colocated_protocol_test_keeps_reference_fixtures(self):
        folder = project.APP / "internal/web"
        source = (folder / "server_test.go").read_text()
        for path in (
            "../fixtures/reference-cases.json",
            "../fixtures/reference-admin.graphql",
            "../fixtures/reference-member.graphql",
            "../../schema/common.graphqls",
        ):
            with self.subTest(path=path):
                self.assertTrue((folder / path).is_file())
        self.assertIn('"../fixtures/', source)
        self.assertIn('"../../schema/', source)


class DatabaseConfigurationTest(unittest.TestCase):
    def fixture(self, root):
        app = root / "projects/multi-database-demo"
        app.mkdir(parents=True)
        (root / ".tools/go/bin").mkdir(parents=True)
        (root / ".tools/go/bin/go").touch()
        (root / ".env").write_text("SHARED_VALUE=root\nDB_DSN=sqlite://root.sqlite\n")
        (app / ".env").write_text(
            "APP_MODE=development\nDB_DSN=mysql://dev:password@localhost/demo\n"
        )
        return app

    def test_shared_connection_url_contract(self):
        fixture = (
            Path(__file__).resolve().parents[1]
            / "packages/go-server-kit/infra/database/testdata/connection_urls.json"
        )
        for item in json.loads(fixture.read_text()):
            with self.subTest(name=item["name"]):
                if item["driver"]:
                    self.assertEqual(database_type(item["url"]), item["driver"])
                else:
                    with self.assertRaisesRegex(RuntimeError, "DB_DSN") as error:
                        database_type(item["url"])
                    self.assertNotIn("password", str(error.exception))

    def test_one_application_configuration_for_all_databases(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(os.environ, {}, clear=True),
            ):
                for dsn in (
                    "mysql://dev:password@localhost/demo",
                    "postgres://dev:password@localhost/demo",
                    "sqlite://demo.sqlite",
                ):
                    (app / ".env").write_text(f"DB_DSN={dsn}\n")
                    _, env = project.environment()
                    self.assertEqual(env["DB_DSN"], dsn)
                    self.assertEqual(env["SHARED_VALUE"], "root")
                    self.assertEqual(env["STARTER_ENV_FILE"], str(app / ".env"))
                    self.assertNotIn("DB_DRIVER", env)

    def test_process_values_override_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(
                    os.environ,
                    {"DB_DSN": "postgres://localhost/demo", "DB_DRIVER": "obsolete"},
                    clear=True,
                ),
            ):
                _, env = project.environment()
                self.assertEqual(database_type(env["DB_DSN"]), "postgres")
                self.assertNotIn("DB_DRIVER", env)
                os.environ["DB_DSN"] = "mysql-secret-native-dsn"
                with self.assertRaisesRegex(RuntimeError, "DB_DSN") as error:
                    project.environment()
                self.assertNotIn("secret", str(error.exception))

    def test_explicit_file_and_nested_commands_retain_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            custom = root / "custom.env"
            custom.write_text("DB_DSN=sqlite://isolated.sqlite\n")
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(os.environ, {}, clear=True),
            ):
                _, env = project.environment(env_file="custom.env")
                self.assertEqual(env["DB_DSN"], "sqlite://isolated.sqlite")
                with patch.dict(os.environ, {"STARTER_ENV_FILE": str(custom)}):
                    _, nested = project.environment()
                    self.assertEqual(nested["DB_DSN"], "sqlite://isolated.sqlite")

    def test_missing_explicit_config_has_copy_hint(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(os.environ, {}, clear=True),
            ):
                with self.assertRaisesRegex(RuntimeError, r"配置文件缺失.*cp .*\.env.example"):
                    project.environment(env_file="missing.env")

    def test_process_only_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            (app / ".env").unlink()
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(os.environ, {"DB_DSN": "postgres://localhost/demo"}, clear=True),
            ):
                _, env = project.environment()
                with patch.dict(os.environ, env, clear=True):
                    _, nested = project.environment()
                self.assertEqual(nested["DB_DSN"], "postgres://localhost/demo")

    def test_missing_default_config_supports_nested_commands_without_dsn(self):
        for root_config in (False, True):
            with self.subTest(root_config=root_config), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                app = self.fixture(root)
                (app / ".env").unlink()
                (root / ".env").unlink()
                if root_config:
                    (root / ".env").write_text("AUTH_SECRET=isolated-secret\n")
                with (
                    patch.object(project, "ROOT", root),
                    patch.object(project, "APP", app),
                    patch.dict(os.environ, {}, clear=True),
                ):
                    _, env = project.environment()
                    self.assertNotIn("STARTER_ENV_FILE", env)
                    with patch.dict(os.environ, env, clear=True):
                        _, nested = project.environment()
                    self.assertNotIn("STARTER_ENV_FILE", nested)
                    self.assertNotIn("DB_DSN", nested)
                    if root_config:
                        self.assertEqual(nested["AUTH_SECRET"], "isolated-secret")

    def test_missing_inherited_explicit_config_still_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(os.environ, {"STARTER_ENV_FILE": str(root / "missing.env")}, clear=True),
                self.assertRaisesRegex(RuntimeError, "配置文件缺失"),
            ):
                project.environment()

    def test_process_dsn_keeps_explicit_config_precedence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app = self.fixture(root)
            selected = root / "missing.env"
            with (
                patch.object(project, "ROOT", root),
                patch.object(project, "APP", app),
                patch.dict(
                    os.environ,
                    {
                        "DB_DSN": "postgres://localhost/demo",
                        "STARTER_ENV_FILE": str(app / ".env"),
                    },
                    clear=True,
                ),
            ):
                _, env = project.environment(env_file=str(selected))
                self.assertEqual(env["STARTER_ENV_FILE"], str(selected))
                with patch.dict(os.environ, env, clear=True):
                    _, nested = project.environment()
                self.assertEqual(nested["STARTER_ENV_FILE"], str(selected))
                self.assertEqual(nested["DB_DSN"], "postgres://localhost/demo")

    def test_postgresql_diff_uses_database_scoped_dev_url(self):
        for scheme in ("postgres", "postgresql"):
            with (
                self.subTest(scheme=scheme),
                patch.object(
                    project,
                    "environment",
                    return_value=(
                        "go",
                        {
                            "DB_DSN": "postgres://localhost/demo?search_path=public",
                            "ATLAS_DEV_URL": f"{scheme}://dev:p%40ss@localhost/isolated?sslmode=disable&search_path=public&application_name=atlas%20diff&search_path=other&connect_timeout=2",
                        },
                    ),
                ),
                patch.object(project, "run") as run,
                patch.object(project, "schema") as schema,
                patch("sys.argv", ["project.py", "diff", "--name", "review"]),
            ):
                project.main()
                schema.assert_called_once()
                command = run.call_args.args[0]
                self.assertEqual(
                    command[command.index("--dev-url") + 1],
                    "postgres://dev:p%40ss@localhost/isolated?sslmode=disable&application_name=atlas+diff&connect_timeout=2",
                )
                self.assertIn("file://" + str(project.APP / "migrations/postgres"), command)

    def test_atlas_dev_url_preserves_other_dialects_and_blank_query_values(self):
        for url in (
            "mysql://dev:password@localhost/isolated?charset=utf8mb4",
            "sqlite:///tmp/isolated.sqlite?_fk=1",
            "postgres://localhost/isolated?sslmode=disable&application_name=",
        ):
            with self.subTest(url=url):
                self.assertEqual(project.atlas_dev_url(url), url)

    def test_migration_directory_and_revision_schema_from_url(self):
        for scheme, dialect in (
            ("mysql", "mysql"),
            ("postgres", "postgres"),
            ("postgresql", "postgres"),
            ("sqlite", "sqlite"),
        ):
            with (
                self.subTest(scheme=scheme),
                patch.object(
                    project,
                    "environment",
                    return_value=(
                        "go",
                        {
                            "DB_DSN": f"{scheme}://dev:password@localhost/demo"
                            if dialect != "sqlite"
                            else "sqlite:///tmp/demo.sqlite",
                            "MIGRATION_URL": f"{scheme}://dev:password@localhost/demo"
                            if dialect != "sqlite"
                            else "sqlite:///tmp/demo.sqlite",
                        },
                    ),
                ),
                patch.object(project, "run") as run,
                patch("sys.argv", ["project.py", "migrate"]),
            ):
                project.main()
                command = run.call_args.args[0]
                self.assertIn("file://" + str(project.APP / "migrations" / dialect), command)
                self.assertEqual("--revisions-schema" in command, dialect == "postgres")
                self.assertTrue(command[command.index("--url") + 1].startswith(dialect + "://"))

    def test_migration_type_mismatch_fails_before_atlas(self):
        for action, key in (("migrate", "MIGRATION_URL"), ("diff", "ATLAS_DEV_URL")):
            with (
                self.subTest(action=action),
                patch.object(
                    project,
                    "environment",
                    return_value=(
                        "go",
                        {
                            "DB_DSN": "postgres://localhost/demo",
                            key: "mysql://dev:password@localhost/demo",
                        },
                    ),
                ),
                patch.object(project, "run") as run,
                patch.object(project, "schema") as schema,
                patch("sys.argv", ["project.py", action]),
            ):
                with self.assertRaisesRegex(RuntimeError, "数据库类型需要一致"):
                    project.main()
                run.assert_not_called()
                schema.assert_not_called()

    def test_empty_invalid_and_missing_connection_settings(self):
        for env, message in (
            ({}, "DB_DSN"),
            ({"DB_DSN": "postgres://localhost/demo"}, "MIGRATION_URL"),
            (
                {"DB_DSN": "postgres://localhost/demo", "MIGRATION_URL": "secret-invalid"},
                "MIGRATION_URL",
            ),
        ):
            with (
                self.subTest(env=env),
                patch.object(project, "environment", return_value=("go", env)),
                patch.object(project, "run") as run,
                patch("sys.argv", ["project.py", "migrate"]),
            ):
                with self.assertRaisesRegex(RuntimeError, message):
                    project.main()
                run.assert_not_called()

    def test_all_schema_dialects_export_in_separate_commands(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(project, "APP", Path(folder)),
            patch.object(project, "run") as run,
        ):
            project.schema("go", {})
            self.assertEqual(
                [call.args[0][-1] for call in run.call_args_list], ["mysql", "postgres", "sqlite"]
            )


if __name__ == "__main__":
    unittest.main()
