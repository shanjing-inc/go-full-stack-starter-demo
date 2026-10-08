import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { FilterIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { useDashboardAdapter, useDashboardSession } from "../dashboard-context.js";
import type { DashboardUserItem, DashboardUserListQuery } from "../adapter.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar.js";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SELECT_EMPTY_VALUE,
} from "../ui/select.js";
import { DataTable, type DataTableColumn } from "../components/data-table.js";
import { DateTimeCell } from "../components/date-time-cell.js";
import { getInitials } from "../lib/utils.js";
import { SessionLoading } from "../components/session-loading.js";
import { UserRoleBadge } from "../components/user-role-badge.js";
import { StatusBadge } from "../components/status-badge.js";
import { TablePagination } from "../components/table-pagination.js";

import { CreateUserDialog, UserActions } from "./user-actions.js";

const roles = ["member", "admin", "user", "owner"];
function validBoolean(value: string | null) {
    return value === "true" || value === "false" ? value : "";
}
const columns: DataTableColumn<DashboardUserItem>[] = [
    { key: "id", header: "ID", render: (user) => user.id },
    {
        key: "user",
        header: "用户",
        render: (user) => (
            <div className="flex min-w-56 items-center gap-3">
                <Avatar>
                    <AvatarImage
                        src={user.image ?? undefined}
                        alt={user.name ?? user.email ?? "用户"}
                    />
                    <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <div className="truncate font-medium">{user.name ?? "-"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                        {user.email ?? "-"}
                    </div>
                </div>
            </div>
        ),
    },
    {
        key: "role",
        header: "角色",
        render: (user) => <UserRoleBadge role={user.role} />,
    },
    {
        key: "verified",
        header: "邮箱验证",
        render: (user) => (
            <StatusBadge
                status={user.emailVerified ? "active" : "draft"}
                label={user.emailVerified ? "已验证" : "未验证"}
            />
        ),
    },
    {
        key: "banned",
        header: "状态",
        render: (user) => (
            <StatusBadge
                status={user.banned ? "failed" : "active"}
                label={user.banned ? "已封禁" : "正常"}
            />
        ),
    },
    { key: "banReason", header: "封禁原因", render: (user) => user.banReason ?? "-" },
    {
        key: "banExpires",
        header: "封禁到期",
        render: (user) => <DateTimeCell value={user.banExpires} />,
    },
    {
        key: "createdAt",
        header: "创建时间",
        render: (user) => <DateTimeCell value={user.createdAt} />,
    },
    {
        key: "updatedAt",
        header: "更新时间",
        render: (user) => <DateTimeCell value={user.updatedAt} />,
    },
];
function FilterSelect({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: [string, string][];
}) {
    return (
        <Select
            value={value || SELECT_EMPTY_VALUE}
            onValueChange={(next) => onChange(next === SELECT_EMPTY_VALUE ? "" : next)}
        >
            <SelectTrigger aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={SELECT_EMPTY_VALUE}>全部{label}</SelectItem>
                {options.map(([key, text]) => (
                    <SelectItem key={key} value={key}>
                        {text}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

// 页面读取与管理动作共用服务端权限契约。
export function UserList({
    onCurrentUserChange,
}: { onCurrentUserChange?: () => Promise<void> } = {}) {
    const adapter = useDashboardAdapter();
    const session = useDashboardSession();
    const listRef = useRef<HTMLDivElement>(null);
    const toolsRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const pendingFocus = useRef<string | null>(null);
    const [focusAfterLoad, setFocusAfterLoad] = useState<{ id: string } | null>(null);
    const restoreActionFocus = useCallback((id: string) => {
        if (!listRef.current?.isConnected) return;
        const trigger = listRef.current.querySelector<HTMLButtonElement>(
            `[data-user-action-id="${CSS.escape(id)}"]`,
        );
        const fallback = toolsRef.current?.querySelector<HTMLButtonElement>("button:enabled");
        (trigger ?? fallback ?? headingRef.current)?.focus();
    }, []);
    async function userChanged(id: string) {
        pendingFocus.current = id;
        setRevision((value) => value + 1);
        if (id === session?.user?.id) await onCurrentUserChange?.();
    }
    const mayManage =
        (!!adapter.updateUser &&
            ["user:update", "user:set-role", "user:ban"].some((permission) =>
                session?.permissions.includes(permission),
            )) ||
        (!!adapter.revokeUserSessions && !!session?.permissions.includes("session:revoke")) ||
        (!!adapter.getUserSessions && !!session?.permissions.includes("session:list"));
    const actionColumns = mayManage
        ? [
              ...columns,
              {
                  key: "actions",
                  header: "操作",
                  render: (user: DashboardUserItem) => (
                      <UserActions
                          user={user}
                          onSuccess={userChanged}
                          onRestoreFocus={restoreActionFocus}
                      />
                  ),
              },
          ]
        : columns;
    const permitted = !!session?.permissions.includes("user:list");
    const [params, setParams] = useSearchParams();
    const rawPage = Number(params.get("page"));
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1000000 ? rawPage : 1;
    const rawSize = Number(params.get("pageSize"));
    const pageSize = [10, 20, 50].includes(rawSize) ? rawSize : 20;
    const email = (params.get("email") ?? "").slice(0, 255);
    const role = roles.includes(params.get("role") ?? "") ? params.get("role")! : "";
    const banned = validBoolean(params.get("banned"));
    const verified = validBoolean(params.get("emailVerified"));
    const [draftEmail, setEmail] = useState(email);
    const [draftRole, setRole] = useState(role);
    const [draftBanned, setBanned] = useState(banned);
    const [draftVerified, setVerified] = useState(verified);
    const [rows, setRows] = useState<DashboardUserItem[]>([]);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        setEmail(email);
        setRole(role);
        setBanned(banned);
        setVerified(verified);
    }, [email, role, banned, verified]);
    useEffect(() => {
        const controller = new AbortController();
        // 将管理动作的焦点请求绑定到本轮查询，取消或切页时随请求失效。
        const focusID = pendingFocus.current;
        pendingFocus.current = null;
        setRows([]);
        setHasNext(false);
        setError("");
        setLoading(false);
        if (!permitted) return () => controller.abort();
        if (!adapter.getUsers) {
            setError("用户查询适配器缺失");
            return () => controller.abort();
        }
        setLoading(true);
        const where: DashboardUserListQuery["where"] = {
            ...(email ? { email: { like: `%${email}%` } } : {}),
            ...(role ? { role: { eq: role } } : {}),
            ...(banned ? { banned: banned === "true" } : {}),
            ...(verified ? { emailVerified: verified === "true" } : {}),
        };
        // 微任务执行前先经过 effect 清理，StrictMode 首轮重放可提前取消请求。
        queueMicrotask(() => {
            if (controller.signal.aborted || !adapter.getUsers) return;
            adapter
                .getUsers(
                    { where, limit: pageSize + 1, offset: (page - 1) * pageSize },
                    controller.signal,
                )
                .then((items) => {
                    if (!controller.signal.aborted) {
                        setRows(items.slice(0, pageSize));
                        setHasNext(items.length > pageSize);
                    }
                })
                .catch((err: unknown) => {
                    if (!controller.signal.aborted)
                        setError(err instanceof Error ? err.message : "用户列表读取失败");
                })
                .finally(() => {
                    if (!controller.signal.aborted) {
                        setLoading(false);
                        if (focusID) setFocusAfterLoad({ id: focusID });
                    }
                });
        });
        return () => controller.abort();
    }, [adapter, permitted, page, pageSize, email, role, banned, verified, revision]);
    useEffect(() => {
        if (!focusAfterLoad) return;
        const active = document.activeElement;
        // 加载期间用户已选择筛选框或其他操作时保留其焦点。
        if (
            active === document.body ||
            active === headingRef.current ||
            (active instanceof Element && toolsRef.current?.contains(active))
        ) {
            restoreActionFocus(focusAfterLoad.id);
        }
        setFocusAfterLoad(null);
    }, [focusAfterLoad, restoreActionFocus]);
    function navigate(
        nextPage: number,
        size = pageSize,
        filters = { email, role, banned, emailVerified: verified },
        refresh = false,
    ) {
        const next = new URLSearchParams();
        if (nextPage > 1) next.set("page", String(nextPage));
        if (size !== 20) next.set("pageSize", String(size));
        Object.entries(filters).forEach(([key, value]) => {
            if (value) next.set(key, value);
        });
        setParams(next);
        // 参数变化由 URL 驱动查询；参数相同时显式刷新一次。
        if (
            refresh &&
            nextPage === page &&
            size === pageSize &&
            filters.email === email &&
            filters.role === role &&
            filters.banned === banned &&
            filters.emailVerified === verified
        ) {
            setRevision((value) => value + 1);
        }
    }
    if (!session) return <SessionLoading />;
    if (!permitted)
        return (
            <section>
                <h1 className="text-2xl font-semibold">用户列表</h1>
                <p role="alert">403 · 当前账号缺少用户列表权限</p>
            </section>
        );
    return (
        <div ref={listRef} className="flex min-w-0 flex-col gap-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h1
                        ref={headingRef}
                        tabIndex={-1}
                        className="mt-1 text-2xl font-semibold tracking-normal"
                    >
                        用户列表
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        查询用户资料，并按权限管理账号、角色与会话。
                        {loading ? "" : ` 当前 ${rows.length} 条记录。`}
                    </p>
                </div>
                <div ref={toolsRef} className="flex flex-wrap items-center gap-2">
                    <CreateUserDialog onSuccess={() => setRevision((value) => value + 1)} />
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        <RefreshCwIcon />
                        刷新
                    </Button>
                </div>
            </header>
            <form
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 rounded-lg border bg-background p-3 *:min-w-0"
                onSubmit={(event) => {
                    event.preventDefault();
                    navigate(
                        1,
                        pageSize,
                        {
                            email: draftEmail.trim(),
                            role: draftRole,
                            banned: draftBanned,
                            emailVerified: draftVerified,
                        },
                        true,
                    );
                }}
            >
                <Input
                    aria-label="邮箱"
                    placeholder="邮箱包含"
                    maxLength={255}
                    value={draftEmail}
                    onChange={(event) => setEmail(event.target.value)}
                />
                <FilterSelect
                    label="角色"
                    value={draftRole}
                    onChange={setRole}
                    options={roles.map((value) => [value, value])}
                />
                <FilterSelect
                    label="状态"
                    value={draftBanned}
                    onChange={setBanned}
                    options={[
                        ["false", "正常"],
                        ["true", "已封禁"],
                    ]}
                />
                <FilterSelect
                    label="邮箱验证"
                    value={draftVerified}
                    onChange={setVerified}
                    options={[
                        ["true", "已验证"],
                        ["false", "未验证"],
                    ]}
                />
                <Button type="submit" className="w-full">
                    <FilterIcon />
                    筛选
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                        navigate(
                            1,
                            pageSize,
                            {
                                email: "",
                                role: "",
                                banned: "",
                                emailVerified: "",
                            },
                            true,
                        );
                    }}
                >
                    <RotateCcwIcon />
                    重置
                </Button>
            </form>
            {error && (
                <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                    {error}
                    <Button
                        className="ml-3"
                        variant="outline"
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        重试
                    </Button>
                </div>
            )}
            <DataTable
                columns={actionColumns}
                items={rows}
                getRowKey={(user) => String(user.id)}
                emptyText={loading ? "加载中" : error ? "用户列表读取失败" : "暂无用户记录"}
            />
            <TablePagination
                page={page}
                pageSize={pageSize}
                itemCount={rows.length}
                hasNext={hasNext}
                loading={loading}
                onPageChange={(next) => navigate(next)}
                onPageSizeChange={(size) => navigate(1, size)}
            />
        </div>
    );
}
