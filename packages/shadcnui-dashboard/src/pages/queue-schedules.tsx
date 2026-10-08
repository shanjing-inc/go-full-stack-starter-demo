import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { DashboardQueueSchedules } from "../adapter.js";
import { useDashboardAdapter, useDashboardSession } from "../dashboard-context.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { DataTable, type DataTableColumn } from "../components/data-table.js";
import { DateTimeCell } from "../components/date-time-cell.js";
import { StatusBadge } from "../components/status-badge.js";
import { SessionLoading } from "../components/session-loading.js";

/** 计划定义在业务代码中注册，页面只读展示定义与调度观测。 */
export function QueueSchedulesPage() {
    const adapter = useDashboardAdapter();
    const session = useDashboardSession();
    const canRead = !!session?.permissions.includes("queue:read");
    const [data, setData] = useState<DashboardQueueSchedules | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        if (!canRead || !adapter.getQueueSchedules) return;
        const controller = new AbortController();
        setLoading(true);
        setError("");
        void adapter
            .getQueueSchedules(controller.signal)
            .then((value) => {
                if (!controller.signal.aborted) setData(value);
            })
            .catch((cause: unknown) => {
                if (!controller.signal.aborted)
                    setError(cause instanceof Error ? cause.message : "计划任务读取失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [adapter, canRead, revision]);
    if (!session) return <SessionLoading />;
    if (!canRead) return <p role="alert">当前账号缺少队列查看权限</p>;
    if (!adapter.getQueueSchedules) return <p>计划任务接口待接入</p>;
    type Schedule = DashboardQueueSchedules["schedules"][number];
    const columns: DataTableColumn<Schedule>[] = [
        {
            key: "name",
            header: "计划",
            render: (s) => (
                <>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                </>
            ),
        },
        { key: "cron", header: "Cron", render: (s) => s.cron },
        { key: "timezone", header: "时区", render: (s) => s.timezone },
        { key: "job", header: "任务类型", render: (s) => s.jobName },
        { key: "queue", header: "队列", render: (s) => s.queueName },
        {
            key: "enabled",
            header: "启用状态",
            render: (s) => (
                <StatusBadge
                    status={s.enabled ? "active" : "paused"}
                    label={s.enabled ? "启用" : "停用"}
                />
            ),
        },
        { key: "next", header: "下次执行", render: (s) => <DateTimeCell value={s.nextRunAt} /> },
        {
            key: "activity",
            header: "最近调度",
            render: (s) => <DateTimeCell value={s.lastActivityAt} />,
        },
        {
            key: "status",
            header: "派发结果",
            render: (s) => (
                <StatusBadge
                    status={
                        s.status === "dispatched"
                            ? "completed"
                            : s.status === "dispatch_failed"
                              ? "failed"
                              : "Idle"
                    }
                    label={s.statusText}
                />
            ),
        },
    ];
    type Heartbeat = DashboardQueueSchedules["heartbeats"][number];
    const heartbeatColumns: DataTableColumn<Heartbeat>[] = [
        { key: "id", header: "实例", render: (h) => h.instanceId },
        {
            key: "at",
            header: "最近心跳",
            render: (h) => <DateTimeCell value={h.lastHeartbeatAt} />,
        },
        {
            key: "role",
            header: "角色",
            render: (h) => (
                <StatusBadge
                    status={h.role}
                    label={h.role === "leader" ? "主调度器" : "备用调度器"}
                />
            ),
        },
    ];
    return (
        <div className="grid min-w-0 gap-6" aria-busy={loading}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">计划任务</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        代码注册的 Cron 计划、下次执行时间和最近派发结果。
                    </p>
                </div>
                <Button
                    variant="outline"
                    disabled={loading}
                    onClick={() => setRevision((v) => v + 1)}
                >
                    <RefreshCwIcon />
                    刷新
                </Button>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <p className="text-xs text-muted-foreground">
                最近更新：
                <DateTimeCell value={data?.updatedAt} />
            </p>
            <section aria-label="调度概览" className="grid gap-4 md:grid-cols-3">
                {[
                    ["注册计划", data?.scheduleCount ?? "—"],
                    ["在线调度器", data?.schedulerInstanceCount ?? "—"],
                    ["当前 Leader", data?.schedulerLeader ?? "—"],
                ].map(([title, value]) => (
                    <Card key={title}>
                        <CardHeader>
                            <CardTitle className="text-sm">{title}</CardTitle>
                        </CardHeader>
                        <CardContent className="break-all text-2xl font-semibold">
                            {value}
                        </CardContent>
                    </Card>
                ))}
            </section>
            <section aria-label="计划定义" className="grid min-w-0 gap-3">
                <h2 className="font-semibold">计划定义</h2>
                <DataTable
                    columns={columns}
                    items={data?.schedules ?? []}
                    getRowKey={(s) => s.name}
                    emptyText={loading ? "计划任务加载中…" : "当前没有注册计划任务"}
                />
                <p className="text-xs text-muted-foreground">
                    计划通过业务代码注册，共享启停状态由调度配置控制。停用计划的下次执行时间显示为空。派发结果表示任务入队结果，业务执行结果在任务列表查看。
                </p>
            </section>
            <section aria-label="调度器心跳" className="grid min-w-0 gap-3">
                <h2 className="font-semibold">调度器心跳</h2>
                <DataTable
                    columns={heartbeatColumns}
                    items={data?.heartbeats ?? []}
                    getRowKey={(h) => h.instanceId}
                    emptyText={loading ? "调度器心跳加载中…" : "当前没有在线调度器"}
                />
                <p className="text-xs text-muted-foreground">
                    Go 调度器使用 Redis 租约选主，心跳有效期为 10
                    秒；进程正常退出时清理自身心跳。周期任务使用 UTC epoch 对齐执行时刻。
                </p>
            </section>
        </div>
    );
}
