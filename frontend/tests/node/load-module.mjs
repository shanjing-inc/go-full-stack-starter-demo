import { readFile } from "node:fs/promises";
import ts from "typescript";

// 保留真实运行时依赖；data URL 中的包导入转换为可解析的绝对 URL。
export async function loadModule(url) {
    const source = await readFile(url, "utf8");
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const module = outputText.replace(
        /from "([^".][^"]*)"/gu,
        (_match, name) => `from "${import.meta.resolve(name)}"`,
    );
    return import(
        `data:text/javascript;base64,${Buffer.from(`${module}\n//# sourceURL=${url.pathname}`).toString("base64")}`
    );
}
