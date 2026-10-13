import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const email = process.env.BUS_TEST_EMAIL;
const password = process.env.BUS_TEST_PASSWORD;
const peer = process.env.BUS_PEER_ORIGIN;
async function queryTab(page: Page) {
    await page.getByRole("tab", { name: "02 · REST + SSE + WebSocket" }).click();
}
async function device(page: Page) {
    await queryTab(page);
    await page.getByRole("button", { name: "连接设备", exact: true }).click();
    await expect(page.locator("[data-device-status]")).toHaveText("设备已就绪，等待查询");
}

test("Bus 公开正文支持无 JavaScript、匿名操作门禁与 HEAD", async ({
    browser,
    baseURL,
    request,
}) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
        const page = await context.newPage();
        const response = await page.goto("/test/bus");
        expect(response?.status()).toBe(200);
        expect(response?.headers()["cache-control"]).toContain("no-store");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bus 消息总线演示");
        await expect(page.getByRole("heading", { name: "发布消息，实时接收" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "设备查询，逐条返回结果" })).toBeVisible();
        await expect(
            page.getByRole("button", { name: "连接 Bus WebSocket", exact: true }),
        ).toBeDisabled();
        await expect(page.getByRole("button", { name: "发送查询", exact: true })).toBeDisabled();
        await expect(page.getByRole("link", { name: "前往登录" })).toHaveAttribute(
            "href",
            "/admin/login?returnTo=%2Ftest%2Fbus",
        );
        const head = await request.head("/test/bus");
        expect(head.status()).toBe(200);
        expect(await head.body()).toHaveLength(0);
    } finally {
        await context.close();
    }
});

test.describe("Bus 登录后的真实 Redis 与浏览器链路", () => {
    test.skip(!email || !password, "需要隔离 Bus 验收账号 BUS_TEST_EMAIL / BUS_TEST_PASSWORD");
    let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
    test.beforeAll(async ({ request, baseURL }) => {
        const response = await request.post("/api/auth/sign-in/email", {
            headers: { Origin: baseURL! },
            data: { email, password },
        });
        expect(response.status()).toBe(200);
        cookies = (await request.storageState()).cookies;
    });
    test.beforeEach(async ({ context }) => {
        await context.addCookies(cookies);
    });

    test("参考布局：下划线 Tab、内嵌日志及桌面／移动端明暗主题", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 960 });
        await page.goto("/test/bus");
        await page.evaluate(() => document.fonts.ready);
        expect(
            await page.locator("body").evaluate((body) => getComputedStyle(body).fontFamily),
        ).toContain("Bus Inter");
        const selected = page.getByRole("tab", { name: "01 · REST + WebSocket" });
        const styles = await selected.evaluate((tab) => {
            const css = getComputedStyle(tab);
            return {
                border: css.borderBottomWidth,
                radius: css.borderRadius,
                background: css.backgroundColor,
            };
        });
        expect(styles).toEqual({ border: "2px", radius: "0px", background: "rgba(0, 0, 0, 0)" });
        await expect(page.getByLabel("发布内容")).toHaveJSProperty("tagName", "INPUT");
        const publisher = await page
            .locator("#bus-broadcast-workbench > .grid > div")
            .first()
            .boundingBox();
        const receiver = await page
            .locator("#bus-broadcast-workbench > .grid > div")
            .last()
            .boundingBox();
        expect(publisher!.y).toBe(receiver!.y);
        expect(receiver!.x - publisher!.x - publisher!.width).toBeCloseTo(20, 0);
        await expect(page.locator("#broadcast-topic-flow > ol > li")).toHaveCount(3);
        const screenshot = async (suffix: string) => {
            if (process.env.BUS_SCREENSHOT)
                await page.screenshot({
                    path: process.env.BUS_SCREENSHOT.replace("-mobile.png", `-${suffix}.png`),
                    fullPage: true,
                });
        };
        // 可选的源码静态参考由验收环境提供，保持常规浏览器测试独立运行。
        const reference = process.env.BUS_REFERENCE_URL
            ? await page.context().newPage()
            : undefined;
        if (reference) await reference.goto(process.env.BUS_REFERENCE_URL!);
        const compareReference = async (scene: "broadcast" | "query", dark: boolean) => {
            if (!reference) return;
            await reference.setViewportSize(page.viewportSize()!);
            await reference.evaluate(
                (value) => document.documentElement.classList.toggle("dark", value),
                dark,
            );
            await reference
                .getByRole("tab", {
                    name:
                        scene === "broadcast"
                            ? "01 · REST + WebSocket"
                            : "02 · REST + SSE + WebSocket",
                })
                .click();
            await reference.evaluate(() => document.fonts.ready);
            const selectors =
                scene === "broadcast"
                    ? [
                          "h1",
                          "#broadcast-tab",
                          "#bus-broadcast-workbench > .grid > div",
                          "#broadcast-toggle",
                          "#broadcast-form",
                          "#broadcast-topic-flow > ol > li",
                      ]
                    : [
                          "h1",
                          "#bus-query-tab",
                          "#device-heading",
                          "#query-heading",
                          "#device-toggle",
                          "#query-submit",
                          "#query-topic-flow > ol > li",
                      ];
            for (const selector of selectors) {
                const measure = (node: Element) => {
                    const css = getComputedStyle(node);
                    const box = node.getBoundingClientRect();
                    return {
                        width: box.width,
                        height: box.height,
                        color: css.color,
                        background: css.backgroundColor,
                        border: css.borderColor,
                        radius: css.borderRadius,
                        padding: css.padding,
                        fontSize: css.fontSize,
                        fontWeight: css.fontWeight,
                        lineHeight: css.lineHeight,
                    };
                };
                expect(await page.locator(selector).first().evaluate(measure), selector).toEqual(
                    await reference.locator(selector).first().evaluate(measure),
                );
            }
            if (process.env.BUS_SCREENSHOT)
                await reference.screenshot({
                    path: process.env.BUS_SCREENSHOT.replace(
                        "-mobile.png",
                        `-reference-${scene}-${page.viewportSize()!.width}-${dark ? "dark" : "light"}.png`,
                    ),
                    fullPage: true,
                });
        };
        await compareReference("broadcast", false);
        await screenshot("broadcast-desktop-light");
        await queryTab(page);
        await expect(
            page.locator("[aria-labelledby=device-heading] [data-device-log]"),
        ).toHaveCount(1);
        await expect(page.locator("[aria-labelledby=query-heading] [data-query-log]")).toHaveCount(
            1,
        );
        await expect(page.locator("#query-topic-flow > ol > li")).toHaveCount(4);
        await screenshot("query-desktop-light");
        await compareReference("query", false);
        await page.locator("[data-theme-toggle]").click();
        await expect(page.locator("html")).toHaveClass(/dark/);
        await screenshot("query-desktop-dark");
        await compareReference("query", true);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const deviceCard = await page.locator("[aria-labelledby=device-heading]").boundingBox();
        const queryCard = await page.locator("[aria-labelledby=query-heading]").boundingBox();
        expect(deviceCard!.x).toBe(queryCard!.x);
        expect(queryCard!.y).toBeGreaterThan(deviceCard!.y + deviceCard!.height);
        await screenshot("query-mobile-dark");
        await compareReference("query", true);
        await page.locator("[data-theme-toggle]").click();
        await expect(page.locator("html")).not.toHaveClass(/dark/);
        await screenshot("query-mobile-light");
        await compareReference("query", false);
        await reference?.close();
    });

    test("广播多标签接收、文本安全、响应式与暗色主题", async ({ page, context }) => {
        const second = await context.newPage();
        try {
            for (const tab of [page, second]) {
                await tab.goto("/test/bus");
                await tab.getByRole("button", { name: "连接 Bus WebSocket", exact: true }).click();
                await expect(tab.locator("[data-broadcast-status]")).toHaveText("广播订阅已就绪");
            }
            const message = `广播 <img src=x onerror=alert(1)> ${Date.now()}`;
            await page.getByLabel("发布内容").fill(message);
            await page.getByRole("button", { name: "发布到 Bus", exact: true }).click();
            for (const tab of [page, second]) {
                await expect(tab.locator("[data-broadcast-log]")).toContainText(message);
                await expect(tab.locator("[data-broadcast-log] img")).toHaveCount(0);
            }
            await expect(page.locator("[data-broadcast-feedback]")).toContainText("发布成功");
            await page.locator("[data-theme-toggle]").click();
            await expect(page.locator("html")).toHaveClass(/dark/);
            await page.setViewportSize({ width: 390, height: 844 });
            expect(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= window.innerWidth,
                ),
            ).toBe(true);
            await expect(
                page.getByRole("button", { name: "发布到 Bus", exact: true }),
            ).toBeVisible();
            if (process.env.BUS_SCREENSHOT)
                await page.screenshot({ path: process.env.BUS_SCREENSHOT, fullPage: true });
        } finally {
            await second.close();
        }
    });

    test("并发查询独立关联、逐条回执与设备错误", async ({ page }) => {
        await page.goto("/test/bus");
        await device(page);
        for (const content of ["第一笔设备状态", "第二笔设备状态"]) {
            await page.getByLabel("查询内容", { exact: true }).fill(content);
            await page.getByRole("button", { name: "发送查询", exact: true }).click();
        }
        await expect(page.locator("[data-query-status]")).toHaveCount(2);
        await expect(page.locator("[data-query-status]").nth(0)).toContainText("查询完成");
        await expect(page.locator("[data-query-status]").nth(1)).toContainText("查询完成");
        const ids = await page
            .locator("[data-request-id]")
            .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.requestId));
        expect(new Set(ids).size).toBe(2);
        for (const row of await page.locator("[data-request-id]").all()) {
            await expect(row).toContainText("responseKey:");
            expect(await row.locator("[data-result-index]").count()).toBeGreaterThanOrEqual(1);
        }
        await page.getByLabel("回执模式").selectOption("error");
        await page.getByRole("button", { name: "发送查询", exact: true }).click();
        await expect(page.locator("[data-query-status]").first()).toContainText("DEVICE_ERROR");
        await expect(
            page.locator("[data-request-id]").first().getByRole("button", { name: "取消查询" }),
        ).toBeDisabled();
    });

    test("设备离线、单笔取消、超时与清空收敛", async ({ page }) => {
        await page.goto("/test/bus");
        await queryTab(page);
        await page.getByLabel("查询内容", { exact: true }).fill("查询设备状态");
        await page.getByRole("button", { name: "发送查询", exact: true }).click();
        await expect(page.locator("[data-query-status]").first()).toContainText("DEVICE_OFFLINE");
        await device(page);
        await page.getByLabel("回执模式").selectOption("timeout");
        await page.getByRole("button", { name: "发送查询", exact: true }).click();
        await expect(page.locator("[data-query-status]").first()).toContainText("等待设备回执");
        await page
            .locator("[data-request-id]")
            .first()
            .getByRole("button", { name: "取消查询" })
            .click();
        await expect(page.locator("[data-query-status]").first()).toHaveText("查询已取消");
        await page.getByRole("button", { name: "发送查询", exact: true }).click();
        await expect(page.locator("[data-query-status]").first()).toContainText("QUERY_TIMEOUT", {
            timeout: 8000,
        });
        await page.getByRole("button", { name: "清空并取消查询" }).click();
        await expect(
            page.locator("#query-history").locator("..").locator("[data-log-empty]"),
        ).toContainText("已清空");
        await expect(page.locator("[data-request-id]")).toHaveCount(0);
    });

    test("跨 Web 实例查询回执通过 Redis 返回", async ({ page, context }) => {
        test.skip(!peer, "需要第二个隔离 Web 实例 BUS_PEER_ORIGIN");
        const second = await context.newPage();
        try {
            await page.goto("/test/bus");
            await device(page);
            await second.goto(`${peer}/test/bus`);
            await queryTab(second);
            await second.getByLabel("查询内容", { exact: true }).fill("跨实例设备查询");
            await second.getByRole("button", { name: "发送查询", exact: true }).click();
            await expect(second.locator("[data-query-status]")).toContainText("查询完成");
            await expect(page.locator("[data-device-log]")).toContainText("跨实例设备查询");
        } finally {
            await second.close();
        }
    });

    test("登录入口回跳到 Bus 公开页", async ({ browser, baseURL }) => {
        const context = await browser.newContext({ baseURL });
        try {
            const page = await context.newPage();
            await page.goto("/admin/login?returnTo=%2Ftest%2Fbus");
            await page.getByLabel("邮箱", { exact: true }).fill(email!);
            await page.getByLabel("密码", { exact: true }).fill(password!);
            await page.getByRole("button", { name: "登录", exact: true }).click();
            await expect(page).toHaveURL(`${baseURL}/test/bus`);
            await expect(
                page.getByRole("button", { name: "连接 Bus WebSocket", exact: true }),
            ).toBeEnabled();
        } finally {
            await context.close();
        }
    });
});
