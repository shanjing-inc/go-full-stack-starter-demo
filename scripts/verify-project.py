#!/usr/bin/env python3
"""正式工程验收：隔离 MySQL／Redis、真实双 Web、Worker、浏览器与宿主机开发。"""

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import sys
import shutil
from verification_workspace import create_workspace
from runtime_cleanup import RunLease, safe_maintain, read_json
from dev_reload import source_fingerprint
import urllib.error
import urllib.request
from project import ROOT, environment

# 宿主机完整验收保留 MySQL 专项入口；PostgreSQL 使用独立 Docker 验收。
APP = ROOT / "projects/multi-database-demo"
# 按数据库选择真实集成用例，保留所选套件零跳过断言。
MYSQL_INTEGRATION_SKIP = (
    r"^TestExternal|^TestPostgreSQL(ConcurrentInitialization|SessionManagement|LoginRateLimitCollation|UserManagementTransactions|Database|AbsoluteTimeAndUnicodeConstraints)$"
    r"|^Test(LegacyPasswordAndRoles|UserQueries)PostgreSQL$"
)


def ensure(value, message):
    if not value:
        raise RuntimeError(message)


def auth_limit_key(namespace, secret, identity):
    """与认证 HTTP 的 HMAC key 一致；用于隔离验收的限流窗口重置。"""
    digest = hmac.new(secret.encode(), identity.encode(), hashlib.sha256).hexdigest()
    return namespace + ":auth:limit:" + digest


def browser_auth_limit_keys(namespace, secret, user_id):
    """仅重置隔离浏览器阶段的合成账号桶和本机 IP 桶。"""
    user_id = int(user_id)
    ensure(user_id > 0, "验收账号 ID 需要正整数")
    return tuple(
        auth_limit_key(namespace, secret, identity)
        for identity in (f"account:{user_id}", "ip:127.0.0.1")
    )


def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def snapshot(folder):
    return {
        str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in folder.rglob("*")
        if p.is_file()
        and not any(
            x in p.relative_to(folder).parts for x in ("node_modules", "dist", "tmp", "__pycache__")
        )
    }


def migration_versions(directory):
    paths = sorted(Path(directory).glob("*.sql"))
    ensure(paths, "迁移目录需要至少一个版本")
    versions = []
    for path in paths:
        ensure(re.fullmatch(r"[0-9]{6,14}_.+\.sql", path.name), "迁移文件名无效：" + path.name)
        versions.append(path.name.split("_", 1)[0])
    ensure(len(set(versions)) == len(versions), "迁移版本需要唯一")
    return versions


def http(origin, path="/health/ready", body=None, token="", cookie=""):
    headers = {"Content-Type": "application/json"}
    if body is not None:
        headers["Origin"] = origin
    if token:
        headers["Authorization"] = "Bearer " + token
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(
        origin + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )
    try:
        response = urllib.request.urlopen(request, timeout=2)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        return response.status, response.headers, response.read()


def create_ssr_browser_account(origin, token):
    """通过正式管理员 API 建立独立 SSR 账号，隔离同套件的账号限流额度。"""
    email = f"ssr-queue-{secrets.token_hex(8)}@example.test"
    password = secrets.token_urlsafe(24)
    code, _, raw = http(
        origin,
        "/api/graphql/admin",
        {
            "query": "mutation($set:CreateUserSetInput!){createUser(set:$set){id role}}",
            "variables": {
                "set": {
                    "name": "SSR 队列验收管理员",
                    "email": email,
                    "password": password,
                    "role": "admin",
                }
            },
        },
        token=token,
    )
    payload = json.loads(raw)
    users = payload.get("data", {}).get("createUser", []) if payload.get("data") else []
    ensure(
        code == 200
        and "errors" not in payload
        and len(users) == 1
        and users[0].get("role") == "admin",
        "SSR 浏览器独立账号创建失败：" + raw.decode(),
    )
    return {"SSR_TEST_EMAIL": email, "SSR_TEST_PASSWORD": password}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-browser", action="store_true")
    parser.add_argument("--skip-dev", action="store_true")
    parser.add_argument("--keep-runtime", action="store_true", help="完整保留本次验收现场")
    parser.add_argument("--isolated-run", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--runtime", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.isolated_run:
        safe_maintain(ROOT, automatic=True, cache=True)
        base = ROOT / ".runtime"
        base.mkdir(exist_ok=True)
        runtime = Path(tempfile.mkdtemp(prefix="project-", dir=base))
        lease = RunLease(ROOT, runtime, "project", args.keep_runtime)
        code = 1
        try:
            print("创建独立验收源码快照：" + str(runtime / "workspace"), flush=True)
            workspace = create_workspace(ROOT, runtime / "workspace")
            command = [
                sys.executable,
                workspace / "scripts/verify-project.py",
                "--isolated-run",
                "--runtime",
                runtime,
            ]
            command += [
                flag
                for flag, enabled in (
                    ("--skip-browser", args.skip_browser),
                    ("--skip-dev", args.skip_dev),
                )
                if enabled
            ]
            child = subprocess.Popen(
                [str(value) for value in command],
                cwd=workspace,
                start_new_session=True,
                env=dict(os.environ, STARTER_ISOLATED_BUILD="1"),
            )

            def forward(signum, frame):
                if child.poll() is None:
                    os.killpg(child.pid, signum)

            old_handlers = {
                sig: signal.signal(sig, forward) for sig in (signal.SIGINT, signal.SIGTERM)
            }
            try:
                code = child.wait()
            finally:
                for sig, handler in old_handlers.items():
                    signal.signal(sig, handler)
        finally:
            result = read_json(runtime / "result.json")
            status = "passed" if code == 0 and result.get("status") == "passed" else "failed"
            lease.finish(status, result.get("cleanupErrors", []))
        raise SystemExit(code if code >= 0 else 128 - code)
    ensure(args.runtime and args.runtime.is_dir(), "隔离验收需要报告目录")
    go, env = environment()
    # 验收仅使用脚本拥有的外部进程，清空继承的故障测试地址和 PID。
    for key in (
        "TEST_WEB_A",
        "TEST_WEB_B",
        "TEST_WEB_A_PID",
        "TEST_REDIS_PID",
        "REDIS_TEST_URL",
        "MYSQL_TEST_DSN",
        "MYSQL_AUTH_TEST_DSN",
        "POSTGRES_TEST_DSN",
        "POSTGRES_AUTH_TEST_DSN",
        "TEST_AUTH_TOKEN",
    ):
        env.pop(key, None)
    env["LD_LIBRARY_PATH"] = (
        str(ROOT / ".tools/browser/usr/lib/x86_64-linux-gnu") + ":" + env.get("LD_LIBRARY_PATH", "")
    )
    runtime = args.runtime.resolve()
    base = runtime.parent
    processes, files, checks, tests = [], [], [], []
    result = {
        "status": "failed",
        "runtime": str(runtime),
        "workspace": str(ROOT),
        "checks": checks,
        "tests": tests,
        "docker": {"status": "pending", "reason": "镜像构建及容器运行由独立环境验收"},
        "race": {"status": "pending", "reason": "当前工具链使用 CGO_ENABLED=0，race 需 C 编译器"},
    }
    before = snapshot(ROOT / "poc")
    reference = Path("/home/dream/wwwroot/astro-full-stack-starter")
    reference_before = (
        subprocess.check_output(["git", "status", "--porcelain"], cwd=reference, text=True)
        if reference.exists()
        else None
    )
    started = time.monotonic()

    def passed(name, **details):
        checks.append(dict(name=name, status="passed", **details))
        print("通过：" + name, flush=True)

    def run(command, name, cwd=ROOT, extra=None, timeout=240, expected=0):
        p = subprocess.run(
            [str(x) for x in command],
            cwd=cwd,
            env=dict(env, **(extra or {})),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )
        (runtime / (name + ".log")).write_text(p.stdout)
        ensure(p.returncode == expected, name + " 失败：\n" + p.stdout[-8000:])
        return p.stdout

    def start(command, name, extra=None, cwd=ROOT):
        path = runtime / (name + ".log")
        output = path.open("w")
        files.append(output)
        p = subprocess.Popen(
            [str(x) for x in command],
            cwd=cwd,
            env=dict(env, **(extra or {})),
            stdout=output,
            stderr=output,
            start_new_session=True,
        )
        processes.append(p)
        return p, path

    def stop(p, expected=0):
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGTERM)
            try:
                p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
                raise RuntimeError("进程退出超时")
        if expected is not None:
            ensure(p.returncode == expected, f"进程 {p.pid} 退出码 {p.returncode}，预期 {expected}")

    def wait(fn, label, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                if fn():
                    return
            except (
                OSError,
                ValueError,
                urllib.error.URLError,
                subprocess.CalledProcessError,
                subprocess.TimeoutExpired,
            ):
                pass
            time.sleep(0.1)
        raise RuntimeError("等待超时：" + label)

    def closed(number):
        try:
            with socket.create_connection(("127.0.0.1", number), timeout=0.1):
                return False
        except OSError:
            return True

    def unit(name, packages, extra=None, pattern=None, skip_external=False, cwd=ROOT):
        command = [go, "test", "-count=1", "-timeout=90s", "-json"]
        if pattern:
            command += ["-run", pattern]
        if skip_external:
            command += ["-skip", MYSQL_INTEGRATION_SKIP]
        out = run(command + packages, name, extra=extra, cwd=cwd)
        records = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
        skips = [r for r in records if r.get("Action") == "skip" and r.get("Test")]
        ensure(not skips, "验收测试存在跳过：" + str(skips))
        tests.extend(
            dict(stage=name, package=r["Package"], test=r["Test"], elapsed=r.get("Elapsed"))
            for r in records
            if r.get("Action") == "pass" and "Test" in r
        )
        passed(name)

    def redis_instance(name):
        number = port()
        proc, _ = start(
            [
                "redis-server",
                "--bind",
                "127.0.0.1",
                "--port",
                number,
                "--save",
                "",
                "--appendonly",
                "no",
                "--dir",
                runtime,
            ],
            name,
        )
        url = f"redis://127.0.0.1:{number}/0"
        wait(
            lambda: subprocess.check_output(
                ["redis-cli", "-u", url, "PING"], stderr=subprocess.DEVNULL
            ).strip()
            == b"PONG",
            name + "就绪",
        )
        return proc, url

    def interrupted(signum, frame):
        raise KeyboardInterrupt("验收收到退出信号")

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)

    try:
        versions = migration_versions(APP / "migrations/mysql")
        ensure(versions == migration_versions(APP / "migrations/sqlite"), "两个方言的迁移版本一致")
        db_version = versions[-1]
        run(["python3", "scripts/test-verify-project.py"], "验收脚本版本与认证请求单测")
        run(["python3", "scripts/setup.py"], "固定工具与依赖")
        run(["pnpm", "generate"], "代码与目标Schema生成")
        generated = (
            snapshot(APP / "internal/graph")
            | {"query/" + k: v for k, v in snapshot(APP / "internal/query").items()}
            | {"schema/" + k: v for k, v in snapshot(APP / "schema/generated").items()}
        )
        run(["pnpm", "generate"], "代码生成可重复性")
        ensure(
            generated
            == snapshot(APP / "internal/graph")
            | {"query/" + k: v for k, v in snapshot(APP / "internal/query").items()}
            | {"schema/" + k: v for k, v in snapshot(APP / "schema/generated").items()},
            "代码生成结果应稳定",
        )
        passed("工具依赖校验与可重复代码生成")
        unit(
            "Go四空格格式工具单测", ["./cmd/format-go"], extra={"GOWORK": "off"}, cwd=ROOT / "tools"
        )
        run(["python3", "scripts/test-format.py"], "格式文件范围与只读检查单测")
        run(["python3", "scripts/test-project.py"], "内嵌SPA构建依赖顺序单测")
        run(["python3", "scripts/test-dev.py"], "开发端口占用与既有服务保护单测")
        run(["python3", "scripts/test-dev-reload.py"], "开发代际与运行隔离回归")
        run(["python3", "scripts/test-runtime-cleanup.py"], "运行产物保留、缓存锁与清理边界回归")
        run(["pnpm", "check"], "静态检查")
        run(["pnpm", "test:ui"], "Dashboard单测")
        run(["pnpm", "build"], "正式产物构建")
        for role in ("web", "worker"):
            ensure(
                "statically linked" in run(["file", ROOT / "bin" / role], "静态二进制-" + role),
                "二进制应静态链接",
            )
        passed("Go vet、前端类型检查、Dashboard单测与静态二进制构建")
        redis_proc, redis_url = redis_instance("隔离Redis")
        mysql_port = port()
        datadir, mysql_log = runtime / "mysql", runtime / "mysql-error.log"
        run(
            [
                "mysqld",
                "--no-defaults",
                "--initialize-insecure",
                f"--datadir={datadir}",
                f"--log-error={mysql_log}",
            ],
            "MySQL初始化",
            timeout=120,
        )
        mysql_proc, _ = start(
            [
                "mysqld",
                "--no-defaults",
                f"--datadir={datadir}",
                "--bind-address=127.0.0.1",
                f"--port={mysql_port}",
                f"--socket={runtime}/mysql.sock",
                f"--pid-file={runtime}/mysql.pid",
                f"--log-error={mysql_log}",
                "--mysqlx=OFF",
                "--skip-log-bin",
                "--performance-schema=OFF",
                "--innodb-buffer-pool-size=64M",
                "--max-connections=40",
                "--default-time-zone=+00:00",
                "--character-set-server=utf8mb4",
                "--collation-server=utf8mb4_unicode_ci",
            ],
            "隔离MySQL",
        )
        mysql_cmd = [
            "mysql",
            "--no-defaults",
            "--protocol=TCP",
            "--host=127.0.0.1",
            f"--port={mysql_port}",
            "--user=root",
            "--connect-timeout=1",
            "--batch",
            "--raw",
            "--skip-column-names",
        ]

        def sql(query):
            p = subprocess.run(
                mysql_cmd,
                input=query,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
            )
            ensure(p.returncode == 0, p.stderr)
            return p.stdout.strip()

        wait(
            lambda: subprocess.run(
                mysql_cmd + ["-e", "SELECT 1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            ).returncode
            == 0,
            "MySQL就绪",
        )
        ensure(
            Path(sql("SELECT @@datadir")).resolve() == datadir.resolve(), "连接脚本拥有的隔离 MySQL"
        )
        version = sql("SELECT VERSION()")
        ensure(version.startswith("8.0."), "MySQL 8.0 集成验证")
        sql(
            "CREATE DATABASE demo; CREATE DATABASE unit_test; CREATE DATABASE auth_test; CREATE DATABASE atlas_dev; CREATE DATABASE missing;"
            'CREATE USER app@127.0.0.1 IDENTIFIED BY "local-test-password";'
        )
        mysql_url = f"mysql://root@127.0.0.1:{mysql_port}/demo"
        run(
            ["pnpm", "migrate"],
            "MySQL正式迁移",
            extra={"DB_DSN": mysql_url, "MIGRATION_URL": mysql_url},
        )
        run(
            ["pnpm", "migrate"],
            "MySQL重复迁移",
            extra={"DB_DSN": mysql_url, "MIGRATION_URL": mysql_url},
        )
        sql(
            "GRANT SELECT ON demo.atlas_schema_revisions TO app@127.0.0.1; GRANT SELECT ON missing.* TO app@127.0.0.1;"
            + "".join(
                f"GRANT SELECT,INSERT,UPDATE,DELETE ON demo.`{table}` TO app@127.0.0.1;"
                for table in (
                    "shop",
                    "user",
                    "account",
                    "session",
                    "verification",
                    "auth_bootstrap",
                )
            )
        )
        ensure(
            sql("SELECT version FROM demo.atlas_schema_revisions ORDER BY version").splitlines()
            == versions,
            "完整迁移版本登记",
        )
        atlas = ROOT / ".tools/bin/atlas-v1.3.0"
        out = run(
            [
                atlas,
                "schema",
                "diff",
                "--from",
                mysql_url,
                "--to",
                "file://" + str(APP / "schema/generated/mysql.sql"),
                "--dev-url",
                f"mysql://root@127.0.0.1:{mysql_port}/atlas_dev",
                "--exclude",
                "atlas_schema_revisions",
            ],
            "MySQL目标Schema一致性",
        )
        ensure("Schemas are synced" in out, "正式迁移与目标 Schema 一致：" + out)
        sqlite = runtime / "app.sqlite"
        run(
            ["pnpm", "migrate"],
            "SQLite正式迁移",
            extra={"DB_DSN": "sqlite://" + str(sqlite), "MIGRATION_URL": "sqlite://" + str(sqlite)},
        )
        with sqlite3.connect(sqlite) as db:
            ensure(
                [
                    str(row[0])
                    for row in db.execute(
                        "SELECT version FROM atlas_schema_revisions ORDER BY version"
                    )
                ]
                == versions,
                "SQLite完整迁移版本登记",
            )
        passed(
            "MySQL8.0与SQLite正式Atlas迁移、版本登记及MySQL结构一致",
            mysql=version,
            databaseVersion=db_version,
        )
        integration = {
            "REDIS_TEST_URL": redis_url,
            "MYSQL_TEST_DSN": f"root@tcp(127.0.0.1:{mysql_port})/unit_test?parseTime=true",
            "MYSQL_AUTH_TEST_DSN": f"root@tcp(127.0.0.1:{mysql_port})/auth_test?parseTime=true",
        }
        unit(
            "正式工程全部单测与真实MySQLRedis集成",
            ["./packages/go-server-kit/...", "./projects/multi-database-demo/..."],
            integration,
            skip_external=True,
        )
        web_port, web_b_port = port(), port()
        app = {
            "APP_MODE": "development",
            "REDIS_URL": redis_url,
            "APP_NAMESPACE": "verify-demo",
            "DB_DSN": f"mysql://app:local-test-password@127.0.0.1:{mysql_port}/demo?parseTime=true&timeout=1s&readTimeout=1s&writeTimeout=1s",
            "DB_VERSION": db_version,
            "AUTH_SECRET": secrets.token_hex(32),
            "AUTH_BOOTSTRAP_TOKEN": secrets.token_hex(32),
            "WEB_ADDR": f"127.0.0.1:{web_port}",
            "SHUTDOWN_TIMEOUT": "4s",
        }
        origin, origin_b = f"http://127.0.0.1:{web_port}", f"http://127.0.0.1:{web_b_port}"
        app["ALLOW_ORIGINS"] = origin + "," + origin_b
        web, _ = start([ROOT / "bin/web"], "Web-A", dict(app, INSTANCE_ID="web-a"))
        web_b, _ = start(
            [ROOT / "bin/web"],
            "Web-B",
            dict(app, INSTANCE_ID="web-b", WEB_ADDR=f"127.0.0.1:{web_b_port}"),
        )
        worker, worker_log = start([ROOT / "bin/worker"], "Worker", dict(app, INSTANCE_ID="worker"))
        wait(
            lambda: http(origin)[0] == 200
            and http(origin_b)[0] == 200
            and "Worker 就绪" in worker_log.read_text(),
            "双Web与Worker就绪",
        )
        passed("受限数据库账户启动双Web与独立Worker")
        ensure(http(origin, "/api/rest/demo/session")[0] == 401, "匿名后台请求拒绝")
        code, _, raw = http(
            origin,
            "/api/auth/initialize",
            {
                "name": "验收管理员",
                "email": "owner@example.com",
                "password": "owner-password-2026",
                "bootstrapToken": app["AUTH_BOOTSTRAP_TOKEN"],
            },
        )
        ensure(code == 201, "受限账户认证初始化：" + raw.decode())
        browser_owner_id = json.loads(raw)["user"]["id"]
        # 真实进程链路复核旧库中的组合管理员身份。
        sql("UPDATE demo.user SET role='owner,user' WHERE email='owner@example.com'")
        code, _, raw = http(origin_b, "/api/auth/install-status")
        ensure(
            code == 200 and json.loads(raw) == {"installed": True, "enabled": False},
            "组合管理员安装状态",
        )
        credentials = {"email": "owner@example.com", "password": "owner-password-2026"}
        code, headers, raw = http(origin, "/api/auth/sign-in/email", credentials)
        ensure(code == 200, "实际登录")
        revoked_token = json.loads(raw)["token"]
        cookie = headers.get("Set-Cookie", "").split(";", 1)[0]
        ensure(cookie.startswith("better-auth.session_token="), "登录设置会话Cookie")
        for bearer, session_cookie in ((revoked_token, ""), ("", cookie)):
            code, _, raw = http(
                origin_b, "/api/rest/demo/session", token=bearer, cookie=session_cookie
            )
            ensure(
                code == 200 and "demo:write" in json.loads(raw)["permissions"],
                "跨Web组合管理员会话与权限",
            )
        ensure(http(origin, "/api/auth/sign-out", {}, cookie=cookie)[0] == 200, "实际退出")
        ensure(
            http(origin_b, "/api/rest/demo/session", token=revoked_token)[0] == 401,
            "退出后跨实例撤销",
        )
        code, _, raw = http(origin_b, "/api/auth/sign-in/email", credentials)
        ensure(code == 200, "创建验收API会话")
        auth_token = json.loads(raw)["token"]
        passed("真实认证初始化、组合角色Cookie与Bearer跨实例权限及退出撤销")
        unit(
            "独立Web跨实例WS广播与查询SSE",
            ["./projects/multi-database-demo/internal/realtime"],
            {"TEST_WEB_A": origin, "TEST_WEB_B": origin_b, "TEST_AUTH_TOKEN": auth_token},
            "^TestExternalWebProcesses$",
        )
        code, _, raw = http(
            origin,
            "/api/graphql/admin",
            {
                "query": "mutation($set:CreateShopSetInput!){createShop(set:$set){id name slug}}",
                "variables": {"set": {"name": "集成店铺", "slug": "integration"}},
            },
            token=auth_token,
        )
        ensure(code == 200 and "errors" not in json.loads(raw), "真实GraphQL创建：" + raw.decode())
        shop_id = json.loads(raw)["data"]["createShop"]["id"]
        for endpoint in ("/api/graphql/member", "/api/graphql/admin"):
            code, _, raw = http(
                origin,
                endpoint,
                {"query": '{getShop(where:{slug:{eq:"integration"}}){id name slug}}'},
                token=auth_token,
            )
            ensure(
                code == 200 and json.loads(raw)["data"]["getShop"]["id"] == shop_id,
                "双Schema读取数据库",
            )
        ensure(
            http(origin, "/api/rest/demo/shops/" + shop_id, token=auth_token)[0] == 200,
            "REST读取数据库",
        )
        code, _, raw = http(origin, "/admin/shops")
        ensure(code == 200 and b'<div id="root"' in raw, "SPA深链")
        ensure(http(origin, "/api/missing", token=auth_token)[0] == 404, "API路由隔离")
        ensure(
            http(origin, "/api/rest/demo/tasks", {"key": "effect"}, token=auth_token)[0] == 202,
            "任务投递",
        )

        def redis(*commands):
            return subprocess.check_output(
                ["redis-cli", "-u", redis_url, "--raw", *commands], text=True, timeout=3
            ).strip()

        def reset_browser_auth_limits():
            # 仅操作本轮临时 Redis 中合成账号与本机 IP 的两个 key。
            # 各浏览器阶段独立使用正式限流策略，保留生产的 20/5 次分钟上限。
            redis(
                "DEL",
                *browser_auth_limit_keys(
                    app["APP_NAMESPACE"], app["AUTH_SECRET"], browser_owner_id
                ),
            )

        wait(lambda: redis("HGET", "verify-demo:worker:counts", "effect") == "1", "任务消费")
        ensure(
            http(origin, "/api/rest/demo/tasks", {"key": "effect"}, token=auth_token)[0] == 409,
            "完成任务ID保留",
        )
        ensure(
            http(origin, "/api/rest/demo/tasks", {"key": "invalid", "extra": 1}, token=auth_token)[
                0
            ]
            == 400,
            "任务严格输入",
        )
        passed("真实REST双GraphQL读写、SPA深链及Asynq任务消费")
        sql(f'UPDATE demo.atlas_schema_revisions SET applied=0 WHERE version="{db_version}"')
        ensure(http(origin)[0] == 503, "迁移登记异常导致readiness失败")
        sql(f'UPDATE demo.atlas_schema_revisions SET applied=total WHERE version="{db_version}"')
        for role in ("web", "worker"):
            run(
                [ROOT / "bin" / role],
                role + "错误版本拒绝启动",
                extra=dict(app, DB_VERSION=str(int(db_version) + 1)),
                expected=1,
            )
            run(
                [ROOT / "bin" / role],
                role + "无效运行模式拒绝启动",
                extra=dict(app, APP_MODE="invalid"),
                timeout=10,
                expected=1,
            )
            missing = dict(app, DB_DSN=app["DB_DSN"].replace("/demo?", "/missing?"))
            run([ROOT / "bin" / role], role + "缺失迁移拒绝启动", extra=missing, expected=1)
        ensure(
            sql('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema="missing"')
            == "0",
            "入口只读版本检查",
        )
        run(
            [ROOT / "bin/web"],
            "生产Web拒绝HTTP-Origin",
            extra=dict(app, APP_MODE="production"),
            timeout=10,
            expected=1,
        )
        production_port = port()
        production = dict(
            app,
            APP_MODE="production",
            APP_NAMESPACE="verify-production",
            AUTH_BOOTSTRAP_TOKEN="",
            ALLOW_ORIGINS="https://deployment.example",
            WEB_ADDR=f"127.0.0.1:{production_port}",
        )
        production_web, _ = start([ROOT / "bin/web"], "生产配置Web", production)
        production_worker, production_log = start(
            [ROOT / "bin/worker"], "生产配置Worker", production
        )
        wait(
            lambda: http(f"http://127.0.0.1:{production_port}")[0] == 200
            and "Worker 就绪" in production_log.read_text(),
            "合法生产配置的双角色就绪",
        )
        stop(production_web)
        stop(production_worker)
        ensure(closed(production_port), "生产配置Web退出后监听关闭")
        passed("readiness故障、启动版本门禁及显式运行模式配置")
        sqlite_env = dict(app, DB_DSN="sqlite://" + str(sqlite), WEB_ADDR=f"127.0.0.1:{port()}")
        sqlite_web, _ = start([ROOT / "bin/web"], "SQLite-Web", sqlite_env)
        wait(lambda: http("http://" + sqlite_env["WEB_ADDR"])[0] == 200, "SQLite真实Atlas登记启动")
        stop(sqlite_web)
        passed("SQLite真实迁移登记通过只读启动门禁")
        ssr_browser_env = {}
        if args.skip_browser:
            checks.append(
                dict(name="Dashboard真实浏览器", status="skipped", reason="--skip-browser")
            )
        else:
            ssr_browser_env = create_ssr_browser_account(origin, auth_token)
            reset_browser_auth_limits()
            run(
                ["pnpm", "test:browser"],
                "Dashboard真实浏览器",
                extra={
                    **ssr_browser_env,
                    "TEST_ORIGIN": origin,
                    "BROWSER_REPORT": str(runtime / "browser.json"),
                },
            )
            passed("Dashboard桌面与移动端、创建唯一约束、深链、主题字号及退出")
        stop(web)
        stop(web_b)
        stop(worker)
        ensure(closed(web_port) and closed(web_b_port), "Web监听已关闭")
        passed("Web与Worker独立优雅退出")
        # 每个故障场景都使用新 Redis 和新 Web；PID 从本次 Popen 对象传入。
        for name in ("TestExternalCrashTTL", "TestExternalShutdown", "TestExternalRedisStop"):
            failure_redis, failure_url = redis_instance(name + "-Redis")
            number_a, number_b = port(), port()
            failure_env = dict(app, REDIS_URL=failure_url, APP_NAMESPACE=name)
            proc_a, _ = start(
                [ROOT / "bin/web"],
                name + "-A",
                dict(failure_env, INSTANCE_ID="a", WEB_ADDR=f"127.0.0.1:{number_a}"),
            )
            proc_b, _ = start(
                [ROOT / "bin/web"],
                name + "-B",
                dict(failure_env, INSTANCE_ID="b", WEB_ADDR=f"127.0.0.1:{number_b}"),
            )
            a, b = f"http://127.0.0.1:{number_a}", f"http://127.0.0.1:{number_b}"
            wait(lambda: http(a)[0] == 200 and http(b)[0] == 200, name + "就绪")
            unit(
                name,
                ["./projects/multi-database-demo/internal/realtime"],
                {
                    "TEST_WEB_A": a,
                    "TEST_WEB_B": b,
                    "TEST_AUTH_TOKEN": auth_token,
                    "TEST_WEB_A_PID": str(proc_a.pid),
                    "TEST_REDIS_PID": str(failure_redis.pid),
                },
                "^" + name + "$",
            )
            stop(proc_a, expected=-signal.SIGKILL if name == "TestExternalCrashTTL" else 0)
            stop(proc_b)
            stop(failure_redis)
        if args.skip_dev:
            checks.append(dict(name="宿主机开发与HMR", status="skipped", reason="--skip-dev"))
        else:
            # 清空快照内公共 dist，验证开发对源包和样式的冷启动路径。
            dashboard_dist = ROOT / "packages/shadcnui-dashboard/dist"
            shutil.rmtree(dashboard_dist)
            embedded_before = snapshot(APP / "webui/dist")
            spa_port, dev_port = port(), port()
            dev_env = dict(
                app,
                WEB_ADDR=f"127.0.0.1:{dev_port}",
                SPA_PORT=str(spa_port),
                ALLOW_ORIGINS=f"http://127.0.0.1:{spa_port},http://127.0.0.1:{dev_port}",
            )
            dev, dev_log = start(
                [sys.executable, ROOT / "scripts/dev.py"], "宿主机Vite串行开发", dev_env
            )
            dev_origin = f"http://127.0.0.1:{dev_port}"
            wait(
                lambda: http(dev_origin)[0] == 200
                and http(f"http://127.0.0.1:{spa_port}", "/admin/")[0] == 200
                and "Worker 就绪" in dev_log.read_text(),
                "宿主机三个角色就绪",
                90,
            )

            def state_for(log):
                prefix = "开发运行目录："
                paths = [
                    line[len(prefix) :]
                    for line in log.read_text().splitlines()
                    if line.startswith(prefix)
                ]
                ensure(paths, "开发监管器公布独立运行目录")
                folder = Path(paths[-1])
                state = json.loads((folder / "state.json").read_text())
                return folder, state

            def generation_ready(log):
                folder, state = state_for(log)
                return state["status"] == "ready" and state[
                    "inputFingerprint"
                ] == source_fingerprint(ROOT, APP, folder / "frontend-dist")

            def assert_generation(log, origin):
                folder, state = state_for(log)
                ensure(generation_ready(log), "开发业务代际及输入指纹一致")
                ensure(set(state["roles"]) == {"web", "worker"}, "两个业务角色完整")
                actual_pid = json.loads(http(origin, "/api/rest/demo/build", token=auth_token)[2])[
                    "pid"
                ]
                ensure(actual_pid == state["roles"]["web"]["pid"], "实际响应 PID 与监管代际一致")
                for role, record in state["roles"].items():
                    executable = Path(f"/proc/{record['pid']}/exe")
                    ensure(
                        executable.resolve() == Path(record["binary"]), role + " 运行独立代际二进制"
                    )
                    ensure(
                        hashlib.sha256(executable.read_bytes()).hexdigest()
                        == record["binaryFingerprint"],
                        role + " 构建指纹一致",
                    )
                    instances = []
                    for path in Path("/proc").glob("[0-9]*/exe"):
                        try:
                            target = path.resolve()
                            if target.is_relative_to(folder) and target.name == role:
                                instances.append(int(path.parent.name))
                        except (OSError, RuntimeError):
                            pass
                    ensure(instances == [record["pid"]], role + " 每代单实例")
                return state

            initial_state = assert_generation(dev_log, dev_origin)
            ensure(not dashboard_dist.exists(), "开发直接消费公共源码及样式，公共 dist 保持独立")
            ensure(embedded_before == snapshot(APP / "webui/dist"), "开发内嵌构建保留既有应用 dist")
            parallel_port, parallel_spa = port(), port()
            parallel, parallel_log = start(
                [sys.executable, ROOT / "scripts/dev.py"],
                "并行开发隔离",
                dict(dev_env, WEB_ADDR=f"127.0.0.1:{parallel_port}", SPA_PORT=str(parallel_spa)),
            )
            parallel_origin = f"http://127.0.0.1:{parallel_port}"
            wait(
                lambda: http(parallel_origin)[0] == 200
                and "Worker 就绪" in parallel_log.read_text(),
                "并行开发代际就绪",
                90,
            )
            assert_generation(parallel_log, parallel_origin)
            stop(parallel)
            wait(
                lambda: "SPA、Web、Worker 进程组已清理" in parallel_log.read_text()
                and closed(parallel_port)
                and closed(parallel_spa),
                "并行开发独立退出",
                20,
            )
            ensure(
                initial_state["roles"] == assert_generation(dev_log, dev_origin)["roles"],
                "停止并行实例保留原开发业务 PID 与二进制",
            )
            source = APP / "internal/buildinfo/buildinfo.go"
            original = source.read_text()
            try:
                source.write_text(original.replace("development", "verify-hmr"))
                wait(
                    lambda: b"verify-hmr"
                    in http(dev_origin, "/api/rest/demo/build", token=auth_token)[2]
                    and dev_log.read_text().count("Worker 就绪") >= 2,
                    "共享Go源码触发两个角色重建",
                    90,
                )
            finally:
                source.write_text(original)
            wait(
                lambda: b"development"
                in http(dev_origin, "/api/rest/demo/build", token=auth_token)[2]
                and generation_ready(dev_log),
                "共享源码恢复",
                90,
            )
            restored_state = assert_generation(dev_log, dev_origin)
            ensure(
                all(
                    not Path(f"/proc/{record['pid']}").exists()
                    for record in initial_state["roles"].values()
                ),
                "重载后旧代业务 PID 全部退出",
            )
            # 实际 Go 编译失败时保持当前可用代，源码恢复后串行切换。
            try:
                source.write_text(original + "\n这段代码用于验证编译失败\n")
                wait(
                    lambda: state_for(dev_log)[1]["status"] == "build-failed",
                    "实际 Go 编译失败明确暴露",
                    90,
                )
                ensure(
                    restored_state["roles"] == state_for(dev_log)[1]["roles"],
                    "编译失败保留当前可用代",
                )
                ensure(http(dev_origin)[0] == 200, "编译失败期间旧代继续服务")
            finally:
                source.write_text(original)
            # 恢复内容与上次成功输入一致，失败输入不同，触发新的完整构建。
            wait(lambda: generation_ready(dev_log), "Go 编译恢复后代际就绪", 90)
            assert_generation(dev_log, dev_origin)
            public_go = ROOT / "packages/go-server-kit/infra/config/env.go"
            public_original = public_go.read_text()
            current_pid = json.loads(http(dev_origin, "/api/rest/demo/build", token=auth_token)[2])[
                "pid"
            ]
            ready_count = dev_log.read_text().count("Worker 就绪")
            try:
                public_go.write_text(public_original + "\n// 验收公共包变更触发两个入口重建。\n")
                wait(
                    lambda: json.loads(
                        http(dev_origin, "/api/rest/demo/build", token=auth_token)[2]
                    )["pid"]
                    != current_pid
                    and dev_log.read_text().count("Worker 就绪") > ready_count,
                    "公共Go包触发两个角色重建",
                    90,
                )
            finally:
                public_go.write_text(public_original)
            wait(
                lambda: http(dev_origin)[0] == 200 and generation_ready(dev_log),
                "公共Go源码恢复后Web就绪",
                90,
            )
            assert_generation(dev_log, dev_origin)
            if not args.skip_browser:
                reset_browser_auth_limits()
                run(
                    ["pnpm", "test:browser"],
                    "宿主机开发浏览器",
                    extra={
                        "TEST_ORIGIN": f"http://127.0.0.1:{spa_port}",
                        "BROWSER_REPORT": str(runtime / "browser-dev.json"),
                        **ssr_browser_env,
                    },
                )
                reset_browser_auth_limits()
                run(
                    ["node", "verify-hmr.mjs"],
                    "公共Dashboard源码HMR",
                    cwd=APP / "frontend",
                    extra={"TEST_ORIGIN": f"http://127.0.0.1:{spa_port}"},
                )
            # 直接监管 Python 入口，等待其全部后代退出后再结束隔离数据库／Redis。
            stop(dev)
            wait(
                lambda: "SPA、Web、Worker 进程组已清理" in dev_log.read_text()
                and closed(spa_port)
                and closed(dev_port),
                "宿主机监管器完成清理与监听关闭",
                20,
            )
            ensure(
                not dashboard_dist.exists() and embedded_before == snapshot(APP / "webui/dist"),
                "开发与 HMR 全程保持原前端产物独立",
            )
            passed("宿主机Vite串行开发、源码冷启动、并行隔离、代际指纹与编译恢复及统一退出")
        ensure(before == snapshot(ROOT / "poc"), "五组POC源码保持原样")
        if reference_before is not None:
            ensure(
                reference_before
                == subprocess.check_output(
                    ["git", "status", "--porcelain"], cwd=reference, text=True
                ),
                "参考仓库状态保持原样",
            )
        passed("原POC与参考仓库保持原样")
        result["status"] = "passed"
    except BaseException as e:
        result["error"] = str(e)
        raise
    finally:
        cleanup_errors = []
        for proc in reversed(processes):
            try:
                stop(proc, expected=None)
            except Exception as error:
                cleanup_errors.append(str(error))
                if proc.poll() is None:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait(timeout=5)
                    except Exception as kill_error:
                        cleanup_errors.append(str(kill_error))
        for output in files:
            output.close()
        result["cleanupErrors"] = cleanup_errors
        if cleanup_errors:
            result["status"] = "failed"
        result["elapsedSeconds"] = round(time.monotonic() - started, 2)
        result["testPassCount"] = len(tests)
        (runtime / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        )
        (base / "project-latest.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        )
        print("验收记录：" + str(runtime / "result.json"), flush=True)
        if cleanup_errors:
            raise RuntimeError("隔离进程清理待处理：" + "；".join(cleanup_errors))


if __name__ == "__main__":
    main()
