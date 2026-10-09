import { test, expect, type Page } from "@playwright/test";
import type { DashboardUserItem, DashboardUserListQuery } from "@shanjing/shadcnui-dashboard";

// Mock 回归保留开发账号与数据库；真实链路另由隔离全流程脚本执行。
async function mockUsers(page: Page, permissions = ["user:list"]) {
    const state = {
        rows: Array.from(
            { length: 25 },
            (_, i): DashboardUserItem => ({
                id: String(i + 1),
                name: `用户${i + 1}`,
                email: `user${String(i + 1).padStart(2, "0")}@example.test`,
                role: i === 24 ? "member,admin" : i % 2 ? "admin" : "user",
                image: null,
                emailVerified: i % 2 === 0,
                banned: i % 3 === 0,
                banReason: i % 3 === 0 ? "测试封禁" : null,
                banExpires: null,
                createdAt: "2026-10-04T00:00:00Z",
                updatedAt: "2026-10-04T00:00:00Z",
            }),
        ),
        fail: false,
        requests: [] as DashboardUserListQuery[],
    };
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path !== "/api/graphql/admin") throw new Error(`意外请求 ${path}`);
        const { query, variables } = route.request().postDataJSON();
        if (query.includes("getDashboardSession")) {
            await route.fulfill({
                json: {
                    data: {
                        getCurrentUser: {
                            id: "1",
                            name: "查询验收管理员",
                            email: "owner@example.test",
                            image: null,
                        },
                        getCurrentPermissions: permissions,
                    },
                },
            });
            return;
        }
        expect(query).toContain("listUsers");
        state.requests.push(variables);
        if (state.fail) {
            await route.fulfill({ json: { errors: [{ message: "用户查询暂时不可用" }] } });
            return;
        }
        const where = variables.where;
        const keyword = where.email?.like.slice(1, -1) ?? "";
        if (keyword === "slow") await new Promise((resolve) => setTimeout(resolve, 500));
        const rows = state.rows
            .filter(
                (row) =>
                    (row.email ?? "").includes(keyword) &&
                    (!where.role || row.role === where.role.eq) &&
                    (where.banned === undefined || row.banned === where.banned) &&
                    (where.emailVerified === undefined ||
                        row.emailVerified === where.emailVerified),
            )
            .reverse();
        await route.fulfill({
            json: {
                data: {
                    listUsers: rows.slice(variables.offset, variables.offset + variables.limit),
                },
            },
        });
    });
    return state;
}
async function choose(page: Page, label: string, value: string) {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: value, exact: true }).click();
}
test("用户字段、稳定分页与刷新 URL 状态", async ({ page }) => {
    const state = await mockUsers(page, ["user:list", "demo:read"]);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "用户列表", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(系统概览|用户列表|店铺列表)$/ })).toHaveText([
        "系统概览",
        "用户列表",
        "店铺列表",
    ]);
    await expect(page.getByRole("cell", { name: "member,admin", exact: true })).toBeVisible();
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(21);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText("user05@example.test", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByText("user05@example.test", { exact: true })).toBeVisible();
    expect(state.requests.at(-1)).toMatchObject({ limit: 21, offset: 20 });
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
});
test("四项筛选、精确布尔与 URL 重置", async ({ page }) => {
    const state = await mockUsers(page);
    await page.goto("/admin/users");
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("@example.test");
    await choose(page, "角色", "admin");
    await choose(page, "状态", "正常");
    await choose(page, "邮箱验证", "未验证");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect
        .poll(() => state.requests.at(-1)?.where)
        .toEqual({
            email: { like: "%@example.test%" },
            role: { eq: "admin" },
            banned: false,
            emailVerified: false,
        });
    await expect(page.getByText("user24@example.test", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toHaveValue(
        "@example.test",
    );
    await expect(page.getByRole("combobox", { name: "角色", exact: true })).toHaveText("admin");
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toHaveValue("");
    await expect.poll(() => state.requests.at(-1)?.where).toEqual({});
});
test("页大小变化重置页码并支持空结果", async ({ page }) => {
    const state = await mockUsers(page);
    await page.goto("/admin/users?page=2");
    await expect(page.getByText("user05@example.test", { exact: true })).toBeVisible();
    await choose(page, "每页条数", "10 / 页");
    await expect(page).toHaveURL(/pageSize=10/);
    await expect(page).not.toHaveURL(/page=2/);
    await expect(page.getByRole("row")).toHaveCount(11);
    expect(state.requests.at(-1)).toMatchObject({ limit: 11, offset: 0 });
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("missing");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByText("暂无用户记录", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
});
test("无效 URL 参数恢复安全默认值", async ({ page }) => {
    const state = await mockUsers(page);
    await page.goto(
        "/admin/users?page=2147483648&pageSize=10000&role=unknown&banned=garbage&emailVerified=garbage",
    );
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    expect(state.requests.at(-1)).toMatchObject({ limit: 21, offset: 0, where: {} });
});
test("查询错误清空旧数据并支持重试", async ({ page }) => {
    const state = await mockUsers(page);
    await page.goto("/admin/users");
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    state.fail = true;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("用户查询暂时不可用");
    await expect(page.getByText("user25@example.test", { exact: true })).toHaveCount(0);
    state.fail = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
});
test("过期响应隔离与历史筛选恢复", async ({ page }) => {
    const state = await mockUsers(page);
    await page.goto("/admin/users");
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("slow");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect
        .poll(() => state.requests.some((request) => request.where.email?.like === "%slow%"))
        .toBeTruthy();
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toHaveValue("slow");
    await expect(page.getByText("暂无用户记录", { exact: true })).toBeVisible();
});
test("权限直达拒绝、菜单隐藏与零用户查询", async ({ page }) => {
    const state = await mockUsers(page, []);
    await page.goto("/admin/users");
    await expect(page.getByRole("alert")).toHaveText("403 · 当前账号缺少用户列表权限");
    await expect(page.getByRole("button", { name: "用户列表", exact: true })).toHaveCount(0);
    expect(state.requests).toHaveLength(0);
});
test("移动布局、主题与头像降级", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockUsers(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/users");
    await expect(page.getByText("user25@example.test", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    expect(errors).toEqual([]);
});
