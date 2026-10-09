#!/usr/bin/env python3
"""从固定 Git 提交导出 Go demo，并同步到独立仓库；公共包暂随源码交付。"""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit

APPLICATION = "projects/multi-database-demo"
ROOT_FILES = {
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "toolchain.json",
    "go.work",
    "go.work.sum",
    ".gitignore",
    ".dockerignore",
    ".editorconfig",
    ".prettierrc.json",
    ".prettierignore",
    "ruff.toml",
    "AGENTS.md",
}
PREFIXES = (
    "packages/go-server-kit/",
    "packages/shadcnui-dashboard/",
    APPLICATION + "/",
    "tools/",
    "scripts/",
    "docs/",
)
# 根与嵌套 Trellis 均只发布可复用框架，运行记录与平台适配不外传。
TRELLIS_FILES = {"workflow.md", "config.yaml", ".version", ".gitignore"}
TRELLIS_DIRECTORIES = {"scripts", "agents", "spec"}
PLATFORM_DIRECTORIES = {".agents", ".codex", ".claude", ".cursor", ".pi", ".trae", ".opencode"}
EXCLUDED = {
    "node_modules",
    "dist",
    ".tools",
    ".runtime",
    ".cache",
    "bin",
    "tmp",
    "coverage",
    "__pycache__",
    "playwright-report",
    "test-results",
    ".git",
}
PRESERVED = {".github", ".gitlab-ci.yml", ".gitlab-ci.yaml", ".yunxiao", "aliyun-pipelines.yml"}
MANIFEST = "demo-release.json"
FORMAT_FIXTURES = {
    "poc/web/fixtures/reference-cases.json",
    "poc/web/fixtures/reference-member.graphql",
    "poc/web/fixtures/reference-admin.graphql",
    "poc/web/graph/member/generated.go",
    "poc/web/graph/admin/generated.go",
    "poc/web/schema/common.graphqls",
    "poc/web/schema/member.graphqls",
    "poc/web/schema/admin.graphqls",
}


def configured(name, default=""):
    value = os.environ.get(name, default)
    return default if value == "__UNSET__" else value


def git(root, *args, env=None):
    # 捕获输出：Git 的远端诊断可能带 URL，不将凭据/完整响应写到 CI 日志。
    result = subprocess.run(
        ["git", "-C", str(root), *args], env=env, capture_output=True, timeout=180
    )
    if result.returncode:
        diagnostic = result.stderr.decode(errors="replace").lower()
        reason = "请检查仓库权限、分支和并发更新"
        for pattern, message in (
            ("invalid format", "SSH 私钥格式无效"),
            ("permission denied (publickey)", "SSH 公钥未获目标仓库授权"),
            ("could not resolve hostname", "无法解析目标主机"),
            ("host key verification failed", "目标主机公钥校验失败"),
            ("connection timed out", "连接目标主机超时"),
        ):
            if pattern in diagnostic:
                reason = message
                break
        raise RuntimeError("Git 操作失败：" + args[0] + "；" + reason)
    return result.stdout


def included(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or any(part in EXCLUDED for part in path.parts):
        return False
    if any(part in PLATFORM_DIRECTORIES for part in path.parts):
        return False
    if any(
        part == ".env" or (part.startswith(".env.") and not part.endswith(".example"))
        for part in path.parts
    ):
        return False
    if path.suffix in {".pem", ".key", ".p12", ".pfx", ".log", ".pyc"} or path.name in {
        ".npmrc",
        "id_rsa",
        "id_ed25519",
    }:
        return False
    if name.startswith("scripts/") and (
        "poc" in path.name or path.name == "setup-delivery-browser.py"
    ):
        return False
    if ".trellis" in path.parts:
        index = path.parts.index(".trellis")
        prefix, relative = path.parts[:index], path.parts[index + 1 :]
        if prefix not in {(), tuple(PurePosixPath(APPLICATION).parts)} or not relative:
            return False
        # 文件名白名单阻止身份、模板更新元数据和后续新增运行文件被自动发布。
        if any(part.startswith(".") or part.endswith((".tmp", ".new")) for part in relative[1:]):
            return False
        return (len(relative) == 1 and relative[0] in TRELLIS_FILES) or (
            len(relative) > 1 and relative[0] in TRELLIS_DIRECTORIES
        )
    return name in ROOT_FILES or name in FORMAT_FIXTURES or name.startswith(PREFIXES)


def export(source, output, revision="HEAD"):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists():
        raise RuntimeError("导出目录必须不存在，避免覆盖已有工作")
    commit = git(source, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    content = git(source, "archive", "--format=tar", commit)
    output.mkdir(parents=True)
    entries = {}
    with tarfile.open(fileobj=io.BytesIO(content)) as archive:
        for member in archive.getmembers():
            if not included(member.name) or member.isdir():
                continue
            if not member.isfile():
                raise RuntimeError("导出范围不接受符号链接或特殊文件：" + member.name)
            destination = output / member.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            data = archive.extractfile(member).read()
            destination.write_bytes(data)
            mode = 0o755 if member.mode & 0o111 else 0o644
            destination.chmod(mode)
            entries[member.name] = {"sha256": hashlib.sha256(data).hexdigest(), "mode": mode}
    required = {
        "go.work",
        "pnpm-lock.yaml",
        "packages/go-server-kit/go.mod",
        APPLICATION + "/go.mod",
        APPLICATION + "/Dockerfile",
        "scripts/setup.py",
        "scripts/project.py",
    }
    if not required.issubset(entries):
        raise RuntimeError("源码缺少独立 demo 的必要文件")
    readme = """# Go Full Stack Starter Demo

可独立构建的多数据库示例，包含 Go 服务公共模块和 React Dashboard 源码。
当前采用源码快照交付，保留工作区结构；不依赖未发布的私有 Go/npm 包。
上游提交及文件哈希见 demo-release.json。

环境：Linux amd64、Python 3、Node 24、pnpm 11.15.1。
在本仓根目录运行 pnpm setup；工具版本由 toolchain.json 固定。
复制 projects/multi-database-demo/.env.example 为同目录 .env，并填写独立数据库、Redis 和认证密钥。
依次运行 pnpm generate、pnpm migrate、pnpm dev。
检查/测试/构建：pnpm check、pnpm test、pnpm build。

Trellis：先读 AGENTS.md、.trellis/spec/index.md。
根任务管理共享包、工具和发布；projects/multi-database-demo 的独立 Trellis 管理应用。
在对应目录运行 python3 .trellis/scripts/get_context.py --mode packages
和 python3 .trellis/scripts/task.py current --source。
复用替换点见 .trellis/spec/guides/reuse-guide.md，文档在 docs/。
上游任务、日志、开发者身份、平台配置不随发布；首次使用自行初始化。
Docker：docker build -f projects/multi-database-demo/Dockerfile .
同一镜像分别运行 /web 和 /worker；迁移先由独立发布步骤执行。

该仓是演示源码同步目标，不是服务器自动部署入口。
真实 .env、凭据、依赖、缓存和运行产物不随同步提交。
少量 poc/web 快照仅用于保留上游格式回归测试，不参与 demo 构建。
目标仓的 .github、.yunxiao 和其他 CI 配置由目标仓自行维护。
"""
    for name, data in {
        "README.md": readme.encode(),
        ".npmrc": b"registry=https://registry.npmjs.org/\n",
    }.items():
        (output / name).write_bytes(data)
        entries[name] = {"sha256": hashlib.sha256(data).hexdigest(), "mode": 0o644}
    manifest = {
        "schemaVersion": 1,
        "layout": "source-bundle-v1",
        "application": APPLICATION,
        "sourceRepository": "https://codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git",
        "sourceCommit": commit,
        "files": dict(sorted(entries.items())),
    }
    (output / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=4) + "\n")
    return manifest


def safe_url(value):
    if value.startswith("git@") and re.fullmatch(r"git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+", value):
        return value
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("目标使用无内嵌凭据的 HTTPS 或 git@host:path 地址")
    return value


def credentials(folder, environment):
    env = {key: value for key, value in environment.items() if value != "__UNSET__"}
    env["GIT_TERMINAL_PROMPT"] = "0"
    key = env.pop("GO_DEMO_SSH_KEY", "")
    token = env.get("GO_DEMO_GIT_TOKEN", "")
    if key and token:
        raise RuntimeError("SSH 和 HTTPS 凭据选择一种")
    if key:
        keyfile = folder / "key"
        keyfile.write_text(key + "\n")
        keyfile.chmod(0o600)
        check = subprocess.run(
            ["ssh-keygen", "-y", "-f", str(keyfile)], capture_output=True, timeout=10
        )
        if check.returncode:
            raise RuntimeError("SSH 发布私钥格式无效；请在私密变量中重新配置完整私钥")
        known = folder / "known_hosts"
        known.write_text(env.pop("GO_DEMO_KNOWN_HOSTS", ""))
        env["GIT_SSH_COMMAND"] = (
            "ssh -i "
            + shlex.quote(str(keyfile))
            + " -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="
            + shlex.quote(str(known))
        )
    if token:
        askpass = folder / "askpass.py"
        askpass.write_text(
            "#!/usr/bin/env python3\nimport os,sys\nprint(os.environ.get('GO_DEMO_GIT_USER','oauth2') if 'username' in sys.argv[1].lower() else os.environ['GO_DEMO_GIT_TOKEN'])\n"
        )
        askpass.chmod(0o700)
        env["GIT_ASKPASS"] = str(askpass)
    return env


def sync(source, primary, targets, branch, revision="HEAD", publish=False):
    urls = list(dict.fromkeys([safe_url(primary), *map(safe_url, targets)]))
    # 检查 ref，不把用户输入作为 git 选项传入。
    if branch.startswith("-"):
        raise RuntimeError("目标分支无效")
    git(source, "check-ref-format", "refs/heads/" + branch)
    with tempfile.TemporaryDirectory(prefix="go-demo-sync-") as temporary:
        folder = Path(temporary).resolve()
        env = credentials(folder, os.environ)
        snapshot, target = folder / "snapshot", folder / "repository"
        manifest = export(source, snapshot, revision)
        git(source, "clone", "--no-checkout", "--", urls[0], str(target), env=env)
        remote = "refs/remotes/origin/" + branch
        existing = (
            git(target, "for-each-ref", "--format=%(refname)", remote, env=env)
            .decode()
            .splitlines()
        )
        if remote in existing:
            # clone 即使使用 --no-checkout 也会创建远端默认分支。
            # 临时仓库直接检出目标提交，后续明确推送 HEAD 到目标 ref。
            git(target, "switch", "--detach", "origin/" + branch, env=env)
            previous = target / MANIFEST
            if not previous.is_file():
                raise RuntimeError("已有目标分支缺少 demo-release.json；拒绝覆盖非本脚本管理的内容")
            old = json.loads(previous.read_text())
            if old.get("layout") != manifest["layout"] or old.get("application") != APPLICATION:
                raise RuntimeError("目标分支不是此 Go demo")
            old_files = old.get("files", {})
            for name in old_files:
                relative = PurePosixPath(name)
                if (
                    relative.is_absolute()
                    or ".." in relative.parts
                    or relative.parts[0] in PRESERVED
                    or ".git" in relative.parts
                ):
                    raise RuntimeError("目标清单包含非法路径")
                destination = target / name
                if destination.is_symlink() or any(
                    parent.is_symlink()
                    for parent in destination.parents
                    if parent.is_relative_to(target) and parent != target
                ):
                    raise RuntimeError("目标管理路径不能是符号链接")
                if name not in manifest["files"] and destination.is_file():
                    destination.unlink()
        else:
            git(target, "switch", "--orphan", branch, env=env)
        for name in [*manifest["files"], MANIFEST]:
            destination = target / name
            if destination.is_symlink() or any(
                parent.is_symlink()
                for parent in destination.parents
                if parent.is_relative_to(target) and parent != target
            ):
                raise RuntimeError("目标路径不能是符号链接")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(snapshot / name, destination)
        git(target, "add", "--", *manifest["files"], MANIFEST, env=env)
        # 纳入管理清单中被上游删除的文件；不触碰目标仓独有 CI/其他文件。
        if remote in existing:
            deleted = [name for name in old_files if name not in manifest["files"]]
            if deleted:
                git(target, "add", "-u", "--", *deleted, env=env)
        changes = bool(git(target, "diff", "--cached", "--name-only", env=env).strip())
        if changes and publish:
            name = env.get("GO_DEMO_BOT_NAME", "ci-go-demo-sync")
            email = env.get("GO_DEMO_BOT_EMAIL", "ci-go-demo-sync@example.com")
            git(
                target,
                "-c",
                "user.name=" + name,
                "-c",
                "user.email=" + email,
                "commit",
                "-m",
                "chore: sync Go demo from " + manifest["sourceCommit"][:12],
                env=env,
            )
        if publish:
            for index, url in enumerate(urls, 1):
                git(target, "push", "--", url, "HEAD:refs/heads/" + branch, env=env)
                print("已同步目标 " + str(index) + "/" + str(len(urls)))
        print(
            json.dumps(
                {
                    "published": publish,
                    "changed": changes,
                    "sourceCommit": manifest["sourceCommit"],
                    "files": len(manifest["files"]),
                    "branch": branch,
                    "targets": len(urls),
                },
                ensure_ascii=False,
            )
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=".")
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--output", help="仅导出到不存在的目录")
    parser.add_argument(
        "--publish", action="store_true", help="向指定目标分支普通推送；缺省只读验证"
    )
    args = parser.parse_args()
    if args.output:
        if args.publish:
            parser.error("--output 与 --publish 不同时使用")
        manifest = export(args.source, args.output, args.revision)
        print(
            json.dumps(
                {"sourceCommit": manifest["sourceCommit"], "files": len(manifest["files"])},
                ensure_ascii=False,
            )
        )
        return
    primary = configured("GO_DEMO_REPO_URL")
    if not primary:
        parser.error("配置 GO_DEMO_REPO_URL 后才能同步")
    targets = re.split(r"[,\s]+", configured("GO_DEMO_PUSH_REPO_URLS").strip())
    sync(
        Path(args.source).resolve(),
        primary,
        [url for url in targets if url],
        configured("GO_DEMO_BRANCH", "multi-database-demo"),
        args.revision,
        args.publish,
    )


if __name__ == "__main__":
    main()
