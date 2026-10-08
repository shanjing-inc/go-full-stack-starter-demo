import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon, FilterIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useDashboardAdapter, useDashboardSession } from "../dashboard-context.js";
import type {
    DashboardQueueOverview,
    DashboardQueueRecord,
    DashboardQueueRecords,
    DashboardQueueSummary,
} from "../adapter.js";
import { Button } from "../ui/button.js";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";
import { QueueOverview } from "./queue-overview.js";
import { DataTable, type DataTableColumn } from "../components/data-table.js";
import { TablePagination } from "../components/table-pagination.js";
import { DateTimeCell } from "../components/date-time-cell.js";
import { DateTimeRangeInput } from "../components/date-time-range-input.js";
import { StatusBadge } from "../components/status-badge.js";
import { SessionLoading } from "../components/session-loading.js";

const statuses: Record<string, string> = {
    all: "全部状态",
    waiting: "待执行",
    delayed: "延迟执行",
    active: "执行中",
    completed: "成功",
    failed: "失败",
};
const pages: Record<string, string> = {
    recent: "最近任务",
    active: "运行中任务",
    completed: "已完成任务",
    failed: "失败任务",
    waiting: "等待任务",
};
const jobStates: Record<string, string> = {
    pending: "待执行",
    active: "执行中",
    scheduled: "延迟执行",
    retry: "等待自动重试",
    archived: "最终失败",
    completed: "已完成",
    missing: "原任务已清理",
};
const pageSizes = [20, 50, 100];
function integer(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 50001 ? parsed : fallback;
}
function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}
function FilterSelect({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: [string, string][];
    onChange: (value: string) => void;
}) {
    return (
        <Select value={value || "all"} onValueChange={onChange}>
            <SelectTrigger aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map(([key, text]) => (
                    <SelectItem key={key} value={key}>
                        {text}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
function Snapshot({ label, value }: { label: string; value: unknown }) {
    return (
        <Card className="min-w-0">
            <CardHeader>
                <CardTitle className="text-xl">{label}</CardTitle>
            </CardHeader>
            <CardContent>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(value ?? null, null, 2)}
                </pre>
            </CardContent>
        </Card>
    );
}

/** 页面只接收服务端安全投影，筛选、页码及当前详情保存在 URL。 */
export function QueuePage() {
    const adapter = useDashboardAdapter();
    const session = useDashboardSession();
    const [search, setSearch] = useSearchParams();
    const routeNavigate = useNavigate();
    const location = useLocation();
    const { status: routeStatus, recordId: routeRecordId } = useParams();
    const overview = routeStatus === undefined;
    const validPage = overview || Object.hasOwn(pages, routeStatus);
    const queryKey = search.toString();
    // 延迟状态通过最近任务的筛选保留，导航入口沿用参考的五类列表。
    const status = overview
        ? "all"
        : routeStatus === "recent"
          ? search.get("status") === "delayed"
              ? "delayed"
              : "all"
          : routeStatus!;
    const queueName = ["critical", "default", "low"].includes(search.get("queue") ?? "")
        ? search.get("queue")!
        : "";
    const jobName = search.get("type") ?? "";
    const from = search.get("from") ?? "";
    const to = search.get("to") ?? "";
    const pageSize = pageSizes.includes(Number(search.get("pageSize")))
        ? Number(search.get("pageSize"))
        : 20;
    const page = integer(search.get("page"), 1);
    const recordId = routeRecordId ?? "";
    const [draft, setDraft] = useState({ status, queueName, jobName, from, to });
    const [dashboard, setDashboard] = useState<DashboardQueueOverview | null>(null);
    const [records, setRecords] = useState<DashboardQueueRecords>({ records: [], total: 0 });
    const [detail, setDetail] = useState<DashboardQueueRecord | null>(null);
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [listError, setListError] = useState("");
    const [overviewError, setOverviewError] = useState("");
    const [detailError, setDetailError] = useState("");
    const [retryError, setRetryError] = useState("");
    const [message, setMessage] = useState("");
    const [revision, setRevision] = useState(0);
    const [retrying, setRetrying] = useState(false);
    const retryBusy = useRef(false);
    const retryController = useRef<AbortController | null>(null);
    const originRecord = useRef<string | null>(null);
    const previousRecord = useRef("");
    const pageHeading = useRef<HTMLHeadingElement | null>(null);
    const canRead = !!session?.permissions.includes("queue:read");
    const canRetry = !!session?.permissions.includes("queue:retry");
    const ready =
        !!adapter.getQueueDashboard && !!adapter.getQueueRecords && !!adapter.getQueueRecord;
    useEffect(() => {
        setDraft({ status, queueName, jobName, from, to });
    }, [status, queueName, jobName, from, to]);
    useEffect(() => () => retryController.current?.abort(), []);
    useEffect(() => {
        if (!canRead || !ready) return;
        const interval = setInterval(() => setRevision((v) => v + 1), 10000);
        return () => clearInterval(interval);
    }, [canRead, ready]);
    useEffect(() => {
        if (!canRead || !ready || !validPage) return;
        const controller = new AbortController();
        if (overview) {
            setOverviewError("");
            void adapter.getQueueDashboard!(controller.signal)
                .then((value) => {
                    if (!controller.signal.aborted) setDashboard(value);
                })
                .catch((error) => {
                    if (!controller.signal.aborted)
                        setOverviewError(errorMessage(error, "队列概览读取失败"));
                });
            return () => controller.abort();
        }
        if (recordId) return;
        setLoading(true);
        setListError("");
        setOverviewError("");
        const params = new URLSearchParams(queryKey);
        const dateFrom = params.get("from") ? Date.parse(params.get("from")!) : undefined;
        const dateTo = params.get("to") ? Date.parse(params.get("to")!) : undefined;
        if (
            (dateFrom !== undefined && !Number.isFinite(dateFrom)) ||
            (dateTo !== undefined && !Number.isFinite(dateTo)) ||
            (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo)
        ) {
            setListError("时间范围无效");
            setRecords({ records: [], total: 0 });
            setLoading(false);
            return () => controller.abort();
        }
        void adapter.getQueueRecords!(
            {
                status,
                orderBy: "updatedAt",
                orderDirection: "desc",
                queueName: queueName || undefined,
                jobName: jobName || undefined,
                from: dateFrom,
                to: dateTo,
                limit: pageSize,
                offset: (page - 1) * pageSize,
            },
            controller.signal,
        )
            .then((value) => {
                if (!controller.signal.aborted) setRecords(value);
            })
            .catch((error) => {
                if (!controller.signal.aborted) {
                    setListError(errorMessage(error, "执行记录读取失败"));
                    setRecords({ records: [], total: 0 });
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [
        adapter,
        canRead,
        ready,
        validPage,
        overview,
        queryKey,
        recordId,
        status,
        queueName,
        jobName,
        page,
        pageSize,
        revision,
    ]);
    useEffect(() => {
        if (!canRead || !ready || !validPage || !recordId) return;
        const controller = new AbortController();
        setDetailError("");
        setDetailLoading(true);
        void adapter.getQueueRecord!(recordId, controller.signal)
            .then((value) => {
                if (!controller.signal.aborted) setDetail(value);
            })
            .catch((error) => {
                if (!controller.signal.aborted)
                    setDetailError(errorMessage(error, "执行详情读取失败"));
            })
            .finally(() => {
                if (!controller.signal.aborted) setDetailLoading(false);
            });
        return () => controller.abort();
    }, [adapter, canRead, ready, validPage, recordId, revision]);
    function navigate(nextPage: number, nextSize = pageSize) {
        setSearch((current) => {
            const next = new URLSearchParams(current);
            next.set("page", String(nextPage));
            next.set("pageSize", String(nextSize));
            return next;
        });
    }
    useEffect(() => {
        if (recordId) {
            previousRecord.current = recordId;
            pageHeading.current?.focus();
        } else if (previousRecord.current) {
            const id = originRecord.current;
            const link = Array.from(
                document.querySelectorAll<HTMLAnchorElement>("a[data-queue-record]"),
            ).find((a) => a.dataset.queueRecord === id);
            if (link) {
                link.focus();
                previousRecord.current = "";
                originRecord.current = null;
            } else if (!loading) {
                pageHeading.current?.focus();
                previousRecord.current = "";
                originRecord.current = null;
            }
        }
    }, [recordId, records, loading]);
    function recordPath(id: string, recordStatus = routeStatus!) {
        return `/queues/jobs/${recordStatus === "delayed" ? "recent" : recordStatus}/${encodeURIComponent(id)}`;
    }
    function showRecord(id: string) {
        if (retrying) return;
        setRetryError("");
        setMessage("");
        setDetailError("");
        routeNavigate(
            { pathname: recordPath(id), search: search.toString() },
            { state: location.state },
        );
    }
    function backToList() {
        if (retrying) return;
        routeNavigate(
            location.state?.queueReturn ?? {
                pathname: `/queues/jobs/${routeStatus}`,
                search: search.toString(),
            },
            { replace: true, state: null },
        );
        setDetail(null);
        setRetryError("");
        setMessage("");
    }
    function filter(reset = false) {
        const value = reset ? { status, queueName: "", jobName: "", from: "", to: "" } : draft;
        const next = new URLSearchParams();
        next.set("pageSize", String(pageSize));
        if (value.status === "delayed") next.set("status", "delayed");
        for (const [key, v] of [
            ["queue", value.queueName],
            ["type", value.jobName.trim()],
            ["from", value.from],
            ["to", value.to],
        ]) {
            if (v) next.set(key!, v!);
        }
        routeNavigate({
            pathname: `/queues/jobs/${["all", "delayed"].includes(value.status) ? "recent" : value.status}`,
            search: next.toString(),
        });
        setMessage("");
    }
    async function retry() {
        if (
            !detail ||
            detail.id !== recordId ||
            !detail.canRetry ||
            !canRetry ||
            !adapter.retryQueueRecord ||
            retryBusy.current
        )
            return;
        setRetryError("");
        retryBusy.current = true;
        setRetrying(true);
        setDetailError("");
        const controller = new AbortController();
        retryController.current = controller;
        try {
            const result = await adapter.retryQueueRecord(recordId, controller.signal);
            if (controller.signal.aborted) return;
            setDetail(result.detail);
            setMessage(result.noticeMessage);
            routeNavigate(
                {
                    pathname: `/queues/jobs/${result.detail.state}/${encodeURIComponent(result.detail.id)}`,
                    search: search.toString(),
                },
                { replace: true, state: location.state },
            );
            setRevision((v) => v + 1);
        } catch (error) {
            if (!controller.signal.aborted) {
                setRetryError(errorMessage(error, "安排重试失败"));
                setRevision((v) => v + 1);
            }
        } finally {
            retryBusy.current = false;
            if (!controller.signal.aborted) setRetrying(false);
        }
    }
    if (!session) return <SessionLoading />;
    if (!canRead) return <p role="alert">当前账号缺少队列查看权限</p>;
    if (!validPage) return <h1>页面不存在</h1>;
    if (!ready) return <p role="alert">当前应用尚未接入队列服务</p>;
    const current = detail?.id === recordId ? detail : null;
    const columns: DataTableColumn<DashboardQueueSummary>[] = [
        {
            key: "jobName",
            header: "任务",
            className: "align-top",
            render: (r) => (
                <>
                    <Link
                        data-queue-record={r.id}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        to={{ pathname: recordPath(r.id, r.status), search: search.toString() }}
                        state={{
                            queueReturn: { pathname: location.pathname, search: location.search },
                        }}
                        onClick={() => {
                            originRecord.current = r.id;
                            setRetryError("");
                            setMessage("");
                        }}
                    >
                        {r.jobName || r.id}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                        {r.queueName}
                        {r.physicalQueueName ? ` · ${r.physicalQueueName}` : ""}
                    </div>
                </>
            ),
        },
        ...(routeStatus === "recent"
            ? [
                  {
                      key: "status",
                      header: "执行状态",
                      render: (r: DashboardQueueSummary) => (
                          <StatusBadge status={r.status} label={statuses[r.status] ?? r.status} />
                      ),
                  },
              ]
            : []),
        { key: "queuedAt", header: "入队时间", render: (r) => <DateTimeCell value={r.queuedAt} /> },
        {
            key: "finishedAt",
            header: "结束时间",
            render: (r) => <DateTimeCell value={r.finishedAt} />,
        },
        {
            key: "runtimeMs",
            header: "耗时",
            render: (r) => (r.runtimeMs === null ? "—" : `${r.runtimeMs} ms`),
        },
        {
            key: "jobId",
            header: "任务 ID",
            render: (r) => (
                <>
                    <div className="font-medium">{r.jobId}</div>
                    <div className="text-xs text-muted-foreground">执行 #{r.executionNumber}</div>
                </>
            ),
        },
    ];
    return (
        <div className="grid min-w-0 grid-cols-1 gap-5">
            <section className="flex flex-wrap items-center justify-between gap-3">
                <h1 ref={pageHeading} tabIndex={-1} className="text-2xl font-semibold">
                    {overview
                        ? "控制台"
                        : recordId
                          ? (current?.name ?? "执行详情")
                          : pages[routeStatus!]}
                </h1>
                <div className="flex flex-wrap gap-2">
                    {!!recordId && (
                        <Button variant="outline" disabled={retrying} onClick={backToList}>
                            <ArrowLeftIcon />
                            返回列表
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
                        <RefreshCwIcon />
                        刷新
                    </Button>
                    {!!recordId && current && canRetry && adapter.retryQueueRecord && (
                        <Button
                            disabled={retrying || !current.canRetry}
                            onClick={() => void retry()}
                        >
                            <RotateCcwIcon />
                            {retrying ? "安排中…" : "重试一次"}
                        </Button>
                    )}
                </div>
            </section>
            <p className="text-sm text-muted-foreground">
                {overview
                    ? "队列负载、Worker 在线情况与执行记录聚合。"
                    : recordId
                      ? "参数、返回结果与错误信息已经服务端脱敏。"
                      : "点击任务名称查看详细数据；筛选时间按最近活动时间计算。"}
            </p>
            {overview && overviewError && (
                <p role="alert" className="text-destructive">
                    {overviewError}
                </p>
            )}
            {overview && <QueueOverview data={dashboard} />}
            {!overview && !recordId && (
                <section className="grid min-w-0 grid-cols-1 gap-3">
                    <h2 className="font-semibold">执行记录</h2>
                    <form
                        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 rounded-lg border bg-background p-3 *:min-w-0"
                        onSubmit={(e) => {
                            e.preventDefault();
                            filter();
                        }}
                    >
                        <FilterSelect
                            label="执行状态"
                            value={draft.status}
                            options={Object.entries(statuses)}
                            onChange={(value) => setDraft((v) => ({ ...v, status: value }))}
                        />
                        <FilterSelect
                            label="队列"
                            value={draft.queueName}
                            options={[
                                ["all", "全部队列"],
                                ["critical", "critical"],
                                ["default", "default"],
                                ["low", "low"],
                            ]}
                            onChange={(value) =>
                                setDraft((v) => ({ ...v, queueName: value === "all" ? "" : value }))
                            }
                        />
                        <Input
                            aria-label="任务类型"
                            placeholder="任务类型（精确匹配）"
                            maxLength={255}
                            value={draft.jobName}
                            onChange={(e) => setDraft((v) => ({ ...v, jobName: e.target.value }))}
                        />
                        <DateTimeRangeInput
                            className="col-span-full md:col-span-2"
                            value={{ from: draft.from, to: draft.to }}
                            onChange={(value) => setDraft((v) => ({ ...v, ...value }))}
                        />
                        <Button type="submit">
                            <FilterIcon />
                            筛选
                        </Button>
                        <Button type="button" variant="outline" onClick={() => filter(true)}>
                            <RotateCcwIcon />
                            重置
                        </Button>
                    </form>
                    {listError && (
                        <p role="alert" className="text-destructive">
                            {listError}
                        </p>
                    )}
                    <div aria-busy={loading}>
                        <DataTable
                            columns={columns}
                            items={records.records}
                            getRowKey={(r) => r.id}
                            emptyText={
                                loading
                                    ? "正在加载执行记录…"
                                    : listError
                                      ? "读取失败，请刷新"
                                      : "暂无匹配的执行记录"
                            }
                        />
                    </div>
                    <TablePagination
                        itemCount={records.records.length}
                        totalCount={records.total}
                        loading={loading || !!listError}
                        page={page}
                        pageSize={pageSize}
                        pageSizeOptions={pageSizes}
                        onPageChange={navigate}
                        onPageSizeChange={(size) => navigate(1, size)}
                    />
                </section>
            )}
            {!!recordId && (
                <section
                    aria-label="执行详情"
                    className="grid min-w-0 gap-4"
                    aria-busy={detailLoading}
                >
                    {detailError && (
                        <p role="alert" className="text-destructive">
                            {detailError}
                        </p>
                    )}
                    {retryError && (
                        <p role="alert" className="text-destructive">
                            {retryError}
                        </p>
                    )}
                    {message && (
                        <p role="status" className="rounded-lg border bg-muted/40 p-3">
                            {message}
                        </p>
                    )}
                    {detailLoading && !current && <p role="status">正在加载执行详情…</p>}
                    {current && (
                        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] xl:items-start">
                            <Card className="min-w-0 xl:sticky xl:top-4">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-xl">
                                        <StatusBadge
                                            status={current.state}
                                            label={statuses[current.state] ?? current.state}
                                        />
                                        执行详情
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="grid min-w-0 gap-4">
                                    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm [&_dd]:break-all">
                                        <dt>任务 ID</dt>
                                        <dd>{current.jobId}</dd>
                                        <dt>记录 ID</dt>
                                        <dd>{current.id}</dd>
                                        <dt>任务类型</dt>
                                        <dd>{current.name}</dd>
                                        <dt>队列</dt>
                                        <dd>{current.queueName}</dd>
                                        <dt>执行序号</dt>
                                        <dd>{current.executionNumber}</dd>
                                        <dt>自动重试次数</dt>
                                        <dd>{current.attempts}</dd>
                                        <dt>原任务状态</dt>
                                        <dd>
                                            {jobStates[current.currentJobState] ??
                                                current.currentJobState}
                                        </dd>
                                        <dt>入队时间</dt>
                                        <dd>
                                            <DateTimeCell value={current.queuedAt} />
                                        </dd>
                                        <dt>开始时间</dt>
                                        <dd>
                                            <DateTimeCell value={current.processedAt} />
                                        </dd>
                                        <dt>结束时间</dt>
                                        <dd>
                                            <DateTimeCell value={current.finishedAt} />
                                        </dd>
                                        <dt>耗时</dt>
                                        <dd>
                                            {current.runtimeMs === null
                                                ? "—"
                                                : `${current.runtimeMs} ms`}
                                        </dd>
                                        <dt>失败原因</dt>
                                        <dd className="whitespace-pre-wrap">
                                            {current.failedReason || "—"}
                                        </dd>
                                    </dl>
                                    {current.retryOfRecordId && (
                                        <Button
                                            variant="outline"
                                            disabled={retrying}
                                            onClick={() => showRecord(current.retryOfRecordId!)}
                                        >
                                            查看上次执行
                                        </Button>
                                    )}
                                    {current.latestRecordId !== current.id && (
                                        <Button
                                            variant="outline"
                                            disabled={retrying}
                                            onClick={() => showRecord(current.latestRecordId)}
                                        >
                                            查看最新执行
                                        </Button>
                                    )}
                                    {current.retryDisabledReason && (
                                        <p className="text-sm text-muted-foreground">
                                            {current.retryDisabledReason}
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                            <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
                                <Snapshot label="任务参数" value={current.data} />
                                <Snapshot label="返回结果" value={current.returnValue} />
                                <Snapshot label="任务选项" value={current.opts} />
                                <Snapshot label="错误堆栈" value={current.stacktrace} />
                                <Snapshot label="重试操作信息" value={current.meta} />
                            </div>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
