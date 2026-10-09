import { test, expect, type Page } from "@playwright/test";
import { signOutFromSidebar } from "./sidebar-helpers.js";

// 接口使用独立 Mock，保持人工开发环境的账号与数据原状。
async function mockSidebar(page: Page, permissions = ["user:list", "demo:read"]) {
    const state = { identities: 0, users: 0, shops: 0, overview: 0, logout: 0, logoutStatus: 200 };
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/install-status") {
            await route.fulfill({ json: { installed: true, enabled: false } });
            return;
        }
        if (path === "/api/auth/sign-out") {
            state.logout++;
            await route.fulfill({
                status: state.logoutStatus,
                json: { success: state.logoutStatus === 200 },
            });
            return;
        }
        if (path === "/api/rest/demo/overview") {
            state.overview++;
            await route.fulfill({ json: { shops: 0, backend: "侧栏验收后端" } });
            return;
        }
        expect(path).toBe("/api/graphql/admin");
        const { query } = route.request().postDataJSON();
        if (query.includes("getDashboardSession")) {
            state.identities++;
            await route.fulfill({
                json: {
                    data: {
                        getCurrentUser: {
                            id: "1",
                            name: "侧栏验收管理员",
                            email: "sidebar@example.test",
                            image: null,
                        },
                        getCurrentPermissions: permissions,
                    },
                },
            });
        } else if (query.includes("listUsers")) {
            state.users++;
            await route.fulfill({ json: { data: { listUsers: [] } } });
        } else {
            expect(query).toContain("listAdminShops");
            state.shops++;
            await route.fulfill({ json: { data: { listShops: [] } } });
        }
    });
    return state;
}

async function usersReady(page: Page) {
    await page.goto("/admin/users?email=sidebar#results");
    await expect(page.getByText("暂无用户记录", { exact: true })).toBeVisible();
}
const userMenu = (page: Page) =>
    page.getByRole("button", { name: "用户菜单：侧栏验收管理员", exact: true });
const trigger = (page: Page) => page.locator('[data-slot="sidebar-trigger"]');
const container = (page: Page) => page.locator('[data-slot="sidebar-container"]');
const currentTitle = (page: Page) => page.locator('[data-slot="breadcrumb-page"]');

for (const width of [1920, 1280, 1100, 1024, 390]) {
    test(`侧栏响应布局、头像菜单、浅深色 ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const state = await mockSidebar(page);
        await usersReady(page);
        await expect(page).toHaveTitle("Multi Database Demo");
        await expect(currentTitle(page)).toHaveText("用户列表");
        await expect(page.locator('[data-slot="sidebar-inset"] > header')).toHaveCSS(
            "height",
            "59.5px",
        );
        const separator = page.locator(
            '[data-slot="sidebar-inset"] > header [data-slot="separator"]',
        );
        await expect(separator).toHaveAttribute("data-orientation", "vertical");
        await expect(separator).toHaveCSS("width", "1px");
        await expect(separator).toHaveCSS("height", "17px");
        await expect(separator).toHaveCSS("background-color", "oklch(0.922 0 0)");
        await expect(
            page.getByRole("link", { name: "Multi Database Demo", exact: true }),
        ).toBeVisible({
            visible: width >= 768,
        });
        if (width < 1024) {
            await expect(container(page)).toHaveCount(0);
            await trigger(page).click();
            await expect(page.getByRole("dialog", { name: "侧边栏", exact: true })).toBeVisible();
            await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCSS("width", "292.5px");
        } else {
            await expect(container(page)).toHaveCSS("width", width >= 1280 ? "272px" : "51px");
            await expect(userMenu(page)).toHaveCSS("width", width >= 1280 ? "254px" : "34px");
        }
        await userMenu(page).click();
        const menu = page.getByRole("menu");
        await expect(menu).toContainText("sidebar@example.test");
        await expect(page.getByRole("menuitem", { name: "退出", exact: true })).toBeVisible();
        await expect(page.getByRole("menuitem")).toHaveCount(1);
        await expect(menu).toHaveCSS("border-radius", "7.65px");
        await page.screenshot({
            path: testInfo.outputPath("sidebar-light.png"),
            animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(userMenu(page)).toBeFocused();
        if (width < 1024) {
            await page.keyboard.press("Escape");
            await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
        await expect(page.locator("html")).toHaveClass(/dark/);
        await expect(separator).toHaveCSS("width", "1px");
        await expect(separator).toHaveCSS("height", "17px");
        await expect(separator).toHaveCSS("background-color", "oklch(1 0 0 / 0.1)");
        if (width < 1024) await trigger(page).click();
        await userMenu(page).click();
        await expect(menu).toHaveCSS("color", "oklch(0.985 0 0)");
        await page.screenshot({
            path: testInfo.outputPath("sidebar-dark.png"),
            animations: "disabled",
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        expect(state).toEqual({
            identities: 1,
            users: 1,
            shops: 0,
            overview: 0,
            logout: 0,
            logoutStatus: 200,
        });
        expect(errors).toEqual([]);
    });
}

test("桌面手动折叠、边轨、快捷键、导航提示与标题复用会话", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const state = await mockSidebar(page);
    await usersReady(page);
    await trigger(page).click();
    await expect(container(page)).toHaveCSS("width", "51px");
    await expect(userMenu(page)).toHaveCSS("width", "34px");
    await page.getByRole("button", { name: "店铺列表", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("店铺列表");
    await page.mouse.move(1000, 800);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath("sidebar-collapsed.png"),
        animations: "disabled",
    });
    await userMenu(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "退出", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(userMenu(page)).toBeFocused();
    await page.locator('[data-slot="sidebar-rail"]').click();
    await expect(container(page)).toHaveCSS("width", "272px");
    await page.keyboard.press("Control+b");
    await expect(container(page)).toHaveCSS("width", "51px");
    await page.keyboard.press("Control+b");
    await expect(container(page)).toHaveCSS("width", "272px");
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expect(currentTitle(page)).toHaveText("店铺列表");
    await expect(page.getByText("暂无匹配的店铺", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Multi Database Demo", exact: true }).click();
    await expect(currentTitle(page)).toHaveText("系统概览");
    await expect(page.getByText("侧栏验收后端", { exact: true })).toBeVisible();
    expect(state.identities).toBe(1);
    expect(state.users).toBe(1);
    expect(state.shops).toBe(1);
    expect(state.overview).toBe(1);
});

test("移动导航后关闭抽屉，标题跟随路由，舒展字号保持布局", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem("go-mysql-demo:font-size", "18"));
    const state = await mockSidebar(page);
    await usersReady(page);
    await expect(page.locator('[data-slot="sidebar-inset"] > header')).toHaveCSS("height", "63px");
    await trigger(page).click();
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(currentTitle(page)).toHaveText("店铺列表");
    await expect(page.getByText("暂无匹配的店铺", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
    );
    expect(state.identities).toBe(1);
    expect(state.shops).toBe(1);
});

test("折叠侧栏退出失败可查看并重试", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const state = await mockSidebar(page);
    await usersReady(page);
    await trigger(page).click();
    state.logoutStatus = 503;
    await signOutFromSidebar(page);
    await expect(page.getByRole("alert")).toContainText("退出失败");
    await expect(currentTitle(page)).toHaveText("用户列表");
    await userMenu(page).click();
    await expect(page.getByRole("menu")).toContainText("退出失败");
    await page.keyboard.press("Escape");
    state.logoutStatus = 200;
    await signOutFromSidebar(page);
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
    expect(state.logout).toBe(2);
});

test("可见导航维持权限边界，未知路由标题回落", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockSidebar(page, []);
    await page.goto("/admin/unknown");
    await expect(userMenu(page)).toBeVisible();
    await expect(currentTitle(page)).toHaveText("页面不存在");
    await expect(page.getByRole("button", { name: "用户列表", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "店铺列表", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "系统概览", exact: true })).toBeVisible();
});

test("退出等待期间锁定动作并合并重复请求", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await mockSidebar(page);
    await usersReady(page);
    let requests = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route("**/api/auth/sign-out", async (route) => {
        requests++;
        await gate;
        await route.fulfill({ json: { success: true } });
    });
    await signOutFromSidebar(page);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await userMenu(page).click();
    await expect(page.getByRole("menuitem", { name: "正在退出…", exact: true })).toBeDisabled();
    expect(requests).toBe(1);
    release();
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect(requests).toBe(1);
});
