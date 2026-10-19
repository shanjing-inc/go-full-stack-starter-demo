import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

test.skip(
    process.env.TEST_PRODUCTION_CHUNKS !== "1",
    "使用生产产物并设置 TEST_PRODUCTION_CHUNKS=1 验收请求闭包",
);

type Manifest = Record<string, { file: string; imports?: string[] }>;
function productionManifest(): Manifest {
    return JSON.parse(
        readFileSync(
            new URL("../../backend/internal/web/dist/manifest.json", import.meta.url),
            "utf8",
        ),
    );
}
function closure(manifest: Manifest, ...entries: string[]) {
    const paths = new Set<string>();
    function visit(key: string) {
        const entry = manifest[key]!;
        const path = `/admin/${entry.file}`;
        if (paths.has(path)) return;
        paths.add(path);
        for (const dependency of entry.imports ?? []) visit(dependency);
    }
    entries.forEach(visit);
    return paths;
}
function scripts(page: Page) {
    const requests: string[] = [];
    page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/admin/assets/") && path.endsWith(".js")) requests.push(path);
    });
    return requests;
}
async function mockAPI(page: Page, anonymous = false) {
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path !== "/api/graphql/admin") throw new Error(`意外接口 ${path}`);
        const respond = (query: string) => {
            if (query.includes("getInstallStatus"))
                return { data: { getInstallStatus: { installed: true, enabled: false } } };
            if (query.includes("signInWithEmail"))
                return { data: { signInWithEmail: { id: "1", email: "owner@example.test" } } };
            if (query.includes("getDashboardSession"))
                return anonymous
                    ? { errors: [{ message: "请重新登录", extensions: { code: "UNAUTHORIZED" } }] }
                    : {
                          data: {
                              getCurrentUser: {
                                  id: "1",
                                  name: "分包验收管理员",
                                  email: "owner@example.test",
                                  image: null,
                              },
                              getCurrentPermissions: ["user:list", "demo:read", "queue:read"],
                          },
                      };
            if (query.includes("getDashboardOverview"))
                return {
                    data: {
                        getDashboardOverview: {
                            shops: 1,
                            backend: "分包验收后端",
                            mode: "production",
                        },
                    },
                };
            if (query.includes("listUsers")) return { data: { listUsers: [] } };
            if (query.includes("getQueueDashboard"))
                return {
                    data: {
                        getQueueDashboard: {
                            updatedAt: 0,
                            queueCount: 0,
                            hasOnlineWorkers: false,
                            capabilities: {
                                supportsWorkerPresence: false,
                                supportsPauseState: false,
                                supportsSchedules: true,
                                supportsRetry: false,
                            },
                            overview: {
                                onlineWorkers: 0,
                                waiting: 0,
                                active: 0,
                                delayed: 0,
                                retrying: 0,
                                failed: 0,
                                completed: 0,
                                succeededExecutions24h: 0,
                                failedExecutions24h: 0,
                            },
                            queues: [],
                            workerProcesses: [],
                        },
                    },
                };
            if (query.includes("getQueueSchedules"))
                return {
                    data: {
                        getQueueSchedules: {
                            scheduleCount: 0,
                            schedulerInstanceCount: 0,
                            schedulerLeader: "",
                            updatedAt: 0,
                            schedules: [],
                            heartbeats: [],
                        },
                    },
                };
            throw new Error(`意外 GraphQL ${query}`);
        };
        const body = route.request().postDataJSON();
        await route.fulfill({
            json: Array.isArray(body)
                ? body.map((operation) => respond(operation.query))
                : respond(body.query),
        });
    });
}
async function overview(page: Page) {
    await expect(page.getByText("分包验收后端", { exact: true })).toBeVisible();
}
async function schedules(page: Page) {
    const link = page.getByRole("link", { name: "计划任务", exact: true });
    if (!(await link.isVisible())) {
        await page.getByRole("button", { name: "队列管理", exact: true }).click();
    }
    await link.click();
    await expect(page.getByText("当前没有注册计划任务", { exact: true })).toBeVisible();
}

test("登录和后台共用同步入口，登录后复用全部模块", async ({ page }) => {
    const manifest = productionManifest();
    const requests = scripts(page);
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await mockAPI(page);
    await page.goto("/admin/login");
    await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
    expect(new Set(requests)).toEqual(closure(manifest, "index.html"));
    const initial = [...requests];

    await page.getByLabel("邮箱", { exact: true }).fill("owner@example.test");
    await page.getByLabel("密码", { exact: true }).fill("password-2026");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await overview(page);
    expect(requests).toEqual(initial);
    expect(new Set(requests)).toEqual(closure(manifest, "index.html"));
    expect(failures).toEqual([]);
});

test("后台切换用户和队列页面复用全部已加载模块", async ({ page }) => {
    const manifest = productionManifest();
    const requests = scripts(page);
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await mockAPI(page);
    await page.goto("/admin/");
    await overview(page);
    const initial = [...requests];
    expect(new Set(initial)).toEqual(closure(manifest, "index.html"));
    await page.getByRole("button", { name: "用户列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "用户列表", exact: true })).toBeVisible();
    await schedules(page);
    await page.getByRole("button", { name: "系统概览", exact: true }).click();
    await overview(page);
    await page.getByRole("button", { name: "用户列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "用户列表", exact: true })).toBeVisible();
    await schedules(page);
    expect(requests).toEqual(initial);
    expect(requests).toHaveLength(new Set(requests).size);
    expect(failures).toEqual([]);
});

test("匿名访问后台根地址加载后台闭包并跳转登录", async ({ page }) => {
    const manifest = productionManifest();
    const requests = scripts(page);
    await mockAPI(page, true);
    await page.goto("/admin/");
    await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "邮箱登录", exact: true })).toBeVisible();
    expect(new Set(requests)).toEqual(closure(manifest, "index.html"));
    expect(requests).toHaveLength(new Set(requests).size);
});
