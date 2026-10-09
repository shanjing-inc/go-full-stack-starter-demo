import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openUserActions, selectUserAction } from "./user-action-helpers.js";
import { test, expect, type Page } from "@playwright/test";
import type { DashboardUserItem } from "@shanjing/shadcnui-dashboard";

const managementPermissions = [
    "user:list",
    "user:create",
    "user:update",
    "user:set-role",
    "user:ban",
    "session:revoke",
    "demo:read",
];
async function mockManagement(
    page: Page,
    permissions = managementPermissions,
    initiallyBanned = false,
) {
    const row = (id: string, role: string): DashboardUserItem => ({
        id,
        name: `管理用户${id}`,
        email: `manage${id}@example.test`,
        role,
        image: null,
        emailVerified: false,
        banned: false,
        banReason: null,
        banExpires: null,
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
    });
    const state = {
        rows: [row("3", "member"), row("2", "owner"), row("1", "admin")],
        mutations: [] as { query: string; variables: Record<string, any> }[],
        lists: 0,
        sessions: 0,
        error: "",
        delay: 0,
        revokedSelf: false,
        listDelay: 0,
        listError: "",
        hiddenUserIDs: [] as string[],
    };
    state.rows[0].banned = initiallyBanned;
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/install-status") {
            await route.fulfill({ json: { installed: true, enabled: false } });
            return;
        }
        if (path === "/api/rest/demo/overview") {
            await route.fulfill({ json: { shops: 1, backend: "管理验收" } });
            return;
        }
        if (path !== "/api/graphql/admin") throw new Error(`意外请求 ${path}`);
        const { query, variables } = route.request().postDataJSON();
        if (query.includes("getDashboardSession")) {
            state.sessions++;
            if (state.revokedSelf) {
                await route.fulfill({
                    status: 401,
                    json: { message: "请重新登录", code: "UNAUTHORIZED" },
                });
                return;
            }
            await route.fulfill({
                json: {
                    data: {
                        getCurrentUser: state.rows.find((row) => row.id === "1"),
                        getCurrentPermissions: permissions,
                    },
                },
            });
            return;
        }
        if (query.includes("listUsers")) {
            state.lists++;
            if (state.listDelay)
                await new Promise((resolve) => setTimeout(resolve, state.listDelay));
            if (state.listError) {
                await route.fulfill({ json: { errors: [{ message: state.listError }] } });
                return;
            }
            await route.fulfill({
                json: {
                    data: {
                        listUsers: state.rows.filter(
                            (row) => !state.hiddenUserIDs.includes(row.id!),
                        ),
                    },
                },
            });
            return;
        }
        state.mutations.push({ query, variables });
        if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
        if (state.error) {
            await route.fulfill({
                json: {
                    errors: [{ message: state.error, extensions: { code: "BAD_USER_INPUT" } }],
                },
            });
            return;
        }
        if (query.includes("createDashboardUser")) {
            const user = { ...row("4", variables.set.role), ...variables.set };
            delete user.password;
            state.rows.unshift(user);
            await route.fulfill({ json: { data: { createUser: [user] } } });
        } else if (query.includes("updateDashboardUser")) {
            const user = state.rows.find((row) => Number(row.id) === variables.where.id.eq)!;
            Object.assign(user, variables.set);
            await route.fulfill({ json: { data: { updateUser: [user] } } });
        } else if (query.includes("revokeDashboardUserSessions")) {
            state.revokedSelf = variables.userId === "1";
            await route.fulfill({ json: { data: { revokeUserSessions: true } } });
        } else throw new Error(`意外操作 ${query}`);
    });
    await page.goto("/admin/users");
    await expect(page.getByText("manage3@example.test", { exact: true })).toBeVisible();
    return state;
}
function userRow(page: Page, id = "3") {
    return page
        .getByRole("row")
        .filter({ has: page.getByText(`manage${id}@example.test`, { exact: true }) });
}
async function createForm(page: Page) {
    await page.getByRole("button", { name: "创建用户", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称", { exact: true }).fill("新增用户");
    await dialog.getByLabel("邮箱", { exact: true }).fill("new@example.test");
    await dialog.getByLabel("初始密码", { exact: true }).fill("password-for-2026");
    return dialog;
}
test("创建用户沿用契约，成功后仅刷新一次列表", async ({ page }) => {
    const state = await mockManagement(page);
    const dialog = await createForm(page);
    await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("new@example.test", { exact: true })).toBeVisible();
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0].variables).toEqual({
        set: {
            name: "新增用户",
            email: "new@example.test",
            password: "password-for-2026",
            role: "member",
        },
    });
    expect(state.lists).toBe(2);
    expect(state.sessions).toBe(1);
});
test("密码按 UTF-8 字节校验并保留表单错误", async ({ page }) => {
    const state = await mockManagement(page);
    const dialog = await createForm(page);
    await dialog.getByLabel("初始密码", { exact: true }).fill("1234567");
    await dialog.getByRole("button", { name: "确认创建" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("密码长度需要 8–128 字节");
    expect(state.mutations).toHaveLength(0);
    await dialog.getByLabel("初始密码", { exact: true }).fill("密码ab");
    await dialog.getByRole("button", { name: "确认创建" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.mutations).toHaveLength(1);
});
test("重复邮箱错误局限于弹窗，重试保持输入", async ({ page }) => {
    const state = await mockManagement(page);
    state.error = "邮箱已存在";
    const dialog = await createForm(page);
    await dialog.getByRole("button", { name: "确认创建" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("邮箱已存在");
    await expect(dialog.getByLabel("邮箱", { exact: true })).toHaveValue("new@example.test");
    expect(state.lists).toBe(1);
    state.error = "";
    await dialog.getByRole("button", { name: "确认创建" }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.mutations).toHaveLength(2);
});
test("编辑资料及角色发送单用户 mutation", async ({ page }) => {
    const state = await mockManagement(page);
    await selectUserAction(page, userRow(page), "编辑");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称", { exact: true }).fill("修改名称");
    await dialog.getByRole("combobox", { name: "用户角色" }).click();
    await page.getByRole("option", { name: "user", exact: true }).click();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(userRow(page).getByText("修改名称", { exact: true })).toBeVisible();
    expect(state.mutations[0].variables).toEqual({
        set: { name: "修改名称", role: "user" },
        where: { id: { eq: 3 } },
    });
    expect(state.lists).toBe(2);
    expect(state.sessions).toBe(1);
});
test("封禁与解封清理显式 null 字段", async ({ page }) => {
    const state = await mockManagement(page);
    await selectUserAction(page, userRow(page), "封禁");
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("封禁原因", { exact: true }).fill("人工审核");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(userRow(page).getByText("已封禁", { exact: true })).toBeVisible();
    expect(state.mutations[0].variables.set).toEqual({
        banned: true,
        banReason: "人工审核",
        banExpires: null,
    });
    await selectUserAction(page, userRow(page), "解封");
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(userRow(page).getByText("正常", { exact: true })).toBeVisible();
    expect(state.mutations[1].variables.set).toEqual({
        banned: false,
        banReason: null,
        banExpires: null,
    });
});
test("封禁到期时间校验与 UTC 转换", async ({ page }) => {
    const state = await mockManagement(page);
    await selectUserAction(page, userRow(page), "封禁");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("封禁到期", { exact: true }).fill("2020-01-01T00:00");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("封禁到期时间需要晚于当前时间");
    expect(state.mutations).toHaveLength(0);
    await dialog.getByLabel("封禁到期", { exact: true }).fill("2099-01-01T00:00");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.mutations[0].variables.set.banExpires).toMatch(/^209[89]-.*Z$/);
});
test("撤销其他用户会话，保留当前管理员身份缓存", async ({ page }) => {
    const state = await mockManagement(page);
    await selectUserAction(page, userRow(page), "撤销会话");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.mutations[0].variables).toEqual({ userId: "3" });
    await expect.poll(() => state.lists).toBe(2);
    expect(state.sessions).toBe(1);
});
test("owner 与自身保护在界面收敛操作入口", async ({ page }) => {
    await mockManagement(page);
    await expect(userRow(page, "2").getByRole("button")).toHaveCount(0);
    await openUserActions(page, userRow(page, "1"));
    await expect(page.getByRole("menuitem", { name: "封禁", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await selectUserAction(page, userRow(page, "1"), "编辑");
    await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
});
test("只读权限保留用户查询，管理入口隐藏", async ({ page }) => {
    const state = await mockManagement(page, ["user:list", "demo:read"]);
    await expect(page.getByRole("button", { name: "创建用户", exact: true })).toHaveCount(0);
    await expect(userRow(page).getByRole("button")).toHaveCount(0);
    expect(state.mutations).toHaveLength(0);
});
test("撤销自身会话后复核身份并跳转登录", async ({ page }) => {
    const state = await mockManagement(page);
    await selectUserAction(page, userRow(page, "1"), "撤销会话");
    await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(state.sessions).toBe(2);
});
test("切换侧栏取消等待，迟到结果保持当前页面", async ({ page }) => {
    const state = await mockManagement(page);
    state.delay = 700;
    const dialog = await createForm(page);
    await dialog.getByRole("button", { name: "确认创建" }).click();
    await expect.poll(() => state.mutations.length).toBe(1);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "系统概览", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
    await page.waitForTimeout(900);
    await expect(page).toHaveURL(/\/admin\/?$/);
    expect(state.lists).toBe(1);
});

async function captureStyle(page: Page, name: string) {
    if (!process.env.USER_STYLE_SCREENSHOTS) return;
    await mkdir(process.env.USER_STYLE_SCREENSHOTS, { recursive: true });
    await page.screenshot({
        path: join(process.env.USER_STYLE_SCREENSHOTS, `${name}.png`),
        fullPage: !name.includes("dialog"),
        animations: "disabled",
    });
}

test("参考后台桌面布局、三点菜单与键盘操作", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const state = await mockManagement(page);
    const heading = page.getByRole("heading", { name: "用户列表", exact: true });
    const header = page.locator("header").filter({ has: heading });
    await expect(header.getByRole("button")).toHaveText(["创建用户", "刷新"]);
    await expect(header).toContainText("当前 3 条记录");
    await expect(heading).toHaveCSS("font-size", "25.5px");
    await expect(heading).toHaveCSS("margin-top", "4.25px");
    await expect(header.locator("p")).toHaveCSS("margin-top", "8.5px");
    await expect(header.locator("..")).toHaveCSS("gap", "25.5px");
    await expect(userRow(page).getByText("member", { exact: true })).toHaveClass(/bg-sky-50/);
    await expect(userRow(page, "1").getByText("admin", { exact: true })).toHaveClass(
        /bg-indigo-50/,
    );
    await expect(userRow(page, "2").getByText("owner", { exact: true })).toHaveClass(/bg-zinc-50/);
    await expect(userRow(page).getByRole("button")).toHaveCount(1);
    const trigger = userRow(page).getByRole("button", { name: /操作菜单$/ });
    await expect(trigger).toHaveCSS("width", "34px");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await captureStyle(page, "users-desktop-light");
    await openUserActions(page, userRow(page));
    await expect(page.getByRole("menuitem")).toHaveText(["编辑", "封禁", "撤销会话"]);
    await expect(page.getByRole("menu")).toHaveCSS("width", "187px");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(userRow(page)).toHaveCSS("color", "oklch(0.985 0 0)");
    await expect(header.getByRole("button", { name: "创建用户", exact: true })).toHaveCSS(
        "background-color",
        "oklch(0.707 0.165 254.624)",
    );
    await captureStyle(page, "users-desktop-dark");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "编辑", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(state.lists).toBe(1);
    expect(state.sessions).toBe(1);
    expect(state.mutations).toHaveLength(0);
});

test("参考后台移动布局与短屏弹窗滚动", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await mockManagement(page);
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await captureStyle(page, "users-mobile-light");
    await selectUserAction(page, userRow(page), "编辑");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveClass(/rounded-lg/);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 480 });
    await page.getByRole("button", { name: "创建用户", exact: true }).click();
    await expect(dialog).toHaveCSS("overflow-y", "auto");
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(16);
    expect(bounds!.y).toBeGreaterThanOrEqual(16);
    expect(bounds!.width).toBeLessThanOrEqual(288);
    expect(bounds!.height).toBeLessThanOrEqual(448);
    await dialog.getByRole("button", { name: "确认创建", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "确认创建", exact: true })).toBeInViewport();
    await captureStyle(page, "users-mobile-dialog");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.lists).toBe(1);
    expect(state.sessions).toBe(1);
    expect(state.mutations).toHaveLength(0);
});

for (const close of ["Escape", "取消", "关闭"]) {
    test(`创建弹窗通过 ${close} 关闭后返回创建入口`, async ({ page }) => {
        const state = await mockManagement(page);
        const trigger = page.getByRole("button", { name: "创建用户", exact: true });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        if (close === "Escape") await page.keyboard.press("Escape");
        else await dialog.getByRole("button", { name: close, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeFocused();
        expect(state.mutations).toHaveLength(0);
    });
}

for (const action of ["编辑", "封禁", "解封", "撤销会话"]) {
    for (const close of ["Escape", "取消", "关闭"]) {
        test(`${action}弹窗通过 ${close} 关闭后返回当前行菜单`, async ({ page }) => {
            const state = await mockManagement(page, managementPermissions, action === "解封");
            const trigger = userRow(page).getByRole("button", { name: /操作菜单$/ });
            await trigger.focus();
            await page.keyboard.press("ArrowDown");
            const item = page.getByRole("menuitem", { name: action, exact: true });
            await item.focus();
            await page.keyboard.press("Enter");
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible();
            if (close === "Escape") await page.keyboard.press("Escape");
            else await dialog.getByRole("button", { name: close, exact: true }).click();
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
            expect(state.mutations).toHaveLength(0);
        });
    }
}

test("创建成功并刷新列表后保持创建入口焦点", async ({ page }) => {
    const state = await mockManagement(page);
    state.listDelay = 400;
    const dialog = await createForm(page);
    await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "创建用户", exact: true });
    await expect(trigger).toBeFocused();
    await expect(page.getByText("new@example.test", { exact: true })).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(state.lists).toBe(2);
});

for (const action of ["编辑", "封禁", "解封", "撤销会话"]) {
    test(`${action}成功并重建列表后返回对应行菜单`, async ({ page }) => {
        const state = await mockManagement(page, managementPermissions, action === "解封");
        state.listDelay = 400;
        await selectUserAction(page, userRow(page), action);
        const dialog = page.getByRole("dialog");
        if (action === "编辑") await dialog.getByLabel("名称", { exact: true }).fill("焦点回归");
        await dialog
            .getByRole("button", { name: action === "编辑" ? "保存" : "确认", exact: true })
            .click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
        await expect(userRow(page).getByRole("button", { name: /操作菜单$/ })).toBeFocused();
        expect(state.lists).toBe(2);
    });
}

for (const mayCreate of [true, false]) {
    test(`目标行消失后返回${mayCreate ? "创建" : "刷新"}入口`, async ({ page }) => {
        const state = await mockManagement(
            page,
            managementPermissions.filter((permission) => mayCreate || permission !== "user:create"),
        );
        state.hiddenUserIDs = ["3"];
        await selectUserAction(page, userRow(page), "编辑");
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("名称", { exact: true }).fill("筛选后隐藏");
        await dialog.getByRole("button", { name: "保存", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(userRow(page)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
        await expect(
            page.getByRole("button", { name: mayCreate ? "创建用户" : "刷新", exact: true }),
        ).toBeFocused();
        expect(state.lists).toBe(2);
    });
}

test("提交成功后的列表读取失败仍恢复稳定入口焦点", async ({ page }) => {
    const state = await mockManagement(page);
    state.listError = "焦点回归读取失败";
    await selectUserAction(page, userRow(page), "撤销会话");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("焦点回归读取失败");
    await expect(page.getByRole("button", { name: "创建用户", exact: true })).toBeFocused();
});

test("列表重载期间主动选择筛选输入后保持用户焦点", async ({ page }) => {
    const state = await mockManagement(page);
    state.listDelay = 700;
    await selectUserAction(page, userRow(page), "编辑");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称", { exact: true }).fill("加载期间操作");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "创建用户", exact: true })).toBeFocused();
    const email = page.getByRole("textbox", { name: "邮箱", exact: true });
    await email.focus();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
    await expect(email).toBeFocused();
});
