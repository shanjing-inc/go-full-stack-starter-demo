import { test, expect, type Page } from "@playwright/test";

// 偏好验收拦截接口，保持开发账号与数据库原状。
async function mockPreferences(page: Page) {
    const state = { requests: 0 };
    await page.route("**/api/**", async (route) => {
        state.requests++;
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/install-status") {
            await route.fulfill({ json: { installed: true, enabled: false } });
            return;
        }
        expect(path).toBe("/api/graphql/admin");
        const { query } = route.request().postDataJSON();
        if (query.includes("getDashboardSession")) {
            await route.fulfill({
                json: {
                    data: {
                        getCurrentUser: {
                            id: "1",
                            name: "字号验收",
                            email: "font@example.test",
                            image: null,
                        },
                        getCurrentPermissions: ["user:list"],
                    },
                },
            });
        } else {
            expect(query).toContain("listUsers");
            await route.fulfill({ json: { data: { listUsers: [] } } });
        }
    });
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "用户列表", exact: true })).toBeVisible();
    await expect(page.getByText("暂无用户记录", { exact: true })).toBeVisible();
    return state;
}

const options = [
    { label: "紧凑", px: 16 },
    { label: "标准", px: 17 },
    { label: "舒展", px: 18 },
];

for (const width of [1920, 390]) {
    test(`字号菜单外观、选中状态、主题与本地切换 ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: width === 1920 ? 1080 : 844 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const state = await mockPreferences(page);
        const requests = state.requests;
        await expect(page.locator("html")).toHaveCSS("font-size", "17px");
        const trigger = page.getByRole("button", { name: "字号：标准", exact: true });
        await expect(trigger).toHaveAttribute("data-variant", "ghost");
        await expect(trigger).toHaveAttribute("data-size", "icon");
        await expect(trigger).toHaveCSS("width", "34px");
        await trigger.hover();
        await expect(page.getByRole("tooltip")).toHaveText("字号：标准");
        const buttonBounds = await trigger.boundingBox();
        await trigger.click();
        const menu = page.getByRole("menu");
        await expect(menu).toContainText("字号大小");
        await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
        await expect(menu).toHaveCSS("width", "170px");
        await expect(page.getByRole("menuitemradio")).toHaveText([
            "紧凑16px",
            "标准17px",
            "舒展18px",
        ]);
        await expect(
            page.getByRole("menuitemradio", { name: "标准 17px", exact: true }),
        ).toHaveAttribute("aria-checked", "true");
        const bounds = await menu.boundingBox();
        expect(
            Math.abs(bounds!.x + bounds!.width - buttonBounds!.x - buttonBounds!.width),
        ).toBeLessThan(1);
        await page.screenshot({
            path: testInfo.outputPath("font-size-light.png"),
            animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
        await expect(page.locator("html")).toHaveClass(/dark/);
        await trigger.click();
        await expect(menu).toHaveCSS("color", "oklch(0.985 0 0)");
        await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
        await page.screenshot({
            path: testInfo.outputPath("font-size-dark.png"),
            animations: "disabled",
        });
        await page.keyboard.press("Escape");
        let current = "标准";
        for (const { label, px } of options) {
            await page.getByRole("button", { name: `字号：${current}`, exact: true }).click();
            await page
                .getByRole("menuitemradio", { name: `${label} ${px}px`, exact: true })
                .click();
            await expect(menu).toHaveCount(0);
            await expect(page.locator("html")).toHaveCSS("font-size", `${px}px`);
            await expect(
                page.getByRole("button", { name: `字号：${label}`, exact: true }),
            ).toBeFocused();
            expect(await page.evaluate(() => localStorage.getItem("go-mysql-demo:font-size"))).toBe(
                String(px),
            );
            current = label;
        }
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBeTruthy();
        expect(state.requests).toBe(requests);
        await page.reload();
        await expect(page.getByRole("button", { name: "字号：舒展", exact: true })).toBeVisible();
        await expect(page.locator("html")).toHaveCSS("font-size", "18px");
        await expect(page.locator("html")).toHaveClass(/dark/);
        await page.getByRole("button", { name: "字号：舒展", exact: true }).click();
        await expect(
            page.getByRole("menuitemradio", { name: "舒展 18px", exact: true }),
        ).toHaveAttribute("aria-checked", "true");
        expect(errors).toEqual([]);
    });
}

test("字号键盘操作与焦点恢复", async ({ page }) => {
    const state = await mockPreferences(page);
    const requests = state.requests;
    const trigger = page.getByRole("button", { name: "字号：标准", exact: true });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "紧凑 16px", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "标准 17px", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "舒展 18px", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveCSS("font-size", "18px");
    const selected = page.getByRole("button", { name: "字号：舒展", exact: true });
    await expect(selected).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
        page.getByRole("menuitemradio", { name: "舒展 18px", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(selected).toBeFocused();
    expect(state.requests).toBe(requests);
});

for (const [stored, label, px] of [
    ["invalid", "标准", 17],
    ["14", "紧凑", 16],
    ["16", "紧凑", 16],
    ["18", "舒展", 18],
] as const) {
    test(`恢复存储字号 ${stored} 并保持应用隔离`, async ({ page }) => {
        await page.addInitScript((value) => {
            if (sessionStorage.getItem("font-seeded")) return;
            localStorage.setItem("go-mysql-demo:font-size", value);
            localStorage.setItem("dashboard:font-size", "18");
            sessionStorage.setItem("font-seeded", "1");
        }, stored);
        await mockPreferences(page);
        await expect(
            page.getByRole("button", { name: `字号：${label}`, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveCSS("font-size", `${px}px`);
        expect(await page.evaluate(() => localStorage.getItem("go-mysql-demo:font-size"))).toBe(
            String(px),
        );
        expect(await page.evaluate(() => localStorage.getItem("dashboard:font-size"))).toBe("18");
        await page.reload();
        await expect(
            page.getByRole("button", { name: `字号：${label}`, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveCSS("font-size", `${px}px`);
    });
}

test("存储受限时字号可切换，刷新恢复标准", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
            get() {
                throw new Error("存储受限");
            },
        });
    });
    const state = await mockPreferences(page);
    const requests = state.requests;
    await page.getByRole("button", { name: "字号：标准", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "紧凑 16px", exact: true }).click();
    await expect(page.locator("html")).toHaveCSS("font-size", "16px");
    expect(state.requests).toBe(requests);
    await page.reload();
    await expect(page.getByRole("button", { name: "字号：标准", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("font-size", "17px");
    expect(errors).toEqual([]);
});
