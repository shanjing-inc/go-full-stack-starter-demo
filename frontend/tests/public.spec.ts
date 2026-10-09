import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const ssrEmail = process.env.SSR_TEST_EMAIL;
const ssrPassword = process.env.SSR_TEST_PASSWORD;

async function screenshot(page: Page, name: string) {
    const folder = process.env.SSR_SCREENSHOTS;
    if (!folder) return;
    mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}

test("关闭 JavaScript 后首页和队列正文仍可直接访问", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
        const page = await context.newPage();
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        expect(response?.headers()["cache-control"]).toContain("no-store");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            "Go SSR + React Dashboard + GraphQL 示例",
        );
        await expect(page.locator("[data-counter]")).toHaveText("0");
        await page.goto("/test/queue?action=all-success");
        await expect(page.getByRole("heading", { name: "最近执行记录" })).toBeVisible();
        await expect(
            page
                .locator("[data-queue-name=critical]")
                .getByRole("button", { name: "触发成功任务", exact: true }),
        ).toBeDisabled();
        await expect(page.getByRole("link", { name: "前往登录" })).toHaveAttribute(
            "href",
            "/admin/login?returnTo=%2Ftest%2Fqueue",
        );
        await expect(
            page.getByText("登录并取得队列读取权限后显示执行记录。", { exact: true }),
        ).toBeVisible();
    } finally {
        await context.close();
    }
});

test("队列页保留 Node.js 的三按钮卡片、请求结果与刷新布局", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/test/queue");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Asynq 队列派发测试");
    const forms = page.locator("form[data-queue-dispatch]");
    await expect(forms).toHaveCount(3);
    for (const [queue, description] of [
        ["critical", "高优先级任务队列"],
        ["default", "默认优先级任务队列"],
        ["low", "低优先级任务队列"],
    ]) {
        const form = page.locator(`[data-queue-name=${queue}]`);
        await expect(form.getByRole("heading", { name: `派发 ${description}` })).toBeVisible();
        for (const label of ["触发成功任务", "失败一次（可 Retry）", "持续失败"]) {
            await expect(form.getByRole("button", { name: label, exact: true })).toBeVisible();
        }
        await expect(form.getByRole("button", { name: "触发成功任务" })).toHaveClass(
            /bg-primary\/10/,
        );
    }
    await expect(forms.getByRole("button")).toHaveCount(9);
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "网站导航" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "当前请求结果" })).toBeVisible();
    await expect(page.locator("[data-queue-action]")).toHaveText("none");
    await expect(page.locator("[data-queue-mode]")).toHaveText("成功");
    await expect(page.locator("[data-queue-requested-at]")).toHaveText(/\d{4}-\d{2}-\d{2}T/);
    await expect(page.locator("[data-queue-result]")).toContainText("尚未派发任何队列任务。");
    const refresh = page.getByRole("link", { name: "刷新执行状态" });
    await expect(refresh).toHaveClass(/bg-emerald-600/);
    await expect(refresh).toHaveAttribute("data-preserve-scroll", "queue-status-refresh");
    for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole("region", { name: "队列派发" })).toHaveCSS("display", "grid");
        const cards = await forms.evaluateAll((items) =>
            items.map((item) => {
                const { top, left, width } = item.getBoundingClientRect();
                return { top, left, width };
            }),
        );
        expect(new Set(cards.map((card) => card.top)).size).toBe(1);
        expect(cards[1].left).toBeGreaterThan(cards[0].left + cards[0].width);
        expect(cards[2].left).toBeGreaterThan(cards[1].left + cards[1].width);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await screenshot(page, "queue-anonymous-desktop");
    await page.setViewportSize({ width: 900, height: 900 });
    const narrow = await forms.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top),
    );
    expect(narrow[1]).toBeGreaterThan(narrow[0]);
    const theme = page.locator("[data-theme-toggle]");
    await expect(theme).toHaveCSS("width", "36px");
    await expect(theme).toHaveCSS("height", "36px");
    await expect(theme).toHaveText("");
    await expect(theme.locator("svg:not([hidden])")).toHaveCount(1);
    await expect(theme.locator("[data-theme-moon]")).toBeVisible();
    for (const icon of ["sun", "moon"]) {
        await theme.click();
        await expect(theme).toHaveText("");
        await expect(theme.locator("svg:not([hidden])")).toHaveCount(1);
        await expect(theme.locator(`[data-theme-${icon}]`)).toBeVisible();
        await expect(theme.locator(`[data-theme-${icon}]`)).toHaveCSS("width", "16px");
        await expect(theme.locator(`[data-theme-${icon}]`)).toHaveCSS("height", "16px");
    }
});

test("计数器和主题在刷新及公开页之间持久化", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "+1", exact: true }).click();
    await page.getByRole("button", { name: "+1", exact: true }).click();
    await expect(page.locator("[data-counter]")).toHaveText("2");
    await page.reload();
    await expect(page.locator("[data-counter]")).toHaveText("2");
    await page.getByRole("button", { name: "-1", exact: true }).click();
    await expect(page.locator("[data-counter]")).toHaveText("1");
    const dark = await page
        .locator("html")
        .evaluate((element) => element.classList.contains("dark"));
    await page.locator("[data-theme-toggle]").click();
    expect(
        await page.locator("html").evaluate((element) => element.classList.contains("dark")),
    ).toBe(!dark);
    await page.goto("/test/queue");
    expect(
        await page.locator("html").evaluate((element) => element.classList.contains("dark")),
    ).toBe(!dark);
    await page.reload();
    expect(
        await page.locator("html").evaluate((element) => element.classList.contains("dark")),
    ).toBe(!dark);
    await page.goto("/");
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page.locator("[data-counter]")).toHaveText("0");
    await screenshot(page, "home-desktop");
    expect(errors).toEqual([]);
});

test("浏览器存储受限时局部交互继续工作", async ({ page }) => {
    await page.addInitScript(() => {
        Storage.prototype.getItem = () => {
            throw new Error("存储受限");
        };
        Storage.prototype.setItem = () => {
            throw new Error("存储受限");
        };
        Storage.prototype.removeItem = () => {
            throw new Error("存储受限");
        };
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "+1", exact: true }).click();
    await expect(page.locator("[data-counter]")).toHaveText("1");
    await page.locator("[data-theme-toggle]").click();
    expect(errors).toEqual([]);
});

test("移动端公开页面宽度保持在视口内", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/", "/test/queue"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            390,
        );
        await screenshot(page, path === "/" ? "home-mobile" : "queue-mobile");
    }
});

test("真实登录返回 SSR、三队列投递和失败任务人工重试", async ({ page, browser, baseURL }) => {
    test.setTimeout(90_000);
    if (!ssrEmail || !ssrPassword) {
        throw new Error(
            "真实 SSR 登录需要独立测试账号：通过 pnpm verify 创建，或设置 SSR_TEST_EMAIL 和 SSR_TEST_PASSWORD",
        );
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/test/queue");
    await page.getByRole("link", { name: "前往登录" }).click();
    await page.getByLabel("邮箱", { exact: true }).fill(ssrEmail);
    await page.getByLabel("密码", { exact: true }).fill(ssrPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/test\/queue$/);
    await expect(
        page
            .locator("[data-queue-name=critical]")
            .getByRole("button", { name: "触发成功任务", exact: true }),
    ).toBeEnabled();
    const origin = new URL(page.url()).origin;
    async function graphql(query: string, variables?: Record<string, unknown>) {
        const response = await page.request.post("/api/graphql/admin", {
            headers: { Origin: origin },
            data: { query, variables },
        });
        expect(response.status()).toBe(200);
        const payload = await response.json();
        expect(payload.errors).toBeUndefined();
        return payload.data;
    }
    async function waitRecord(id: string, status: string, executionNumber = 1) {
        let found: any;
        await expect
            .poll(
                async () => {
                    const data = await graphql(
                        '{listQueueExecutionRecords(status:"recent",jobName:"demo:queue-test",limit:100){records{id jobId status executionNumber queueName}}}',
                    );
                    found = data.listQueueExecutionRecords.records.find(
                        (row: any) =>
                            row.jobId === id &&
                            row.status === status &&
                            row.executionNumber === executionNumber,
                    );
                    return Boolean(found);
                },
                { timeout: 20_000 },
            )
            .toBe(true);
        return found as { id: string; jobId: string; queueName: string };
    }
    const sent: { id: string; queue: string }[] = [];
    for (const queue of ["critical", "default", "low"]) {
        const form = page.locator(`[data-queue-name=${queue}]`);
        const accepted = page.waitForResponse(
            (response) =>
                response.url().endsWith("/api/rest/demo/queue-test") &&
                response.request().method() === "POST",
        );
        await form.getByRole("button", { name: "触发成功任务", exact: true }).click();
        const response = await accepted;
        expect(response.status()).toBe(202);
        expect(response.request().postDataJSON()).toEqual({ queue, mode: "success" });
        const rows = (await response.json()).results as { id: string; queue: string }[];
        expect(rows).toHaveLength(1);
        expect(rows[0].queue).toBe(queue);
        sent.push(rows[0]);
        expect((await waitRecord(rows[0].id, "completed")).queueName).toBe(queue);
        const card = page.locator(`[data-queue-result-card=${queue}]`);
        await expect(card).toContainText(rows[0].id);
        await expect(card).toContainText("队列任务已写入。");
        await expect(card).toContainText(`queue: ${queue}`);
        await expect(card).toContainText("mode: success");
        await expect(page.locator("[data-queue-action]")).toHaveText(queue);
        await expect(page.locator("[data-queue-mode]")).toHaveText("成功");
    }
    expect(sent.map((row) => row.queue)).toEqual(["critical", "default", "low"]);
    await screenshot(page, "queue-result-desktop");
    await page.getByRole("link", { name: "刷新执行状态" }).click();
    for (const row of sent)
        await expect(page.getByRole("cell", { name: row.id, exact: true })).toBeVisible();
    const html = await page.request.get("/test/queue");
    expect(await html.text()).toContain(sent[0].id);
    const context = await browser.newContext({
        baseURL,
        javaScriptEnabled: false,
        storageState: await page.context().storageState(),
    });
    try {
        const plain = await context.newPage();
        await plain.goto("/test/queue");
        await expect(plain.getByRole("cell", { name: sent[0].id, exact: true })).toBeVisible();
    } finally {
        await context.close();
    }
    for (const mode of ["fail-once", "always-fail"]) {
        const form = page
            .locator("form[data-queue-dispatch]")
            .filter({ has: page.locator('input[value="default"]') });
        const waiting = page.waitForResponse(
            (response) =>
                response.url().endsWith("/api/rest/demo/queue-test") &&
                response.request().method() === "POST",
        );
        await form
            .getByRole("button", {
                name: mode === "fail-once" ? "失败一次（可 Retry）" : "持续失败",
                exact: true,
            })
            .click();
        const result = await waiting;
        expect(result.status()).toBe(202);
        expect(result.request().postDataJSON()).toEqual({ queue: "default", mode });
        await expect(page.locator("[data-queue-mode]")).toHaveText(
            mode === "fail-once" ? "失败一次" : "持续失败",
        );
        await expect(page.locator("[data-queue-result-card=default]")).toContainText(
            `mode: ${mode}`,
        );
        const id = (await result.json()).results[0].id;
        const failed = await waitRecord(id, "failed");
        // 执行记录先落库，等待 Asynq 原任务完成归档后再进行人工重试。
        await expect
            .poll(
                async () => {
                    const detail = await graphql(
                        'query($id:String!){getQueueExecutionRecord(recordId:$id,statusHint:"failed"){canRetry}}',
                        { id: failed.id },
                    );
                    return detail.getQueueExecutionRecord.canRetry;
                },
                { timeout: 10_000 },
            )
            .toBe(true);
        await graphql(
            'mutation($id:String!){updateQueueExecutionRecord(set:{recordId:$id,statusHint:"failed"}){noticeMessage detail{id}}}',
            { id: failed.id },
        );
        await waitRecord(id, mode === "fail-once" ? "completed" : "failed", 2);
    }
    await page.getByRole("link", { name: "刷新执行状态" }).click();
    await screenshot(page, "queue-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
    );
    const records = page.getByRole("region", { name: "最近执行记录表格" });
    expect(await records.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true,
    );
    const rowHeights = await records
        .locator("tbody tr")
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(rowHeights.length).toBeGreaterThan(0);
    expect(Math.max(...rowHeights)).toBeLessThanOrEqual(160);
    await screenshot(page, "queue-records-mobile");
    const headers = records.getByRole("columnheader");
    await expect(headers).toHaveText([
        "queue",
        "job id",
        "mode",
        "status",
        "attempt",
        "requestedAt",
        "processedAt",
        "error",
    ]);
    const unsafeText = "<img src=x onerror=alert(1)>";
    await page.route("**/api/rest/demo/queue-test", (route) =>
        route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ message: unsafeText }),
        }),
    );
    const success = page
        .locator("[data-queue-name=default]")
        .getByRole("button", { name: "触发成功任务", exact: true });
    await success.click();
    await expect(page.locator("[data-queue-result] [role=alert]")).toHaveText(unsafeText);
    await expect(page.locator("[data-queue-result] img")).toHaveCount(0);
    await expect(success).toBeEnabled();
    await page.unroute("**/api/rest/demo/queue-test");
    expect(errors).toEqual([]);
});
