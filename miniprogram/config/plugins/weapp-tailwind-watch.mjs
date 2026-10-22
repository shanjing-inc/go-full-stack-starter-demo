import path from "node:path";

/** 避免 Taro watch 复用已被处理为导入壳的 Tailwind 根样式。 */
export function createWeappTailwindWatch(root = process.cwd()) {
    const entry = path.join(root, "src/app.css");
    return {
        name: "weapp-tailwind-watch",
        shouldTransformCachedModule({ id }) {
            if (id.replace(/[?#].*$/, "") === entry) return true;
        },
    };
}
