#!/usr/bin/env python3
"""为正式工作区 准备项目内工具，校验固定版本的 SHA256。"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request
import zipfile
from runtime_cleanup import cache_activity

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "toolchain.json").read_text())


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def download(spec, destination, offline):
    if destination.exists() and sha256(destination) == spec["sha256"]:
        return
    if offline:
        raise RuntimeError(f"离线模式缺少校验通过的缓存：{destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    print(f"下载固定版本：{spec['url']}", flush=True)
    try:
        with (
            urllib.request.urlopen(spec["url"], timeout=120) as response,
            temporary.open("wb") as out,
        ):
            while block := response.read(1024 * 1024):
                out.write(block)
        if sha256(temporary) != spec["sha256"]:
            raise RuntimeError("下载内容的 SHA256 与锁定值不一致")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="仅使用已缓存的工具")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("当前工具锁定文件适用于 Linux amd64，其他平台需单独核对版本和校验值")
    tools = ROOT / ".tools"
    go = tools / "go/bin/go"
    env = dict(os.environ, GOTOOLCHAIN="local")
    if not go.exists() or LOCK["go"]["version"] not in subprocess.check_output(
        [str(go), "version"], env=env, text=True
    ):
        archive = tools / "downloads/go1.26.8.tar.gz"
        download(LOCK["go"], archive, args.offline)
        with tarfile.open(archive) as source:
            source.extractall(tools, filter="data")
    atlas = tools / "bin/atlas-v1.3.0"
    download(LOCK["atlas"], atlas, args.offline)
    atlas.chmod(0o755)
    wheel = tools / f"downloads/ruff-{LOCK['ruff']['version']}.whl"
    download(LOCK["ruff"], wheel, args.offline)
    ruff = tools / f"bin/ruff-{LOCK['ruff']['version']}"
    with zipfile.ZipFile(wheel) as source:
        members = [name for name in source.namelist() if name.endswith(".data/scripts/ruff")]
        if len(members) != 1:
            raise RuntimeError("Ruff wheel 中的可执行文件数量应为一")
        ruff.write_bytes(source.read(members[0]))
    ruff.chmod(0o755)
    subprocess.run([str(ruff), "--version"], check=True)
    subprocess.run([str(go), "version"], env=env, check=True)
    subprocess.run([str(atlas), "version"], check=True)
    env.update(
        PATH=str(go.parent) + os.pathsep + env.get("PATH", ""),
        CGO_ENABLED="0",
        GOPATH=str(tools / "gopath"),
        GOCACHE=str(tools / "gocache"),
        GOFLAGS="-mod=readonly",
    )
    if args.offline:
        env.update(GOPROXY="off", GOSUMDB="off")
    else:
        env["GOPROXY"] = env.get("GOPROXY", "https://goproxy.cn")
    for module in (
        ROOT / "packages/go-server-kit",
        ROOT / "projects/multi-database-demo",
        ROOT / "tools",
    ):
        subprocess.run(
            [str(go), "mod", "download"], cwd=module, env=dict(env, GOWORK="off"), check=True
        )
        subprocess.run(
            [str(go), "mod", "verify"], cwd=module, env=dict(env, GOWORK="off"), check=True
        )
    subprocess.run(
        [
            str(go),
            "build",
            "-mod=readonly",
            "-o",
            tools / "bin/air-v1.64.5",
            "github.com/air-verse/air",
        ],
        cwd=ROOT / "tools",
        env=dict(env, GOWORK="off"),
        check=True,
    )
    subprocess.run(
        [str(go), "build", "-mod=readonly", "-o", tools / "bin/format-go", "./cmd/format-go"],
        cwd=ROOT / "tools",
        env=dict(env, GOWORK="off"),
        check=True,
    )
    subprocess.run(
        ["pnpm", "install", "--frozen-lockfile"] + (["--offline"] if args.offline else []),
        cwd=ROOT,
        check=True,
    )
    print("正式工程工具已就绪；MySQL 与 Redis 使用宿主机服务。")


if __name__ == "__main__":
    with cache_activity(ROOT):
        main()
