#!/usr/bin/env python3
"""预览或回收已结束运行的大产物、过期证据与超限Go缓存。"""

import argparse
import json
import sys
from runtime_cleanup import CACHE_LIMIT, GIB, maintain
from starter_context import ROOT
from toolchain import cli


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="列出候选项和保护原因，保留全部产物")
    parser.add_argument(
        "--cache", action="store_true", help=f"同时检查{CACHE_LIMIT // GIB} GiB的Go缓存阈值"
    )
    parser.add_argument("--cache-only", action="store_true", help="仅检查Go缓存")
    args = parser.parse_args()
    report = maintain(
        ROOT, dry_run=args.dry_run, cache=args.cache or args.cache_only, cache_only=args.cache_only
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report.get("errors") else 0


if __name__ == "__main__":
    sys.exit(cli(main, "运行产物清理失败"))
