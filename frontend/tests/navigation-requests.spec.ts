import { test, expect, type Page } from "@playwright/test";

// 网络计数包含取消请求；全部接口由当前浏览器 mock，保留开发账号与数据库。
async function mockNavigation(page: Page) {
    const state = {
        session: 0,
        shops: 0,
        users: 0,
        overview: 0,
        created: 0,
        authenticated: true,
        userQueries: [] as { where: { email?: { like: string } }; offset: number; limit: number }[],
        shopQueries: [] as { where: { slug?: { like: string } }; offset: number }[],
    };
    page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (
            path === "/api/graphql/admin" &&
            request.postDataJSON()?.query.includes("getDashboardSession")
        )
            state.session += 1;
        if (path === "/api/rest/demo/overview") state.overview += 1;
        if (
            path === "/api/graphql/admin" &&
            request.postDataJSON()?.query.includes("listAdminShops")
        ) {
            state.shops += 1;
            state.shopQueries.push(request.postDataJSON().variables);
        }
        if (path === "/api/graphql/admin" && request.postDataJSON()?.query.includes("listUsers")) {
            state.users += 1;
            state.userQueries.push(request.postDataJSON().variables);
        }
    });
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/rest/demo/overview") {
            await route.fulfill({ json: { shops: 1, backend: "导航验收后端" } });
        } else if (path === "/api/graphql/admin") {
            const { query } = route.request().postDataJSON();
            if (!state.authenticated) {
                await route.fulfill({
                    status: 401,
                    json: { code: "UNAUTHORIZED", message: "会话已过期" },
                });
                return;
            }
            if (query.includes("getDashboardSession")) {
                await route.fulfill({
                    json: {
                        data: {
                            getCurrentUser: {
                                id: "1",
                                name: "导航验收管理员",
                                email: "owner@example.test",
                                image: null,
                            },
                            getCurrentPermissions: ["demo:read", "user:list", "shop:create"],
                        },
                    },
                });
                return;
            }
            if (query.includes("createShop")) {
                state.created += 1;
                await route.fulfill({ json: { data: { createShop: { id: "2" } } } });
                return;
            }
            if (query.includes("listUsers")) {
                const { offset, limit } = route.request().postDataJSON().variables;
                await route.fulfill({
                    json: {
                        data: {
                            listUsers: Array.from(
                                { length: Math.min(limit, 25 - offset) },
                                (_, i) => ({
                                    id: String(offset + i + 1),
                                    name: `导航验收用户 ${state.users}-${i + 1}`,
                                    email: `user${offset + i + 1}@example.test`,
                                    role: "admin",
                                    image: null,
                                    emailVerified: true,
                                    banned: false,
                                    banReason: null,
                                    banExpires: null,
                                    createdAt: null,
                                    updatedAt: null,
                                }),
                            ),
                        },
                    },
                });
                return;
            }
            expect(query).toContain("listAdminShops");
            await route.fulfill({
                json: {
                    data: {
                        listShops: [
                            {
                                id: "1",
                                name: `导航验收店铺 ${state.shops}`,
                                slug: "navigation-shop",
                                status: "active",
                                createdAt: null,
                                updatedAt: null,
                            },
                        ],
                    },
                },
            });
        } else if (path === "/api/auth/install-status") {
            await route.fulfill({ json: { installed: true, enabled: false } });
        } else {
            throw new Error(`意外请求 ${path}`);
        }
    });
    return state;
}

// 每轮返回独立名称，等待本轮查询渲染完成后统计，覆盖路由 transition 的异步提交。
async function expectShopResult(page: Page, queryNumber: number) {
    await expect(
        page.getByRole("cell", { name: `导航验收店铺 ${queryNumber}`, exact: true }),
    ).toBeVisible();
}

test("侧栏进入店铺发起一次列表查询且复用会话", async ({ page }) => {
    const state = await mockNavigation(page);
    await page.goto("/admin/");
    await expect(page.getByText("导航验收后端", { exact: true })).toBeVisible();
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    const before = { ...state };
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expectShopResult(page, before.shops + 1);
    expect(state.shops - before.shops).toBe(1);
    expect(state.session - before.session).toBe(0);
    await page.getByRole("button", { name: "系统概览", exact: true }).click();
    await expect(page.getByText("导航验收后端", { exact: true })).toBeVisible();
    const again = { ...state };
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expectShopResult(page, again.shops + 1);
    expect(state.shops - again.shops).toBe(1);
    expect(state.session - again.session).toBe(0);
});

test("店铺筛选与刷新各查询一次，当前路由保持会话", async ({ page }) => {
    const state = await mockNavigation(page);
    await page.goto("/admin/shops");
    await expect(page.getByRole("cell", { name: "navigation-shop", exact: true })).toBeVisible();
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    const before = { ...state };
    await page.getByRole("textbox", { name: "标识筛选", exact: true }).fill("navigation");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page).toHaveURL(/slug=navigation/);
    await expectShopResult(page, before.shops + 1);
    expect(state.shops - before.shops).toBe(1);
    expect(state.session - before.session).toBe(0);
    const refreshed = state.shops;
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await expectShopResult(page, refreshed + 1);
    expect(state.shops - refreshed).toBe(1);
    const sameFilter = state.shops;
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expectShopResult(page, sameFilter + 1);
    expect(state.shops - sameFilter).toBe(1);
    const reset = state.shops;
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/shops$/);
    await expectShopResult(page, reset + 1);
    expect(state.shops - reset).toBe(1);
    expect(state.shopQueries.at(-1)?.where).toEqual({});
    expect(state.session - before.session).toBe(0);
});

test("侧栏切换继续校验失效会话并跳转登录", async ({ page }) => {
    const state = await mockNavigation(page);
    await page.goto("/admin/");
    await expect(page.getByText("导航验收后端", { exact: true })).toBeVisible();
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    const before = state.session;
    state.authenticated = false;
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login\?returnTo=/);
    await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
    expect(state.session - before).toBe(0);
});

test("创建后清除筛选与当前页刷新均查询一次", async ({ page }) => {
    const state = await mockNavigation(page);
    await page.goto("/admin/shops?slug=navigation");
    await expect(page.getByRole("cell", { name: "navigation-shop", exact: true })).toBeVisible();
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    for (const slug of ["created-filtered", "created-current"]) {
        const before = { ...state };
        await page.getByRole("button", { name: "创建店铺", exact: true }).click();
        await page.getByLabel("名称", { exact: true }).fill("导航验收新店铺");
        await page.getByLabel("唯一标识", { exact: true }).fill(slug);
        await page.getByRole("button", { name: "创建", exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/shops$/);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expectShopResult(page, before.shops + 1);
        expect(state.created - before.created).toBe(1);
        expect(state.shops - before.shops).toBe(1);
        expect(state.session - before.session).toBe(0);
        expect(state.shopQueries.at(-1)).toMatchObject({ where: {}, offset: 0 });
    }
});

async function expectUserResult(page: Page, queryNumber: number) {
    await expect(page.getByText(`导航验收用户 ${queryNumber}-1`, { exact: true })).toBeVisible();
}

test("侧栏进入用户列表发起一次查询且复用会话", async ({ page }) => {
    const state = await mockNavigation(page);
    await page.goto("/admin/");
    await expect(page.getByText("导航验收后端", { exact: true })).toBeVisible();
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    for (let i = 0; i < 2; i++) {
        const before = { ...state };
        await page.getByRole("button", { name: "用户列表", exact: true }).click();
        await expectUserResult(page, before.users + 1);
        expect(state.users - before.users).toBe(1);
        expect(state.session - before.session).toBe(0);
        await page.getByRole("button", { name: "系统概览", exact: true }).click();
        await expect(page.getByText("导航验收后端", { exact: true })).toBeVisible();
    }
});

test("用户列表筛选、重置、刷新与分页各查询一次", async ({ page }) => {
    const state = await mockNavigation(page);
    await page.goto("/admin/users");
    await expectUserResult(page, 1);
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    expect(state.users).toBe(1);
    const session = state.session;
    async function queryOnce(action: () => Promise<unknown>) {
        const before = state.users;
        await action();
        await expectUserResult(page, before + 1);
        expect(state.users - before).toBe(1);
        expect(state.session).toBe(session);
    }
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("user");
    await queryOnce(() => page.getByRole("button", { name: "筛选", exact: true }).click());
    expect(state.userQueries.at(-1)?.where).toEqual({ email: { like: "%user%" } });
    await queryOnce(() => page.getByRole("button", { name: "筛选", exact: true }).click());
    await queryOnce(() => page.getByRole("button", { name: "下一页", exact: true }).click());
    expect(state.userQueries.at(-1)?.offset).toBe(20);
    await queryOnce(() => page.getByRole("button", { name: "重置", exact: true }).click());
    expect(state.userQueries.at(-1)).toEqual({ where: {}, limit: 21, offset: 0 });
    await queryOnce(() => page.getByRole("button", { name: "重置", exact: true }).click());
    await queryOnce(() => page.getByRole("button", { name: "刷新", exact: true }).click());
    await queryOnce(async () => {
        await page.getByRole("combobox", { name: "每页条数", exact: true }).click();
        await page.getByRole("option", { name: "10 / 页", exact: true }).click();
    });
    expect(state.userQueries.at(-1)?.limit).toBe(11);
    const beforeReload = state.users;
    await page.reload();
    await expectUserResult(page, beforeReload + 1);
    expect(state.users - beforeReload).toBe(1);
    await expect(page.getByText("导航验收管理员", { exact: true })).toBeVisible();
    expect(state.userQueries.at(-1)?.limit).toBe(11);
});
