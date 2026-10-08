"""运行产物的租约、保留期限和容量治理；共享缓存由主仓库入口回收。"""

from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

GIB = 1024**3
CACHE_LIMIT = 12 * GIB
RUNTIME_WARNING = 5 * GIB
FAILURE_GRACE = 48 * 3600
SWEEP_INTERVAL = 3600
MANIFEST = "retention.json"
PIN = ".keep-runtime"
KINDS = {"project", "project-docker", "dev"}


def read_json(path):
    if path.is_symlink():
        return {}
    try:
        value = path.read_text()
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError):
        return {}


def write_json(path, value):
    temporary = path.with_name(path.name + ".part")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def runtime_base(root):
    base = Path(root) / ".runtime"
    if base.is_symlink():
        raise RuntimeError("运行目录需要使用仓库内的真实目录")
    base.mkdir(exist_ok=True)
    return base


def disk_size(path, seen=None):
    """统计已分配块；符号链接仅统计链接自身。"""
    seen = set() if seen is None else seen

    def blocks(file):
        try:
            entry = file.lstat()
        except FileNotFoundError:
            return 0
        key = (entry.st_dev, entry.st_ino)
        if key in seen:
            return 0
        seen.add(key)
        return entry.st_blocks * 512

    size = blocks(path)
    if path.is_dir() and not path.is_symlink():
        for base, directories, files in os.walk(path, followlinks=False):
            for name in directories + files:
                size += blocks(Path(base) / name)
    return size


def process_identity(pid):
    if not str(pid).isdigit():
        return None
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
        return fields[19] if fields[0] != "Z" else None
    except (OSError, IndexError):
        return None


def process_references():
    """补充旧目录的活跃检查，包含工作目录、可执行文件、命令参数和打开文件。"""
    references, go_processes = [], []
    for proc in Path("/proc").glob("[0-9]*"):
        if int(proc.name) == os.getpid() or process_identity(proc.name) is None:
            continue
        try:
            command = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            command = ""
        paths = [command]
        executable = ""
        for name in ("cwd", "exe"):
            try:
                target = os.readlink(proc / name).removesuffix(" (deleted)")
                paths.append(target)
                if name == "exe":
                    executable = target
            except OSError:
                pass
        try:
            for fd in (proc / "fd").iterdir():
                try:
                    paths.append(os.readlink(fd).removesuffix(" (deleted)"))
                except OSError:
                    pass
        except OSError:
            pass
        references.extend(paths)
        if Path(executable).name in {"go", "compile", "link", "gopls", "trae-gopls"}:
            go_processes.append((proc.name, executable))
    return references, go_processes


def referenced(path, references):
    prefix = str(path)
    return any(re.search(re.escape(prefix) + r"(?:/|$|[\s\"'])", text) for text in references)


@contextmanager
def cache_activity(root):
    """所有受管 Go 入口共享同一把锁，源码快照通过真实缓存路径定位锁。"""
    tools = (Path(root) / ".tools/gocache").resolve().parent
    tools.mkdir(parents=True, exist_ok=True)
    with (tools / ".gocache-clean.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
        yield


class RunLease:
    """进程存活期间持有运行锁与缓存共享锁，完成记录在进程清理后写入。"""

    def __init__(self, root, runtime, kind, keep=False):
        if kind not in KINDS:
            raise RuntimeError("未知运行产物类型")
        self.root, self.runtime = Path(root), Path(runtime)
        if self.runtime.parent != runtime_base(self.root) or self.runtime.is_symlink():
            raise RuntimeError("运行产物路径越界")
        self.lock = (self.runtime / ".run.lock").open("a+")
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.cache = cache_activity(root)
        self.cache.__enter__()
        self.record = dict(
            version=1,
            kind=kind,
            status="running",
            startedAt=time.time(),
            ownerPID=os.getpid(),
            ownerStart=process_identity(os.getpid()),
            ownerBoot=Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            keepRuntime=keep,
            cleanupErrors=[],
        )
        try:
            write_json(self.runtime / MANIFEST, self.record)
        except BaseException:
            self.lock.close()
            self.cache.__exit__(None, None, None)
            raise

    def finish(self, status, errors=()):
        self.record.update(status=status, completedAt=time.time(), cleanupErrors=list(errors))
        try:
            write_json(self.runtime / MANIFEST, self.record)
        except OSError as error:
            print("运行保留记录待处理：" + str(error), flush=True)
            return
        finally:
            self.lock.close()
            self.cache.__exit__(None, None, None)
        # 清理失败时继续保留现场，等待资源状态得到确认。
        safe_maintain(self.root, only=self.runtime)


def pinned_reports(root):
    """保留文档引用和最近结果入口指向的证据目录，大产物仍按期限回收。"""
    base = Path(root) / ".runtime"
    pinned = set()
    prefix = r"(?:" + re.escape(str(base)) + r"|(?<![\w/])\.runtime)/([^/\s\"'`<>]+)"
    files = list((Path(root) / "docs").rglob("*.md")) + [Path(root) / "README.md"]
    for file in files:
        try:
            pinned.update(re.findall(prefix, file.read_text()))
        except OSError:
            pass
    for file in base.glob("*.json"):
        target = read_json(file).get("runtime")
        if isinstance(target, str) and Path(target).parent == base:
            pinned.add(Path(target).name)
    for file in base.iterdir() if base.exists() else []:
        if file.is_symlink():
            try:
                target = file.resolve()
                if target.parent == base.resolve():
                    pinned.add(target.name)
            except (OSError, RuntimeError):
                pass
    return pinned


def record_for(runtime):
    record = read_json(runtime / MANIFEST)
    if (runtime / MANIFEST).exists() or (runtime / MANIFEST).is_symlink():
        if record.get("version") == 1 and record.get("kind") in KINDS:
            if record.get("status") in {"running", "passed", "stopped", "failed", "blocked"}:
                return record
        return {}
    # 旧目录限定为脚本的随机名称和可识别完成记录；人工备份单独保护。
    if re.fullmatch(r"project-(?:docker-)?[a-z0-9_]{8}", runtime.name):
        result = read_json(runtime / "result.json")
        if result.get("runtime") == str(runtime) and result.get("status") in {
            "passed",
            "failed",
            "blocked",
        }:
            return dict(
                version=1,
                kind="project-docker" if runtime.name.startswith("project-docker-") else "project",
                status=result["status"],
                completedAt=(runtime / "result.json").stat().st_mtime,
                cleanupErrors=result.get("cleanupErrors", []),
                legacy=True,
            )
    if re.fullmatch(r"dev-[a-z0-9_]{8}", runtime.name):
        state = read_json(runtime / "state.json")
        if state.get("status") in {"stopped", "failed"} and isinstance(
            state.get("supervisorPID"), int
        ):
            # 旧记录缺少 PID 启动身份，PID 尚存时采用保守保护。
            if process_identity(state["supervisorPID"]) is None:
                return dict(
                    version=1,
                    kind="dev",
                    status=state["status"],
                    completedAt=(runtime / "state.json").stat().st_mtime,
                    cleanupErrors=[],
                    legacy=True,
                )
    return {}


def artifact_paths(runtime, kind):
    names = {
        "project": ["workspace", "mysql", "bin"],
        "project-docker": ["mysql", "runtime-context", "schema-diff", "bin"],
        "dev": ["frontend-dist", "vite-cache"],
    }[kind]
    if kind == "dev":
        names += [
            item.name
            for item in runtime.glob("generation-*")
            if re.fullmatch(r"generation-[0-9]+", item.name)
        ]
    return [
        runtime / name
        for name in names
        if (runtime / name).exists() or (runtime / name).is_symlink()
    ]


def run_locked(runtime):
    path = runtime / ".run.lock"
    if path.is_symlink():
        return True
    if not path.exists():
        return False
    try:
        with path.open("r") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return False
    except (BlockingIOError, PermissionError):
        return True


@contextmanager
def exclusive_lock(path, create=True):
    if path.is_symlink():
        raise RuntimeError("清理锁需要真实文件")
    if not create and not path.exists():
        yield
        return
    with path.open("a+" if create else "r") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def plan_entry(runtime, references, pins, now, check_lock=True):
    result = dict(
        path=str(runtime), action="保留", reason="人工目录或完成记录待确认", paths=[], record={}
    )
    if runtime.is_symlink():
        return dict(result, reason="符号链接边界")
    record = record_for(runtime)
    result["record"] = record
    if check_lock and run_locked(runtime):
        result["reason"] = "运行锁占用"
    elif (runtime / PIN).exists() or (runtime / PIN).is_symlink() or record.get("keepRuntime"):
        result["reason"] = "显式保留"
    elif referenced(runtime, references):
        result["reason"] = "活跃进程引用"
    elif record:
        owner = record.get("ownerPID")
        if (
            record.get("status") == "running"
            and owner
            and process_identity(owner) == record.get("ownerStart")
            and process_identity(owner)
            and record.get("ownerBoot", Path("/proc/sys/kernel/random/boot_id").read_text().strip())
            == Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        ):
            result["reason"] = "运行所有者存活"
        elif record.get("cleanupErrors"):
            result["reason"] = "资源退出待确认"
        elif record.get("status") == "running":
            result.update(action="标记异常", reason="异常退出，完整现场保留48小时")
        else:
            completed = record.get("completedAt")
            if type(completed) not in (int, float) or not math.isfinite(completed):
                result["reason"] = "完成时间待确认"
                return result
            age = now - completed
            failed = record.get("status") not in {"passed", "stopped"}
            if failed and age < FAILURE_GRACE:
                result["reason"] = "失败现场保留48小时"
            elif age >= (14 if failed else 7) * 86400 and runtime.name not in pins:
                result.update(
                    action="删除过期目录", reason="证据保留期限已到", paths=[str(runtime)]
                )
            else:
                paths = artifact_paths(runtime, record["kind"])
                result.update(
                    action="回收大产物" if paths else "保留",
                    reason="保留报告与日志",
                    paths=[str(p) for p in paths],
                )
    return result


def apply_entry(root, entry):
    runtime = Path(entry["path"])
    base = runtime_base(root)
    if runtime.parent != base or runtime.is_symlink():
        raise RuntimeError("运行产物路径越界")
    # 锁覆盖删除期间；旧目录首次创建锁，后续复用。
    if (runtime / ".run.lock").is_symlink():
        return dict(entry, action="保留", reason="运行锁边界", paths=[])
    with (runtime / ".run.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return dict(entry, action="保留", reason="运行锁占用", paths=[])
        references, _ = process_references()
        current = plan_entry(
            runtime, references, pinned_reports(root), time.time(), check_lock=False
        )
        if current["action"] == "标记异常":
            record = current["record"]
            record.update(status="failed", completedAt=time.time(), interrupted=True)
            write_json(runtime / MANIFEST, record)
        elif current["action"] == "回收大产物":
            if current["record"]["kind"] == "dev":
                # 构建／运行日志从代目录迁到原运行目录，保留诊断证据。
                for folder in [
                    Path(name)
                    for name in current["paths"]
                    if Path(name).name.startswith("generation-")
                ]:
                    if folder.is_dir() and not folder.is_symlink():
                        for log in folder.glob("*.log"):
                            if log.is_file() and not log.is_symlink():
                                shutil.copy2(log, runtime / (folder.name + "-" + log.name))
            for name in current["paths"]:
                path = Path(name)
                if path.parent != runtime:
                    raise RuntimeError("大产物路径越界")
                if path.is_symlink() or path.is_file():
                    path.unlink()
                else:
                    shutil.rmtree(path)
            record = current["record"]
            record.update(artifactsCleanedAt=time.time(), artifactsRetained=False)
            write_json(runtime / MANIFEST, record)
        elif current["action"] == "删除过期目录":
            shutil.rmtree(runtime)
        return current


def clean_cache(root, dry_run=False, references=None):
    root = Path(root)
    cache = root / ".tools/gocache"
    result = dict(path=str(cache), action="保留", reason="缓存容量在12 GiB阈值内", bytes=0)
    if cache.is_symlink() or (root / ".tools").is_symlink():
        return dict(result, reason="共享缓存由主仓库入口清理")
    if not cache.is_dir():
        return dict(result, reason="缓存目录尚未创建")
    size = disk_size(cache)
    result["bytes"] = size
    if size <= CACHE_LIMIT:
        return result
    _, busy = process_references() if references is None else references
    if busy:
        return dict(result, reason="Go构建／语言服务进程活跃")
    try:
        with exclusive_lock(cache.parent / ".gocache-clean.lock", create=not dry_run):
            if process_references()[1]:
                return dict(result, reason="Go构建／语言服务进程活跃")
            result.update(action="回收Go缓存", reason="超过12 GiB，使用go clean -cache")
            if not dry_run:
                go = root / ".tools/go/bin/go"
                if not go.is_file():
                    return dict(result, action="保留", reason="Go工具链尚未准备")
                env = dict(
                    os.environ, GOCACHE=str(cache), GOTOOLCHAIN="local", GOENV="off", GOWORK="off"
                )
                # 缓存回收独立于构建标志、模块下载和应用配置。
                env.pop("GOFLAGS", None)
                env.pop("GOCACHEPROG", None)
                subprocess.run(
                    [str(go), "clean", "-cache"], cwd=root, env=env, check=True, timeout=120
                )
                result["remainingBytes"] = disk_size(cache)
    except BlockingIOError:
        return dict(result, reason="受管Go任务持有缓存锁")
    return result


def maintain(root, dry_run=False, cache=False, cache_only=False, automatic=False, only=None):
    root = Path(root).resolve()
    base = root / ".runtime"
    if base.is_symlink():
        raise RuntimeError("运行目录需要使用仓库内的真实目录")
    if not dry_run:
        base = runtime_base(root)
    if automatic and (
        os.environ.get("STARTER_ISOLATED_BUILD") == "1" or (root / ".tools/gocache").is_symlink()
    ):
        return {"skipped": "隔离子任务由父运行管理"}
    state_file = base / "cleanup-latest.json"
    previous = read_json(state_file)
    if automatic:
        swept_at, now = previous.get("sweptAt", 0), time.time()
        # 类型与时间范围共同排除布尔、非有限值和异常大整数，完整现场继续保留。
        if type(swept_at) not in (int, float) or not 0 <= swept_at <= now:
            return {
                "skipped": "启动兜底完成时间待确认",
                "errors": ["兜底清理记录 sweptAt 无效，请执行 pnpm clean:runtime 重建记录"],
            }
        if now - swept_at < SWEEP_INTERVAL:
            return {"skipped": "启动兜底每小时执行一次"}
    try:
        with exclusive_lock(base / ".cleanup.lock", create=not dry_run):
            refs, busy = process_references()
            pins = pinned_reports(root)
            candidates = [Path(only)] if only else sorted(base.iterdir()) if base.exists() else []
            entries = (
                []
                if cache_only
                else [
                    plan_entry(item, refs, pins, time.time())
                    for item in candidates
                    if item.is_dir() or item.is_symlink()
                ]
            )
            for entry in entries:
                entry["bytes"] = disk_size(Path(entry["path"]))
            total = disk_size(base) if only is None else disk_size(Path(only))
            seen = set()
            planned = sum(
                disk_size(Path(name), seen) for entry in entries for name in entry["paths"]
            )
            errors = []
            if not dry_run:
                for index, entry in enumerate(entries):
                    if entry["action"] != "保留":
                        try:
                            entries[index] = dict(apply_entry(root, entry), bytes=entry["bytes"])
                        except (OSError, RuntimeError) as error:
                            errors.append(f"{entry['path']}：{error}")
            cache_result = None
            if cache:
                try:
                    cache_result = clean_cache(root, dry_run, (refs, busy))
                except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                    errors.append("Go缓存回收：" + str(error))
            remaining = (
                total if dry_run else (disk_size(base) if only is None else disk_size(Path(only)))
            )
            report = dict(
                dryRun=dry_run,
                runtimeBytes=total,
                estimatedReclaimBytes=planned,
                remainingRuntimeBytes=remaining,
                reclaimedBytes=0 if dry_run else max(0, total - remaining),
                warning=remaining > RUNTIME_WARNING,
                entries=[{k: v for k, v in entry.items() if k != "record"} for entry in entries],
                cache=cache_result,
                errors=errors,
            )
            if not dry_run and only is None and not cache_only:
                report["sweptAt"] = time.time()
                write_json(state_file, report)
            return report
    except BlockingIOError:
        return {"skipped": "清理任务正在运行"}


def safe_maintain(root, **options):
    """清理问题单独告警，业务命令保留自己的退出状态。"""
    try:
        report = maintain(root, **options)
        if report.get("errors"):
            print("运行产物清理待处理：" + "；".join(report["errors"]), flush=True)
        if report.get("warning"):
            print("运行产物超过5 GiB预警线；保留项见 pnpm clean:runtime --dry-run", flush=True)
        cache = report.get("cache")
        if cache and cache["bytes"] > CACHE_LIMIT and cache["action"] == "保留":
            print("Go缓存超过12 GiB，本轮保留：" + cache["reason"], flush=True)
        return report
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print("运行产物清理待处理：" + str(error), flush=True)
        return {"errors": [str(error)]}
