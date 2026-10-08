#!/usr/bin/env python3
"""统一数据库连接 URL 的方言识别与安全校验。"""

import re
from urllib.parse import parse_qsl, unquote, urlsplit

DATABASES = ("mysql", "postgres", "sqlite")


def database_type(value, setting="DB_DSN"):
    """推导数据库方言；错误文案始终隐藏连接凭据。"""
    message = f"{setting} 需要有效的 mysql://、postgres://、postgresql:// 或 sqlite:// 连接 URL"
    try:
        if (
            not value
            or "://" not in value
            or any(ord(char) <= 32 or ord(char) == 127 for char in value)
            or "#" in value
            or re.search(r"%(?![0-9a-fA-F]{2})", value)
        ):
            raise ValueError()
        url = urlsplit(value)
        parse_qsl(url.query, separator="&")
        if url.fragment or ";" in url.query:
            raise ValueError()
        if "@" in url.netloc and not re.fullmatch(
            r"[A-Za-z0-9_.~!$&'()*+,;=:%@-]*", url.netloc.rsplit("@", 1)[0]
        ):
            raise ValueError()
        dialect = "postgres" if url.scheme == "postgresql" else url.scheme
        if dialect not in DATABASES:
            raise ValueError()
        if dialect == "sqlite":
            if (
                url.username is not None
                or any(char in url.netloc for char in ":[]")
                or not (url.netloc or url.path)
            ):
                raise ValueError()
        else:
            if (
                not url.hostname
                or url.netloc.endswith(":")
                or not url.path.startswith("/")
                or len(url.path) <= 1
                or "/" in url.path[1:]
                or (":" in url.hostname and not url.netloc.split("@")[-1].startswith("["))
                or (url.port is not None and not 1 <= url.port <= 65535)
            ):
                raise ValueError()
            if dialect == "mysql" and (not url.username or ":" in unquote(url.username)):
                raise ValueError()
        return dialect
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError(message) from None
