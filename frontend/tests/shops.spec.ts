import { test, expect, type Page } from "@playwright/test";

type Shop = {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
    updatedAt: string;
};
// 浏览器回归全部拦截 API，人工开发库保持原状。SQL 与协议由隔离 Go 测试覆盖。
async function mockShops(page: Page, permissions = ["demo:read", "demo:write", "shop:create"]) {
    const state = {
        rows: Array.from(
            { length: 25 },
            (_, index): Shop => ({
                id: String(index + 1),
                name: `已有店铺${index + 1}`,
                slug: `shop-${String(index + 1).padStart(2, "0")}`,
                status: index % 2 === 0 ? "active" : "inactive",
                createdAt: "2026-10-04T00:00:00Z",
                updatedAt: "2026-10-04T00:00:00Z",
            }),
        ),
        fail: false,
        beforeCreate: async () => {},
        createError: false,
        requests: [] as {
            limit: number;
            offset: number;
            where: { slug?: { like: string }; status?: { eq: string } };
        }[],
    };
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/rest/demo/overview") {
            await route.fulfill({ json: { shops: state.rows.length, backend: "mock" } });
            return;
        }
        if (path !== "/api/graphql/admin") throw new Error(`意外请求 ${path}`);
        const { query, variables } = route.request().postDataJSON();
        if (query.includes("getDashboardSession")) {
            await route.fulfill({
                json: {
                    data: {
                        getCurrentUser: {
                            id: "1",
                            name: "列表验收管理员",
                            email: "owner@example.com",
                            image: null,
                        },
                        getCurrentPermissions: permissions,
                    },
                },
            });
            return;
        }
        if (query.includes("createShop")) {
            await state.beforeCreate();
            if (state.createError) {
                await route.fulfill({ json: { errors: [{ message: "延迟创建失败" }] } });
                return;
            }
            if (state.rows.some((row) => row.slug === variables.set.slug)) {
                await route.fulfill({ json: { errors: [{ message: "slug 已存在" }] } });
                return;
            }
            const row = {
                ...variables.set,
                id: String(state.rows.length + 1),
                status: "active",
                createdAt: "2026-10-04T01:00:00Z",
                updatedAt: "2026-10-04T01:00:00Z",
            };
            state.rows.push(row);
            await route.fulfill({ json: { data: { createShop: row } } });
            return;
        }
        expect(query).toContain("listShops");
        state.requests.push(variables);
        if (state.fail) {
            await route.fulfill({ json: { errors: [{ message: "列表服务暂时不可用" }] } });
            return;
        }
        const keyword = variables.where.slug?.like.slice(1, -1) ?? "";
        if (keyword === "slow") await new Promise((resolve) => setTimeout(resolve, 400));
        const rows = state.rows
            .filter(
                (row) =>
                    row.slug.includes(keyword) &&
                    (!variables.where.status || row.status === variables.where.status.eq),
            )
            .sort((a, b) => Number(b.id) - Number(a.id));
        await route.fulfill({
            json: {
                data: {
                    listShops: rows.slice(variables.offset, variables.offset + variables.limit),
                },
            },
        });
    });
    return state;
}

test("已有店铺、分页与刷新后的 URL 状态", async ({ page }) => {
    const state = await mockShops(page);
    await page.goto("/admin/shops");
    await expect(page.getByRole("heading", { name: "店铺列表", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(21);
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole("cell", { name: "shop-05", exact: true })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole("cell", { name: "shop-05", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "上一页", exact: true }).click();
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "每页条数", exact: true }).click();
    await page.getByRole("option", { name: "10 / 页", exact: true }).click();
    await expect(page.getByRole("row")).toHaveCount(11);
    expect(state.requests.at(-1)?.limit).toBe(11);
    expect(state.requests.some((input) => input.offset === 20)).toBeTruthy();
});

test("筛选、空态、重置与浏览器历史", async ({ page }) => {
    const state = await mockShops(page);
    await page.goto("/admin/shops?page=2&pageSize=10");
    await expect(page.getByRole("cell", { name: "shop-15", exact: true })).toBeVisible();
    await page.getByLabel("标识筛选", { exact: true }).fill("shop-0");
    await page.getByRole("combobox", { name: "状态筛选", exact: true }).click();
    await page.getByRole("option", { name: "停用", exact: true }).click();
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByRole("cell", { name: "shop-08", exact: true })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(5);
    expect(state.requests.at(-1)?.where).toEqual({
        slug: { like: "%shop-0%" },
        status: { eq: "inactive" },
    });
    expect(state.requests.at(-1)?.offset).toBe(0);
    await page.reload();
    await expect(page.getByLabel("标识筛选", { exact: true })).toHaveValue("shop-0");
    await expect(page.getByRole("combobox", { name: "状态筛选", exact: true })).toHaveText("停用");
    await page.getByLabel("标识筛选", { exact: true }).fill("missing");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByText("暂无匹配的店铺", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel("标识筛选", { exact: true })).toHaveValue("shop-0");
    await expect(page.getByRole("cell", { name: "shop-08", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/shops\?pageSize=10$/);
});

test("创建后回首页清除筛选、刷新持久化列表与重复标识", async ({ page }) => {
    await mockShops(page);
    await page.goto("/admin/shops?page=2&status=inactive");
    await expect(page.getByText("暂无匹配的店铺", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "创建店铺", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("名称", { exact: true }).fill("新店铺");
    await page.getByLabel("唯一标识", { exact: true }).fill("created-shop");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("cell", { name: "created-shop", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/shops$/);
    await expect(page.getByRole("combobox", { name: "状态筛选", exact: true })).toHaveText(
        "全部状态",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "创建店铺", exact: true }).click();
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("slug 已存在");
    await page.reload();
    await expect(page.getByRole("cell", { name: "created-shop", exact: true })).toBeVisible();
});

test("列表失败、重试与手动刷新", async ({ page }) => {
    const state = await mockShops(page);
    state.fail = true;
    await page.goto("/admin/shops");
    await expect(page.getByRole("alert")).toHaveText("列表服务暂时不可用");
    await expect(page.getByText("暂无匹配的店铺", { exact: true })).toHaveCount(0);
    state.fail = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    state.rows[24].name = "外部更新后的店铺";
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await expect(page.getByRole("cell", { name: "外部更新后的店铺", exact: true })).toBeVisible();
});

test("快速筛选时旧响应保持隔离", async ({ page }) => {
    const state = await mockShops(page);
    await page.goto("/admin/shops");
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await page.getByLabel("标识筛选", { exact: true }).fill("slow");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect
        .poll(() => state.requests.some((input) => input.where.slug?.like === "%slow%"))
        .toBeTruthy();
    await expect(page.getByText("正在加载店铺…", { exact: true })).toBeVisible();
    await page.getByLabel("标识筛选", { exact: true }).fill("shop-25");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await expect(page.getByText("暂无匹配的店铺", { exact: true })).toHaveCount(0);
});

test("移动端列表与异常分页参数", async ({ page }) => {
    const state = await mockShops(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/shops?page=-1&pageSize=100000&status=unknown");
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    expect(state.requests.at(-1)?.offset).toBe(0);
    expect(state.requests.at(-1)?.limit).toBe(21);
    expect(state.requests.at(-1)?.where).toEqual({});
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
});

test("Node.js 版页面结构、明暗主题及移动端抽屉", async ({ page }, testInfo) => {
    await mockShops(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/shops");
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    const list = page.getByTestId("shop-list-page");
    await expect(list.locator('[data-slot="card"]')).toHaveCount(0);
    await expect(page.getByTestId("shop-filters")).toHaveCSS("display", "grid");
    await expect(page.getByRole("columnheader", { name: "更新时间", exact: true })).toBeVisible();
    await expect(
        page.getByRole("cell", { name: "启用", exact: true }).first().locator("span"),
    ).toHaveClass(/border-emerald-200/);
    await expect(
        page.getByRole("cell", { name: "已有店铺25", exact: true }).locator("span"),
    ).toHaveClass(/font-medium/);
    await page.screenshot({ path: testInfo.outputPath("shops-light.png"), fullPage: true });
    await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: testInfo.outputPath("shops-dark.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "创建店铺", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("width", "390px");
    await page.getByLabel("名称", { exact: true }).fill("抽屉保留内容");
    await page.screenshot({
        path: testInfo.outputPath("shops-mobile-create.png"),
        fullPage: false,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "创建店铺", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "创建店铺", exact: true }).click();
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue("抽屉保留内容");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
});

test("店铺只读权限保留列表并隐藏创建入口", async ({ page }) => {
    await mockShops(page, ["demo:read", "shop:list"]);
    await page.goto("/admin/shops");
    await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "创建店铺", exact: true })).toHaveCount(0);
});

for (const fail of [false, true]) {
    test(`离开店铺页后清理创建请求并忽略迟到${fail ? "失败" : "成功"}响应`, async ({ page }) => {
        const state = await mockShops(page);
        let release!: () => void;
        let started!: () => void;
        let completed!: () => void;
        const beginning = new Promise<void>((resolve) => {
            started = resolve;
        });
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        const completion = new Promise<void>((resolve) => {
            completed = resolve;
        });
        state.createError = fail;
        state.beforeCreate = async () => {
            started();
            await released;
            completed();
        };
        const urlChanges: string[] = [];
        page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame()) urlChanges.push(frame.url());
        });
        await page.goto("/admin/");
        await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "店铺列表", exact: true }).click();
        await expect(page.getByRole("cell", { name: "shop-25", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "创建店铺", exact: true }).click();
        await page.getByLabel("名称", { exact: true }).fill("延迟创建店铺");
        await page.getByLabel("唯一标识", { exact: true }).fill("late-shop");
        const failedRequest = page.waitForEvent("requestfailed", {
            predicate: (request) => request.postData()?.includes("createShop") ?? false,
        });
        await page.getByRole("button", { name: "创建", exact: true }).click();
        await beginning;
        await page.goBack();
        await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
        await failedRequest;
        const current = page.url();
        const count = urlChanges.length;
        release();
        await completion;
        // 服务端已经完成的写入继续有效；页面保留用户选择的导航位置。
        await page.waitForTimeout(300);
        expect(page.url()).toBe(current);
        expect(urlChanges).toHaveLength(count);
        await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
        await expect(page.getByText("延迟创建失败", { exact: true })).toHaveCount(0);
    });
}
