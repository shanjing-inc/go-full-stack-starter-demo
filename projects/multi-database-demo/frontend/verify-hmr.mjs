import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cache = join(homedir(), ".cache/ms-playwright");
let executablePath = process.env.CHROMIUM_PATH;
if (!executablePath && existsSync(cache)) {
    for (const dir of readdirSync(cache)
        .filter((name) => name.startsWith("chromium_headless_shell-"))
        .sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)))) {
        const path = join(cache, dir, "chrome-headless-shell-linux64/chrome-headless-shell");
        if (existsSync(path)) {
            executablePath = path;
            break;
        }
    }
}
const source = new URL("../../../packages/shadcnui-dashboard/src/dashboard.tsx", import.meta.url);
const original = await readFile(source, "utf8");
const marker = "HMR 公共 Dashboard 已更新";
const replacement = original.replace(
    '<Link to="/">{title}</Link>',
    '<Link to="/">{title} · ' + marker + "</Link>",
);
if (replacement === original) throw new Error("公共 Dashboard HMR 验证锚点缺失");
const browser = await chromium.launch({ executablePath, headless: true });
try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_ORIGIN + "/admin/");
    await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
    await page.getByLabel("密码", { exact: true }).fill("owner-password-2026");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByText("验收管理员", { exact: true }).waitFor();
    // 窗口标记可区分源码热更新与整页刷新。
    await page.evaluate(() => {
        window.__hmrSentinel = "kept";
    });
    await writeFile(source, replacement);
    const breadcrumb = page.getByRole("navigation", { name: "面包屑", exact: true });
    await breadcrumb
        .getByRole("link", { name: "Multi Database Demo · " + marker, exact: true })
        .waitFor();
    if ((await page.evaluate(() => window.__hmrSentinel)) !== "kept")
        throw new Error("公共包源码变更触发了整页刷新");
    await writeFile(source, original);
    await breadcrumb.getByRole("link", { name: "Multi Database Demo", exact: true }).waitFor();
    console.log(JSON.stringify({ status: "passed", publicDashboardHMR: true, pageReload: false }));
} finally {
    await writeFile(source, original);
    await browser.close();
}
