#!/usr/bin/env python3
"""统一全仓库源码的四空格格式，保留本地环境与工具管理产物。"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {
    "node_modules",
    "dist",
    "bin",
    "tmp",
    "__pycache__",
    "playwright-report",
    "test-results",
    ".tools",
    ".runtime",
    ".git",
    ".cache",
    ".ruff_cache",
    ".pytest_cache",
    "coverage",
}
PRETTIER_EXTENSIONS = {
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".json",
    ".yaml",
    ".yml",
    ".css",
    ".html",
    ".md",
    ".graphql",
    ".graphqls",
}


def files(root=ROOT):
    """覆盖正式工程、历史 POC、全部脚本与根配置；跳过本地依赖和产物。"""
    result = []
    for current, directories, names in os.walk(root):
        directories[:] = sorted(name for name in directories if name not in EXCLUDED)
        directory = Path(current)
        for name in sorted(names):
            path = directory / name
            local_env = name == ".env" or (
                name.startswith(".env.") and not name.endswith(".example")
            )
            if path.is_symlink() or local_env:
                continue
            result.append(path)
    return sorted(result)


def modules(paths, check):
    """Go module／workspace 的块内指令使用一层四空格缩进。"""
    changed = False
    for path in paths:
        source = path.read_bytes()
        output = re.sub(rb"(?m)^[ \t]+(?=\S)", b"    ", source)
        if output != source:
            changed = True
            if check:
                print(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path, flush=True)
            else:
                path.write_bytes(output)
    return changed


def run(command):
    return subprocess.run([str(value) for value in command], cwd=ROOT).returncode == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="仅检查，保留文件内容")
    parser.add_argument("--go-only", action="store_true", help="生成完成后仅格式化 Go")
    args = parser.parse_args()
    paths = files()
    formatter = ROOT / ".tools/bin/format-go"
    if not formatter.exists():
        raise RuntimeError("请先执行 pnpm setup，准备四空格格式工具")
    success = run(
        [
            formatter,
            *(["-check"] if args.check else []),
            *[path for path in paths if path.suffix == ".go"],
        ]
    )
    changed = modules([path for path in paths if path.name in ("go.mod", "go.work")], args.check)
    success = success and (not changed or not args.check)
    if not args.go_only:
        lock = json.loads((ROOT / "toolchain.json").read_text())
        ruff = ROOT / f".tools/bin/ruff-{lock['ruff']['version']}"
        prettier = ROOT / "node_modules/.bin/prettier"
        if not ruff.exists() or not prettier.exists():
            raise RuntimeError("请先执行 pnpm setup，准备 Python 与前端格式工具")
        success = (
            run(
                [
                    ruff,
                    "format",
                    "--config",
                    ROOT / "ruff.toml",
                    *(["--check"] if args.check else []),
                    *[path for path in paths if path.suffix == ".py"],
                ]
            )
            and success
        )
        mode = "--check" if args.check else "--write"
        regular = [
            path
            for path in paths
            if path.suffix in PRETTIER_EXTENSIONS and path.suffix != ".graphqls"
        ]
        success = run([prettier, mode, *regular]) and success
        schemas = [path for path in paths if path.suffix == ".graphqls"]
        if schemas:
            success = run([prettier, mode, "--parser", "graphql", *schemas]) and success
    if not success:
        raise SystemExit(1)
    print("全仓库四空格格式检查通过" if args.check else "全仓库四空格格式化完成", flush=True)


if __name__ == "__main__":
    main()
