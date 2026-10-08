import { signOutFromSidebar } from "./sidebar-helpers.js";
import { test, expect, type Page } from "@playwright/test";

async function mockSession(page: Page) {
    const state = {
        identities: 0,
        restSessions: 0,
        users: 0,
        shops: 0,
        installChecks: 0,
        identityStatus: 200,
        identityProxyError: false,
        identityNull: false,
        permissions: ["user:list", "demo:read"],
        businessStatus: 200,
        businessCode: "",
        businessHTML: false,
        identityCode: "",
        slowUsers: false,
        logoutStatus: 200,
    };
    page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path === "/api/rest/demo/session") state.restSessions++;
        if (path === "/api/auth/install-status") state.installChecks++;
        if (path === "/api/graphql/admin") {
            const query = request.postDataJSON().query;
            if (query.includes("getDashboardSession")) state.identities++;
            if (query.includes("listUsers")) state.users++;
            if (query.includes("listAdminShops")) state.shops++;
        }
    });
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/install-status") {
            await route.fulfill({ json: { installed: true, enabled: false } });
            return;
        }
        if (path === "/api/auth/sign-in/email") {
            state.identityStatus = 200;
            await route.fulfill({ json: { success: true } });
            return;
        }
        if (path === "/api/auth/sign-out") {
            await route.fulfill({
                status: state.logoutStatus,
                json: { success: state.logoutStatus === 200 },
            });
            return;
        }
        const query = path === "/api/graphql/admin" ? route.request().postDataJSON().query : "";
        if (query.includes("getDashboardSession")) {
            if (state.identityProxyError) {
                await route.fulfill({ status: 502, contentType: "text/plain", body: "" });
                return;
            }
            if (state.identityStatus !== 200 || state.identityCode) {
                await route.fulfill({
                    status: state.identityStatus,
                    json:
                        state.identityStatus === 200
                            ? {
                                  errors: [
                                      {
                                          message: "身份认证失败",
                                          extensions: { code: state.identityCode },
                                      },
                                  ],
                              }
                            : {
                                  code:
                                      state.identityStatus === 401
                                          ? "UNAUTHORIZED"
                                          : state.identityStatus === 403
                                            ? "FORBIDDEN"
                                            : "SERVICE_UNAVAILABLE",
                                  message: "身份服务错误",
                              },
                });
            } else
                await route.fulfill({
                    json: {
                        data: {
                            getCurrentUser: state.identityNull
                                ? null
                                : {
                                      id: "1",
                                      name: "会话验收管理员",
                                      email: "session@example.test",
                                      image: null,
                                  },
                            getCurrentPermissions: state.permissions,
                        },
                    },
                });
            return;
        }
        if (state.businessStatus !== 200 || state.businessCode) {
            if (state.businessHTML)
                await route.fulfill({
                    status: state.businessStatus,
                    contentType: "text/html",
                    body: "<h1>代理错误</h1>",
                });
            else
                await route.fulfill({
                    status: state.businessStatus,
                    json:
                        state.businessStatus === 200
                            ? {
                                  errors: [
                                      {
                                          message: "业务认证失败",
                                          extensions: { code: state.businessCode },
                                      },
                                  ],
                              }
                            : {
                                  code:
                                      state.businessCode ||
                                      (state.businessStatus === 401
                                          ? "UNAUTHORIZED"
                                          : state.businessStatus === 403
                                            ? "FORBIDDEN"
                                            : "SERVICE_UNAVAILABLE"),
                                  message: "业务请求错误",
                              },
                });
            return;
        }
        if (query.includes("listUsers")) {
            if (state.slowUsers) await new Promise((resolve) => setTimeout(resolve, 500));
            await route.fulfill({
                json: {
                    data: {
                        listUsers: [
                            {
                                id: "2",
                                name: "会话验收用户",
                                email: "row@example.test",
                                role: "admin",
                                image: null,
                                emailVerified: true,
                                banned: false,
                                banReason: null,
                                banExpires: null,
                                createdAt: null,
                                updatedAt: null,
                            },
                        ],
                    },
                },
            });
        } else if (query.includes("listAdminShops")) {
            await route.fulfill({ json: { data: { listShops: [] } } });
        } else if (path === "/api/rest/demo/overview") {
            await route.fulfill({ json: { shops: 1, backend: "会话验收后端" } });
        } else throw new Error(`意外请求 ${path} ${query}`);
    });
    return state;
}
async function ready(page: Page, path = "/admin/users") {
    await page.goto(path);
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    if (path.includes("users"))
        await expect(page.getByText("row@example.test", { exact: true })).toBeVisible();
}

test("StrictMode 初次身份一次 GraphQL，切页复用守卫和侧栏会话", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    expect(state.identities).toBe(1);
    expect(state.users).toBe(1);
    for (const name of ["店铺列表", "系统概览", "用户列表"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByText("row@example.test", { exact: true })).toBeVisible();
    expect(state.identities).toBe(1);
    expect(state.restSessions).toBe(0);
});

for (const failure of [
    { name: "HTTP 401", status: 401, code: "", html: false },
    { name: "非 JSON HTTP 401", status: 401, code: "", html: true },
    { name: "GraphQL UNAUTHENTICATED", status: 200, code: "UNAUTHENTICATED", html: false },
    { name: "GraphQL UNAUTHORIZED", status: 200, code: "UNAUTHORIZED", html: false },
])
    test(`${failure.name} 清理会话并保存当前筛选地址`, async ({ page }) => {
        const state = await mockSession(page);
        await ready(page, "/admin/users?email=row#results");
        Object.assign(state, {
            businessStatus: failure.status,
            businessCode: failure.code,
            businessHTML: failure.html,
        });
        await page.getByRole("button", { name: "刷新", exact: true }).click();
        await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
        const url = new URL(page.url());
        expect(url.pathname).toBe("/admin/login");
        expect(url.searchParams.get("returnTo")).toBe("/admin/users?email=row#results");
        expect(state.identities).toBe(1);
    });

test("概览 REST 401 使用统一登录失效边界", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    state.businessStatus = 401;
    await page.getByRole("button", { name: "系统概览", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login\?returnTo=/);
});

test("403 复核有效权限并同步菜单与用户页", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    state.businessStatus = 403;
    state.permissions = ["demo:read"];
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("403");
    await expect(page.getByRole("button", { name: "用户列表", exact: true })).toHaveCount(0);
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/admin/users");
    expect(state.identities).toBe(2);
});

test("封禁账号清理后台并显示明确提示", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    state.businessStatus = 403;
    state.businessCode = "USER_BANNED";
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("封禁");
    await expect(page.getByText("会话验收管理员", { exact: true })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/admin/users");
});

for (const failure of ["HTTP 401", "GraphQL UNAUTHENTICATED", "空用户"])
    test(`首次${failure} 返回登录页`, async ({ page }) => {
        const state = await mockSession(page);
        if (failure === "HTTP 401") state.identityStatus = 401;
        if (failure === "GraphQL UNAUTHENTICATED") state.identityCode = "UNAUTHENTICATED";
        if (failure === "空用户") state.identityNull = true;
        await page.goto("/admin/users");
        await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
        expect(state.users).toBe(0);
        expect(state.identities).toBe(1);
    });

test("后台访问 403 保持权限错误且支持退出", async ({ page }) => {
    const state = await mockSession(page);
    state.identityStatus = 403;
    await page.goto("/admin/users");
    await expect(page.getByRole("alert")).toContainText("身份服务错误");
    expect(new URL(page.url()).pathname).toBe("/admin/users");
    expect(state.users).toBe(0);
    state.logoutStatus = 503;
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByText("退出失败，请重试", { exact: true })).toBeVisible();
});

test("身份 503 可重试，恢复后加载业务数据", async ({ page }) => {
    const state = await mockSession(page);
    state.identityStatus = 503;
    await page.goto("/admin/users");
    await expect(page.getByRole("alert")).toContainText("会话服务暂时不可用");
    expect(state.users).toBe(0);
    state.identityStatus = 200;
    await page.getByRole("button", { name: "重试会话", exact: true }).click();
    await expect(page.getByText("row@example.test", { exact: true })).toBeVisible();
    expect(state.identities).toBe(2);
});

test("启动代理 502 可重试，Web 恢复后加载会话与业务数据", async ({ page }) => {
    const state = await mockSession(page);
    state.identityProxyError = true;
    await page.goto("/admin/users");
    await expect(page.getByRole("alert")).toContainText("会话服务暂时不可用：请求失败 502");
    expect(state.users).toBe(0);
    expect(state.identities).toBe(1);
    state.identityProxyError = false;
    await page.getByRole("button", { name: "重试会话", exact: true }).click();
    await expect(page.getByText("row@example.test", { exact: true })).toBeVisible();
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(state.identities).toBe(2);
});

test("恢复焦点按 60 秒有效期合并复核，背景 503 保留当前身份", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(state.identities).toBe(1);
    state.identityStatus = 503;
    await page.evaluate(() => {
        const now = Date.now() + 61_000;
        Date.now = () => now;
        for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("alert")).toContainText("会话服务暂时不可用");
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    await expect(page.getByText("row@example.test", { exact: true })).toBeVisible();
    expect(state.identities).toBe(2);
    state.identityStatus = 200;
    await page.getByRole("button", { name: "重试会话", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
});

test("业务 503 保留会话并展示页面错误", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    state.businessStatus = 503;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("业务请求错误");
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    expect(state.identities).toBe(1);
});

test("会话失效取消慢查询且统一跳转一次", async ({ page }) => {
    const state = await mockSession(page);
    state.slowUsers = true;
    const failed: string[] = [];
    page.on("requestfailed", (request) => {
        if (request.postData()?.includes("listUsers")) failed.push(request.url());
    });
    await page.goto("/admin/users");
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    await expect.poll(() => state.users).toBe(1);
    state.identityStatus = 401;
    await page.evaluate(() => {
        const now = Date.now() + 61_000;
        Date.now = () => now;
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
    await expect.poll(() => failed.length).toBe(1);
    await page.waitForTimeout(600);
    await expect(page.getByText("row@example.test", { exact: true })).toHaveCount(0);
    expect(state.identities).toBe(2);
    // 登录页的 StrictMode 安装状态请求沿用既有行为；身份失效导航只提交一次。
    expect(state.installChecks).toBeLessThanOrEqual(2);
});

for (const returnTo of [
    "/admin/users?email=row#results",
    "https://evil.example/admin/users",
    "//evil.example/admin/users",
    "/admin/../outside",
    "/admin/login",
    "/admin/install",
    "/admin//evil.example",
    "/admin/%2f%2fevil.example",
    "/admin/%6cogin",
])
    test(`登录安全回跳 ${returnTo}`, async ({ page }) => {
        await mockSession(page);
        await page.goto(`/admin/login?returnTo=${encodeURIComponent(returnTo)}`);
        await page.getByLabel("邮箱", { exact: true }).fill("session@example.test");
        await page.getByLabel("密码", { exact: true }).fill("session-password-2026");
        await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
        await page.getByRole("button", { name: "登录", exact: true }).click();
        await expect(page).toHaveURL(
            returnTo === "/admin/users?email=row#results"
                ? /\/admin\/users\?email=row#results$/
                : /\/admin\/?$/,
        );
        await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    });

test("退出失败保留会话，成功后清理后台", async ({ page }) => {
    const state = await mockSession(page);
    await ready(page);
    state.logoutStatus = 503;
    await signOutFromSidebar(page);
    await expect(page.getByRole("alert")).toContainText("退出失败");
    await expect(page.getByText("会话验收管理员", { exact: true })).toBeVisible();
    state.logoutStatus = 200;
    await signOutFromSidebar(page);
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
});

for (const appearance of [
    {
        name: "桌面浅色",
        width: 1280,
        height: 800,
        colorScheme: "light",
        reducedMotion: "no-preference",
    },
    {
        name: "移动端深色静态",
        width: 375,
        height: 667,
        colorScheme: "dark",
        reducedMotion: "reduce",
    },
] as const)
    test(`会话加载居中布局与权限门禁：${appearance.name}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: appearance.width, height: appearance.height });
        await page.emulateMedia({
            colorScheme: appearance.colorScheme,
            reducedMotion: appearance.reducedMotion,
        });
        const state = await mockSession(page);
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route("**/api/graphql/admin", async (route) => {
            if (route.request().postDataJSON().query.includes("getDashboardSession")) await pending;
            await route.fallback();
        });
        try {
            await page.goto("/admin/users");
            if (appearance.colorScheme === "dark")
                await page.evaluate(() => document.documentElement.classList.add("dark"));
            const loading = page.locator('[data-slot="session-loading"]');
            await expect(loading.getByRole("status")).toContainText("会话加载中");
            await expect(loading.locator('[data-slot="skeleton"]')).toHaveCount(3);
            const content = loading.locator(":scope > div");
            const bounds = await content.boundingBox();
            expect(bounds).not.toBeNull();
            expect(Math.abs(bounds!.x + bounds!.width / 2 - appearance.width / 2)).toBeLessThan(1);
            expect(Math.abs(bounds!.y + bounds!.height / 2 - appearance.height / 2)).toBeLessThan(
                1,
            );
            for (const block of await loading.locator("div").all()) {
                const style = await block.evaluate((element) => {
                    const computed = getComputedStyle(element);
                    return {
                        border: [
                            computed.borderTopWidth,
                            computed.borderRightWidth,
                            computed.borderBottomWidth,
                            computed.borderLeftWidth,
                        ],
                        shadow: computed.boxShadow,
                    };
                });
                expect(style.border).toEqual(["0px", "0px", "0px", "0px"]);
                expect(style.shadow).toBe("none");
            }
            await expect(page.getByRole("table")).toHaveCount(0);
            expect(state.users).toBe(0);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(appearance.width);
            if (appearance.reducedMotion === "reduce") {
                for (const decoration of await loading.locator('svg, [data-slot="skeleton"]').all())
                    expect(
                        await decoration.evaluate(
                            (element) => getComputedStyle(element).animationName,
                        ),
                    ).toBe("none");
            }
            await page.screenshot({
                path: testInfo.outputPath("session-loading.png"),
                fullPage: true,
            });
        } finally {
            release();
        }
        await expect(page.locator('[data-slot="session-loading"]')).toHaveCount(0);
        await expect(page.getByRole("table")).toBeVisible();
        await expect.poll(() => state.users).toBeGreaterThan(0);
    });
