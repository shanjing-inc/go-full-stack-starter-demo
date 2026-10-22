#!/usr/bin/env python3
"""为正式工作区 准备项目内工具，校验固定版本的 SHA256。"""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
import subprocess
import tarfile
import urllib.request
import zipfile
from runtime_cleanup import exclusive_lock
from toolchain import artifact, host_target, load_lock, probe_go, validate_go, cli
from starter_context import ROOT, TOOL_ROOT, MODULES, APPLICATION_ONLY, kit_environment


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
        request = urllib.request.Request(
            spec["url"], headers={"User-Agent": "shanjing-go-starter/1.0"}
        )
        with (
            urllib.request.urlopen(request, timeout=120) as response,
            temporary.open("wb") as out,
        ):
            while block := response.read(1024 * 1024):
                out.write(block)
        if sha256(temporary) != spec["sha256"]:
            raise RuntimeError("下载内容的 SHA256 与锁定值不一致")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def cached_download(spec, destination, offline, legacy=None):
    """沿用已校验的旧缓存；新缓存名称包含平台，支持离线迁移。"""
    if (
        legacy
        and legacy.is_file()
        and not destination.exists()
        and sha256(legacy) == spec["sha256"]
    ):
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy, destination)
    download(spec, destination, offline)


def install_go(root, lock, target, offline, env):
    tools = root / ".tools"
    go = tools / "go/bin/go"
    expected = lock["go"]["version"]
    actual, detail = probe_go(go, env) if go.is_file() else (None, "工具文件缺失")
    if actual == (expected, target):
        return go
    spec = artifact(lock, "go", target)
    archive = tools / f"downloads/{expected}-{target}.tar.gz"
    cached_download(spec, archive, offline, tools / f"downloads/{expected}.tar.gz")
    if (tools / "go").is_symlink():
        raise RuntimeError("项目 Go 工具目录需要真实目录，请核对 .tools/go")
    print(f"准备 Go 工具链：{detail} → {expected}（{target}）", flush=True)
    with tempfile.TemporaryDirectory(prefix=".go-stage-", dir=tools) as temporary:
        stage = Path(temporary)
        try:
            with tarfile.open(archive) as source:
                source.extractall(stage, filter="data")
        except tarfile.TarError as error:
            raise RuntimeError(f"Go 工具压缩包解压失败，原工具保留：{archive}。{error}") from None
        validate_go(root, env, binary=stage / "go/bin/go")
        previous = stage / "previous"
        if (tools / "go").exists():
            (tools / "go").rename(previous)
        try:
            (stage / "go").rename(tools / "go")
        except BaseException:
            if previous.exists():
                previous.rename(tools / "go")
            raise
    return go


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="仅使用已缓存的工具")
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        raise RuntimeError("工具脚本需要 Python 3.12+，请安装后使用 python3 执行")
    target = host_target()
    lock = load_lock(ROOT)
    tools = ROOT / ".tools"
    tools.mkdir(exist_ok=True)
    env = dict(
        os.environ,
        GOTOOLCHAIN="local",
        GOPRIVATE=os.environ.get("GOPRIVATE", "codeup.aliyun.com/shanjing"),
    )
    env.pop("GOROOT", None)
    env.pop("GOTOOLDIR", None)
    go = install_go(ROOT, lock, target, args.offline, env)
    atlas = tools / f"bin/atlas-{lock['atlas']['version']}"
    download(artifact(lock, "atlas", target), atlas, args.offline)
    atlas.chmod(0o755)
    wheel = tools / f"downloads/ruff-{lock['ruff']['version']}-{target}.whl"
    cached_download(
        artifact(lock, "ruff", target),
        wheel,
        args.offline,
        tools / f"downloads/ruff-{lock['ruff']['version']}.whl",
    )
    ruff = tools / f"bin/ruff-{lock['ruff']['version']}"
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
        GOROOT=str(go.parent.parent),
        CGO_ENABLED="0",
        GOPATH=str(tools / "gopath"),
        GOCACHE=str(tools / "gocache"),
        GOFLAGS="-mod=readonly",
    )
    if args.offline:
        env.update(GOPROXY="off", GOSUMDB="off")
    else:
        env["GOPROXY"] = env.get("GOPROXY", "https://goproxy.cn")
    env = kit_environment(env, workspace=not APPLICATION_ONLY, announce=True)
    for module in [*MODULES, TOOL_ROOT / "tools"]:
        module_env = dict(env, GOWORK="off") if module == TOOL_ROOT / "tools" else env
        if module_env["GOWORK"] != "off":
            # mod download/verify 按单模块 require 读取，会下载被 workspace 遮蔽的旧 kit。
            # 源码模式先准备实际选中的依赖图，构建时由 Go 校验并下载所需包。
            subprocess.run([str(go), "list", "-m", "all"], cwd=module, env=module_env, check=True)
            continue
        subprocess.run([str(go), "mod", "download"], cwd=module, env=module_env, check=True)
        subprocess.run([str(go), "mod", "verify"], cwd=module, env=module_env, check=True)
    subprocess.run(
        [
            str(go),
            "build",
            "-mod=readonly",
            "-o",
            tools / f"bin/air-{lock['air']}",
            "github.com/air-verse/air",
        ],
        cwd=TOOL_ROOT / "tools",
        env=dict(env, GOWORK="off"),
        check=True,
    )
    subprocess.run(
        [str(go), "build", "-mod=readonly", "-o", tools / "bin/format-go", "./cmd/format-go"],
        cwd=TOOL_ROOT / "tools",
        env=dict(env, GOWORK="off"),
        check=True,
    )
    subprocess.run(
        ["pnpm", "install", "--frozen-lockfile"] + (["--offline"] if args.offline else []),
        cwd=ROOT,
        check=True,
    )
    validate_go(ROOT, env)
    print(f"正式工程工具已就绪（{target}）；数据库与 Redis 按应用配置提供。")


def setup_entry():
    tools = ROOT / ".tools"
    tools.mkdir(exist_ok=True)
    try:
        with exclusive_lock(tools / ".gocache-clean.lock"):
            main()
    except BlockingIOError:
        raise RuntimeError(
            "受管 Go 任务正在使用工具链；请先退出开发服务和构建任务，再执行 rtk pnpm run setup"
        ) from None


if __name__ == "__main__":
    sys.exit(cli(setup_entry, "工具准备失败"))
