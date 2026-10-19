"""应用与主仓公共验收的显式路径契约。"""

import json
import os
from pathlib import Path
import shlex


def workspace_modules(root):
    """读取 go.work 的 use 指令，保留声明顺序与带空格路径。"""
    work = root / "go.work"
    if not work.is_file():
        return []
    modules = []
    block = False
    for line in work.read_text().splitlines():
        tokens = shlex.split(line.split("//", 1)[0])
        if not tokens:
            continue
        if tokens == ["use", "("]:
            block = True
            continue
        if block and tokens == [")"]:
            block = False
            continue
        values = tokens if block else tokens[1:] if tokens[0] == "use" else []
        for value in values:
            module = (root / value).resolve()
            if not module.is_relative_to(root):
                raise RuntimeError("go.work 模块需要位于主仓范围内：" + value)
            if module not in modules:
                modules.append(module)
    return modules


_source_root = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get("STARTER_ROOT", _source_root)).resolve()
CONFIG = ROOT / "starter.config.json"
APPLICATION_ONLY = CONFIG.is_file()
if APPLICATION_ONLY:
    APP = ROOT
else:
    application = os.environ.get("STARTER_APPLICATION", "projects/multi-database-demo")
    path = Path(application)
    if (
        path.is_absolute()
        or ".." in path.parts
        or len(path.parts) != 2
        or path.parts[0] != "projects"
    ):
        raise RuntimeError("STARTER_APPLICATION 需要 projects/<demo-name>")
    APP = (ROOT / path).resolve()
    if not APP.is_relative_to(ROOT / "projects"):
        raise RuntimeError("应用路径超出主仓 projects 目录")

# 应用本地工具优先；共享入口显式传入源码归属，完整独立脚本保持本地来源。
_default_tools = (
    ROOT
    if not APPLICATION_ONLY
    else _source_root
    if (_source_root / "tools/go.mod").is_file()
    else globals().get("_shared_scripts_root", _source_root)
)
TOOL_ROOT = Path(os.environ.get("STARTER_TOOL_ROOT", _default_tools)).resolve()
LAYOUT = json.loads(CONFIG.read_text()).get("layout") if APPLICATION_ONLY else "app-layout-v2"
if LAYOUT == "app-only-v2":
    LAYOUT = "app-layout-v2"
if LAYOUT not in {"app-only-v1", "app-layout-v2"}:
    raise RuntimeError(
        f"{CONFIG} 需要明确 app-layout-v2、app-only-v2（兼容别名）或 app-only-v1 布局"
    )
BACKEND = APP / "backend" if LAYOUT == "app-layout-v2" else APP
SCHEMA = APP / "share/schema" if LAYOUT == "app-layout-v2" else APP / "schema"
DOCKER = APP / "docker" if LAYOUT == "app-layout-v2" else APP
MODULES = [BACKEND] if APPLICATION_ONLY else workspace_modules(ROOT)

# 工具来源与应用命令范围独立：在主仓 demo 目录运行也使用本地公共依赖。
SOURCE_WORKSPACE = None
candidate = TOOL_ROOT if APPLICATION_ONLY else ROOT
marker = candidate / "package.json"
if (
    (candidate / "projects/multi-database-demo").resolve() == APP
    and marker.is_file()
    and json.loads(marker.read_text()).get("name") == "go-full-stack-starter"
    and (candidate / "go.work").is_file()
    and (candidate / "packages/go-server-kit/go.mod").is_file()
):
    SOURCE_WORKSPACE = candidate


def frontend_directory(module):
    """统一默认布局及自定义 Go 模块的前端位置。"""
    if module == BACKEND:
        return APP / "frontend"
    return (module.parent if module.name == "backend" else module) / "frontend"
