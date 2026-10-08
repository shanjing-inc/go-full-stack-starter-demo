import { useEffect, useRef, useState } from "react";
import { useDashboardAdapter, useDashboardSession } from "../dashboard-context.js";
import type { DashboardUserSessionItem } from "../adapter.js";
import { Button } from "../ui/button.js";
import { DateTimeCell } from "../components/date-time-cell.js";
import { DataTable } from "../components/data-table.js";
import { TablePagination } from "../components/table-pagination.js";

/** 弹窗独立维护查询和撤销生命周期；关闭或切页时取消请求。 */
export function UserSessions({
    userId,
    onCurrentRevoked,
}: {
    userId: string;
    onCurrentRevoked: () => Promise<void>;
}) {
    const adapter = useDashboardAdapter();
    const session = useDashboardSession();
    const [rows, setRows] = useState<DashboardUserSessionItem[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [revision, setRevision] = useState(0);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [mutationError, setMutationError] = useState("");
    const [confirm, setConfirm] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const refreshRef = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);
    const mayRevoke =
        !!adapter.revokeUserSession && !!session?.permissions.includes("session:revoke");
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        const request = new AbortController();
        setLoading(true);
        setError("");
        setRows([]);
        setHasNext(false);
        setConfirm(null);
        adapter.getUserSessions!(
            userId,
            { limit: pageSize + 1, offset: (page - 1) * pageSize },
            request.signal,
        )
            .then((items) => {
                if (request.signal.aborted) return;
                // 撤销该页最后一条后回到上一页，保持可见列表连贯。
                if (!items.length && page > 1) {
                    setPage(page - 1);
                    return;
                }
                setRows(items.slice(0, pageSize));
                setHasNext(items.length > pageSize);
            })
            .catch((err) => {
                if (!request.signal.aborted)
                    setError(err instanceof Error ? err.message : "会话列表读取失败");
            })
            .finally(() => {
                if (!request.signal.aborted) setLoading(false);
            });
        return () => request.abort();
    }, [adapter, userId, page, pageSize, revision]);
    useEffect(() => {
        if (!loading && restoreFocus.current) {
            restoreFocus.current = false;
            if (
                document.activeElement === document.body ||
                document.activeElement?.getAttribute("role") === "dialog"
            )
                refreshRef.current?.focus();
        }
    }, [loading]);
    async function revoke(row: DashboardUserSessionItem) {
        if (controller.current || !mayRevoke) return;
        const request = new AbortController();
        controller.current = request;
        setPending(true);
        setMutationError("");
        try {
            await adapter.revokeUserSession!(userId, row.id, request.signal);
            if (request.signal.aborted) return;
            if (row.current) {
                await onCurrentRevoked();
                return;
            }
            restoreFocus.current = true;
            setConfirm(null);
            setRevision((value) => value + 1);
        } catch (err) {
            if (!request.signal.aborted)
                setMutationError(err instanceof Error ? err.message : "撤销会话失败");
        } finally {
            if (!request.signal.aborted) setPending(false);
            if (controller.current === request) controller.current = null;
        }
    }
    return (
        <div className="grid min-w-0 gap-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    有效期内的登录会话。撤销当前会话后将返回登录页。
                </p>
                <Button
                    ref={refreshRef}
                    type="button"
                    variant="outline"
                    disabled={loading || pending}
                    onClick={() => setRevision((value) => value + 1)}
                >
                    刷新会话
                </Button>
            </div>
            {(error || mutationError) && (
                <p role="alert" className="text-sm text-destructive">
                    {error || mutationError}
                </p>
            )}
            <DataTable
                items={rows}
                getRowKey={(row) => row.id}
                emptyText={loading ? "加载中" : error ? "会话列表读取失败" : "暂无有效会话"}
                columns={[
                    {
                        key: "device",
                        header: "设备",
                        render: (row) => (
                            <div className="max-w-64 break-words">
                                <div>{row.current ? "当前会话" : `会话 #${row.id}`}</div>
                                <div className="text-xs text-muted-foreground">
                                    {row.userAgent || "未知设备"}
                                </div>
                            </div>
                        ),
                    },
                    { key: "ip", header: "IP 地址", render: (row) => row.ipAddress || "—" },
                    {
                        key: "created",
                        header: "创建时间",
                        render: (row) => <DateTimeCell value={row.createdAt} />,
                    },
                    {
                        key: "expires",
                        header: "到期时间",
                        render: (row) => <DateTimeCell value={row.expiresAt} />,
                    },
                    ...(mayRevoke
                        ? [
                              {
                                  key: "actions",
                                  header: "操作",
                                  render: (row: DashboardUserSessionItem) =>
                                      confirm === row.id ? (
                                          <div className="flex flex-col gap-2">
                                              <span className="text-xs">
                                                  {row.current
                                                      ? "确认退出当前登录？"
                                                      : "确认撤销此会话？"}
                                              </span>
                                              <div className="flex gap-2">
                                                  <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="destructive"
                                                      disabled={pending}
                                                      onClick={() => void revoke(row)}
                                                  >
                                                      {pending ? "处理中" : "确认撤销"}
                                                  </Button>
                                                  <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="outline"
                                                      disabled={pending}
                                                      onClick={() => {
                                                          setConfirm(null);
                                                          setMutationError("");
                                                      }}
                                                  >
                                                      取消撤销
                                                  </Button>
                                              </div>
                                          </div>
                                      ) : (
                                          <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              disabled={pending || loading}
                                              onClick={() => {
                                                  setConfirm(row.id);
                                                  setMutationError("");
                                              }}
                                          >
                                              撤销会话
                                          </Button>
                                      ),
                              },
                          ]
                        : []),
                ]}
            />
            <TablePagination
                page={page}
                pageSize={pageSize}
                itemCount={rows.length}
                hasNext={hasNext}
                loading={loading || pending}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                    if (!pending) {
                        setPage(1);
                        setPageSize(size);
                    }
                }}
            />
        </div>
    );
}
