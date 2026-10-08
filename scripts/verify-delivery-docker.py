#!/usr/bin/env python3
"""使用隔离容器网络验收同镜像 Web／Worker；缺少 engine 时退出码为 2。"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-image", action="store_true")
    args = parser.parse_args()
    report = ROOT / ".runtime/delivery-docker-result.json"
    report.parent.mkdir(exist_ok=True)
    result = {"status": "blocked", "checks": [], "reason": "宿主机 Docker engine 可用性待确认"}
    created = []
    network = None
    image = None
    built = False

    def docker(*cmd, timeout=180):
        p = subprocess.run(
            ["docker", *map(str, cmd)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        if p.returncode:
            raise RuntimeError("Docker命令失败：" + p.stderr[-3000:])
        return p.stdout.strip()

    def passed(name):
        result["checks"].append(dict(name=name, status="passed"))
        print("通过：" + name, flush=True)

    def wait(fn, name, seconds=60):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                if fn():
                    return
            except (OSError, RuntimeError, urllib.error.URLError):
                pass
            time.sleep(0.25)
        raise RuntimeError("等待超时：" + name)

    def request(origin, path="/health/ready", body=None):
        req = urllib.request.Request(
            origin + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            r = urllib.request.urlopen(req, timeout=2)
        except urllib.error.HTTPError as e:
            r = e
        with r:
            return r.status, r.read()

    def launch(name, *options, command=()):
        docker("run", "-d", "--name", name, "--network", network, *options, *command)
        created.append(name)

    try:
        if not shutil.which("docker"):
            result["reason"] = "宿主机缺少 docker 命令与容器运行环境"
            print("待验证：" + result["reason"])
            return 2
        try:
            result["engine"] = json.loads(
                docker("info", "--format", "{{json .ServerVersion}}", timeout=10)
            )
        except (RuntimeError, subprocess.TimeoutExpired) as e:
            result["reason"] = "Docker daemon 检查失败：" + str(e)
            print(result["reason"])
            return 2
        result["status"] = "failed"
        result.pop("reason", None)
        token = uuid.uuid4().hex[:12]
        network = "delivery-poc-" + token
        image = "delivery-poc:" + token
        images = json.loads((ROOT / "poc/delivery/docker-images.json").read_text())
        # 标签经实际拉取核验，报告记录 RepoDigests；生产发布使用验收后的摘要。
        refs = list(images["buildImages"].values()) + list(images["testImages"].values())
        digests = {}
        for ref in refs:
            docker("pull", ref, timeout=600)
            digests[ref] = json.loads(
                docker("image", "inspect", ref, "--format", "{{json .RepoDigests}}")
            )
            if not digests[ref]:
                raise RuntimeError("镜像摘要缺失：" + ref)
        result["baseImageDigests"] = digests
        node = images["buildImages"]["node"]
        go = images["buildImages"]["go"]
        docker(
            "build",
            "--platform",
            "linux/amd64",
            "--build-arg",
            "NODE_IMAGE=" + node + "@" + digests[node][0].split("@", 1)[1],
            "--build-arg",
            "GO_IMAGE=" + go + "@" + digests[go][0].split("@", 1)[1],
            "-f",
            ROOT / "poc/delivery/Dockerfile",
            "-t",
            image,
            ROOT,
            timeout=1800,
        )
        built = True
        inspect = json.loads(docker("image", "inspect", image))[0]
        result["imageID"] = inspect["Id"]
        if inspect["Config"]["User"] != "65532:65532":
            raise RuntimeError("运行用户应为 65532")
        passed("多阶段构建与非root运行用户")
        docker("network", "create", network)
        mysql = "delivery-mysql-" + token
        redis = "delivery-redis-" + token
        web = "delivery-web-" + token
        worker = "delivery-worker-" + token
        launch(
            mysql,
            "-p",
            "127.0.0.1::3306",
            "-e",
            "MYSQL_ALLOW_EMPTY_PASSWORD=yes",
            "-e",
            "MYSQL_DATABASE=delivery",
            images["testImages"]["mysql"],
        )
        launch(
            redis,
            images["testImages"]["redis"],
            command=("redis-server", "--save", "", "--appendonly", "no"),
        )
        wait(
            lambda: docker("exec", mysql, "mysql", "-uroot", "-e", "SELECT 1") == "1\n1",
            "MySQL初始化",
            120,
        )
        binding = json.loads(docker("inspect", mysql))[0]["NetworkSettings"]["Ports"]["3306/tcp"][
            0
        ]["HostPort"]
        subprocess.run(
            [
                ROOT / ".tools/bin/atlas-v1.3.0",
                "migrate",
                "apply",
                "--dir",
                "file://" + str(ROOT / "poc/database/artifacts/migrations"),
                "--url",
                f"mysql://root@127.0.0.1:{binding}/delivery",
            ],
            check=True,
            timeout=60,
        )
        docker(
            "exec",
            mysql,
            "mysql",
            "-uroot",
            "-e",
            "CREATE USER 'delivery_ro'@'%' IDENTIFIED BY 'poc-private-password'; GRANT SELECT ON delivery.* TO 'delivery_ro'@'%';",
        )
        settings = ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true"]
        for key, value in dict(
            REDIS_URL=f"redis://{redis}:6379/0",
            APP_NAMESPACE="delivery-container",
            DB_DRIVER="mysql",
            DB_DSN=f"delivery_ro:poc-private-password@tcp({mysql}:3306)/delivery?timeout=1s&readTimeout=1s&writeTimeout=1s",
            DB_VERSION="000002",
            SHUTDOWN_TIMEOUT="4s",
        ).items():
            settings += ["-e", key + "=" + value]
        launch(worker, *settings, image, command=("/worker",))
        launch(web, *settings, "-p", "127.0.0.1::8080", image, command=("/web",))
        mapped = json.loads(docker("inspect", web))[0]["NetworkSettings"]["Ports"]["8080/tcp"][0][
            "HostPort"
        ]
        origin = "http://127.0.0.1:" + mapped
        wait(
            lambda: request(origin)[0] == 200 and "Worker 就绪" in docker("logs", worker),
            "两个角色就绪",
        )
        statuses = [json.loads(docker("inspect", name))[0] for name in (web, worker)]
        if any(s["Image"] != inspect["Id"] for s in statuses):
            raise RuntimeError("角色镜像ID应保持一致")
        passed("同一镜像启动独立Web与Worker并通过只读MySQL门禁")
        status, body = request(origin, "/admin/tasks")
        if status != 200 or b"/admin/assets/" not in body:
            raise RuntimeError("内嵌SPA路由异常")
        passed("容器内嵌SPA深层路由")
        if request(origin, "/api/rest/poc/tasks", {"key": "container-task"})[0] != 202:
            raise RuntimeError("任务投递异常")
        wait(
            lambda: docker(
                "exec",
                redis,
                "redis-cli",
                "--raw",
                "HGET",
                "delivery-container:worker-poc:counts",
                "container-task",
            )
            == "1",
            "独立Worker消费",
        )
        passed("容器Web投递与独立Worker消费")
        for name in (web, worker):
            docker("stop", "-t", "10", name)
            state = json.loads(docker("inspect", name))[0]["State"]
            if state["Running"] or state["ExitCode"] != 0:
                raise RuntimeError("容器SIGTERM优雅退出异常")
        passed("Web与Worker容器SIGTERM退出码0")
        result["status"] = "passed"
        return 0
    except Exception as e:
        result.update(status="failed", error=str(e))
        print("失败：" + str(e))
        return 1
    finally:
        if shutil.which("docker"):
            for name in reversed(created):
                subprocess.run(
                    ["docker", "rm", "-f", name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                )
            if network:
                subprocess.run(
                    ["docker", "network", "rm", network],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                )
            if built and not args.keep_image:
                subprocess.run(
                    ["docker", "image", "rm", image],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                )
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print("容器验收报告：" + str(report))


if __name__ == "__main__":
    sys.exit(main())
