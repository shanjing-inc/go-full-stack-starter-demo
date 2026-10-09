import { test, expect, type Page } from "@playwright/test";

// 页面回归拦截认证接口，保留人工验收库与账号原状。
async function mockAuthentication(page: Page, installed = false, initializationEnabled = true) {
    const initialized: Record<string, string>[] = [];
    await page.route("**/api/auth/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/install-status") {
            await route.fulfill({
                json: { installed, enabled: !installed && initializationEnabled },
            });
        } else if (path === "/api/auth/initialize") {
            const input = route.request().postDataJSON();
            initialized.push(input);
            if (input.bootstrapToken === "invalid-token") {
                await route.fulfill({ status: 401, json: { message: "请重新登录" } });
                return;
            }
            installed = true;
            await route.fulfill({
                status: 201,
                json: { user: { email: input.email.toLowerCase(), name: input.name } },
            });
        } else if (path === "/api/auth/sign-in/email") {
            await route.fulfill({ status: 401, json: { message: "邮箱或密码错误" } });
        } else {
            throw new Error(`意外认证请求 ${path}`);
        }
    });
    return initialized;
}
async function fillInitialization(page: Page, password: string, token = "test-bootstrap-token") {
    await page.getByLabel("名称", { exact: true }).fill("验收管理员");
    await page.getByLabel("邮箱", { exact: true }).fill("OWNER@example.com");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByLabel("初始化密钥", { exact: true }).fill(token);
}

test("未初始化自动跳转、密码字节校验与成功后状态刷新", async ({ page }) => {
    const requests = await mockAuthentication(page);
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin\/install$/);
    await expect(page.getByRole("heading", { name: "初始化管理员", exact: true })).toBeVisible();
    await fillInitialization(page, "1234567");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("密码长度需要 8–128 字节");
    expect(requests).toHaveLength(0);
    // 两个常用汉字加两个英文字符恰好 8 UTF-8 字节。
    await page.getByLabel("密码", { exact: true }).fill("密码ab");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("status")).toHaveText(
        "管理员初始化成功，请使用刚设置的邮箱和密码登录。",
    );
    await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue("owner@example.com");
    await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
    await expect(page.getByRole("link", { name: "初始化管理员", exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].password).toBe("密码ab");
});

test("失败初始化保留表单与错误提示", async ({ page }) => {
    await mockAuthentication(page);
    await page.goto("/admin/install");
    await fillInitialization(page, "owner-password-2026", "invalid-token");
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/install$/);
    await expect(page.getByRole("alert")).toHaveText("请重新登录");
    await expect(page.getByLabel("密码", { exact: true })).toHaveValue("owner-password-2026");
    await expect(page.getByRole("status")).toHaveCount(0);
});

test("多字节密码上限与 ASCII 最大长度", async ({ page }) => {
    const requests = await mockAuthentication(page);
    await page.goto("/admin/install");
    await fillInitialization(page, "汉".repeat(43));
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("密码长度需要 8–128 字节");
    expect(requests).toHaveLength(0);
    await page.getByLabel("密码", { exact: true }).fill("x".repeat(128));
    await page.getByRole("button", { name: "创建管理员", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
        "管理员初始化成功，请使用刚设置的邮箱和密码登录。",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].password).toHaveLength(128);
});

test("已初始化账号登录失败保持统一凭据错误", async ({ page }) => {
    await mockAuthentication(page, true);
    await page.goto("/admin/login");
    await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
    await page.getByLabel("密码", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("邮箱或密码错误");
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "初始化管理员", exact: true })).toHaveCount(0);
});

test("初始化入口关闭时跳转安装页并显示关闭提示", async ({ page }) => {
    await mockAuthentication(page, false, false);
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin\/install$/);
    await expect(page.getByText("初始化入口已关闭", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建管理员", exact: true })).toHaveCount(0);
});

test("旧多字节密码登录保持完整输入与独立长度门禁", async ({ page }) => {
    await mockAuthentication(page, true);
    const passwords: string[] = [];
    await page.route("**/api/auth/sign-in/email", async (route) => {
        passwords.push(route.request().postDataJSON().password);
        await route.fulfill({ status: 401, json: { message: "邮箱或密码错误" } });
    });
    await page.goto("/admin/login");
    await page.getByLabel("邮箱", { exact: true }).fill("legacy@example.com");
    for (const password of ["汉".repeat(50), "汉".repeat(128), "😀".repeat(64)]) {
        await page.getByLabel("密码", { exact: true }).fill(password);
        await page.getByRole("button", { name: "登录", exact: true }).click();
        await expect(page.getByRole("alert")).toHaveText("邮箱或密码错误");
        expect(passwords.at(-1)).toBe(password);
    }
    expect(passwords).toHaveLength(3);
    await page.getByLabel("密码", { exact: true }).fill("汉".repeat(171));
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("密码长度最多 512 字节");
    expect(passwords).toHaveLength(3);
});
