#!/usr/bin/env python3
"""正式工程的生成、迁移、测试及构建入口。"""

import argparse
import os
import re
import shlex
from pathlib import Path
import subprocess
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from database_url import DATABASES, database_type

from runtime_cleanup import cache_activity

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "projects/multi-database-demo"
MODULES = [ROOT / "packages/go-server-kit", APP]
GO_TEST_PACKAGES = ["./" + str(module.relative_to(ROOT)) + "/..." for module in MODULES]
# 覆盖率聚焦业务包；各业务目录中的同包与外部包测试由 GO_TEST_PACKAGES 统一发现。
GO_COVER_PACKAGES = [
    "./packages/go-server-kit/infra/...",
    "./packages/go-server-kit/modules/...",
    "./packages/go-server-kit/transport/...",
    "./packages/go-server-kit/internal/jsonobject",
    "./projects/multi-database-demo/cmd/...",
    "./projects/multi-database-demo/internal/...",
    "./projects/multi-database-demo/webui/...",
]


def config_file(env_file=None):
    if env_file:
        path = Path(env_file).expanduser()
        return (ROOT / path).resolve() if not path.is_absolute() else path.resolve()
    return APP / ".env"


def environment(env_file=None):
    inherited = os.environ.get("STARTER_ENV_FILE")
    file = config_file(env_file or inherited)
    if (env_file or inherited) and not file.is_file() and not os.environ.get("DB_DSN"):
        raise RuntimeError(
            f"配置文件缺失：{file}。执行 cp {APP / '.env.example'} {file}，填写数据库、Redis 与认证配置。"
        )
    values = {}
    for source in [ROOT / ".env", file]:
        if source.exists():
            for line in source.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                key, sep, value = line.partition("=")
                if not sep:
                    raise RuntimeError(f"环境文件需要 KEY=value：{source}")
                values[key.strip()] = value.strip().strip('"').strip("'")
    values.update(os.environ)
    # 方言由连接 URL 推导，旧进程环境中的类型变量随本次加载清除。
    values.pop("DB_DRIVER", None)
    if "DB_DSN" in values:
        database_type(values["DB_DSN"])
    # 显式路径保持继承；默认配置存在时继承，缺省构建可继续用于嵌套命令。
    if file.is_file() or env_file or inherited:
        values["STARTER_ENV_FILE"] = str(file)
    go = ROOT / ".tools/go/bin/go"
    if not go.exists():
        raise RuntimeError("请先执行 pnpm setup")
    values.update(
        PATH=str(go.parent) + os.pathsep + values.get("PATH", ""),
        GOTOOLCHAIN="local",
        CGO_ENABLED="0",
        GOPATH=str(ROOT / ".tools/gopath"),
        GOCACHE=str(ROOT / ".tools/gocache"),
        GOPROXY=values.get("GOPROXY", "https://goproxy.cn"),
        GOWORK=str(ROOT / "go.work"),
    )
    if values.get("STARTER_ISOLATED_BUILD") == "1":
        flags = values.get("GOFLAGS", "")
        if not any(flag.startswith("-trimpath") for flag in shlex.split(flags)):
            values["GOFLAGS"] = (flags + " -trimpath").strip()
    return str(go), values


def atlas_dev_url(url):
    dialect = database_type(url, "ATLAS_DEV_URL")
    if dialect != "postgres":
        return dialect + ":" + url.split(":", 1)[1]
    parts = urlsplit(url)
    # 数据库级开发库让 Atlas 清理排序规则等 schema 级自定义对象。
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if key != "search_path"
        ]
    )
    return urlunsplit((dialect, parts.netloc, parts.path, query, parts.fragment))


def run(command, cwd=ROOT, env=None, **kwargs):
    subprocess.run([str(x) for x in command], cwd=cwd, env=env, check=True, **kwargs)


def schema(go, env):
    folder = APP / "schema/generated"
    folder.mkdir(parents=True, exist_ok=True)
    for dialect in DATABASES:
        with (folder / (dialect + ".sql")).open("w") as out:
            run([go, "run", "./cmd/schema", "-dialect", dialect], cwd=APP, env=env, stdout=out)
    print("应用组合模型的目标 Schema 已导出", flush=True)


def validate_go_test_layout(modules=None):
    """在正式模块中固定包级测试同目录布局，三个检查／测试入口共享门禁。"""
    roots = [ROOT, *MODULES] if modules is None else modules
    for folder in roots:
        if (folder / "tests").exists():
            raise RuntimeError(f"Go 测试布局：{folder / 'tests'}；请将包级测试放入业务目录")
    for module in MODULES if modules is None else modules:
        for current, directories, names in os.walk(module):
            # 与 Go 的包发现边界一致，跳过 fixture、依赖与前端产物。
            directories[:] = sorted(
                name
                for name in directories
                if not name.startswith((".", "_"))
                and name not in {"testdata", "vendor", "node_modules", "dist"}
            )
            folder = Path(current)
            invalid = sorted(name for name in names if name.endswith(".test.go"))
            if invalid:
                raise RuntimeError(f"Go 测试文件名：{folder / invalid[0]}；请使用 *_test.go")
            tests = sorted(name for name in names if name.endswith("_test.go"))
            if not tests:
                continue
            sources = sorted(
                name for name in names if name.endswith(".go") and not name.endswith("_test.go")
            )
            if not sources:
                raise RuntimeError(f"Go 测试布局：{folder}；请将包级测试放入业务源码目录")
            packages = set()
            for name in sources:
                match = re.search(r"^package\s+(\w+)", (folder / name).read_text(), re.M)
                if match:
                    packages.update((match[1], match[1] + "_test"))
            for name in tests:
                match = re.search(r"^package\s+(\w+)", (folder / name).read_text(), re.M)
                if not match or match[1] not in packages:
                    raise RuntimeError(
                        f"Go 测试包声明：{folder / name}；请使用业务包名或业务包名加 _test"
                    )


def go_tests(go, env, coverage=False):
    """统一发现业务目录中的全部 Go 测试，并按需输出业务代码覆盖率。"""
    command = [go, "test", "-count=1", "-timeout=90s"]
    if coverage:
        folder = ROOT / "coverage"
        folder.mkdir(exist_ok=True)
        command += [
            "-coverpkg=" + ",".join(GO_COVER_PACKAGES),
            "-coverprofile=" + str(folder / "go.out"),
        ]
    run(command + GO_TEST_PACKAGES, env=env)


def run_project():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=["generate", "schema", "diff", "migrate", "test", "test-go", "check", "build"],
    )
    parser.add_argument("--name", default="change")
    parser.add_argument("--env-file", help="相对仓库根目录或绝对配置文件路径")
    parser.add_argument("--coverage", action="store_true", help="测试时输出 Go 业务包覆盖率")
    args = parser.parse_args()
    if args.coverage and args.action not in ("test", "test-go"):
        parser.error("--coverage 配合 test 或 test-go 使用")
    go, env = environment(env_file=args.env_file)
    action = args.action
    if action == "generate":
        toolenv = dict(env, GOWORK="off")
        run(
            [
                go,
                "build",
                "-mod=readonly",
                "-o",
                ROOT / ".tools/bin/gqlgen",
                "github.com/99designs/gqlgen",
            ],
            cwd=ROOT / "tools",
            env=toolenv,
        )
        for name in ("member", "admin"):
            run(
                [ROOT / ".tools/bin/gqlgen", "generate", "--config", "gqlgen-" + name + ".yml"],
                cwd=APP,
                env=env,
            )
        run([go, "run", "./cmd/gen"], cwd=APP, env=env)
        schema(go, env)
        run(["python3", ROOT / "scripts/format.py", "--go-only"], env=env)
    elif action == "schema":
        schema(go, env)
    elif action in ("migrate", "diff"):
        dialect = database_type(env.get("DB_DSN"))
        directory = "file://" + str(APP / "migrations" / dialect)
        atlas = ROOT / ".tools/bin/atlas-v1.3.0"
        if action == "migrate":
            url = env.get("MIGRATION_URL")
            if not url:
                raise RuntimeError("请配置独立迁移账户的 MIGRATION_URL")
            if database_type(url, "MIGRATION_URL") != dialect:
                raise RuntimeError("MIGRATION_URL 与 DB_DSN 的数据库类型需要一致")
            url = dialect + ":" + url.split(":", 1)[1]
            command = [atlas, "migrate", "apply", "--dir", directory, "--url", url]
            if dialect == "postgres":
                command += ["--revisions-schema", "public"]
            run(command, env=env)
        else:
            dev = env.get("ATLAS_DEV_URL")
            if not dev:
                raise RuntimeError("请配置可清空的隔离开发库 ATLAS_DEV_URL")
            if database_type(dev, "ATLAS_DEV_URL") != dialect:
                raise RuntimeError("ATLAS_DEV_URL 与 DB_DSN 的数据库类型需要一致")
            dev = atlas_dev_url(dev)
            schema(go, env)
            run(
                [
                    atlas,
                    "migrate",
                    "diff",
                    args.name,
                    "--dir",
                    directory,
                    "--to",
                    "file://" + str(APP / "schema/generated" / (dialect + ".sql")),
                    "--dev-url",
                    dev,
                ],
                env=env,
            )
    elif action in ("test", "test-go", "check"):
        validate_go_test_layout()
        # 全量 Go 包加载需要应用自己的内嵌 SPA；每次重建保证产物与源码一致。
        run(["pnpm", "build:frontend"], env=env)
        if action == "check":
            run(["pnpm", "format:check"], env=env)
            run([go, "vet", "./cmd/format-go"], cwd=ROOT / "tools", env=dict(env, GOWORK="off"))
            run(
                [go, "vet", "./packages/go-server-kit/...", "./projects/multi-database-demo/..."],
                env=env,
            )
            run(["pnpm", "--filter", "@shanjing/shadcnui-dashboard", "typecheck"], env=env)
            run(["pnpm", "--filter", "multi-database-demo-dashboard", "typecheck"], env=env)
        elif action == "test-go":
            go_tests(go, env, coverage=args.coverage)
        else:
            run(
                [go, "test", "-count=1", "./cmd/format-go"],
                cwd=ROOT / "tools",
                env=dict(env, GOWORK="off"),
            )
            run(["python3", ROOT / "scripts/test-format.py"], env=env)
            run(["python3", ROOT / "scripts/test-project.py"], env=env)
            run(["python3", ROOT / "scripts/test-dev.py"], env=env)
            run(["python3", ROOT / "scripts/test-dev-reload.py"], env=env)
            run(["python3", ROOT / "scripts/test-runtime-cleanup.py"], env=env)
            run(["python3", ROOT / "scripts/test-verify-project.py"], env=env)
            run(["python3", ROOT / "scripts/test-verify-project-docker.py"], env=env)
            run(["python3", ROOT / "scripts/test-verify-postgresql.py"], env=env)
            go_tests(go, env, coverage=args.coverage)
            run(["pnpm", "test:ui"], env=env)
    elif action == "build":
        run(["pnpm", "build:frontend"], env=env)
        out = ROOT / "bin"
        out.mkdir(exist_ok=True)
        for role in ("web", "worker"):
            run(
                [go, "build", "-mod=readonly", "-trimpath", "-o", out / role, "./cmd/" + role],
                cwd=APP,
                env=env,
            )
        print("Web 与 Worker 静态二进制已构建", flush=True)


def main():
    with cache_activity(ROOT):
        run_project()


if __name__ == "__main__":
    main()
