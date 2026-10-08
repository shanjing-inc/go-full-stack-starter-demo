import { test, expect, type Page } from "@playwright/test";

async function mockQueue(page: Page, permissions = ["queue:read", "queue:retry"]) {
    const at = Date.parse("2026-10-05T01:00:00Z");
    const rows = Array.from({ length: 25 }, (_, i) => ({
        id: `record-${25 - i}`,
        jobId: `task-${25 - i}`,
        jobName: "demo:failure",
        name: "demo:failure",
        queueName: i % 2 ? "low" : "default",
        executionNumber: 1,
        status: "failed",
        state: "failed",
        statusHint: "failed",
        sortAt: at - i * 1000,
        queuedAt: at - i * 1000,
        processedAt: at - i * 1000,
        finishedAt: at,
        runtimeMs: 12,
        attempts: 3,
        retryOfRecordId: null as string | null,
        latestRecordId: `record-${25 - i}`,
        currentJobState: "archived",
        canRetry: true,
        retryDisabledReason: "",
        data: { password: "[已脱敏]", normal: "公开参数" },
        returnValue: null,
        opts: { maxRetry: 3 },
        meta: null,
        failedReason: "password=[已脱敏]",
        stacktrace: [],
    }));
    const state = {
        rows,
        overviews: 0,
        scheduleRequests: 0,
        workerPresence: false,
        workerInstances: null as number | null,
        workerMaxMemory: "",
        onlineWorkers: 2,
        workerMemory: (32 * 1024 * 1024) as number | null,
        scheduleError: "",
        schedules: {
            scheduleCount: 2,
            schedulerInstanceCount: 2,
            schedulerLeader: "scheduler-primary",
            updatedAt: at,
            schedules: [
                {
                    name: "demo-tick",
                    cron: "@every 1m",
                    timezone: "Asia/Shanghai",
                    jobName: "demo:effect",
                    queueName: "default",
                    description: "默认停用的示例计划",
                    enabled: false,
                    nextRunAt: null,
                    lastActivityAt: null,
                    status: "idle",
                    statusText: "等待派发",
                },
                {
                    name: "enabled-tick",
                    cron: "0 9 * * *",
                    timezone: "Asia/Shanghai",
                    jobName: "demo:effect",
                    queueName: "critical",
                    description: "每日任务",
                    enabled: true,
                    nextRunAt: at + 60000,
                    lastActivityAt: at,
                    status: "dispatched",
                    statusText: "已派发",
                },
            ],
            heartbeats: [
                { instanceId: "scheduler-primary", lastHeartbeatAt: at, role: "leader" },
                { instanceId: "scheduler-secondary", lastHeartbeatAt: at, role: "follower" },
            ],
        },
        lists: [] as Record<string, any>[],
        details: [] as string[],
        retries: [] as string[],
        listError: "",
        retryError: "",
        delay: 0,
    };
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/rest/demo/overview") {
            await route.fulfill({ json: { shops: 1, backend: "队列验收" } });
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
                            name: "队列管理员",
                            email: "queue@example.test",
                            role: "admin",
                        },
                        getCurrentPermissions: permissions,
                    },
                },
            });
            return;
        }
        if (query.includes("getQueueSchedules")) {
            state.scheduleRequests++;
            await route.fulfill({
                json: state.scheduleError
                    ? { errors: [{ message: state.scheduleError }] }
                    : { data: { getQueueSchedules: state.schedules } },
            });
            return;
        }
        if (query.includes("getQueueDashboard")) {
            state.overviews++;
            const counts = {
                waiting: 2,
                active: 1,
                delayed: 3,
                retrying: 4,
                failed: 5,
                completed: 6,
                onlineWorkers: 0,
                succeededExecutions24h: 8,
                failedExecutions24h: 9,
            };
            await route.fulfill({
                json: {
                    data: {
                        getQueueDashboard: {
                            overview: {
                                ...counts,
                                onlineWorkers: state.workerPresence ? state.onlineWorkers : 0,
                            },
                            queueCount: 3,
                            hasOnlineWorkers: state.workerPresence && state.onlineWorkers > 0,
                            capabilities: {
                                supportsWorkerPresence: state.workerPresence,
                                supportsPauseState: false,
                                supportsSchedules: false,
                                supportsRetry: true,
                            },
                            workerProcesses: state.workerPresence
                                ? [
                                      {
                                          name: "test-worker",
                                          processGroup: "shared",
                                          queues: ["critical", "default", "low"],
                                          instances: state.workerInstances,
                                          concurrency: 4,
                                          onlineInstances: state.onlineWorkers,
                                          maxMemory: state.workerMaxMemory,
                                          memoryBytes:
                                              state.onlineWorkers > 0 ? state.workerMemory : null,
                                          isOnline: state.onlineWorkers > 0,
                                      },
                                  ]
                                : [],
                            queues: [
                                {
                                    ...counts,
                                    queueName: "default",
                                    physicalQueueName: "test-default",
                                    concurrency: null,
                                    workerProcessName: state.workerPresence ? "test-worker" : null,
                                    workerProcessGroup: state.workerPresence ? "shared" : null,
                                    workerCount: state.workerPresence ? state.onlineWorkers : 0,
                                    isListening: state.workerPresence && state.onlineWorkers > 0,
                                    isPaused: false,
                                },
                            ],
                            updatedAt: at,
                        },
                    },
                },
            });
            return;
        }
        if (query.includes("listQueueExecutionRecords")) {
            state.lists.push(variables);
            if (state.listError) {
                await route.fulfill({ json: { errors: [{ message: state.listError }] } });
                return;
            }
            const filtered = state.rows.filter(
                (r) =>
                    (["all", "recent"].includes(variables.status) ||
                        variables.status === r.status ||
                        (variables.status === "waiting" && r.status === "delayed")) &&
                    (!variables.queueName || variables.queueName === r.queueName) &&
                    (!variables.jobName || variables.jobName === r.jobName) &&
                    (!variables.from || r.sortAt >= variables.from) &&
                    (!variables.to || r.sortAt <= variables.to),
            );
            await route.fulfill({
                json: {
                    data: {
                        listQueueExecutionRecords: {
                            total: filtered.length,
                            records: filtered.slice(
                                variables.offset,
                                variables.offset + variables.limit,
                            ),
                        },
                    },
                },
            });
            return;
        }
        if (query.includes("getQueueExecutionRecord")) {
            state.details.push(variables.recordId);
            const record = state.rows.find((r) => r.id === variables.recordId);
            await route.fulfill({
                json: record
                    ? { data: { getQueueExecutionRecord: record } }
                    : { errors: [{ message: "执行记录已过期或不存在" }] },
            });
            return;
        }
        if (query.includes("updateQueueExecutionRecord")) {
            state.retries.push(variables.set.recordId);
            if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
            if (state.retryError) {
                await route.fulfill({ json: { errors: [{ message: state.retryError }] } });
                return;
            }
            const previous = state.rows.find((r) => r.id === variables.set.recordId)!;
            const next = {
                ...previous,
                id: "record-new",
                executionNumber: previous.executionNumber + 1,
                status: "waiting",
                state: "waiting",
                statusHint: "waiting",
                currentJobState: "pending",
                canRetry: false,
                retryDisabledReason: "最终失败后可重试",
                latestRecordId: "record-new",
                retryOfRecordId: previous.id,
                processedAt: null as unknown as number,
                finishedAt: null as unknown as number,
                runtimeMs: null as unknown as number,
                failedReason: "",
            };
            previous.canRetry = false;
            previous.latestRecordId = next.id;
            previous.retryDisabledReason = "请通过最新执行记录发起重试";
            state.rows.unshift(next);
            await route.fulfill({
                json: {
                    data: {
                        updateQueueExecutionRecord: { detail: next, noticeMessage: "已安排重试" },
                    },
                },
            });
            return;
        }
        throw new Error(`意外 GraphQL ${query}`);
    });
    return state;
}

test("最近任务支持服务端分页及筛选 URL", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues/jobs/recent");
    await expect(page.getByRole("heading", { name: "最近任务", exact: true })).toBeVisible();
    expect(state.overviews).toBe(0);
    await expect(page.getByText("第 1 页 · 显示 1–20 条，共 25 条", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(
        page.getByText("第 2 页 · 显示 21–25 条，共 25 条", { exact: true }),
    ).toBeVisible();
    expect(state.lists.at(-1)?.offset).toBe(20);
    expect(state.lists.at(-1)).toMatchObject({ orderBy: "updatedAt", orderDirection: "desc" });
    await page.getByRole("combobox", { name: "每页条数", exact: true }).click();
    await page.getByRole("option", { name: "100 / 页", exact: true }).click();
    await expect(page.getByText("第 1 页 · 显示 1–25 条，共 25 条", { exact: true })).toBeVisible();
    expect(state.lists.at(-1)?.limit).toBe(100);
    await page.getByRole("combobox", { name: "队列", exact: true }).click();
    await page.getByRole("option", { name: "low", exact: true }).click();
    await page.getByLabel("任务类型", { exact: true }).fill("demo:failure");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page).toHaveURL(/queue=low/);
    await expect(page.getByRole("row")).toHaveCount(13);
    await page.reload();
    await expect(page.getByLabel("任务类型", { exact: true })).toHaveValue("demo:failure");
    expect(state.lists.at(-1)).toMatchObject({
        queueName: "low",
        jobName: "demo:failure",
        limit: 100,
        offset: 0,
    });
});

test("成功执行状态在列表和详情中展示绿色标签", async ({ page }) => {
    const state = await mockQueue(page);
    Object.assign(state.rows[0]!, {
        status: "completed",
        state: "completed",
        statusHint: "completed",
        currentJobState: "completed",
        canRetry: false,
        failedReason: "",
    });
    await page.goto("/admin/queues/jobs/recent");
    const row = page.getByRole("row").filter({ has: page.locator('a[href*="record-25"]') });
    const badge = row.getByText("成功", { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/bg-emerald-50/);
    await expect(badge).toHaveClass(/text-emerald-700/);
    await expect(badge).toHaveClass(/dark:text-emerald-300/);
    await row.getByRole("link").click();
    const detailBadge = page
        .getByRole("region", { name: "执行详情", exact: true })
        .getByText("成功", { exact: true });
    await expect(detailBadge).toBeVisible();
    await expect(detailBadge).toHaveClass(/bg-emerald-50/);
    await expect(detailBadge).toHaveClass(/text-emerald-700/);
});

test("失败任务仅安排一次重试，并跳转新记录保留历史", async ({ page }) => {
    const state = await mockQueue(page);
    state.delay = 250;
    await page.goto("/admin/queues/jobs/failed/record-25?queue=default&pageSize=50&page=1");
    const dialog = page.getByRole("region", { name: "执行详情", exact: true });
    await expect(dialog.getByText("record-25", { exact: true })).toBeVisible();
    await expect(dialog.getByText('"password": "[已脱敏]"', { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "重试一次", exact: true }).click();
    await expect(page.getByRole("button", { name: "安排中…", exact: true })).toBeDisabled();
    await expect(page).toHaveURL(
        /\/queues\/jobs\/waiting\/record-new\?queue=default&pageSize=50&page=1$/,
    );
    await expect(dialog.getByText("已安排重试", { exact: true })).toBeVisible();
    expect(state.retries).toEqual(["record-25"]);
    await dialog.getByRole("button", { name: "查看上次执行", exact: true }).click();
    await expect(page).toHaveURL(/\/record-25\?queue=default&pageSize=50&page=1$/);
    await expect(page.getByRole("button", { name: "重试一次", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "查看最新执行", exact: true })).toBeVisible();
});

test("仅查看权限保持详情可用，重试入口按权限展示", async ({ page }) => {
    await mockQueue(page, ["queue:read"]);
    await page.goto("/admin/queues/jobs/failed/record-25");
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-25", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "重试一次", exact: true })).toHaveCount(0);
});

test("原任务清理后历史可查，重试禁用并显示原因", async ({ page }) => {
    const state = await mockQueue(page);
    state.rows[0]!.currentJobState = "missing";
    state.rows[0]!.canRetry = false;
    state.rows[0]!.retryDisabledReason = "原任务已清理，执行历史继续保留";
    await page.goto("/admin/queues/jobs/failed/record-25");
    await expect(page.getByRole("button", { name: "重试一次", exact: true })).toBeDisabled();
    await expect(page.getByText("原任务已清理，执行历史继续保留", { exact: true })).toBeVisible();
    expect(state.retries).toEqual([]);
});

test("安排失败提示保持可见，列表错误支持刷新恢复", async ({ page }) => {
    const state = await mockQueue(page);
    state.retryError = "任务已有新执行记录，请刷新后查看";
    await page.goto("/admin/queues/jobs/failed/record-25");
    await page.getByRole("button", { name: "重试一次", exact: true }).click();
    await expect(
        page.getByRole("region", { name: "执行详情", exact: true }).getByRole("alert"),
    ).toHaveText(state.retryError);
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    state.listError = "执行记录读取失败";
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(state.listError);
    state.listError = "";
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("row")).toHaveCount(21);
});

test("移动端详情、筛选和错误权限页面保持可访问", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockQueue(page);
    await page.goto("/admin/queues/jobs/failed/record-25");
    await expect(page.getByRole("region", { name: "执行详情", exact: true })).toBeVisible();
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBeTruthy();
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "失败任务", exact: true })).toBeVisible();
});

test("缺少查看权限时保留权限反馈并隐藏菜单", async ({ page }) => {
    await mockQueue(page, []);
    await page.goto("/admin/queues/jobs/recent");
    await expect(page.getByRole("alert")).toHaveText("当前账号缺少队列查看权限");
    await expect(page.getByRole("button", { name: "失败任务", exact: true })).toHaveCount(0);
});

test("时间范围组件在桌面和移动端保持可访问", async ({ page }) => {
    await mockQueue(page);
    await page.goto("/admin/queues/jobs/recent");
    const range = page.getByRole("group", { name: "时间范围", exact: true });
    for (const width of [375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(range).toBeVisible();
        await expect(range).toHaveText("至");
        const from = range.getByRole("textbox", { name: "开始时间", exact: true });
        const to = range.getByRole("textbox", { name: "结束时间", exact: true });
        await from.fill("2026-10-05T08:59");
        await to.fill("2026-10-05T09:01");
        await expect(from).toHaveValue("2026-10-05T08:59");
        await expect(to).toHaveValue("2026-10-05T09:01");
        await from.focus();
        await page.keyboard.press("Tab");
        await expect
            .poll(() => range.evaluate((element) => element.contains(document.activeElement)))
            .toBeTruthy();
        await expect
            .poll(() =>
                page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            )
            .toBeTruthy();
        const fromBox = await from.boundingBox();
        const toBox = await to.boundingBox();
        expect(fromBox).not.toBeNull();
        expect(toBox).not.toBeNull();
        if (width < 640) {
            expect(toBox!.y).toBeGreaterThanOrEqual(fromBox!.y + fromBox!.height);
        } else {
            expect(toBox!.y).toBe(fromBox!.y);
        }
    }
});

test("时间筛选传递毫秒范围，异常范围保留错误反馈", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues/jobs/recent");
    const range = page.getByRole("group", { name: "时间范围", exact: true });
    await expect(range).toBeVisible();
    await expect(range).toHaveText("至");
    await expect(range.getByRole("textbox")).toHaveCount(2);
    await range.getByRole("textbox", { name: "开始时间", exact: true }).fill("2026-10-05T08:59");
    await page.getByRole("textbox", { name: "结束时间", exact: true }).fill("2026-10-05T09:01");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page).toHaveURL(/from=/);
    await expect.poll(() => state.lists.at(-1)?.from).toBeGreaterThan(0);
    expect(state.lists.at(-1)?.to).toBeGreaterThan(state.lists.at(-1)?.from);
    await page.getByRole("textbox", { name: "开始时间", exact: true }).fill("2026-10-06T09:01");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("时间范围无效");
    await expect(page.getByRole("row")).toHaveCount(1);
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("row")).toHaveCount(21);
    await expect(range.getByRole("textbox", { name: "开始时间", exact: true })).toHaveValue("");
    await expect(range.getByRole("textbox", { name: "结束时间", exact: true })).toHaveValue("");
});

test("返回列表恢复任务链接焦点，详情读取失败提供反馈", async ({ page }) => {
    await mockQueue(page);
    await page.goto("/admin/queues/jobs/recent");
    const trigger = page.locator("a[data-queue-record]").first();
    await trigger.click();
    const dialog = page.getByRole("region", { name: "执行详情", exact: true });
    await expect(dialog.getByText("record-25", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(trigger).toBeFocused();
    await page.goto("/admin/queues/jobs/failed/missing-record");
    await expect(
        page.getByRole("region", { name: "执行详情", exact: true }).getByRole("alert"),
    ).toHaveText("执行记录已过期或不存在");
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByRole("button", { name: "重试一次", exact: true }),
    ).toHaveCount(0);
});

test("控制台展示概览，队列菜单顺序与 Node.js 保持一致", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues");
    await expect(page.getByRole("heading", { name: "控制台", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "队列负载", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Worker 进程", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        "最近 24 小时执行次数",
        "Worker 进程",
        "队列负载",
    ]);
    const overview = page.getByRole("region", { name: "队列概览", exact: true });
    await expect(overview.getByText("Worker 在线信息待接入", { exact: true })).toBeVisible();
    await expect(overview.getByText("—", { exact: true })).toBeVisible();
    await expect(page.getByText("平台差异与功能进度", { exact: true })).toHaveCount(0);
    await expect(
        page.getByRole("heading", { name: "最近 24 小时执行次数", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "执行记录", exact: true })).toHaveCount(0);
    expect(state.lists).toEqual([]);
    const links = page.locator('[data-sidebar="menu-sub"] a');
    await expect(links).toHaveText([
        "控制台",
        "最近任务",
        "运行中任务",
        "已完成任务",
        "失败任务",
        "等待任务",
        "计划任务",
    ]);
    await page.getByRole("link", { name: "失败任务", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed$/);
    await expect(page.getByRole("heading", { name: "失败任务", exact: true })).toBeVisible();
    await expect.poll(() => state.lists.at(-1)?.status).toBe("failed");
    await page.getByRole("link", { name: "控制台", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/queues$/);
});

for (const [status, title, apiStatus] of [
    ["recent", "最近任务", "recent"],
    ["active", "运行中任务", "active"],
    ["completed", "已完成任务", "completed"],
    ["failed", "失败任务", "failed"],
    ["waiting", "等待任务", "waiting"],
]) {
    test(`${title}独立路由及刷新使用对应状态`, async ({ page }) => {
        const state = await mockQueue(page);
        await page.goto(`/admin/queues/jobs/${status}`);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect.poll(() => state.lists.at(-1)?.status).toBe(apiStatus);
        await page.reload();
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect.poll(() => state.lists.length).toBeGreaterThan(1);
        expect(state.lists.at(-1)?.status).toBe(apiStatus);
        expect(state.overviews).toBe(0);
        await expect(page.getByText("平台差异与功能进度", { exact: true })).toHaveCount(0);
    });
}

test("详情深链保留筛选分页，返回后恢复列表和导航活跃状态", async ({ page }) => {
    await mockQueue(page);
    const url =
        "/admin/queues/jobs/failed/record-25?queue=default&type=demo%3Afailure&pageSize=50&page=1";
    await page.goto(url);
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-25", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("平台差异与功能进度", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-25", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('a[data-sidebar="menu-sub-button"][aria-current="page"]')).toHaveText(
        "失败任务",
    );
    await expect(page.locator('[data-slot="breadcrumb-page"]')).toHaveText("失败任务");
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(page.getByRole("heading", { name: "失败任务", exact: true })).toBeFocused();
    await expect(page).toHaveURL(url.replace("/record-25", ""));
    await expect(
        page.locator('a[data-sidebar="menu-sub-button"]').filter({ hasText: "失败任务" }),
    ).toHaveAttribute("data-active", "true");
    await expect(page.locator('[data-slot="breadcrumb-page"]')).toHaveText("失败任务");
    await expect(page.getByLabel("任务类型", { exact: true })).toHaveValue("demo:failure");
    await expect(page.getByRole("combobox", { name: "每页条数", exact: true })).toHaveText(
        "50 / 页",
    );
});

test("旧队列地址迁移控制台和详情，保留筛选与页码", async ({ page }) => {
    await mockQueue(page);
    await page.goto("/admin/queue");
    await expect(page).toHaveURL(/\/admin\/queues$/);
    await expect(page.getByRole("heading", { name: "控制台", exact: true })).toBeVisible();
    await page.goto("/admin/queue?status=failed&record=record-25&queue=default&pageSize=50&page=2");
    await expect(page).toHaveURL(
        /\/queues\/jobs\/failed\/record-25\?queue=default&pageSize=50&page=2$/,
    );
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-25", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\?queue=default&pageSize=50&page=2$/);
});

test("未知列表状态保留不存在反馈", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues/jobs/unknown");
    await expect(page.getByRole("heading", { name: "页面不存在", exact: true })).toBeVisible();
    expect(state.lists).toEqual([]);
    expect(state.overviews).toBe(0);
});

test("移动端队列分组支持切换独立列表并关闭侧栏", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await mockQueue(page);
    await page.goto("/admin/queues");
    await page.getByRole("button", { name: "切换侧栏", exact: true }).click();
    const sidebar = page.getByRole("dialog");
    await expect(sidebar.getByRole("link", { name: "等待任务", exact: true })).toBeVisible();
    await sidebar.getByRole("link", { name: "等待任务", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/waiting$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "等待任务", exact: true })).toBeVisible();
    await expect.poll(() => state.lists.at(-1)?.status).toBe("waiting");
});

test("等待列表包含延迟记录并支持单独筛选", async ({ page }) => {
    const state = await mockQueue(page);
    state.rows[0]!.status = state.rows[0]!.state = "waiting";
    state.rows[1]!.status = state.rows[1]!.state = "delayed";
    await page.goto("/admin/queues/jobs/waiting");
    await expect(page.getByRole("row")).toHaveCount(3);
    await page.locator("a[data-queue-record]").first().click();
    await expect(page).toHaveURL(/\/queues\/jobs\/waiting\/record-25$/);
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-25", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await page.getByRole("combobox", { name: "执行状态", exact: true }).click();
    await page.getByRole("option", { name: "延迟执行", exact: true }).click();
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/recent\?pageSize=20&status=delayed$/);
    await expect.poll(() => state.lists.at(-1)?.status).toBe("delayed");
    await expect(page.getByRole("row")).toHaveCount(2);
    await page.locator("a[data-queue-record]").click();
    await expect(page).toHaveURL(
        /\/queues\/jobs\/recent\/record-24\?(?:pageSize=20&)?status=delayed$/,
    );
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(page.locator('[data-slot="breadcrumb-page"]')).toHaveText("最近任务");
    await expect(
        page.locator('a[data-sidebar="menu-sub-button"]').filter({ hasText: "最近任务" }),
    ).toHaveAttribute("data-active", "true");
    await page.goto("/admin/queue?status=delayed&record=record-24");
    await expect(page).toHaveURL(
        /\/queues\/jobs\/recent\/record-24\?(?:pageSize=20&)?status=delayed$/,
    );
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-24", { exact: true }),
    ).toBeVisible();
});

test("状态筛选切换独立路由，重置保留当前列表状态", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues/jobs/recent");
    await page.getByRole("combobox", { name: "执行状态", exact: true }).click();
    await page.getByRole("option", { name: "失败", exact: true }).click();
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\?pageSize=20$/);
    await expect(page.getByRole("heading", { name: "失败任务", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重置", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\?pageSize=20$/);
    await expect.poll(() => state.lists.at(-1)?.status).toBe("failed");
});

test("详情路径支持浏览器前进后退并保留列表页码", async ({ page }) => {
    await mockQueue(page);
    await page.goto("/admin/queues/jobs/failed?page=2&pageSize=20");
    await expect(
        page.getByText("第 2 页 · 显示 21–25 条，共 25 条", { exact: true }),
    ).toBeVisible();
    await page.locator("a[data-queue-record]").first().click();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\/record-5\?page=2&pageSize=20$/);
    await expect(page.getByRole("region", { name: "执行详情", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\?page=2&pageSize=20$/);
    await expect(page.getByRole("region", { name: "执行详情", exact: true })).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\/record-5\?page=2&pageSize=20$/);
    await expect(
        page
            .getByRole("region", { name: "执行详情", exact: true })
            .getByText("record-5", { exact: true }),
    ).toBeVisible();
});

test("独立详情只读取详情，列表列按状态展示", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues/jobs/failed/record-25");
    await expect(page.getByRole("heading", { name: "demo:failure", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "执行详情", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "筛选", exact: true })).toHaveCount(0);
    expect(state.lists).toEqual([]);
    expect(state.overviews).toBe(0);
    expect([...new Set(state.details)]).toEqual(["record-25"]);
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(page.getByRole("row")).toHaveCount(21);
    await expect(page.getByRole("columnheader", { name: "执行状态", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "结束时间", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "耗时", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "最近任务", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "执行状态", exact: true })).toBeVisible();
});

test("最近列表跨状态详情和人工重试返回原分页与筛选", async ({ page }) => {
    const state = await mockQueue(page);
    await page.goto("/admin/queues/jobs/recent?page=2&pageSize=20&type=demo%3Afailure");
    const trigger = page.locator("a[data-queue-record]").first();
    await expect(trigger).toHaveAttribute("data-queue-record", "record-5");
    await trigger.click();
    await expect(page).toHaveURL(/\/queues\/jobs\/failed\/record-5\?/);
    await page.getByRole("button", { name: "重试一次", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/waiting\/record-new\?/);
    expect(state.retries).toEqual(["record-5"]);
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(page).toHaveURL(/\/queues\/jobs\/recent\?page=2&pageSize=20&type=demo%3Afailure$/);
    await expect(page.getByRole("heading", { name: "最近任务", exact: true })).toBeVisible();
    await expect(page.getByLabel("任务类型", { exact: true })).toHaveValue("demo:failure");
    await expect(page.locator("a[data-queue-record='record-5']")).toBeFocused();
});

test("计划任务入口展示代码定义、调度器和派发结果，支持刷新深链", async ({ page }) => {
    const state = await mockQueue(page, ["queue:read"]);
    await page.goto("/admin/queues/schedules");
    await expect(page.getByRole("heading", { name: "计划任务", exact: true })).toBeVisible();
    await expect(page.getByText("平台差异与功能进度", { exact: true })).toHaveCount(0);
    const definitions = page.getByRole("region", { name: "计划定义" });
    await expect(definitions.getByRole("cell", { name: "Asia/Shanghai", exact: true })).toHaveCount(
        2,
    );
    await expect(definitions.getByRole("cell", { name: "停用", exact: true })).toBeVisible();
    await expect(definitions.getByRole("cell", { name: "已派发", exact: true })).toBeVisible();
    const heartbeat = page.getByRole("region", { name: "调度器心跳" });
    await expect(
        heartbeat.getByRole("cell", { name: "scheduler-secondary", exact: true }),
    ).toBeVisible();
    await expect(heartbeat.getByText("主调度器", { exact: true })).toBeVisible();
    await expect(heartbeat.getByText("备用调度器", { exact: true })).toBeVisible();
    await expect(
        page.locator('a[data-sidebar="menu-sub-button"]').filter({ hasText: /^计划任务$/ }),
    ).toHaveAttribute("href", "/admin/queues/schedules");
    expect(state.overviews).toBe(0);
    expect(state.lists).toHaveLength(0);
    expect(state.details).toHaveLength(0);
    const requests = state.scheduleRequests;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect.poll(() => state.scheduleRequests).toBeGreaterThan(requests);
    await page.reload();
    await expect(definitions.getByRole("cell", { name: "@every 1m", exact: true })).toBeVisible();
});

test("计划任务读取错误支持刷新恢复和空态", async ({ page }) => {
    const state = await mockQueue(page);
    state.scheduleError = "调度服务暂时不可用";
    await page.goto("/admin/queues/schedules");
    await expect(page.getByRole("alert")).toHaveText("调度服务暂时不可用");
    state.scheduleError = "";
    state.schedules.schedules = [];
    state.schedules.heartbeats = [];
    state.schedules.scheduleCount = 0;
    state.schedules.schedulerInstanceCount = 0;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("当前没有注册计划任务", { exact: true })).toBeVisible();
    await expect(page.getByText("当前没有在线调度器", { exact: true })).toBeVisible();
});

test("计划任务复核查看权限并禁止数据查询", async ({ page }) => {
    const state = await mockQueue(page, []);
    await page.goto("/admin/queues/schedules");
    await expect(page.getByRole("alert")).toHaveText("当前账号缺少队列查看权限");
    await expect(
        page.locator('a[data-sidebar="menu-sub-button"]').filter({ hasText: /^计划任务$/ }),
    ).toHaveCount(0);
    expect(state.scheduleRequests).toBe(0);
});

test("移动端计划定义保持内部横向滚动", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockQueue(page);
    await page.goto("/admin/queues/schedules");
    await expect(
        page
            .getByRole("region", { name: "计划定义" })
            .getByRole("cell", { name: "停用", exact: true }),
    ).toBeVisible();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
});

test("Worker 进程展示在线数量、共享并发和 RSS，部署字段使用占位符", async ({ page }) => {
    const state = await mockQueue(page);
    state.workerPresence = true;
    await page.goto("/admin/queues");
    const workers = page.getByRole("region", { name: "Worker 进程", exact: true });
    await expect(workers.getByRole("columnheader").nth(6)).toHaveText("内存");
    await expect(workers.getByRole("columnheader").nth(7)).toHaveText("内存上限");
    const row = workers.getByRole("row").filter({ hasText: "test-worker" });
    await expect(row.getByRole("cell")).toHaveText([
        "test-worker",
        "shared",
        "critical、default、low",
        "—",
        "4",
        "2",
        "32.0 MB",
        "—",
        "在线",
    ]);
    await expect(workers.getByText("在线数量来自 Asynq 心跳", { exact: false })).toBeVisible();
    const load = page.getByRole("region", { name: "队列负载", exact: true });
    await expect(load.getByRole("cell", { name: "test-worker", exact: true })).toBeVisible();
    await expect(load.getByRole("cell", { name: "共享并发池", exact: true })).toBeVisible();
    await expect(
        load.getByRole("row").filter({ hasText: "default" }).getByRole("cell").last(),
    ).toHaveText("2");
    await expect(
        page
            .getByRole("region", { name: "队列概览", exact: true })
            .getByText("所有队列都有 Worker 在线"),
    ).toBeVisible();
});

test("Worker 部署字段支持悬停和键盘提示，已接入数值按原值展示", async ({ page }) => {
    const state = await mockQueue(page);
    state.workerPresence = true;
    await page.goto("/admin/queues");
    const row = page
        .getByRole("region", { name: "Worker 进程", exact: true })
        .getByRole("row")
        .filter({ hasText: "test-worker" });
    const instances = row.getByRole("cell").nth(3);
    const maxMemory = row.getByRole("cell").nth(7);
    const tooltip = page.getByRole("tooltip");
    for (const cell of [instances, maxMemory]) {
        await expect(cell).toHaveText("—");
        const trigger = cell.locator('[data-slot="tooltip-trigger"]');
        await trigger.hover();
        await expect(tooltip).toHaveText("由部署环境配置");
        await page.mouse.move(0, 0, { steps: 10 });
        await expect(tooltip).toHaveCount(0);
        await trigger.focus();
        await expect(tooltip).toHaveText("由部署环境配置");
        await page.keyboard.press("Escape");
        await expect(tooltip).toHaveCount(0);
        await page.getByRole("button", { name: "刷新", exact: true }).focus();
    }
    state.workerInstances = 2;
    state.workerMaxMemory = "512 MB";
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(instances).toHaveText("2");
    await expect(maxMemory).toHaveText("512 MB");
    await expect(row.locator('[data-slot="tooltip-trigger"]')).toHaveCount(0);
    state.workerInstances = 0;
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(instances).toHaveText("0");
});

test("Worker 内存采样缺失时保留在线状态", async ({ page }) => {
    const state = await mockQueue(page);
    state.workerPresence = true;
    state.workerMemory = null;
    await page.goto("/admin/queues");
    const row = page
        .getByRole("region", { name: "Worker 进程", exact: true })
        .getByRole("row")
        .filter({ hasText: "test-worker" });
    await expect(row.getByRole("cell").nth(6)).toHaveText("—");
    await expect(row.getByRole("cell").last()).toHaveText("在线");
});

test("Worker 离线保留进程行和共享池配置", async ({ page }) => {
    const state = await mockQueue(page);
    state.workerPresence = true;
    state.onlineWorkers = 0;
    await page.goto("/admin/queues");
    const row = page
        .getByRole("region", { name: "Worker 进程", exact: true })
        .getByRole("row")
        .filter({ hasText: "test-worker" });
    await expect(row.getByRole("cell").nth(4)).toHaveText("4");
    await expect(row.getByRole("cell").nth(5)).toHaveText("0");
    await expect(row.getByRole("cell").nth(6)).toHaveText("—");
    await expect(row.getByRole("cell").last()).toHaveText("离线");
    await expect(
        page
            .getByRole("region", { name: "队列负载", exact: true })
            .getByRole("row")
            .filter({ hasText: "default" })
            .getByRole("cell")
            .last(),
    ).toHaveText("0");
});
