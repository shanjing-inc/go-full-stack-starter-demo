"""正式验收的可写源码快照；工具与依赖缓存共享，生成及构建产物独立。"""

from pathlib import Path
import shutil

EXCLUDED = {
    ".git",
    ".tools",
    ".runtime",
    ".cache",
    "node_modules",
    "tmp",
    "__pycache__",
    "coverage",
    "playwright-report",
    "test-results",
    ".ruff_cache",
    ".pytest_cache",
}
SHARED_TOOLS = {"go", "gopath", "gocache", "browser"}


def create_workspace(source, destination):
    """复制当前 tracked／untracked／本地配置和前端 dist，重装隔离 workspace 依赖。"""
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists():
        raise RuntimeError("验收源码快照目录需要全新路径")
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns(*EXCLUDED))
    tools = destination / ".tools"
    tools.mkdir()
    for original in (source / ".tools").iterdir():
        target = tools / original.name
        if original.name in SHARED_TOOLS:
            target.symlink_to(original.resolve(), target_is_directory=original.is_dir())
        elif original.is_dir():
            # bin 与下载文件独立复制，setup/generate 的写入留在验收目录。
            shutil.copytree(original, target)
        else:
            shutil.copy2(original, target)
    return destination
