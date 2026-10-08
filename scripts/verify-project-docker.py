#!/usr/bin/env python3
"""正式项目 Docker 验收；完整构建与离线运行分别记录，环境阻塞退出码为 2。"""

import argparse
from runtime_cleanup import RunLease, safe_maintain
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from project import atlas_dev_url, environment

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "projects/multi-database-demo"
# 从业务目录发现数据库初始化、连接 URL、认证与业务数据库测试。
POSTGRESQL_TEST_PACKAGES = [
    "./packages/go-server-kit/infra/database/...",
    "./packages/go-server-kit/modules/auth",
    "./" + str(APP.relative_to(ROOT)) + "/internal/service",
]


class Blocked(RuntimeError):
    """外部环境尚未满足验收前提。"""


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def migration_versions(directory):
    versions = sorted(path.name.split("_", 1)[0] for path in directory.glob("*.sql"))
    ensure(versions and all(re.fullmatch(r"\d{6,14}", v) for v in versions), "迁移版本无效")
    ensure(len(versions) == len(set(versions)), "迁移版本重复")
    return versions


def free_port(excluded=()):
    for _ in range(50):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            number = listener.getsockname()[1]
        if number not in excluded:
            return number
    raise RuntimeError("无法分配独立验收端口")


def redact(text, values):
    for value in sorted(set(values), key=len, reverse=True):
        if value:
            text = text.replace(value, "[已隐藏]")
    return re.sub(r"(https?://[^\s\"?]+)\?[^\s\"]+", r"\1?[已隐藏]", text)


def runtime_recipe(source):
    """复用正式 Dockerfile 最终阶段，此前的编译阶段单独登记待验收。"""
    ensure(source.count("FROM scratch") == 1, "正式 Dockerfile 需要唯一 scratch 运行阶段")
    remainder = source.split("FROM scratch", 1)[1]
    ensure(
        not re.search(r"^\s*FROM\s", remainder, re.MULTILINE | re.IGNORECASE),
        "scratch 需要为最终运行阶段",
    )
    recipe = "FROM scratch" + remainder
    replacements = {
        "COPY --from=backend /etc/ssl/certs/ca-certificates.crt": "COPY ca-certificates.crt",
        "COPY --from=backend /out/web": "COPY web",
        "COPY --from=backend /out/worker": "COPY worker",
    }
    for old, new in replacements.items():
        ensure(recipe.count(old) == 1, "运行阶段 COPY 定义需要同步：" + old)
        recipe = recipe.replace(old, new)
    ensure("--from=" not in recipe, "离线运行阶段包含额外构建依赖")
    return recipe


def valid_registry(value):
    """只接收镜像引用前缀 host[:port][/path]，排除 URL 与凭据。"""
    pattern = (
        r"([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)(?::([0-9]{1,5}))?"
        r"(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*"
    )
    match = re.fullmatch(pattern, value)
    if not match or ".." in match[1]:
        return False
    return match[2] is None or 1 <= int(match[2]) <= 65535


def valid_build_proxy(value):
    """构建代理使用无凭据的 HTTP(S) URL，避免把凭据写入命令与报告。"""
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
        return (
            parsed.scheme in ("http", "https")
            and parsed.hostname is not None
            and parsed.username is None
            and parsed.password is None
            and parsed.path in ("", "/")
            and not parsed.query
            and not parsed.fragment
            and (port is None or 1 <= port <= 65535)
            and not any(char.isspace() for char in value)
        )
    except ValueError:
        return False


def image_repository(reference):
    repository = reference.split("@", 1)[0]
    if ":" in repository.rsplit("/", 1)[-1]:
        repository = repository.rsplit(":", 1)[0]
    first = repository.split("/", 1)[0]
    if "/" not in repository:
        return "docker.io/library/" + repository
    if "." not in first and ":" not in first and first != "localhost":
        return "docker.io/" + repository
    if first == "docker.io" and repository.count("/") == 1:
        return "docker.io/library/" + repository.split("/", 1)[1]
    return repository


def matching_digest(reference, digests):
    for digest in digests:
        if re.search(r"@sha256:[a-f0-9]{64}$", digest) and image_repository(
            digest
        ) == image_repository(reference):
            return digest
    raise RuntimeError("镜像摘要与拉取来源需要一致：" + reference)


def resource_absent(error, kind, name):
    text = str(error).lower()
    if kind == "network":
        return "network " + name.lower() + " not found" in text
    return "no such " + kind + ": " + name.lower() in text


def network_failure(text):
    return any(
        marker in text.lower()
        for marker in (
            "i/o timeout",
            "context deadline exceeded",
            "connection reset",
            "network is unreachable",
            "no such host",
            "temporary failure",
            "tls handshake timeout",
            "connection refused",
            "lookup ",
        )
    )


class Verification:
    def __init__(self, args):
        self.args = args
        base = ROOT / ".runtime"
        base.mkdir(exist_ok=True)
        self.runtime = Path(tempfile.mkdtemp(prefix="project-docker-", dir=base))
        self.runtime.chmod(0o700)
        self.token = uuid.uuid4().hex[:12]
        self.network = None
        self.containers, self.processes, self.outputs, self.env_files, self.private = (
            [],
            [],
            [],
            [],
            [],
        )
        self.dialect = getattr(args, "database", "mysql")
        self.dependency_pending = (
            "PostgreSQL" if self.dialect == "postgres" else "MySQL"
        ) + "／Redis 依赖容器拓扑"
        self.image = APP.name + "-verify:" + self.token
        self.built = False
        self.build_attempted = False
        self.command_id = 0
        self.started = time.monotonic()
        self.result = {
            "status": "failed",
            "project": APP.name,
            "database": self.dialect,
            "scope": "offline-runtime" if args.runtime_only else "full-build-and-runtime",
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "runtime": str(self.runtime),
            "checks": [],
            "pending": [
                "生产 TLS／反向代理／Secure Cookie、真实旧库切换、容量与发布验收",
                "正式多阶段 Dockerfile 构建与基础镜像摘要",
                self.dependency_pending,
            ],
        }

    def run(self, command, label, timeout=60, expected=0, input=None, env=None):
        try:
            p = subprocess.run(
                [str(v) for v in command],
                cwd=ROOT,
                env=env,
                input=input,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as error:
            output = error.stdout or b""
            if isinstance(output, bytes):
                output = output.decode(errors="replace")
            (self.runtime / (label + ".log")).write_text(redact(output, self.private))
            raise RuntimeError(label + "超时") from error
        safe = redact(p.stdout, self.private)
        (self.runtime / (label + ".log")).write_text(safe)
        ensure(p.returncode == expected, label + "失败：\n" + safe[-6000:])
        return p.stdout.strip()

    def docker(self, *command, timeout=60, expected=0, input=None):
        self.command_id += 1
        env = None
        if self.args.build_proxy:
            # BuildKit 的认证回调由 Docker CLI 发起，需要独立于 daemon 的代理环境。
            env = os.environ.copy()
            for key in ("HTTP_PROXY", "HTTPS_PROXY"):
                env[key] = env[key.lower()] = self.args.build_proxy
            env["NO_PROXY"] = env["no_proxy"] = "localhost,127.0.0.1,::1"
        return self.run(
            ["docker", *command],
            f"docker-{self.command_id:04d}",
            timeout=timeout,
            expected=expected,
            input=input,
            env=env,
        )

    def passed(self, name, **details):
        self.result["checks"].append(dict(name=name, status="passed", **details))
        print("通过：" + name, flush=True)

    def wait(self, fn, name, seconds=30):
        deadline, last = time.monotonic() + seconds, ""
        while time.monotonic() < deadline:
            try:
                if fn():
                    return
            except (OSError, RuntimeError, ValueError, urllib.error.URLError) as error:
                last = str(error)
            time.sleep(0.2)
        raise RuntimeError("等待超时：" + name + "\n" + redact(last, self.private)[-1500:])

    def inspect(self, name):
        return json.loads(self.docker("inspect", name))[0]

    def envfile(self, values):
        ensure(
            all(re.fullmatch(r"[A-Z_][A-Z0-9_]*", key) for key in values),
            "环境变量键名需要合法标识符",
        )
        ensure(
            all("\n" not in str(v) and "\r" not in str(v) for v in values.values()),
            "环境变量需要单行值",
        )
        file = self.runtime / f"container-{len(self.env_files)}.env"
        file.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
        file.chmod(0o600)
        self.env_files.append(file)
        return file

    def launch(self, suffix, values, image=None, command=(), port=None, hardened=True):
        name = "project-docker-" + self.token + "-" + suffix
        args = ["run", "-d", "--name", name, "--network", self.network or "host"]
        if hardened:
            args += ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true"]
        if port is not None and self.network:
            args += ["-p", f"127.0.0.1:{port}:8080"]
        args += ["--env-file", self.envfile(values), image or self.image, *command]
        self.containers.append(name)
        self.docker(*args)
        return name

    def start(self, command, label):
        output = (self.runtime / (label + ".log")).open("w")
        self.outputs.append(output)
        p = subprocess.Popen(
            [str(v) for v in command],
            cwd=ROOT,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.processes.append(p)
        return p

    def http(self, origin, path="/health/ready", body=None, token="", cookie=""):
        headers = {"Origin": origin}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = "Bearer " + token
        if cookie:
            headers["Cookie"] = cookie
        req = urllib.request.Request(
            origin + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        try:
            response = urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def build_image(self, *args):
        self.build_attempted = True
        try:
            self.docker("build", *args, timeout=1800)
        except RuntimeError as error:
            if not self.args.runtime_only and network_failure(str(error)):
                raise Blocked("正式镜像构建下载依赖受网络阻塞：" + str(error)) from error
            raise
        self.built = True

    def prepare_image(self):
        source = (APP / "Dockerfile").read_text()
        self.result["dockerfileSHA256"] = hashlib.sha256(source.encode()).hexdigest()
        syntax = re.search(r"^# syntax=(.+)$", source, re.MULTILINE)
        self.result["dockerfileFrontend"] = syntax[1] if syntax else "builtin"
        if self.args.runtime_only:
            go, env = environment()
            self.run(["pnpm", "build"], "host-build", timeout=600, env=env)
            context = self.runtime / "runtime-context"
            context.mkdir()
            for role in ("web", "worker"):
                binary = ROOT / "bin" / role
                description = self.run(["file", binary], "static-" + role)
                ensure("statically linked" in description, "运行程序需要静态链接：" + role)
                shutil.copy2(binary, context / role)
            shutil.copy2("/etc/ssl/certs/ca-certificates.crt", context / "ca-certificates.crt")
            (context / "Dockerfile").write_text(runtime_recipe(source))
            self.build_image("--network=none", "-t", self.image, context)
            self.result["hostGo"] = self.run([go, "version"], "host-go-version")
            self.passed("当前源码构建静态程序与 SPA，使用正式最终阶段离线构建运行镜像")
        else:
            images = json.loads((APP / "docker-images.json").read_text())
            self.refs = {}
            self.result["baseImages"] = {}
            selected = {key: images["testImages"][key] for key in (self.dialect, "redis")}
            for key, original in {**images["buildImages"], **selected}.items():
                ref = (
                    self.args.registry.rstrip("/") + "/" + original
                    if self.args.registry
                    else original
                )
                try:
                    self.docker("pull", ref, timeout=self.args.pull_timeout)
                except RuntimeError as error:
                    if network_failure(str(error)) or str(error).endswith("超时"):
                        raise Blocked("镜像拉取受网络阻塞：" + ref + "\n" + str(error)) from error
                    raise
                info = self.inspect(ref)
                digest = matching_digest(ref, info.get("RepoDigests", []))
                self.refs[key] = digest
                self.result["baseImages"][key] = dict(
                    reference=ref, digest=digest, imageID=info["Id"]
                )
            self.passed("四个基础镜像实际拉取与摘要固定")
            build_options = []
            if self.args.build_proxy:
                build_options = [
                    "--network=host",
                    "--build-arg",
                    "HTTP_PROXY=" + self.args.build_proxy,
                    "--build-arg",
                    "HTTPS_PROXY=" + self.args.build_proxy,
                    "--build-arg",
                    "NO_PROXY=localhost,127.0.0.1,::1",
                ]
                self.result["buildProxy"] = self.args.build_proxy
            self.result["buildNetwork"] = "host" if self.args.build_proxy else "default"
            self.build_image(
                *build_options,
                "--platform=linux/amd64",
                "--build-arg",
                "NODE_IMAGE=" + self.refs["node"],
                "--build-arg",
                "GO_IMAGE=" + self.refs["go"],
                "-f",
                APP / "Dockerfile",
                "-t",
                self.image,
                ROOT,
            )
            self.passed("正式多阶段 Dockerfile 完整构建")
            self.result["pending"].remove("正式多阶段 Dockerfile 构建与基础镜像摘要")
        info = self.inspect(self.image)
        self.result["imageID"] = info["Id"]
        ensure(info["Config"]["User"] == "65532:65532", "运行镜像需要非 root 用户")
        ensure(info["Config"].get("StopSignal") == "SIGTERM", "运行镜像需要 SIGTERM")
        ensure(info["Config"]["Cmd"] == ["/web"], "默认运行角色需要为 Web")
        ensure(info["Architecture"] == "amd64", "本次验收需要 amd64 镜像")
        ensure(
            not any(
                value.split("=", 1)[0].upper()
                in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY")
                for value in info["Config"].get("Env", [])
            ),
            "构建代理需要限制在构建阶段",
        )
        self.passed("镜像非 root、默认 Web 入口、SIGTERM 元数据")

    def prepare_database(self):
        if self.dialect == "postgres":
            return self.prepare_postgresql_database()
        self.mysql_password, self.web_password, self.worker_password = [
            secrets.token_hex(24) for _ in range(3)
        ]
        self.private += [self.mysql_password, self.web_password, self.worker_password]
        if self.args.runtime_only:
            for tool in ("mysqld", "mysql", "redis-server", "redis-cli"):
                if not shutil.which(tool):
                    raise Blocked("离线运行验收需要本地工具：" + tool)
            self.mysql_port = free_port()
            self.redis_port = free_port([self.mysql_port])
            datadir = self.runtime / "mysql"
            self.run(
                ["mysqld", "--no-defaults", "--initialize-insecure", f"--datadir={datadir}"],
                "mysql-initialize",
                timeout=120,
            )
            self.start(
                [
                    "mysqld",
                    "--no-defaults",
                    f"--datadir={datadir}",
                    "--bind-address=127.0.0.1",
                    f"--port={self.mysql_port}",
                    f"--socket={self.runtime}/mysql.sock",
                    f"--pid-file={self.runtime}/mysql.pid",
                    "--mysqlx=OFF",
                    "--skip-log-bin",
                    "--performance-schema=OFF",
                    "--innodb-buffer-pool-size=64M",
                    "--max-connections=40",
                    "--default-time-zone=+00:00",
                    "--character-set-server=utf8mb4",
                    "--collation-server=utf8mb4_unicode_ci",
                ],
                "mysql",
            )
            self.start(
                [
                    "redis-server",
                    "--bind",
                    "127.0.0.1",
                    "--port",
                    self.redis_port,
                    "--save",
                    "",
                    "--appendonly",
                    "no",
                    "--dir",
                    self.runtime,
                ],
                "redis",
            )
            self.db_host, self.db_port = "127.0.0.1", self.mysql_port
            self.redis_url = f"redis://127.0.0.1:{self.redis_port}/0"
        else:
            self.network = "project-docker-" + self.token
            self.docker("network", "create", self.network)
            self.mysql = "project-docker-" + self.token + "-mysql"
            self.containers.append(self.mysql)
            self.docker(
                "run",
                "-d",
                "--name",
                self.mysql,
                "--network",
                self.network,
                "-p",
                "127.0.0.1::3306",
                "--env-file",
                self.envfile({"MYSQL_ROOT_PASSWORD": self.mysql_password, "MYSQL_ROOT_HOST": "%"}),
                self.refs["mysql"],
                "--default-time-zone=+00:00",
            )
            self.redis = self.launch(
                "redis",
                {},
                image=self.refs["redis"],
                hardened=False,
                command=("redis-server", "--save", "", "--appendonly", "no"),
            )
            bindings = self.inspect(self.mysql)["NetworkSettings"]["Ports"]["3306/tcp"]
            ensure(len(bindings) == 1 and bindings[0]["HostIp"] == "127.0.0.1", "MySQL 回环发布")
            self.mysql_port = int(bindings[0]["HostPort"])
            self.db_host, self.db_port = self.mysql, 3306
            self.redis_url = f"redis://{self.redis}:6379/0"
        self.wait(lambda: self.sql("SELECT 1") == "1", "MySQL 就绪", seconds=120)
        self.wait(lambda: self.redis_command("PING") == "PONG", "Redis 就绪")
        version = self.sql("SELECT VERSION()")
        ensure(version.startswith("8.0."), "本次验收要求 MySQL 8.0")
        self.result["mysqlVersion"] = version
        if not self.args.runtime_only:
            self.result["pending"].remove(self.dependency_pending)
        self.sql("CREATE DATABASE demo; CREATE DATABASE missing;")
        self.versions = migration_versions(APP / "migrations/mysql")
        ensure(self.versions == migration_versions(APP / "migrations/sqlite"), "两方言版本一致")
        self.result["databaseVersion"] = self.versions[-1]
        atlas = ROOT / ".tools/bin/atlas-v1.3.0"
        if not atlas.exists():
            raise Blocked("请先执行 pnpm setup 准备 Atlas")
        password = "" if self.args.runtime_only else ":" + self.mysql_password
        url = f"mysql://root{password}@127.0.0.1:{self.mysql_port}/demo"
        for index in range(2):
            self.run(
                [
                    atlas,
                    "migrate",
                    "apply",
                    "--dir",
                    "file://" + str(APP / "migrations/mysql"),
                    "--url",
                    url,
                ],
                f"migration-{index}",
            )
        ensure(
            self.sql(
                "SELECT version FROM demo.atlas_schema_revisions ORDER BY version"
            ).splitlines()
            == self.versions,
            "正式迁移版本登记需要完整",
        )
        tables = self.sql(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='demo' "
            "AND table_name<>'atlas_schema_revisions' ORDER BY table_name"
        ).splitlines()
        ensure(tables and all(re.fullmatch(r"[a-z_]+", t) for t in tables), "应用表列表无效")
        grants = (
            f"CREATE USER web_app@'%' IDENTIFIED BY '{self.web_password}';"
            f"CREATE USER worker_app@'%' IDENTIFIED BY '{self.worker_password}';"
            "GRANT SELECT ON demo.atlas_schema_revisions TO web_app@'%';"
            "GRANT SELECT ON demo.* TO worker_app@'%';"
            "GRANT SELECT ON missing.* TO web_app@'%',worker_app@'%';"
        )
        grants += "".join(
            f"GRANT SELECT,INSERT,UPDATE,DELETE ON demo.`{table}` TO web_app@'%';"
            for table in tables
        )
        self.sql(grants)
        self.passed("隔离 MySQL 8.0／Redis、正式 Atlas 重复迁移、受限 Web 与只读 Worker 账户")

    def prepare_postgresql_database(self):
        self.mysql_password, self.web_password, self.worker_password = [
            secrets.token_hex(20) for _ in range(3)
        ]
        self.private += [self.mysql_password, self.web_password, self.worker_password]
        if self.args.runtime_only:
            images = json.loads((APP / "docker-images.json").read_text())["testImages"]
            self.refs = {key: images[key] for key in (self.dialect, "redis")}
            for ref in self.refs.values():
                try:
                    self.inspect(ref)
                except RuntimeError as error:
                    raise Blocked("离线运行验收需要已缓存的依赖镜像：" + ref) from error
        self.network = "project-docker-" + self.token
        self.docker("network", "create", self.network)
        self.postgres = "project-docker-" + self.token + "-postgres"
        self.containers.append(self.postgres)
        self.docker(
            "run",
            "-d",
            "--name",
            self.postgres,
            "--network",
            self.network,
            "-p",
            "127.0.0.1::5432",
            "--env-file",
            self.envfile({"POSTGRES_PASSWORD": self.mysql_password}),
            self.refs["postgres"],
            "-c",
            "timezone=UTC",
        )
        self.redis = "project-docker-" + self.token + "-redis"
        self.containers.append(self.redis)
        self.docker(
            "run",
            "-d",
            "--name",
            self.redis,
            "--network",
            self.network,
            "-p",
            "127.0.0.1::6379",
            self.refs["redis"],
            "redis-server",
            "--save",
            "",
            "--appendonly",
            "no",
        )
        self.mysql_port = int(
            self.inspect(self.postgres)["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"]
        )
        self.redis_port = int(
            self.inspect(self.redis)["NetworkSettings"]["Ports"]["6379/tcp"][0]["HostPort"]
        )
        self.db_host, self.db_port = self.postgres, 5432
        self.redis_url = f"redis://{self.redis}:6379/0"
        self.wait(
            lambda: self.postgresql_sql("SELECT 1", "postgres") == "1",
            "PostgreSQL 就绪",
            seconds=120,
        )
        self.wait(lambda: self.redis_command("PING") == "PONG", "Redis 就绪")
        version = self.postgresql_sql("SHOW server_version", "postgres")
        ensure(version.startswith("18."), "示例的 ICU LIKE 兼容要求 PostgreSQL 18")
        self.result["postgresqlVersion"] = version
        for name in ("demo", "missing", "auth_test", "business_test"):
            self.postgresql_sql("CREATE DATABASE " + name, "postgres")
        self.versions = migration_versions(APP / "migrations/postgres")
        ensure(self.versions == migration_versions(APP / "migrations/sqlite"), "两方言版本一致")
        self.result["databaseVersion"] = self.versions[-1]
        go, env = environment()
        atlas = ROOT / ".tools/bin/atlas-v1.3.0"
        for name in ("demo", "auth_test", "business_test"):
            url = f"postgres://postgres:{self.mysql_password}@127.0.0.1:{self.mysql_port}/{name}?sslmode=disable&search_path=public"
            self.private.append(url)
            for index in range(2):
                self.run(
                    [
                        atlas,
                        "migrate",
                        "apply",
                        "--dir",
                        "file://" + str(APP / "migrations/postgres"),
                        "--url",
                        url,
                        "--revisions-schema",
                        "public",
                    ],
                    f"migration-{name}-{index}",
                    env=env,
                )
        ensure(
            self.sql(
                "SELECT version FROM demo.atlas_schema_revisions ORDER BY version"
            ).splitlines()
            == self.versions,
            "正式迁移版本登记需要完整",
        )
        self.postgresql_sql(
            f"CREATE ROLE web_app LOGIN PASSWORD '{self.web_password}'; "
            f"CREATE ROLE worker_app LOGIN PASSWORD '{self.worker_password}'; "
            "GRANT CONNECT ON DATABASE demo,missing TO web_app,worker_app;"
        )
        tables = self.sql(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name<>'atlas_schema_revisions'"
        ).splitlines()
        ensure(
            len(tables) == 6 and all(re.fullmatch(r"[a-z_]+", table) for table in tables),
            "应用表列表无效",
        )
        grants = "GRANT USAGE ON SCHEMA public TO web_app,worker_app; GRANT SELECT ON ALL TABLES IN SCHEMA public TO worker_app; GRANT SELECT ON public.atlas_schema_revisions TO web_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO web_app;"
        grants += "".join(
            f'GRANT SELECT,INSERT,UPDATE,DELETE ON public."{table}" TO web_app;' for table in tables
        )
        self.postgresql_sql(grants)
        self.result["pending"].remove(self.dependency_pending)
        self.passed("隔离 PostgreSQL 18／Redis、正式 Atlas 重复迁移、受限 Web 与只读 Worker 账户")
        env.update(
            POSTGRES_AUTH_TEST_DSN=f"postgres://postgres:{self.mysql_password}@127.0.0.1:{self.mysql_port}/auth_test?sslmode=disable&timezone=UTC&search_path=public",
            POSTGRES_TEST_DSN=f"postgres://postgres:{self.mysql_password}@127.0.0.1:{self.mysql_port}/business_test?sslmode=disable&timezone=UTC&search_path=public",
            REDIS_TEST_URL=f"redis://127.0.0.1:{self.redis_port}/0",
        )
        for key in (
            "MYSQL_AUTH_TEST_DSN",
            "MYSQL_TEST_DSN",
            "TEST_WEB_A",
            "TEST_WEB_B",
            "TEST_AUTH_TOKEN",
            "TEST_REDIS_PID",
        ):
            env.pop(key, None)
        self.private += [env["POSTGRES_AUTH_TEST_DSN"], env["POSTGRES_TEST_DSN"]]
        output = self.run(
            [
                go,
                "test",
                "-count=1",
                "-timeout=120s",
                "-json",
                "-skip",
                "MySQL|^TestExternal",
            ]
            + POSTGRESQL_TEST_PACKAGES,
            "postgresql-integration",
            timeout=180,
            env=env,
        )
        events = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
        ensure(
            not any(event.get("Action") == "skip" for event in events),
            "PostgreSQL 所选套件需要零跳过",
        )
        passed = {event.get("Test") for event in events if event.get("Action") == "pass"}
        required = {
            "TestPostgreSQLConcurrentInitialization",
            "TestPostgreSQLSessionManagement",
            "TestPostgreSQLLoginRateLimitCollation",
            "TestPostgreSQLUserManagementTransactions",
            "TestLegacyPasswordAndRolesPostgreSQL",
            "TestUserQueriesPostgreSQL",
            "TestPostgreSQLDatabase",
            "TestPostgreSQLAbsoluteTimeAndUnicodeConstraints",
            "TestOpenPostgreSQLHandshakeDeadline",
            "TestPostgreSQLDriverAndErrorTranslation",
        }
        ensure(
            required <= passed, "PostgreSQL 集成用例需要完整通过：" + str(sorted(required - passed))
        )
        self.passed(
            "真实 PostgreSQL 初始化并发、会话、邮箱等价限流、用户事务、旧密码角色、用户筛选和店铺 ORM",
            tests=len(passed),
        )

    def verify_postgresql_schema_diff(self):
        self.postgresql_sql("CREATE DATABASE schema_diff", "postgres")
        _, env = environment()
        folder = self.runtime / "schema-diff"
        directory = folder / "migrations"
        shutil.copytree(APP / "migrations/postgres", directory)
        target = folder / "target.sql"
        target.write_bytes((APP / "schema/generated/postgres.sql").read_bytes())
        url = atlas_dev_url(
            f"postgres://postgres:{self.mysql_password}@127.0.0.1:{self.mysql_port}/schema_diff?sslmode=disable&search_path=public"
        )
        self.private.append(url)
        command = [
            ROOT / ".tools/bin/atlas-v1.3.0",
            "migrate",
            "diff",
            "review_probe",
            "--dir",
            "file://" + str(directory),
            "--to",
            "file://" + str(target),
            "--dev-url",
            url,
        ]

        def snapshot():
            return {path.name: path.read_bytes() for path in directory.iterdir() if path.is_file()}

        baseline = snapshot()
        for index in range(2):
            self.run(command, f"postgresql-schema-diff-baseline-{index}", env=env)
            ensure(snapshot() == baseline, "目标 Schema 与正式迁移需要保持零漂移")
        target.write_text(
            target.read_text()
            + '\nALTER TABLE "shop" ADD COLUMN "review_note" text COLLATE "starter_unicode_ci";\n'
        )
        self.run(command, "postgresql-schema-diff-change", env=env)
        generated = list(directory.glob("*_review_probe.sql"))
        ensure(len(generated) == 1, "模型新增列需要生成一份增量迁移")
        change_sql = generated[0].read_text()
        ensure('ADD COLUMN "review_note"' in change_sql, "增量迁移需要包含新增列")
        ensure('COLLATE "starter_unicode_ci"' in change_sql, "增量迁移需要保留 ICU 排序规则")
        changed = snapshot()
        self.run(command, "postgresql-schema-diff-replay", env=env)
        ensure(snapshot() == changed, "增量迁移重放后需要保持零漂移")
        self.passed("PostgreSQL 真实 schema diff：连续无漂移、新增列迁移及迁移重放")

    def reset_browser_auth_limit(self):
        # 仅重置本轮隔离 Redis 的合成浏览器账号桶，保留正式 20/5 次分钟策略。
        identity = "account:" + str(int(self.browser_owner_id))
        digest = hmac.new(self.auth_secret.encode(), identity.encode(), hashlib.sha256).hexdigest()
        self.redis_command("DEL", "docker-" + self.token + ":auth:limit:" + digest)

    def verify_browser(self, origin, token):
        self.reset_browser_auth_limit()
        email, password = "ssr-" + self.token + "@example.test", secrets.token_urlsafe(24)
        self.private.append(password)
        status, _, body = self.http(
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
        payload = json.loads(body)
        ensure(
            status == 200
            and "errors" not in payload
            and len(payload.get("data", {}).get("createUser", [])) == 1,
            "浏览器 SSR 独立账号创建",
        )
        _, env = environment()
        env.update(
            TEST_ORIGIN=origin,
            SSR_TEST_EMAIL=email,
            SSR_TEST_PASSWORD=password,
            BROWSER_REPORT=str(self.runtime / "browser.json"),
        )
        env["LD_LIBRARY_PATH"] = (
            str(ROOT / ".tools/browser/usr/lib/x86_64-linux-gnu")
            + ":"
            + env.get("LD_LIBRARY_PATH", "")
        )
        self.run(
            ["pnpm", "--filter", APP.name + "-dashboard", "test:browser"],
            "browser",
            timeout=600,
            env=env,
        )
        report = json.loads((self.runtime / "browser.json").read_text())
        stats = report["stats"]
        ensure(
            stats["expected"] > 0
            and stats["unexpected"] == stats["flaky"] == stats["skipped"] == 0,
            "浏览器用例需要完整通过且零跳过",
        )
        self.passed(
            "内嵌 SPA 与公开 SSR 真实浏览器：认证、用户、店铺、队列、导航和主题",
            tests=stats["expected"],
        )

    def postgresql_sql(self, query, database="demo"):
        return self.docker(
            "exec",
            "-i",
            "-e",
            "PGPASSWORD=" + self.mysql_password,
            self.postgres,
            "psql",
            "-h",
            "127.0.0.1",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            database,
            "-At",
            "-c",
            query,
        )

    def sql(self, query):
        if self.dialect == "postgres":
            database = "missing" if "table_schema='missing'" in query else "demo"
            query = query.replace("demo.", "public.").replace(
                "table_schema='missing'", "table_schema='public'"
            )
            return self.postgresql_sql(query, database)
        if self.args.runtime_only:
            return self.run(
                [
                    "mysql",
                    "--no-defaults",
                    "--protocol=TCP",
                    "--host=127.0.0.1",
                    f"--port={self.mysql_port}",
                    "--user=root",
                    "--connect-timeout=1",
                    "--batch",
                    "--raw",
                    "--skip-column-names",
                ],
                "sql",
                input=query,
            )
        return self.docker(
            "exec",
            "-i",
            "-e",
            "MYSQL_PWD=" + self.mysql_password,
            self.mysql,
            "mysql",
            "--user=root",
            "--batch",
            "--raw",
            "--skip-column-names",
            input=query,
        )

    def redis_command(self, *command):
        if self.args.runtime_only and self.dialect != "postgres":
            return self.run(["redis-cli", "-u", self.redis_url, "--raw", *command], "redis-cli")
        return self.docker("exec", self.redis, "redis-cli", "--raw", *command)

    def settings(self, role, port):
        user, password = (
            ("web_app", self.web_password)
            if role == "web"
            else ("worker_app", self.worker_password)
        )
        dsn = f"mysql://{user}:{password}@{self.db_host}:{self.db_port}/demo?parseTime=true&timeout=1s&readTimeout=1s&writeTimeout=1s"
        if self.dialect == "postgres":
            dsn = f"postgres://{user}:{password}@{self.db_host}:{self.db_port}/demo?sslmode=disable&timezone=UTC&connect_timeout=2&search_path=public"
        return dict(
            APP_MODE="development",
            APP_NAMESPACE="docker-" + self.token,
            INSTANCE_ID=role + "-" + str(port),
            REDIS_URL=self.redis_url,
            DB_VERSION=self.versions[-1],
            AUTH_SECRET=self.auth_secret,
            AUTH_BOOTSTRAP_TOKEN=self.bootstrap,
            DB_DSN=dsn,
            ALLOW_ORIGINS=",".join(self.origins),
            SHUTDOWN_TIMEOUT="4s",
            WEB_ADDR=f"127.0.0.1:{port}"
            if self.args.runtime_only and self.dialect != "postgres"
            else "0.0.0.0:8080",
        )

    def verify_application(self):
        self.auth_secret, self.bootstrap = secrets.token_hex(32), secrets.token_hex(32)
        self.private += [self.auth_secret, self.bootstrap]
        dependency_ports = [self.mysql_port]
        if self.args.runtime_only:
            dependency_ports.append(self.redis_port)
        a = free_port(dependency_ports)
        b = free_port([*dependency_ports, a])
        self.origins = [f"http://127.0.0.1:{a}", f"http://127.0.0.1:{b}"]
        origin, other = self.origins
        web = self.launch("web-a", self.settings("web", a), port=a)
        web_b = self.launch("web-b", self.settings("web", b), port=b)
        worker = self.launch("worker", self.settings("worker", a), command=("/worker",))
        self.wait(
            lambda: self.http(origin)[0] == self.http(other)[0] == 200
            and "Worker 就绪" in self.docker("logs", worker),
            "双 Web 与独立 Worker 就绪",
            seconds=60,
        )
        for name in (web, web_b, worker):
            info = self.inspect(name)
            ensure(info["Image"] == self.result["imageID"], "三个角色需要同一镜像 ID")
            ensure(info["Config"]["User"] == "65532:65532", "容器用户需要为 65532")
            ensure(info["HostConfig"]["ReadonlyRootfs"], "容器需要只读根文件系统")
            ensure(info["HostConfig"]["CapDrop"] == ["ALL"], "容器需要移除 capabilities")
            ensure(
                "no-new-privileges:true" in info["HostConfig"]["SecurityOpt"],
                "容器需要禁止提升权限",
            )
        self.passed("同镜像双 Web／独立 Worker、非 root、只读根文件系统与受限能力")
        ensure(self.http(origin, "/api/rest/demo/session")[0] == 401, "匿名后台请求拒绝")
        credentials = {"email": "docker-owner@example.com", "password": secrets.token_hex(16)}
        if getattr(self.args, "browser", False):
            # 浏览器套件沿用既有验收账号；范围限定为本轮拥有的隔离数据库。
            credentials = {"email": "owner@example.com", "password": "owner-password-2026"}
        self.private.append(credentials["password"])
        status, _, body = self.http(
            origin,
            "/api/auth/initialize",
            dict(credentials, name="验收管理员", bootstrapToken=self.bootstrap),
        )
        ensure(status == 201, "容器内初始化 owner：" + body.decode())
        if getattr(self.args, "browser", False):
            self.browser_owner_id = int(json.loads(body)["user"]["id"])
            quote = '"' if self.dialect == "postgres" else "`"
            # 合成旧库组合身份与宿主机验收夹具一致，供浏览器核对角色列表。
            self.sql(
                f"UPDATE demo.{quote}user{quote} SET role='owner,user' WHERE id={self.browser_owner_id}"
            )
        status, headers, body = self.http(origin, "/api/auth/sign-in/email", credentials)
        ensure(status == 200, "容器内邮箱登录：" + body.decode())
        token = json.loads(body)["token"]
        cookie = headers.get("Set-Cookie", "").split(";", 1)[0]
        self.private += [token, cookie]
        ensure(cookie.startswith("better-auth.session_token="), "登录 Cookie 名称")
        for bearer, session_cookie in ((token, ""), ("", cookie)):
            ensure(
                self.http(other, "/api/rest/demo/session", token=bearer, cookie=session_cookie)[0]
                == 200,
                "跨容器 Cookie／Bearer 会话",
            )
        ensure(self.http(origin, "/api/auth/sign-out", {}, cookie=cookie)[0] == 200, "实际退出")
        ensure(self.http(other, "/api/rest/demo/session", token=token)[0] == 401, "跨容器会话撤销")
        status, _, body = self.http(other, "/api/auth/sign-in/email", credentials)
        ensure(status == 200, "重新创建验收会话")
        token = json.loads(body)["token"]
        self.private.append(token)
        self.passed("认证初始化、邮箱登录、Cookie／Bearer 跨容器共享与退出撤销")
        status, _, body = self.http(
            origin,
            "/api/graphql/admin",
            {
                "query": "mutation($set:CreateShopSetInput!){createShop(set:$set){id name slug}}",
                "variables": {"set": {"name": "容器店铺", "slug": "docker-verification"}},
            },
            token=token,
        )
        data = json.loads(body)
        ensure(status == 200 and "errors" not in data, "GraphQL 创建店铺：" + body.decode())
        shop_id = data["data"]["createShop"]["id"]
        for endpoint in ("/api/graphql/member", "/api/graphql/admin"):
            status, _, body = self.http(
                other,
                endpoint,
                {"query": '{getShop(where:{slug:{eq:"docker-verification"}}){id name}}'},
                token=token,
            )
            ensure(
                status == 200 and json.loads(body)["data"]["getShop"]["id"] == shop_id,
                "双 GraphQL Schema 跨容器读写",
            )
        ensure(
            self.http(other, "/api/rest/demo/shops/" + shop_id, token=token)[0] == 200, "REST 读取"
        )
        self.passed("受限数据库账户真实 GraphQL 写入、双 Schema 与 REST 跨容器读取")
        for path in ("/admin/shops", "/admin/users"):
            status, _, html = self.http(origin, path)
            ensure(status == 200 and b'<div id="root"' in html, "内嵌 SPA 深层路由")
            assets = re.findall(rb'(?:src|href)="(/admin/assets/[^" ]+)"', html)
            ensure(assets, "内嵌 SPA 需要构建后的静态资源")
            for asset in set(assets):
                code, _, content = self.http(origin, asset.decode())
                ensure(code == 200 and content and content != html, "SPA 静态资源独立响应")
        ensure(self.http(origin, "/api/missing", token=token)[0] == 404, "API 路由隔离")
        self.passed("容器内嵌 SPA 深链、JS／CSS 资源与 API 路由隔离")
        if getattr(self.args, "browser", False):
            self.verify_browser(origin, token)
        ensure(
            self.http(origin, "/api/rest/demo/tasks", {"key": "container-effect"}, token=token)[0]
            == 202,
            "Web 任务投递",
        )
        self.wait(
            lambda: self.redis_command(
                "HGET", "docker-" + self.token + ":worker:counts", "container-effect"
            )
            == "1",
            "独立 Worker 消费",
        )
        ensure(
            self.http(other, "/api/rest/demo/tasks", {"key": "container-effect"}, token=token)[0]
            == 409,
            "任务 ID 幂等保留",
        )
        self.passed("容器 Web 投递、独立 Worker 消费与任务去重")
        go, env = environment()
        for key in ("TEST_WEB_A_PID", "TEST_REDIS_PID", "REDIS_TEST_URL"):
            env.pop(key, None)
        env.update(TEST_WEB_A=origin, TEST_WEB_B=other, TEST_AUTH_TOKEN=token)
        output = self.run(
            [
                go,
                "test",
                "-count=1",
                "-timeout=60s",
                "-json",
                "-run",
                "^TestExternalWebProcesses$",
                "./" + str(APP.relative_to(ROOT)) + "/internal/realtime",
            ],
            "external-realtime",
            timeout=120,
            env=env,
        )
        records = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
        ensure(not any(r.get("Action") == "skip" for r in records), "实时验收需要实际执行")
        ensure(
            any(
                r.get("Action") == "pass" and r.get("Test") == "TestExternalWebProcesses"
                for r in records
            ),
            "跨容器实时测试需要通过记录",
        )
        self.passed("双 Web 容器跨实例 WebSocket 广播、设备查询 SSE 与连接资源释放")
        version = self.versions[-1]
        try:
            self.sql(f"UPDATE demo.atlas_schema_revisions SET applied=0 WHERE version='{version}'")
            ensure(self.http(origin)[0] == self.http(other)[0] == 503, "迁移异常 readiness 降级")
            ensure(self.http(origin, "/health/live")[0] == 200, "依赖异常保持 liveness")
        finally:
            self.sql(
                f"UPDATE demo.atlas_schema_revisions SET applied=total WHERE version='{version}'"
            )
        self.wait(lambda: self.http(origin)[0] == self.http(other)[0] == 200, "readiness 恢复")
        self.passed("数据库版本故障 readiness 降级、liveness 保持及恢复")
        self.verify_startup_gates([*dependency_ports, a, b])
        production_port = free_port([*dependency_ports, a, b])
        values = dict(
            self.settings("web", production_port),
            APP_MODE="production",
            AUTH_BOOTSTRAP_TOKEN="",
            ALLOW_ORIGINS="https://deployment.example",
        )
        production = self.launch("production-web", values, port=production_port)
        self.wait(
            lambda: self.http(f"http://127.0.0.1:{production_port}")[0] == 200, "生产配置容器就绪"
        )
        self.passed("生产配置 HTTPS Origin／关闭初始化的容器启动与 readiness")
        for name in (production, web, web_b, worker):
            self.docker("stop", "-t", "10", name, timeout=20)
            state = self.inspect(name)["State"]
            ensure(
                not state["Running"] and state["ExitCode"] == 0 and not state["OOMKilled"],
                "SIGTERM 需要优雅退出且保持退出码 0",
            )
        self.passed("生产 Web、双 Web 与 Worker 容器 SIGTERM 优雅退出码 0")

    def verify_startup_gates(self, excluded_ports):
        # 正向对照及每个负向用例分配独立端口，隔离 host 网络下的监听冲突。
        ports = list(excluded_ports)
        control_port = free_port(ports)
        ports.append(control_port)
        control = self.launch(
            "gate-valid-web", self.settings("web", control_port), port=control_port
        )
        self.wait(
            lambda: self.http(f"http://127.0.0.1:{control_port}")[0] == 200,
            "启动门禁有效配置正向对照",
        )
        self.docker("stop", "-t", "10", control, timeout=20)
        state = self.inspect(control)["State"]
        ensure(
            not state["Running"] and state["ExitCode"] == 0 and not state["OOMKilled"],
            "启动门禁正向对照需要就绪并优雅退出",
        )
        version = self.versions[-1]
        for role in ("web", "worker"):
            for label, expected_error in (
                ("version", "数据库迁移版本不匹配"),
                ("mode", "APP_MODE 需要显式选择 development 或 production"),
                ("missing", "数据库版本检查失败"),
            ):
                port = free_port(ports)
                ports.append(port)
                values = self.settings(role, port)
                if label == "version":
                    values["DB_VERSION"] = str(int(version) + 1)
                elif label == "mode":
                    values["APP_MODE"] = "invalid"
                else:
                    values["DB_DSN"] = values["DB_DSN"].replace("/demo?", "/missing?")
                name = "project-docker-" + self.token + "-gate-" + role + "-" + label
                self.containers.append(name)
                output = self.docker(
                    "run",
                    "--name",
                    name,
                    "--network",
                    self.network or "host",
                    "--read-only",
                    "--cap-drop=ALL",
                    "--security-opt=no-new-privileges:true",
                    "--env-file",
                    self.envfile(values),
                    self.image,
                    "/" + role,
                    expected=1,
                    timeout=20,
                )
                ensure(self.inspect(name)["State"]["ExitCode"] == 1, "启动门禁退出码")
                records = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
                ensure(
                    any(
                        isinstance(record, dict)
                        and record.get("level") == "ERROR"
                        and record.get("msg") == ("Web" if role == "web" else "Worker") + " 退出"
                        and record.get("error") == expected_error
                        for record in records
                    ),
                    f"启动门禁错误原因需要匹配 {role}/{label}：{expected_error}",
                )
        ensure(
            self.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='missing'")
            == "0",
            "入口门禁保持只读",
        )
        self.passed("双角色启动门禁错误原因、独立端口与有效配置正向对照，入口保持只读")

    def cleanup(self):
        errors = []
        for name in reversed(self.containers):
            try:
                output = subprocess.run(
                    ["docker", "logs", name],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    timeout=10,
                ).stdout
                (self.runtime / (name + ".log")).write_text(redact(output, self.private))
            except Exception as error:
                if not resource_absent(error, "container", name):
                    errors.append(redact(str(error), self.private))
            try:
                self.docker("rm", "-f", "-v", name, timeout=30)
            except Exception as error:
                if not resource_absent(error, "container", name):
                    errors.append(redact(str(error), self.private))
        for p in reversed(self.processes):
            try:
                if p.poll() is None:
                    os.killpg(p.pid, signal.SIGTERM)
                    try:
                        p.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid, signal.SIGKILL)
                        p.wait(timeout=5)
                        errors.append("依赖进程退出超时：" + str(p.pid))
            except Exception as error:
                errors.append(str(error))
        for output in self.outputs:
            output.close()
        if self.network:
            try:
                self.docker("network", "rm", self.network)
            except Exception as error:
                if not resource_absent(error, "network", self.network):
                    errors.append(str(error))
        if (self.built or self.build_attempted) and not self.args.keep_image:
            try:
                self.docker("image", "rm", self.image)
            except Exception as error:
                if not resource_absent(error, "image", self.image):
                    errors.append(str(error))
        for file in self.env_files:
            try:
                file.unlink(missing_ok=True)
            except OSError as error:
                errors.append(str(error))
        self.result["cleanupErrors"] = errors
        if errors:
            self.result["status"] = "failed"
        return errors

    def execute(self):
        def interrupt(signum, frame):
            # 第一次终止进入受控退出，后续 SIGTERM 留给同一轮清理完成。
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            raise KeyboardInterrupt("收到 SIGTERM，验收已中断")

        safe_maintain(ROOT, automatic=True, cache=True)
        lease = RunLease(
            ROOT, self.runtime, "project-docker", getattr(self.args, "keep_runtime", False)
        )
        previous = signal.signal(signal.SIGTERM, interrupt)
        try:
            return self._execute()
        finally:
            signal.signal(signal.SIGTERM, previous)
            lease.finish(self.result.get("status", "failed"), self.result.get("cleanupErrors", []))

    def _execute(self):
        code = 1
        try:
            if not shutil.which("docker"):
                raise Blocked("缺少 docker 命令")
            try:
                self.result["engine"] = self.docker(
                    "info", "--format", "{{.ServerVersion}}", timeout=10
                )
            except RuntimeError as error:
                raise Blocked(
                    "Docker Engine 访问失败，请确认服务与用户组权限：" + str(error)
                ) from error
            self.prepare_image()
            self.prepare_database()
            if self.dialect == "postgres":
                self.verify_postgresql_schema_diff()
            self.verify_application()
            self.result["status"] = "passed"
            code = 0
        except Blocked as error:
            self.result.update(status="blocked", reason=redact(str(error), self.private))
            print("环境待验收：" + self.result["reason"], flush=True)
            code = 2
        except (Exception, KeyboardInterrupt) as error:
            self.result.update(status="failed", error=redact(str(error), self.private))
            print("失败：" + self.result["error"], flush=True)
        finally:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            if self.cleanup():
                code = 1
            self.result["elapsedSeconds"] = round(time.monotonic() - self.started, 2)
            self.result["finishedAt"] = datetime.now(timezone.utc).isoformat()
            text = json.dumps(self.result, ensure_ascii=False, indent=2) + "\n"
            (self.runtime / "result.json").write_text(text)
            filename = (
                "project-docker-runtime-result.json"
                if self.args.runtime_only
                else "project-docker-result.json"
            )
            if self.dialect == "postgres":
                filename = filename.replace("project-docker", "project-postgresql-docker")
            report = ROOT / ".runtime" / filename
            report.write_text(text)
            print("Docker 验收报告：" + str(report), flush=True)
        return code


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--database", choices=("mysql", "postgres"), default="mysql")
    parser.add_argument(
        "--runtime-only", action="store_true", help="宿主机编译与隔离本地依赖，仅验收容器运行阶段"
    )
    parser.add_argument(
        "--browser", action="store_true", help="追加当前应用的内嵌 SPA 真实浏览器验收"
    )
    parser.add_argument("--keep-image", action="store_true", help="保留本轮唯一应用镜像")
    parser.add_argument("--keep-runtime", action="store_true", help="完整保留本次验收现场")
    parser.add_argument("--pull-timeout", type=int, default=120, help="单个镜像拉取超时秒数")
    parser.add_argument(
        "--registry", default="", help="显式替换镜像来源前缀，例如 public.ecr.aws/docker/library"
    )
    parser.add_argument(
        "--build-proxy",
        default="",
        help="构建阶段 HTTP(S) 代理，使用 host 构建网络；daemon 拉取代理单独配置",
    )
    args = parser.parse_args(argv)
    if not 5 <= args.pull_timeout <= 900:
        parser.error("--pull-timeout 范围为 5–900 秒")
    if args.registry and not valid_registry(args.registry):
        parser.error("--registry 需要合法 Registry 前缀")
    if args.build_proxy and not valid_build_proxy(args.build_proxy):
        parser.error("--build-proxy 需要无凭据、无查询参数的 HTTP(S) 代理 URL")
    if args.runtime_only and (args.registry or args.build_proxy):
        parser.error("--runtime-only 使用本地构建上下文，请保持 registry 和 build-proxy 为空")
    return Verification(args).execute()


if __name__ == "__main__":
    sys.exit(main())
