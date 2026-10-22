"""应用与主仓公共验收的显式路径契约。"""

import json
import hashlib
import os
from pathlib import Path
import re
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


KIT_MODULE = "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit"


def kit_source(values):
    """显式路径只在本地生效；安装模式拒绝继承的源码覆盖。"""
    mode = values.get("STARTER_KIT_MODE", "auto")
    if mode not in {"auto", "installed"}:
        raise RuntimeError("STARTER_KIT_MODE 需要 auto 或 installed")
    selected = values.get("STARTER_KIT_SOURCE")
    if mode == "installed":
        if selected:
            raise RuntimeError("installed 模式不能配置本地 kit 路径")
        return None
    config = APP / ".starter.local.json"
    if selected is None and config.is_file():
        try:
            data = json.loads(config.read_text())
            selected = data.get("kitSource")
        except (ValueError, AttributeError):
            raise RuntimeError(f"kit 本地配置无效：{config}") from None
    if selected is None:
        return None
    if not isinstance(selected, str) or not selected.strip():
        raise RuntimeError("kitSource 需要非空模块路径")
    path = (APP / Path(selected).expanduser()).resolve()
    mod = path / "go.mod"
    if not mod.is_file() or not re.search(
        r"(?m)^\s*module\s+" + re.escape(KIT_MODULE) + r"\s*$", mod.read_text()
    ):
        raise RuntimeError(f"kit 路径缺少正确的 Go module：{path}")
    return path


def write_workspace(path, modules):
    """按模块声明生成 workspace，不修改正式模块的依赖文件。"""
    versions = []
    for module in modules:
        match = re.search(r"(?m)^go\s+(\d+\.\d+(?:\.\d+)?)", (module / "go.mod").read_text())
        if match:
            versions.append(match[1])
    version = max(versions, key=lambda value: tuple(map(int, value.split("."))))
    content = (
        "go "
        + version
        + "\n\nuse (\n"
        + "".join("\t" + json.dumps(str(module), ensure_ascii=False) + "\n" for module in modules)
        + ")\n"
    )
    # 完整依赖图仍读取 require 中被遮蔽版本的 go.mod；仅在本地 workspace 中
    # 将这些精确版本映射到选定 kit，避免准备依赖时要求其已发布。
    kit = next(
        (
            module
            for module in modules
            if re.search(
                r"(?m)^module\s+" + re.escape(KIT_MODULE) + r"\s*$", (module / "go.mod").read_text()
            )
        ),
        None,
    )
    if kit:
        required = set()
        for module in modules:
            required.update(
                re.findall(
                    r"(?m)^\s*(?:require\s+)?" + re.escape(KIT_MODULE) + r"\s+(v[^\s]+)",
                    (module / "go.mod").read_text(),
                )
            )
        for required_version in sorted(required):
            content += (
                f"\nreplace {KIT_MODULE} {required_version} => "
                + json.dumps(str(kit), ensure_ascii=False)
                + "\n"
            )
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file() or path.read_text() != content:
        # 不同进程可以同时准备同一 workspace；原子替换避免读到半个文件。
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
            file.write(content)
        Path(file.name).replace(path)


def kit_environment(values, *, workspace=False, announce=False):
    values = dict(values)
    workspace = workspace or (
        not APPLICATION_ONLY and values.get("STARTER_KIT_WORKSPACE") == str(ROOT)
    )
    if workspace and values.get("STARTER_KIT_MODE", "auto") == "auto":
        # 主仓公共验收覆盖 go.work 全部模块；应用联调配置不能缩小此范围。
        values.pop("STARTER_KIT_SOURCE", None)
        # 生成、构建及开发子进程会重新加载配置，继承同一根目录的验收范围。
        values["STARTER_KIT_WORKSPACE"] = str(ROOT)
        selected = None
    else:
        selected = kit_source(values)
    installed = values.get("STARTER_KIT_MODE") == "installed"
    work = "off"
    if selected:
        modules = [BACKEND, selected]
        key = hashlib.sha256("\n".join(map(str, modules)).encode()).hexdigest()[:20]
        path = APP / ".runtime/kit-workspaces" / key / "go.work"
        write_workspace(path, modules)
        work = str(path)
        values["STARTER_KIT_SOURCE"] = str(selected)
    elif not installed:
        path = (SOURCE_WORKSPACE or ROOT) / "go.work"
        if SOURCE_WORKSPACE or (not APPLICATION_ONLY and path.is_file()):
            work = str(path)
    values.update(GOWORK=work, DASHBOARD_SOURCE="1" if SOURCE_WORKSPACE and not installed else "0")
    if selected:
        flags = [
            flag for flag in shlex.split(values.get("GOFLAGS", "")) if not flag.startswith("-mod=")
        ]
        values["GOFLAGS"] = shlex.join([*flags, "-mod=readonly"])
    if announce:
        print(
            "Go kit 来源："
            + (str(selected) if selected else work if work != "off" else "锁定安装版本"),
            flush=True,
        )
    return values
