import type { DashboardQueueOverview } from "../adapter.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { DataTable, type DataTableColumn } from "../components/data-table.js";
import { StatusBadge } from "../components/status-badge.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";

function memory(bytes: number | null) {
    return bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DeploymentManagedValue() {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    className="inline-flex cursor-help rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    —
                </span>
            </TooltipTrigger>
            <TooltipContent>由部署环境配置</TooltipContent>
        </Tooltip>
    );
}

/** 保持参考的概览卡片、进程表和负载表结构，并展示部署侧指标口径。 */
export function QueueOverview({ data }: { data: DashboardQueueOverview | null }) {
    const presence = data?.capabilities.supportsWorkerPresence ?? false;
    const metric = (value: number | undefined) => (value === undefined ? "—" : value);
    const cards = [
        ["队列数量", metric(data?.queueCount), "当前注册队列数量"],
        [
            "在线 Worker",
            presence ? metric(data?.overview.onlineWorkers) : "—",
            presence
                ? data?.hasOnlineWorkers
                    ? "所有队列都有 Worker 在线"
                    : "部分队列缺少在线 Worker"
                : "Worker 在线信息待接入",
        ],
        ["等待任务", metric(data?.overview.waiting), "当前待消费的原任务数量"],
        ["失败任务", metric(data?.overview.failed), "当前归档的最终失败原任务数量"],
    ];
    type Worker = DashboardQueueOverview["workerProcesses"][number];
    const workerColumns: DataTableColumn<Worker>[] = [
        { key: "name", header: "Worker 进程", render: (p) => p.name },
        { key: "group", header: "进程组", render: (p) => p.processGroup || "—" },
        { key: "queues", header: "队列", render: (p) => p.queues.join("、") },
        {
            key: "instances",
            header: "配置数量",
            render: (p) => p.instances ?? <DeploymentManagedValue />,
        },
        { key: "concurrency", header: "共享并发", render: (p) => p.concurrency ?? "—" },
        { key: "online", header: "在线数量", render: (p) => p.onlineInstances },
        { key: "memory", header: "内存", render: (p) => memory(p.memoryBytes) },
        {
            key: "maxMemory",
            header: "内存上限",
            render: (p) => p.maxMemory || <DeploymentManagedValue />,
        },
        {
            key: "status",
            header: "状态",
            render: (p) => (
                <StatusBadge
                    status={p.isOnline ? "listening" : "offline"}
                    label={p.isOnline ? "在线" : "离线"}
                />
            ),
        },
    ];
    type Queue = DashboardQueueOverview["queues"][number];
    const queueColumns: DataTableColumn<Queue>[] = [
        {
            key: "queue",
            header: "队列",
            render: (q) => (
                <>
                    <div className="font-medium">{q.queueName}</div>
                    <div className="text-xs text-muted-foreground">{q.physicalQueueName}</div>
                </>
            ),
        },
        { key: "process", header: "Worker 进程", render: (q) => q.workerProcessName || "待接入" },
        { key: "concurrency", header: "并发数", render: (q) => q.concurrency ?? "共享并发池" },
        { key: "waiting", header: "等待", render: (q) => q.waiting },
        { key: "active", header: "运行中", render: (q) => q.active },
        { key: "delayed", header: "延迟", render: (q) => q.delayed },
        { key: "retrying", header: "自动重试", render: (q) => q.retrying },
        { key: "failed", header: "失败", render: (q) => q.failed },
        { key: "completed", header: "已完成", render: (q) => q.completed },
        {
            key: "consumers",
            header: "消费者",
            render: (q) => (presence ? q.workerCount : "待接入"),
        },
    ];
    return (
        <>
            <section aria-label="队列概览" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {cards.map(([label, value, hint]) => (
                    <Card key={label}>
                        <CardHeader>
                            <CardTitle className="text-sm">{label}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-semibold">{value}</div>
                            <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
                        </CardContent>
                    </Card>
                ))}
            </section>
            <section className="grid gap-3" aria-label="最近 24 小时执行次数">
                <h2 className="font-semibold">最近 24 小时执行次数</h2>
                <div className="grid grid-cols-2 gap-4">
                    {[
                        ["成功", data?.overview.succeededExecutions24h],
                        ["失败", data?.overview.failedExecutions24h],
                    ].map(([label, value]) => (
                        <Card key={label}>
                            <CardHeader>
                                <CardTitle className="text-sm">{label}</CardTitle>
                            </CardHeader>
                            <CardContent className="text-2xl font-semibold">
                                {value ?? "—"}
                            </CardContent>
                        </Card>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                    每次自动重试和人工执行分别计数；队列负载表统计当前原任务数量。
                </p>
            </section>
            <section className="grid min-w-0 gap-3" aria-label="Worker 进程">
                <h2 className="font-semibold">Worker 进程</h2>
                <p className="text-xs text-muted-foreground">
                    {presence
                        ? "在线数量来自 Asynq 心跳；内存为在线进程的 Linux RSS 合计，采样缺失时显示 —。配置数量和硬内存上限由部署环境管理。"
                        : "Worker 在线信息与进程指标待接入。"}
                </p>
                <DataTable
                    columns={workerColumns}
                    items={data?.workerProcesses ?? []}
                    getRowKey={(p) => `${p.processGroup}:${p.name}`}
                    emptyText={
                        data
                            ? presence
                                ? "当前没有配置 Worker 进程"
                                : "Worker 进程信息待接入"
                            : "正在加载 Worker 进程信息…"
                    }
                />
            </section>
            <section className="grid min-w-0 gap-3" aria-label="队列负载">
                <h2 className="font-semibold">队列负载</h2>
                <DataTable
                    columns={queueColumns}
                    items={data?.queues ?? []}
                    getRowKey={(q) => q.queueName}
                    emptyText={data ? "当前没有注册队列" : "正在加载队列负载…"}
                />
            </section>
        </>
    );
}
