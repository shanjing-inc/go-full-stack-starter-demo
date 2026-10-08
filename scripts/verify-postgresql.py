#!/usr/bin/env python3
"""PostgreSQL 隔离验收入口，复用双数据库 Docker 验收链路。"""

import argparse
import importlib.util
from pathlib import Path
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument(
        "--docker-build",
        action="store_true",
        help="验收完整多阶段构建，默认复用本地工具和已缓存依赖镜像",
    )
    args, extra = parser.parse_known_args(argv)
    if "--database" in extra or any(value.startswith("--database=") for value in extra):
        parser.error("PostgreSQL 验收入口固定选择 postgres")
    if args.docker_build and "--runtime-only" in extra:
        parser.error("完整构建与仅运行阶段请选择一个范围")
    spec = importlib.util.spec_from_file_location(
        "docker_verification", Path(__file__).with_name("verify-project-docker.py")
    )
    verification = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verification)
    options = ["--database", "postgres", *extra]
    if not args.docker_build and "--runtime-only" not in extra:
        options.append("--runtime-only")
    return verification.main(options)


if __name__ == "__main__":
    sys.exit(main())
