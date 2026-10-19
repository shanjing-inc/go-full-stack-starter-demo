"""项目工具链的主机平台选择、执行前诊断与统一命令错误边界。"""

import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

SUPPORTED = ("linux-amd64", "darwin-amd64", "darwin-arm64")


def host_target(system=None, machine=None):
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    architecture = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(
        machine, machine
    )
    target = system + "-" + architecture
    if target not in SUPPORTED:
        raise RuntimeError(f"当前主机平台：{system}/{machine}。支持的平台：{', '.join(SUPPORTED)}")
    return target


def load_lock(root):
    path = Path(root) / "toolchain.json"
    try:
        lock = json.loads(path.read_text())
        if not isinstance(lock, dict) or not re.fullmatch(
            r"go\d+\.\d+\.\d+", lock["go"]["version"]
        ):
            raise ValueError("Go 版本需要 goX.Y.Z 格式")
        return lock
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError(f"工具链配置读取失败：{path}。{error}") from None


def artifact(lock, name, target):
    spec = lock.get(name)
    platforms = spec.get("platforms", {}) if isinstance(spec, dict) else None
    selected = platforms.get(target) if isinstance(platforms, dict) else None
    # 保留已发布的 Linux 应用锁文件兼容；新版锁文件逐个平台声明产物。
    if selected is None and platforms == {} and target == "linux-amd64":
        selected = spec
    if (
        not isinstance(selected, dict)
        or not isinstance(selected.get("url"), str)
        or not selected["url"].startswith("https://")
        or not isinstance(selected.get("sha256"), str)
        or not re.fullmatch(r"[0-9a-f]{64}", selected["sha256"])
    ):
        raise RuntimeError(
            f"工具链配置缺少 {name} 的 {target} 下载地址和有效 SHA256，请更新 toolchain.json"
        )
    return selected


def probe_go(binary, env=None):
    values = dict(os.environ if env is None else env)
    values.update(GOTOOLCHAIN="local", GOENV="off", GOWORK="off")
    values.pop("GOROOT", None)
    values.pop("GOTOOLDIR", None)
    try:
        result = subprocess.run(
            [str(binary), "version"], env=values, text=True, capture_output=True, timeout=10
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, str(error)
    source = result.stdout.strip()
    match = re.fullmatch(r"go version (go\S+) (\w+)/(\w+)", source)
    if result.returncode or match is None:
        return None, (result.stderr.strip() or source or f"退出码 {result.returncode}")
    return (match[1], match[2] + "-" + match[3]), source


def validate_go(root, env=None, binary=None):
    root = Path(root)
    lock = load_lock(root)
    expected, target = lock["go"]["version"], host_target()
    go = Path(binary) if binary is not None else root / ".tools/go/bin/go"
    actual, detail = probe_go(go, env) if go.is_file() else (None, "工具文件缺失")
    if actual != (expected, target):
        raise RuntimeError(
            "Go 工具链检查失败，执行已停止。\n"
            f"要求版本：{expected}（{target}）\n实际结果：{detail}\n"
            f"使用路径：{go}\n配置来源：{root / 'toolchain.json'}\n"
            "修复命令：rtk pnpm run setup\n修复完成后重新执行原命令。"
        )
    return str(go)


def cli(main, operation):
    try:
        return main() or 0
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        if os.environ.get("STARTER_DEBUG") == "1":
            raise
        print(f"{operation}：{error}", file=sys.stderr)
        return 1
