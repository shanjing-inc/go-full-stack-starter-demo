#!/usr/bin/env python3
"""正式工程的生成、迁移、测试及构建入口。"""

import argparse
import json
import os
import re
import shlex
import shutil
from pathlib import Path
import subprocess
import sys
from toolchain import validate_go, cli
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit
from database_url import DATABASES, database_type

from runtime_cleanup import cache_activity
from starter_context import (
    ROOT,
    TOOL_ROOT,
    APP,
    BACKEND,
    SCHEMA,
    MODULES,
    APPLICATION_ONLY,
    LAYOUT,
    SOURCE_WORKSPACE,
    frontend_directory,
)

GO_TEST_PACKAGES = [
    "./..." if APPLICATION_ONLY else "./" + str(module.relative_to(ROOT)) + "/..."
    for module in MODULES
]
# 覆盖率聚焦业务包；各业务目录中的同包与外部包测试由 GO_TEST_PACKAGES 统一发现。
GO_COVER_PACKAGES = (
    ["./cmd/...", "./internal/..."]
    if APPLICATION_ONLY
    else [
        "./" + str(directory.relative_to(ROOT)) + ("" if directory.name == "jsonobject" else "/...")
        for module in MODULES
        for name in ("cmd", "internal", "infra", "modules", "transport")
        if (folder := module / name).is_dir()
        for directory in (
            [folder / "jsonobject"]
            if module.name == "go-server-kit" and name == "internal"
            else [folder]
        )
    ]
)


FRONTEND_ACTIONS = ("build", "lint", "codegen", "codegen:check", "check:weapp", "test:weapp")


def frontend_packages(*kinds):
    """按正式模块发现前端及小程序包；应用内只覆盖当前应用。"""
    packages = []
    for module in MODULES:
        frontend = frontend_directory(module)
        for kind in kinds or ("frontend",):
            directory = frontend if kind == "frontend" else frontend.parent / kind
            manifest = directory / "package.json"
            if manifest.is_file():
                packages.append((module, json.loads(manifest.read_text())["name"]))
    return packages


def run_frontend(action):
    """公共前端动作仅加载各应用的公开配置，失败立即停止。"""
    kinds = (
        ("miniprogram",)
        if action.endswith(":weapp")
        else ("frontend", "miniprogram")
        if action in ("lint", "codegen", "codegen:check")
        else ("frontend",)
    )
    for module, package in frontend_packages(*kinds):
        run(
            ["pnpm", "--filter", package, action.removesuffix(":weapp")],
            env=frontend_environment(module=module),
        )


def config_file(env_file=None):
    if env_file:
        path = Path(env_file).expanduser()
        return (ROOT / path).resolve() if not path.is_absolute() else path.resolve()
    return APP / "backend/.env" if LAYOUT == "app-layout-v2" else APP / ".env"


def read_environment_file(file):
    """沿用统一脚本的 KEY=value 解析与脱敏错误提示。"""
    values = {}
    if file.is_file():
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, separator, value = line.partition("=")
            if not separator:
                raise RuntimeError(f"环境文件需要 KEY=value：{file}")
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


# 前端子进程只继承宿主工具环境、公开配置及开发代理信息。
FRONTEND_RUNTIME_KEYS = {
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "PWD",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "TERM",
    "COLORTERM",
    "CI",
    "TZ",
    "SystemRoot",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
    "SSH_AUTH_SOCK",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "STARTER_ROOT",
    "STARTER_APPLICATION",
    "STARTER_TOOL_ROOT",
    "SPA_PORT",
    "WEB_ORIGIN",
    "DASHBOARD_SOURCE",
}
FRONTEND_RUNTIME_PREFIXES = (
    "VITE_",
    "LC_",
    "NODE_",
    "npm_config_",
    "NPM_CONFIG_",
    "PNPM_",
    "COREPACK_",
)


def frontend_runtime_environment(env=None):
    """聚合命令仅传递公开进程环境，由各应用分别加载前端配置。"""
    source = os.environ if env is None else env
    return {
        key: value
        for key, value in source.items()
        if key in FRONTEND_RUNTIME_KEYS or key.startswith(FRONTEND_RUNTIME_PREFIXES)
    }


def frontend_environment(env=None, module=None, mode="production"):
    """隔离后端密钥；前端控制配置复用应用 Vite 的 dotenv 语义。"""
    frontend = frontend_directory(module) if module is not None else APP / "frontend"
    values = frontend_runtime_environment(env)
    files = (".env", ".env.local", f".env.{mode}", f".env.{mode}.local")
    if any((frontend / name).is_file() for name in files):
        # 从应用依赖解析 Vite，沿用应用自己的环境加载语义。
        # 子进程只接收筛选后的环境，stdout 只返回两项前端控制配置。
        loader = """
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [frontend, mode] = process.argv.slice(1);
const require = createRequire(join(frontend, "package.json"));
const { loadEnv } = await import(pathToFileURL(require.resolve("vite")).href);
const env = loadEnv(mode, frontend, ["SPA_PORT", "WEB_ORIGIN"]);
const values = Object.fromEntries(
    ["SPA_PORT", "WEB_ORIGIN"].filter((key) => key in env).map((key) => [key, env[key]]),
);
process.stdout.write(JSON.stringify(values));
"""
        try:
            result = subprocess.run(
                [
                    shutil.which("node") or "node",
                    "--input-type=module",
                    "--eval",
                    loader,
                    str(frontend.resolve()),
                    mode,
                ],
                cwd=frontend,
                env=values,
                capture_output=True,
                text=True,
                check=True,
            )
        except (OSError, subprocess.CalledProcessError):
            raise RuntimeError(
                f"前端配置加载失败：{frontend}。确认 Node.js 与应用 Vite 依赖已安装。"
            ) from None
        values.update(json.loads(result.stdout))
    return values


def environment(env_file=None):
    inherited = os.environ.get("STARTER_ENV_FILE")
    file = config_file(env_file or inherited)
    if (env_file or inherited) and not file.is_file() and not os.environ.get("DB_DSN"):
        raise RuntimeError(
            f"配置文件缺失：{file}。执行 cp {config_file().with_name('.env.example')} {file}，填写数据库、Redis 与认证配置。"
        )
    values = {}
    # v1 继承根配置；独立 app-layout-v2 使用所选后端文件。
    sources = [file] if ROOT == APP and LAYOUT == "app-layout-v2" else [ROOT / ".env", file]
    for source in sources:
        values.update(read_environment_file(source))
    values.update(os.environ)
    # 方言由连接 URL 推导，旧进程环境中的类型变量随本次加载清除。
    values.pop("DB_DRIVER", None)
    if "DB_DSN" in values:
        database_type(values["DB_DSN"])
    # 显式路径保持继承；默认配置存在时继承，缺省构建可继续用于嵌套命令。
    if file.is_file() or env_file or inherited:
        values["STARTER_ENV_FILE"] = str(file)
    go = Path(validate_go(ROOT, values))
    values.update(
        PATH=str(go.parent) + os.pathsep + values.get("PATH", ""),
        GOTOOLCHAIN="local",
        GOROOT=str(go.parent.parent),
        CGO_ENABLED="0",
        GOPATH=str(ROOT / ".tools/gopath"),
        GOCACHE=str(ROOT / ".tools/gocache"),
        GOPROXY=values.get("GOPROXY", "https://goproxy.cn"),
        GOPRIVATE=values.get("GOPRIVATE", "codeup.aliyun.com/shanjing"),
        GOWORK=str(SOURCE_WORKSPACE / "go.work")
        if SOURCE_WORKSPACE
        else ("off" if APPLICATION_ONLY else str(ROOT / "go.work")),
        DASHBOARD_SOURCE="1" if SOURCE_WORKSPACE else "0",
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


def atlas_sqlite_url(dsn):
    """默认迁移复用应用解码后的文件路径，再编码为 Atlas 的 SQLite 文件 URI。"""
    parts = urlsplit(dsn)
    path = unquote(parts.netloc + parts.path)
    # Atlas 沿用 Go URL.Query().Get 的首值语义，保留空值与重复参数的顺序。
    mode = next(
        (value for key, value in parse_qsl(parts.query, keep_blank_values=True) if key == "mode"),
        None,
    )
    if path in (":memory:", "/:memory:") or mode == "memory":
        return dsn
    # 保持 .. 和符号链接的文件系统语义，相对路径沿用 Atlas 子进程的 ROOT。
    uri = (ROOT / path).as_uri()
    return "sqlite://" + uri + ("?" + parts.query if parts.query else "")


def run(command, cwd=ROOT, env=None, **kwargs):
    subprocess.run([str(x) for x in command], cwd=cwd, env=env, check=True, **kwargs)


def schema(go, env):
    folder = SCHEMA / "generated"
    folder.mkdir(parents=True, exist_ok=True)
    for dialect in DATABASES:
        with (folder / (dialect + ".sql")).open("w") as out:
            run([go, "run", "./cmd/schema", "-dialect", dialect], cwd=BACKEND, env=env, stdout=out)
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
    run(command + GO_TEST_PACKAGES, cwd=BACKEND if APPLICATION_ONLY else ROOT, env=env)


def run_project():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=[
            "generate",
            "schema",
            "diff",
            "migrate",
            "test",
            "test-go",
            "check",
            "build",
            "frontend",
        ],
    )
    parser.add_argument("frontend_action", nargs="?", choices=FRONTEND_ACTIONS)
    parser.add_argument("--name", default="change")
    parser.add_argument("--env-file", help="后端配置文件，相对仓库根目录或使用绝对路径")
    parser.add_argument("--coverage", action="store_true", help="测试时输出 Go 业务包覆盖率")
    args = parser.parse_args()
    if args.coverage and args.action not in ("test", "test-go"):
        parser.error("--coverage 配合 test 或 test-go 使用")
    if args.action == "frontend":
        if args.frontend_action is None:
            parser.error("frontend 需要指定前端动作")
        run_frontend(args.frontend_action)
        return
    if args.frontend_action is not None:
        parser.error("前端动作需要配合 frontend 使用")
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
            cwd=TOOL_ROOT / "tools",
            env=toolenv,
        )
        for name in ("member", "admin"):
            run(
                [ROOT / ".tools/bin/gqlgen", "generate", "--config", "gqlgen-" + name + ".yml"],
                cwd=BACKEND,
                env=env,
            )
        run([go, "run", "./cmd/gen"], cwd=BACKEND, env=env)
        schema(go, env)
        run(
            ["pnpm", "codegen"],
            env=frontend_environment(env)
            if APPLICATION_ONLY
            else frontend_runtime_environment(env),
        )
        run(
            ["python3", TOOL_ROOT / "scripts/format.py", "--go-only"],
            env=dict(env, STARTER_ROOT=str(ROOT), STARTER_TOOL_ROOT=str(TOOL_ROOT)),
        )
    elif action == "schema":
        schema(go, env)
    elif action in ("migrate", "diff"):
        dialect = database_type(env.get("DB_DSN"))
        directory = "file://" + str(BACKEND / "migrations" / dialect)
        atlas = ROOT / ".tools/bin/atlas-v1.3.0"
        if action == "migrate":
            url = env.get("MIGRATION_URL")
            use_db_dsn = not url or not url.strip()
            if use_db_dsn:
                url = env["DB_DSN"]
            if database_type(url, "MIGRATION_URL") != dialect:
                raise RuntimeError("MIGRATION_URL 与 DB_DSN 的数据库类型需要一致")
            url = dialect + ":" + url.split(":", 1)[1]
            if use_db_dsn and dialect == "sqlite":
                url = atlas_sqlite_url(url)
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
                    "file://" + str(SCHEMA / "generated" / (dialect + ".sql")),
                    "--dev-url",
                    dev,
                ],
                env=env,
            )
    elif action in ("test", "test-go", "check"):
        validate_go_test_layout()
        # 全量 Go 包加载需要应用自己的内嵌 SPA；每次重建保证产物与源码一致。
        run(
            ["pnpm", "build:frontend"],
            env=frontend_environment(env)
            if APPLICATION_ONLY
            else frontend_runtime_environment(env),
        )
        if action == "test":
            for module, package in frontend_packages():
                run(
                    ["pnpm", "--filter", package, "test"],
                    env=frontend_environment(env, module=module),
                )
        if action == "check":
            run(["pnpm", "format:check"], env=env)
            run(
                [go, "vet", "./cmd/format-go"], cwd=TOOL_ROOT / "tools", env=dict(env, GOWORK="off")
            )
            run(
                [go, "vet", *GO_TEST_PACKAGES],
                cwd=BACKEND if APPLICATION_ONLY else ROOT,
                env=env,
            )
            if not APPLICATION_ONLY:
                run(
                    ["pnpm", "--filter", "@shanjing/shadcnui-dashboard", "typecheck"],
                    env=frontend_environment(env),
                )
            for module, package in frontend_packages():
                run(
                    ["pnpm", "--filter", package, "typecheck"],
                    env=frontend_environment(env, module=module),
                )
        elif action == "test-go":
            go_tests(go, env, coverage=args.coverage)
        elif APPLICATION_ONLY:
            run(
                [go, "test", "-count=1", "./cmd/format-go"],
                cwd=TOOL_ROOT / "tools",
                env=dict(env, GOWORK="off"),
            )
            go_tests(go, env, coverage=args.coverage)
        else:
            run(
                [go, "test", "-count=1", "./cmd/format-go"],
                cwd=TOOL_ROOT / "tools",
                env=dict(env, GOWORK="off"),
            )
            run(["python3", ROOT / "scripts/test-application-scripts.py"], env=env)
            run(["python3", ROOT / "scripts/test-format.py"], env=env)
            run(["python3", ROOT / "scripts/test-project.py"], env=env)
            run(["python3", ROOT / "scripts/test-starter-context.py"], env=env)
            run(["python3", ROOT / "scripts/test-toolchain.py"], env=env)
            run(["python3", ROOT / "scripts/test-host-platform.py"], env=env)
            run(["python3", ROOT / "scripts/test-sync-go-demo.py"], env=env)
            run(["python3", ROOT / "scripts/test-release-go-demo.py"], env=env)
            run(["python3", ROOT / "scripts/test-release-common.py"], env=env)
            run(["python3", ROOT / "scripts/test-demo-dependencies.py"], env=env)
            run(["python3", ROOT / "scripts/test-release-packages.py"], env=env)
            run(["python3", ROOT / "scripts/test-dev.py"], env=env)
            run(["python3", ROOT / "scripts/test-dev-reload.py"], env=env)
            run(["python3", ROOT / "scripts/test-runtime-cleanup.py"], env=env)
            run(["python3", ROOT / "scripts/test-verify-project.py"], env=env)
            run(["python3", ROOT / "scripts/test-verify-project-docker.py"], env=env)
            run(["python3", ROOT / "scripts/test-verify-postgresql.py"], env=env)
            go_tests(go, env, coverage=args.coverage)
            run(["pnpm", "test:ui"], env=frontend_environment(env))
    elif action == "build":
        run(
            ["pnpm", "build:frontend"],
            env=frontend_environment(env)
            if APPLICATION_ONLY
            else frontend_runtime_environment(env),
        )
        out = ROOT / "bin"
        out.mkdir(exist_ok=True)
        for role in ("web", "worker"):
            run(
                [go, "build", "-mod=readonly", "-trimpath", "-o", out / role, "./cmd/" + role],
                cwd=BACKEND,
                env=env,
            )
        print("Web 与 Worker 静态二进制已构建", flush=True)


def main():
    with cache_activity(ROOT):
        run_project()


if __name__ == "__main__":
    sys.exit(cli(main, "工程命令失败"))
