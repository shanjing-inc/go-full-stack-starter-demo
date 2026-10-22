import { execFileSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
    lstatSync,
} from "node:fs";
import path from "node:path";

const OWNER_FILE = ".weapp-sync-owner.json";
const PRIVATE_FILE = "project.private.config.json";

// 解析已有父目录的真实路径，让符号链接参与边界校验。
function realLocation(value) {
    const target = path.resolve(value);
    let parent = target;
    while (!existsSync(parent)) parent = path.dirname(parent);
    return path.resolve(realpathSync(parent), path.relative(parent, target));
}
function inside(parent, child) {
    const relative = path.relative(parent, child);
    return (
        relative === "" ||
        (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
    );
}
function guardOverlap(source, destination) {
    if (inside(source, destination) || inside(destination, source))
        throw new Error("同步源与目标目录重叠，请使用独立产物目录。");
}

/** Windows 同步只接受挂载盘下的专用 dist，配置目录与目标保持隔离。 */
export function validateDestination(projectRoot, destination) {
    if (typeof destination !== "string" || !path.isAbsolute(destination))
        throw new Error("同步目标需要 Windows 挂载盘下的绝对 dist 路径。");
    const target = path.resolve(destination);
    if (!/^\/mnt\/[a-z]\/(?:[^/]+\/)+dist$/u.test(target))
        throw new Error("同步目标需要 /mnt/盘符/项目目录/dist 形式的专用目录。");
    const realTarget = realLocation(target);
    const realProject = realLocation(projectRoot);
    if (realTarget !== target || inside(realProject, realTarget) || inside(realTarget, realProject))
        throw new Error("同步目标与项目目录需要隔离，目标路径请使用真实路径。");
    return target;
}

/** 使用归属标记保护已有目录，通过参数数组运行 rsync，保留本地私有配置。 */
export function syncDist(source, destination, run = execFileSync) {
    if (!existsSync(source) || !lstatSync(source).isDirectory())
        throw new Error("小程序源产物目录缺失，请先完成构建。");
    const realSource = realLocation(source);
    const realTarget = realLocation(destination);
    guardOverlap(realSource, realTarget);
    if (realTarget !== path.resolve(destination)) throw new Error("同步目标包含符号链接。");
    const owner = path.join(destination, OWNER_FILE);
    if (existsSync(destination)) {
        if (!lstatSync(destination).isDirectory()) throw new Error("同步目标需要专用目录。");
        if (existsSync(owner)) {
            if (
                lstatSync(owner).isSymbolicLink() ||
                readFileSync(owner, "utf8") !== JSON.stringify({ source: realSource })
            )
                throw new Error("同步目标归属其他工程，请配置新的专用 dist 目录。");
        } else if (readdirSync(destination).some((name) => name !== PRIVATE_FILE)) {
            throw new Error("同步目标已有其他文件，请配置空的专用 dist 目录。");
        }
    }
    mkdirSync(destination, { recursive: true });
    try {
        // 归属表示目录所有权；提前落盘支持失败后的安全重试。
        if (!existsSync(owner))
            writeFileSync(owner, JSON.stringify({ source: realSource }), { flag: "wx" });
        run(
            "rsync",
            [
                "-a",
                // 重建会触碰未变的 app.json；不向开发者工具传播纯时间变化。
                "--no-times",
                "--checksum",
                "--delete",
                "--exclude=" + PRIVATE_FILE,
                "--exclude=" + OWNER_FILE,
                "--",
                realSource + "/",
                realTarget + "/",
            ],
            { stdio: "pipe" },
        );
    } catch (error) {
        const reason =
            error instanceof Error && "code" in error && error.code === "ENOENT"
                ? "请安装 rsync。"
                : "请检查目录权限和 rsync 环境。";
        throw new Error("小程序 Windows 产物同步失败，构建已中断；" + reason, { cause: error });
    }
}

/** @returns {import("vite").Plugin | undefined} */
export function createWindowsDistSync({ root = process.cwd(), env = process.env } = {}) {
    const destination = env.TARO_APP_WINDOWS_DIST;
    if (!destination) return undefined;
    const target = validateDestination(root, destination);
    return {
        name: "sync-dist-to-windows",
        apply: "build",
        enforce: "post",
        writeBundle: {
            order: "post",
            sequential: true,
            handler() {
                syncDist(path.join(root, "dist"), target);
            },
        },
    };
}
