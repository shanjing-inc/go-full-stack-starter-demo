import { signOutFromSidebar } from "./sidebar-helpers.js";
import { selectUserAction } from "./user-action-helpers.js";
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.goto("/admin/");
    await expect(page).toHaveURL(/\/admin\/login(?:\?returnTo=.*)?$/);
    await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
    await page.getByLabel("密码", { exact: true }).fill("owner-password-2026");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByText("验收管理员", { exact: true })).toBeVisible();
});

test("真实 Go API、店铺唯一约束与队列执行记录深链", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/admin/");
    await expect(page.getByText("Go / Echo", { exact: true })).toBeVisible();
    await expect(page.getByText("验收管理员", { exact: true })).toBeVisible();
    await expect(page.getByTestId("shop-count")).toHaveText(/^\d+$/);
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/shops$/);
    const slug = `browser-${Date.now()}`;
    await page.getByRole("button", { name: "创建店铺", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill("浏览器集成店铺");
    await page.getByLabel("唯一标识", { exact: true }).fill(slug);
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("cell", { name: slug, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "创建店铺", exact: true }).click();
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("slug 已存在");
    await page.reload();
    await expect(page.getByRole("heading", { name: "店铺列表", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: slug, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "系统概览", exact: true }).click();
    await expect(page.getByTestId("shop-count")).toHaveText(/^[1-9]\d*$/);
    // 共用当前管理员会话，队列验收沿用正式登录限流。
    await test.step("真实队列入队、独立执行记录与详情深链", async () => {
        const origin = new URL(page.url()).origin;
        const response = await page.request.post("/api/rest/demo/tasks", {
            data: { key: `browser-queue-${Date.now()}` },
            headers: { Origin: origin },
        });
        expect(response.status()).toBe(202);
        const task = await response.json();
        expect(task.id).toEqual(expect.any(String));
        await page.goto("/admin/queues");
        await expect(page.getByRole("heading", { name: "控制台", exact: true })).toBeVisible();
        await expect
            .poll(async () => {
                const response = await page.request.post("/api/graphql/admin", {
                    headers: { Origin: origin },
                    data: {
                        query: '{listQueueExecutionRecords(status:"completed",jobName:"demo:effect",limit:100){records{id jobId status}}}',
                    },
                });
                expect(response.status()).toBe(200);
                const payload = await response.json();
                expect(payload.errors).toBeUndefined();
                return payload.data?.listQueueExecutionRecords.records.find(
                    (r: { jobId: string }) => r.jobId === task.id,
                );
            })
            .toBeTruthy();
        const listed = await page.request.post("/api/graphql/admin", {
            headers: { Origin: origin },
            data: {
                query: '{listQueueExecutionRecords(status:"completed",jobName:"demo:effect",limit:100){records{id jobId status}}}',
            },
        });
        const record = (await listed.json()).data.listQueueExecutionRecords.records.find(
            (r: { jobId: string }) => r.jobId === task.id,
        );
        await page.getByRole("link", { name: "已完成任务", exact: true }).click();
        await expect(page).toHaveURL(/\/queues\/jobs\/completed$/);
        await expect(page.getByRole("heading", { name: "已完成任务", exact: true })).toBeVisible();
        await page.goto(`/admin/queues/jobs/completed/${record.id}`);
        const detail = page.getByRole("region", { name: "执行详情", exact: true });
        await expect(detail.getByText(task.id, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "重试一次", exact: true })).toBeDisabled();
        await page.reload();
        await expect(detail.getByText(record.id, { exact: true })).toBeVisible();
    });
    await test.step("真实 Worker 原生在线信息、共享并发与内存采样", async () => {
        const origin = new URL(page.url()).origin;
        await expect
            .poll(
                async () => {
                    const response = await page.request.post("/api/graphql/admin", {
                        headers: { Origin: origin },
                        data: {
                            query: `{getQueueDashboard{capabilities{supportsWorkerPresence} overview{onlineWorkers} hasOnlineWorkers workerProcesses{name processGroup queues instances concurrency onlineInstances isOnline maxMemory memoryBytes} queues{queueName concurrency workerCount isListening workerProcessName}}}`,
                        },
                    });
                    expect(response.status()).toBe(200);
                    const payload = await response.json();
                    expect(payload.errors).toBeUndefined();
                    const dashboard = payload.data.getQueueDashboard;
                    expect(dashboard.capabilities.supportsWorkerPresence).toBe(true);
                    expect(dashboard.overview.onlineWorkers).toBeGreaterThan(0);
                    expect(dashboard.hasOnlineWorkers).toBe(true);
                    expect(dashboard.workerProcesses).toHaveLength(1);
                    const process = dashboard.workerProcesses[0];
                    expect(process.name).toMatch(/-worker$/);
                    expect(process.processGroup).toBe("shared");
                    expect(process.instances).toBeNull();
                    expect(process.concurrency).toBeGreaterThan(0);
                    expect(process.onlineInstances).toBe(dashboard.overview.onlineWorkers);
                    expect(process.isOnline).toBe(true);
                    expect(process.maxMemory).toBe("");
                    expect(process.queues).toEqual(["critical", "default", "low"]);
                    for (const queue of dashboard.queues) {
                        expect(queue.concurrency).toBeNull();
                        expect(queue.workerCount).toBeGreaterThan(0);
                        expect(queue.isListening).toBe(true);
                        expect(queue.workerProcessName).toBe(process.name);
                    }
                    return process.memoryBytes;
                },
                { timeout: 10000 },
            )
            .toBeGreaterThan(0);
        await page.goto("/admin/queues");
        const workers = page.getByRole("region", { name: "Worker 进程", exact: true });
        await expect(workers.getByRole("cell", { name: "在线", exact: true })).toBeVisible();
        await expect(workers.getByRole("cell", { name: "—", exact: true })).toHaveCount(2);
        await workers.getByRole("cell", { name: "—", exact: true }).first().locator("span").focus();
        await expect(page.getByRole("tooltip")).toHaveText("由部署环境配置");
        await expect(workers.getByRole("cell").filter({ hasText: /^\d+\.\d MB$/ })).toBeVisible();
        await page.reload();
        await expect(workers.getByRole("cell", { name: "在线", exact: true })).toBeVisible();
    });
    await test.step("真实计划定义、停用状态与在线调度器心跳", async () => {
        const origin = new URL(page.url()).origin;
        let schedules: {
            scheduleCount: number;
            schedulerInstanceCount: number;
            schedulerLeader: string | null;
            schedules: { name: string; enabled: boolean; nextRunAt: number | null }[];
            heartbeats: { instanceId: string; role: string }[];
        };
        await expect
            .poll(async () => {
                const response = await page.request.post("/api/graphql/admin", {
                    headers: { Origin: origin },
                    data: {
                        query: "{getQueueSchedules{scheduleCount schedulerInstanceCount schedulerLeader schedules{name enabled nextRunAt} heartbeats{instanceId role}}}",
                    },
                });
                expect(response.status()).toBe(200);
                const payload = await response.json();
                expect(payload.errors).toBeUndefined();
                schedules = payload.data.getQueueSchedules;
                return schedules.schedulerInstanceCount;
            })
            .toBeGreaterThan(0);
        expect(schedules!.scheduleCount).toBe(1);
        expect(schedules!.schedules[0]).toEqual({
            name: "demo-tick",
            enabled: false,
            nextRunAt: null,
        });
        expect(schedules!.schedulerLeader).toEqual(expect.any(String));
        expect(
            schedules!.heartbeats.some(
                (h) => h.role === "leader" && h.instanceId === schedules.schedulerLeader,
            ),
        ).toBeTruthy();
        await page.getByRole("link", { name: "计划任务", exact: true }).click();
        await expect(page).toHaveURL(/\/admin\/queues\/schedules$/);
        const definitions = page.getByRole("region", { name: "计划定义" });
        await expect(definitions.getByRole("cell", { name: "停用", exact: true })).toBeVisible();
        await expect(
            definitions.getByRole("cell", { name: "@every 1m", exact: true }),
        ).toBeVisible();
        await expect(
            definitions.getByRole("cell", { name: "Asia/Shanghai", exact: true }),
        ).toBeVisible();
        await expect(
            page.getByRole("region", { name: "调度器心跳" }).getByText("主调度器", { exact: true }),
        ).toBeVisible();
        await page.reload();
        await expect(page.getByRole("heading", { name: "计划任务", exact: true })).toBeVisible();
        await expect(definitions.getByRole("cell", { name: "停用", exact: true })).toBeVisible();
    });
    expect(errors).toEqual([]);
});

test("主题、字号持久化与退出适配器", async ({ page }) => {
    await page.goto("/admin/");
    await expect(page.getByText("验收管理员", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "切换深色主题", exact: true }).click();
    await page.getByRole("button", { name: "字号：标准", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "舒展 18px", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveCSS("font-size", "18px");
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveCSS("font-size", "18px");
    await signOutFromSidebar(page);
    await expect(page).toHaveURL(/\/admin\/login(?:\?returnTo=.*)?$/);
    await expect(page.getByRole("heading")).toHaveText("邮箱登录");
});

test("移动端侧栏与布局", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/admin/");
    await expect(page.getByText("Go / Echo", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "切换侧栏", exact: true }).click();
    await page.getByRole("button", { name: "店铺列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "店铺列表", exact: true })).toBeVisible();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    expect(errors).toEqual([]);
});

test("退出撤销服务端会话与失效会话保护", async ({ page, context }) => {
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === "better-auth.session_token");
    expect(session).toBeDefined();
    await signOutFromSidebar(page);
    await expect(page).toHaveURL(/\/admin\/login(?:\?returnTo=.*)?$/);
    const revoked = await page.request.get("/api/rest/demo/session", {
        headers: { Cookie: `${session!.name}=${session!.value}` },
    });
    expect(revoked.status()).toBe(401);
    await context.clearCookies();
    await page.goto("/admin/shops");
    await expect(page).toHaveURL(/\/admin\/login(?:\?returnTo=.*)?$/);
});

test("真实用户查询、创建、编辑、角色、封禁与会话撤销", async ({ page, browser }) => {
    await page.getByRole("button", { name: "用户列表", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole("heading", { name: "用户列表", exact: true })).toBeVisible();
    await expect(
        page.getByRole("table").getByText("owner@example.com", { exact: true }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("owner@example.com");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByRole("row")).toHaveCount(2);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toHaveValue(
        "owner@example.com",
    );
    await expect(page.getByRole("cell", { name: "owner,user", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("missing-user@example.com");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByText("暂无用户记录", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重置", exact: true }).click();
    const email = `management-${Date.now()}@example.test`;
    await page.getByRole("button", { name: "创建用户", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("名称", { exact: true }).fill("真实新增用户");
    await dialog.getByLabel("邮箱", { exact: true }).fill(email);
    await dialog.getByLabel("初始密码", { exact: true }).fill("12345678");
    await dialog.getByRole("button", { name: "确认创建", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole("row").filter({ has: page.getByText(email, { exact: true }) });
    await expect(row).toBeVisible();
    // 独立浏览器上下文验证实际凭据和数据库会话状态，保留管理员登录态。
    const origin = new URL(page.url()).origin;
    const member = await browser.newContext();
    const login = async () => {
        const response = await member.request.post(`${origin}/api/auth/sign-in/email`, {
            headers: { Origin: origin },
            data: { email, password: "12345678" },
        });
        return response.status();
    };
    const current = async () => (await member.request.get(`${origin}/api/auth/get-session`)).json();
    try {
        expect(await login()).toBe(200);
        expect((await current()).user.email).toBe(email);
        await selectUserAction(page, row, "编辑");
        await dialog.getByLabel("名称", { exact: true }).fill("真实编辑用户");
        await dialog.getByRole("button", { name: "保存", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(row.getByText("真实编辑用户", { exact: true })).toBeVisible();
        expect((await current()).user.name).toBe("真实编辑用户");
        await selectUserAction(page, row, "编辑");
        await dialog.getByRole("combobox").click();
        await page.getByRole("option", { name: "admin", exact: true }).click();
        await dialog.getByRole("button", { name: "保存", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(row.getByText("admin", { exact: true })).toBeVisible();
        expect(await current()).toBeNull();
        expect(await login()).toBe(200);
        await selectUserAction(page, row, "封禁");
        await dialog.getByLabel("封禁原因", { exact: true }).fill("真实封禁验收");
        await dialog.getByRole("button", { name: "确认", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(row.getByText("已封禁", { exact: true })).toBeVisible();
        expect(await current()).toBeNull();
        expect(await login()).toBe(403);
        await selectUserAction(page, row, "解封");
        await dialog.getByRole("button", { name: "确认", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(row.getByText("正常", { exact: true })).toBeVisible();
        expect(await login()).toBe(200);
        await selectUserAction(page, row, "撤销会话");
        await dialog.getByRole("button", { name: "确认", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(await current()).toBeNull();
        await page.reload();
        await expect(row.getByText("真实编辑用户", { exact: true })).toBeVisible();
    } finally {
        await member.close();
    }
});
