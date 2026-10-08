#!/usr/bin/env python3
"""预览或回收已结束运行的大产物、过期证据与超限Go缓存。"""

import argparse
import json
from pathlib import Path
import sys
from runtime_cleanup import maintain

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="列出候选项和保护原因，保留全部产物")
    parser.add_argument("--cache", action="store_true", help="同时检查12 GiB的Go缓存阈值")
    parser.add_argument("--cache-only", action="store_true", help="仅检查Go缓存")
    args = parser.parse_args()
    report = maintain(
        ROOT, dry_run=args.dry_run, cache=args.cache or args.cache_only, cache_only=args.cache_only
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report.get("errors") else 0


if __name__ == "__main__":
    sys.exit(main())
