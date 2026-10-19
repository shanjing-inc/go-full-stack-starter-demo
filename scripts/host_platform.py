"""macOS 原生进程查询；检查失败时保留进程和运行产物。"""

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def darwin():
    return sys.platform == "darwin"


def require_darwin_tools():
    missing = [name for name in ("ps", "lsof", "sysctl") if shutil.which(name) is None]
    if missing:
        raise RuntimeError(
            "macOS 系统命令缺失：" + ", ".join(missing) + "；请恢复系统命令或核对 PATH"
        )


def native(command, absent=False):
    try:
        result = subprocess.run(
            command, capture_output=True, timeout=15, env=dict(os.environ, LC_ALL="C")
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f"macOS 进程检查失败，现有资源保留：{error}") from None
    stdout = os.fsdecode(result.stdout)
    stderr = os.fsdecode(result.stderr)
    if absent and result.returncode == 1 and not stdout and not stderr:
        return ""
    if result.returncode or stderr:
        raise RuntimeError(
            f"macOS 进程检查失败，现有资源保留：{' '.join(command)}；{stderr.strip() or result.returncode}"
        )
    return stdout


def darwin_process_table():
    entries = {}
    for line in native(["ps", "-axo", "pid=,ppid=,pgid=,stat="]).splitlines():
        try:
            pid, parent, group, state = line.split()
            if int(pid) <= 0 or int(parent) < 0 or int(group) < 0:
                raise ValueError("进程编号越界")
            entries[int(pid)] = (state, int(parent), int(group))
        except (ValueError, TypeError):
            raise RuntimeError("macOS 进程快照字段无效，现有资源保留") from None
    if not entries:
        raise RuntimeError("macOS 进程快照为空，现有资源保留")
    return entries


def darwin_process_identity(pid):
    source = native(["ps", "-p", str(pid), "-o", "stat=,lstart="], absent=True).strip()
    if not source:
        return None
    state, separator, started = source.partition(" ")
    if not separator or not started.strip():
        raise RuntimeError("macOS 进程启动身份读取失败，现有资源保留")
    # 秒级身份仅用于保守保留记录；旧进程自动接管由独立的平台能力决定。
    return None if state.startswith("Z") else started.strip()


def darwin_boot_id():
    source = native(["sysctl", "-n", "kern.boottime"])
    match = re.search(r"sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)", source)
    if match is None:
        raise RuntimeError("macOS 系统启动标识读取失败，现有资源保留")
    return f"darwin:{match[1]}:{match[2]}"


def boot_id():
    if darwin():
        return darwin_boot_id()
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def lsof_name(value):
    """按 LC_ALL=C 的 lsof 转义还原文件系统字节，单次解码保留字面反斜杠。"""
    source = os.fsencode(value)
    escapes = {b"\\": 92, b"b": 8, b"f": 12, b"n": 10, b"r": 13, b"t": 9}
    pattern = re.compile(rb"\\(?:x([0-9a-fA-F]{2})|([\\bfnrt]))")
    decoded, index = bytearray(), 0
    while index < len(source):
        if source[index] != 92:
            decoded.append(source[index])
            index += 1
            continue
        match = pattern.match(source, index)
        if match is None:
            raise RuntimeError("macOS 文件名转义无效，现有资源保留")
        byte = int(match[1], 16) if match[1] else escapes[match[2]]
        if byte == 0:
            raise RuntimeError("macOS 文件名包含 NUL，现有资源保留")
        decoded.append(byte)
        index = match.end()
    return os.fsdecode(bytes(decoded))


def lsof_records(source):
    """先按 NUL 切分字段，再还原文件名转义；换行分隔记录。"""
    records, record, pid, command = [], {}, None, ""
    files = 0
    for field in source.split("\0"):
        field = field.lstrip("\n")
        if not field:
            continue
        key, value = field[0], field[1:]
        if key in ("p", "f"):
            if record:
                records.append(dict(record, pid=pid, command=command))
            record = {}
            if key == "p":
                if (pid is not None and not files) or not value.isdigit() or int(value) <= 0:
                    raise RuntimeError("macOS 文件引用进程记录不完整，现有资源保留")
                pid, command, files = value, "", 0
            else:
                if pid is None or not value:
                    raise RuntimeError("macOS 文件引用缺少进程身份，现有资源保留")
                record["f"] = value
                files += 1
        elif key == "c":
            command = value
        elif key == "n":
            record[key] = lsof_name(value)
        else:
            record[key] = value
    if record:
        records.append(dict(record, pid=pid, command=command))
    if pid is not None and not files:
        raise RuntimeError("macOS 文件引用进程记录不完整，现有资源保留")
    return records


def darwin_process_references():
    source = native(["lsof", "-nP", "+c", "0", "-F0pcfn"])
    records = lsof_records(source)
    if not records:
        raise RuntimeError("macOS 文件引用快照为空，运行目录和缓存保留")
    references, busy = [], set()
    for record in records:
        if (
            not str(record["pid"]).isdigit()
            or not record["command"]
            or not record.get("n")
            or record.get("f", "").upper() == "NOFD"
        ):
            raise RuntimeError("macOS 文件引用记录不完整，运行目录和缓存保留")
        if record["pid"] == str(os.getpid()):
            continue
        path = record.get("n", "")
        if path.startswith("/"):
            references.append(path)
        command = record["command"]
        if Path(command).name in {"go", "compile", "link", "gopls", "trae-gopls"}:
            busy.add((record["pid"], command))
    return references, sorted(busy)


def darwin_binary_matches(pid, expected):
    """用运行中的 text 映射核验文件身份，覆盖磁盘文件被替换的情形。"""
    try:
        source = native(["lsof", "-nP", "-a", "-p", str(pid), "-d", "txt", "-F0pfin"], absent=True)
        expected = expected.resolve()
        inode = str(expected.stat().st_ino)
        return any(
            record["pid"] == str(pid)
            and record.get("f") == "txt"
            and record.get("n") == str(expected)
            and record.get("i") == inode
            for record in lsof_records(source)
        )
    except (RuntimeError, OSError):
        return False


def darwin_port_description(port):
    try:
        return (
            native(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"], absent=True).strip()
            or "占用进程信息待确认"
        )
    except RuntimeError as error:
        return str(error)
