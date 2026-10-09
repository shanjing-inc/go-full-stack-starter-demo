import { test, expect, type Page } from "@playwright/test";
import { selectUserAction, openUserActions } from "./user-action-helpers.js";

async function mockSessions(
    page: Page,
    permissions = ["user:list", "session:list", "session:revoke"],
) {
    const user = (id: string, role: string) => ({
        id,
        name: `用户${id}`,
        email: `sessions${id}@example.test`,
        role,
        image: null,
        emailVerified: false,
        banned: false,
        banReason: null,
        banExpires: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
    });
    const users = [user("3", "user"), user("2", "owner"), user("1", "admin")];
    const row = (id: number, userId = "3", current = false) => ({
        id: String(id),
        userId,
        current,
        ipAddress: "127.0.0.1",
        userAgent: `浏览器 ${id}`,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
        expiresAt: "2026-10-12T00:00:00Z",
    });
    const state = {
        rows: [row(31), row(30)],
        lists: [] as Record<string, any>[],
        revokes: [] as Record<string, any>[],
        error: "",
        mutationError: "",
        delay: 0,
        mutationDelay: 0,
        revokedSelf: false,
    };
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/install-status") {
            await route.fulfill({ json: { installed: true, enabled: false } });
            return;
        }
        if (path === "/api/rest/demo/overview") {
            await route.fulfill({ json: { shops: 1, backend: "会话验收" } });
            return;
        }
        if (path !== "/api/graphql/admin") throw new Error(`意外请求 ${path}`);
        const { query, variables } = route.request().postDataJSON();
        if (query.includes("getDashboardSession")) {
            if (state.revokedSelf) {
                await route.fulfill({
                    status: 401,
                    json: { code: "UNAUTHORIZED", message: "请重新登录" },
                });
                return;
            }
            await route.fulfill({
                json: { data: { getCurrentUser: users[2], getCurrentPermissions: permissions } },
            });
            return;
        }
        if (query.includes("listUsers")) {
            await route.fulfill({ json: { data: { listUsers: users } } });
            return;
        }
        if (query.includes("listUserSessions")) {
            state.lists.push(variables);
            if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
            if (state.error) {
                await route.fulfill({ json: { errors: [{ message: state.error }] } });
                return;
            }
            await route.fulfill({
                json: {
                    data: {
                        listUserSessions: state.rows
                            .filter((item) => item.userId === variables.userId)
                            .slice(variables.offset, variables.offset + variables.limit),
                    },
                },
            });
            return;
        }
        if (query.includes("revokeUserSession")) {
            state.revokes.push(variables);
            if (state.mutationDelay)
                await new Promise((resolve) => setTimeout(resolve, state.mutationDelay));
            if (state.mutationError) {
                await route.fulfill({ json: { errors: [{ message: state.mutationError }] } });
                return;
            }
            const target = state.rows.find(
                (item) => item.userId === variables.userId && item.id === variables.sessionId,
            );
            if (target?.current) state.revokedSelf = true;
            state.rows = state.rows.filter((item) => item !== target);
            await route.fulfill({ json: { data: { revokeUserSession: true } } });
            return;
        }
        throw new Error(`意外查询 ${query}`);
    });
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "用户列表" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "sessions3@example.test" })).toBeVisible();
    return {
        state,
        row,
        open: async (id = "3") => {
            await selectUserAction(
                page,
                page.getByRole("row").filter({ hasText: `sessions${id}@example.test` }),
                "查看会话",
            );
            return page.getByRole("dialog");
        },
    };
}

test("会话列表显示安全字段，关闭后恢复行菜单焦点", async ({ page }) => {
    const { state, open } = await mockSessions(page);
    const dialog = await open();
    await expect(dialog.getByText("浏览器 31", { exact: true })).toBeVisible();
    expect(state.lists.length).toBeGreaterThan(0);
    expect(
        state.lists.every(
            (query) =>
                JSON.stringify(query) === JSON.stringify({ userId: "3", limit: 11, offset: 0 }),
        ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
        page.getByRole("button", { name: "打开 sessions3@example.test 的操作菜单" }),
    ).toBeFocused();
});

test("会话列表权限可独立提供只读入口，owner 行保持保护", async ({ page }) => {
    const { open } = await mockSessions(page, ["user:list", "session:list"]);
    const dialog = await open();
    await expect(dialog.getByText("浏览器 31", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "撤销会话", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(
        page.getByRole("row").filter({ hasText: "sessions2@example.test" }).getByRole("button"),
    ).toHaveCount(0);
});

test("缺少会话列表权限时隐藏入口", async ({ page }) => {
    await mockSessions(page, ["user:list", "session:revoke"]);
    await openUserActions(
        page,
        page.getByRole("row").filter({ hasText: "sessions3@example.test" }),
    );
    await expect(page.getByRole("menuitem", { name: "查看会话" })).toHaveCount(0);
});

test("单会话撤销经过确认，仅刷新会话列表", async ({ page }) => {
    const { state, open } = await mockSessions(page);
    const dialog = await open();
    const target = dialog.getByRole("row").filter({ hasText: "浏览器 31" });
    await target.getByRole("button", { name: "撤销会话", exact: true }).click();
    expect(state.revokes).toHaveLength(0);
    await target.getByRole("button", { name: "取消撤销" }).click();
    await target.getByRole("button", { name: "撤销会话", exact: true }).click();
    await target.getByRole("button", { name: "确认撤销" }).click();
    await expect(target).toHaveCount(0);
    await expect(dialog.getByText("浏览器 30", { exact: true })).toBeVisible();
    expect(state.revokes).toEqual([{ userId: "3", sessionId: "31" }]);
    await expect(dialog.getByRole("button", { name: "刷新会话" })).toBeFocused();
    await expect(page).toHaveURL(/\/admin\/users$/);
});

test("分页、每页条数和撤销末页最后记录后的回退", async ({ page }) => {
    const { state, row, open } = await mockSessions(page);
    state.rows = Array.from({ length: 11 }, (_, i) => row(100 - i));
    const dialog = await open();
    await expect(dialog.getByText("第 1 页 · 本页 10 条", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "下一页" }).click();
    await expect(dialog.getByText("第 2 页 · 本页 1 条", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "撤销会话", exact: true }).click();
    await dialog.getByRole("button", { name: "确认撤销" }).click();
    await expect(dialog.getByText("第 1 页 · 本页 10 条", { exact: true })).toBeVisible();
    await dialog.getByRole("combobox", { name: "每页条数" }).click();
    await page.getByRole("option", { name: "20 / 页", exact: true }).click();
    await expect.poll(() => state.lists.at(-1)?.limit).toBe(21);
});

test("查询与撤销错误保留在会话弹窗，可重试", async ({ page }) => {
    const { state, open } = await mockSessions(page);
    state.error = "会话查询故障";
    const dialog = await open();
    await expect(dialog.getByRole("alert")).toHaveText("会话查询故障");
    state.error = "";
    await dialog.getByRole("button", { name: "刷新会话" }).click();
    const target = dialog.getByRole("row").filter({ hasText: "浏览器 31" });
    await target.getByRole("button", { name: "撤销会话", exact: true }).click();
    state.mutationError = "会话撤销故障";
    await target.getByRole("button", { name: "确认撤销" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("会话撤销故障");
    state.mutationError = "";
    await target.getByRole("button", { name: "确认撤销" }).click();
    await expect(target).toHaveCount(0);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("撤销当前会话后重新校验身份并返回登录页", async ({ page }) => {
    const { state, row, open } = await mockSessions(page);
    state.rows = [row(1, "1", true), row(2, "1")];
    const dialog = await open("1");
    const target = dialog.getByRole("row").filter({ hasText: "当前会话" });
    await target.getByRole("button", { name: "撤销会话", exact: true }).click();
    await expect(target.getByText("确认退出当前登录？")).toBeVisible();
    await target.getByRole("button", { name: "确认撤销" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(state.rows).toHaveLength(1);
});

test("关闭弹窗后忽略迟到查询，再次打开加载新结果", async ({ page }) => {
    const { state, open } = await mockSessions(page);
    state.delay = 700;
    const dialog = await open();
    await expect.poll(() => state.lists.length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    state.delay = 0;
    state.rows = [];
    await open();
    await expect(dialog.getByText("暂无有效会话")).toBeVisible();
    await page.waitForTimeout(850);
    await expect(dialog.getByText("暂无有效会话")).toBeVisible();
});

test("关闭弹窗后撤销回调保持取消状态", async ({ page }) => {
    const { state, open } = await mockSessions(page);
    state.mutationDelay = 700;
    const dialog = await open();
    const target = dialog.getByRole("row").filter({ hasText: "浏览器 31" });
    await target.getByRole("button", { name: "撤销会话", exact: true }).click();
    await target.getByRole("button", { name: "确认撤销" }).click();
    await expect.poll(() => state.revokes.length).toBe(1);
    const listCount = state.lists.length;
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(850);
    expect(state.lists).toHaveLength(listCount);
    await expect(page).toHaveURL(/\/admin\/users$/);
});
