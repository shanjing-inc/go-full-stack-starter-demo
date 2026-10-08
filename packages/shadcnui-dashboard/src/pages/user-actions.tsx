import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import {
    BanIcon,
    CheckCircle2Icon,
    LogOutIcon,
    MoreHorizontalIcon,
    PlusIcon,
    UserCogIcon,
    MonitorIcon,
} from "lucide-react";
import { useDashboardAdapter, useDashboardSession } from "../dashboard-context.js";
import type { DashboardUserItem, DashboardUpdateUserInput } from "../adapter.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../ui/dialog.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

import { UserSessions } from "./user-sessions.js";

const assignableRoles = ["member", "admin", "user"];
function RoleSelect({
    value,
    onChange,
    disabled,
}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger aria-label="用户角色">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {Array.from(new Set([...assignableRoles, value])).map((role) => (
                    <SelectItem key={role} value={role}>
                        {role}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
// 每个操作独立取消；切页和关闭弹窗后，迟到回调保持原页面生命周期。
function useUserMutation() {
    const controller = useRef<AbortController | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const cancel = () => {
        controller.current?.abort();
        controller.current = null;
    };
    useEffect(() => () => cancel(), []);
    async function run(
        action: (signal: AbortSignal) => Promise<unknown>,
        success: () => void | Promise<void>,
    ) {
        if (controller.current) return;
        const current = new AbortController();
        controller.current = current;
        setPending(true);
        setError("");
        try {
            await action(current.signal);
            if (!current.signal.aborted) await success();
        } catch (err) {
            if (!current.signal.aborted)
                setError(err instanceof Error ? err.message : "用户操作失败");
        } finally {
            if (!current.signal.aborted) setPending(false);
            if (controller.current === current) controller.current = null;
        }
    }
    function reset() {
        cancel();
        setPending(false);
        setError("");
    }
    return { pending, error, setError, run, reset };
}
function ErrorMessage({ error }: { error: string }) {
    return error ? (
        <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
            {error}
        </p>
    ) : null;
}

export function CreateUserDialog({ onSuccess }: { onSuccess: () => void }) {
    const adapter = useDashboardAdapter();
    const session = useDashboardSession();
    const [open, setOpen] = useState(false);
    const [role, setRole] = useState("member");
    const mutation = useUserMutation();
    const maySetRole = !!session?.permissions.includes("user:set-role");
    if (!adapter.createUser || !session?.permissions.includes("user:create")) return null;
    function changeOpen(value: boolean) {
        mutation.reset();
        setOpen(value);
        setRole("member");
    }
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const name = String(form.get("name") ?? "").trim();
        const email = String(form.get("email") ?? "").trim();
        const password = String(form.get("password") ?? "");
        const size = new TextEncoder().encode(password).length;
        if (!name || new TextEncoder().encode(name).length > 255) {
            mutation.setError("名称长度需要 1–255 字节");
            return;
        }
        if (size < 8 || size > 128) {
            mutation.setError("密码长度需要 8–128 字节");
            return;
        }
        await mutation.run(
            (signal) =>
                adapter.createUser!(
                    { name, email, password, role: maySetRole ? role : "user" },
                    signal,
                ),
            () => {
                setOpen(false);
                onSuccess();
            },
        );
    }
    return (
        <Dialog open={open} onOpenChange={changeOpen}>
            <DialogTrigger asChild>
                <Button type="button">
                    <PlusIcon />
                    创建用户
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>创建用户</DialogTitle>
                    <DialogDescription>创建邮箱账号并设置初始密码。</DialogDescription>
                </DialogHeader>
                <form className="grid gap-4" onSubmit={submit}>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">名称</span>
                        <Input
                            name="name"
                            required
                            maxLength={255}
                            autoComplete="off"
                            disabled={mutation.pending}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">邮箱</span>
                        <Input
                            name="email"
                            type="email"
                            required
                            maxLength={255}
                            autoComplete="off"
                            disabled={mutation.pending}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">初始密码</span>
                        <Input
                            name="password"
                            type="password"
                            required
                            maxLength={128}
                            autoComplete="new-password"
                            disabled={mutation.pending}
                        />
                    </label>
                    {maySetRole && (
                        <label className="grid gap-1.5 text-sm">
                            <span className="font-medium">角色</span>
                            <RoleSelect
                                value={role}
                                onChange={setRole}
                                disabled={mutation.pending}
                            />
                        </label>
                    )}
                    <ErrorMessage error={mutation.error} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
                            取消
                        </Button>
                        <Button type="submit" disabled={mutation.pending}>
                            <PlusIcon />
                            {mutation.pending ? "创建中" : "确认创建"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

type UserAction = "edit" | "ban" | "unban" | "revoke" | "sessions";
export function UserActions({
    user,
    onSuccess,
    onRestoreFocus,
}: {
    user: DashboardUserItem;
    onSuccess: (id: string) => void | Promise<void>;
    onRestoreFocus?: (id: string) => void;
}) {
    const adapter = useDashboardAdapter();
    const session = useDashboardSession();
    const banHelpID = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [action, setAction] = useState<UserAction | null>(null);
    const [role, setRole] = useState(user.role ?? "user");
    const mutation = useUserMutation();
    const self = user.id === session?.user?.id;
    const owner = user.role?.split(",").includes("owner");
    const manageable = !owner || !!session?.permissions.includes("system:owner");
    const mayEdit =
        !!adapter.updateUser && manageable && !!session?.permissions.includes("user:update");
    const mayRole =
        !!adapter.updateUser &&
        manageable &&
        !self &&
        !owner &&
        !!session?.permissions.includes("user:set-role");
    const mayBan =
        !!adapter.updateUser && manageable && !self && !!session?.permissions.includes("user:ban");
    const mayRevoke =
        !!adapter.revokeUserSessions &&
        manageable &&
        !!session?.permissions.includes("session:revoke");
    const mayListSessions =
        !!adapter.getUserSessions && manageable && !!session?.permissions.includes("session:list");
    if (!user.id || !(mayEdit || mayRole || mayBan || mayRevoke || mayListSessions)) return null;
    function changeAction(value: UserAction | null) {
        mutation.reset();
        setAction(value);
        setRole(user.role ?? "user");
    }
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const set: DashboardUpdateUserInput = {};
        if (action === "edit") {
            if (mayEdit) set.name = String(form.get("name") ?? "").trim();
            if (mayRole && role !== user.role) set.role = role;
            if (!Object.keys(set).length) {
                changeAction(null);
                return;
            }
        }
        if (action === "ban") {
            const expires = String(form.get("expires") ?? "");
            const instant = expires ? new Date(expires) : null;
            if (
                instant &&
                (!Number.isFinite(instant.getTime()) || instant.getTime() <= Date.now())
            ) {
                mutation.setError("封禁到期时间需要晚于当前时间");
                return;
            }
            set.banned = true;
            set.banReason = String(form.get("reason") ?? "").trim() || null;
            set.banExpires = instant?.toISOString() ?? null;
        }
        if (action === "unban") {
            set.banned = false;
            set.banReason = null;
            set.banExpires = null;
        }
        await mutation.run(
            (signal) =>
                action === "revoke"
                    ? adapter.revokeUserSessions!(user.id!, signal)
                    : adapter.updateUser!(user.id!, set, signal),
            async () => {
                setAction(null);
                await onSuccess(user.id!);
            },
        );
    }
    const title =
        action === "sessions"
            ? "用户会话"
            : action === "edit"
              ? "编辑用户"
              : action === "ban"
                ? "封禁用户"
                : action === "unban"
                  ? "解封用户"
                  : "撤销全部会话";
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={mutation.pending}
                        aria-label={`打开 ${user.email ?? user.name ?? "用户"} 的操作菜单`}
                        ref={triggerRef}
                        data-user-action-id={user.id}
                    >
                        <MoreHorizontalIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    {mayListSessions && (
                        <DropdownMenuItem onSelect={() => changeAction("sessions")}>
                            <MonitorIcon />
                            查看会话
                        </DropdownMenuItem>
                    )}
                    {(mayEdit || mayRole) && (
                        <DropdownMenuItem onSelect={() => changeAction("edit")}>
                            <UserCogIcon />
                            编辑
                        </DropdownMenuItem>
                    )}
                    {(mayEdit || mayRole) && (mayBan || mayRevoke) && <DropdownMenuSeparator />}
                    {mayBan && (
                        <DropdownMenuItem
                            onSelect={() => changeAction(user.banned ? "unban" : "ban")}
                        >
                            {user.banned ? <CheckCircle2Icon /> : <BanIcon />}
                            {user.banned ? "解封" : "封禁"}
                        </DropdownMenuItem>
                    )}
                    {mayBan && mayRevoke && <DropdownMenuSeparator />}
                    {mayRevoke && (
                        <DropdownMenuItem onSelect={() => changeAction("revoke")}>
                            <LogOutIcon />
                            撤销会话
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog
                open={action !== null}
                onOpenChange={(open) => {
                    if (!open) changeAction(null);
                }}
            >
                <DialogContent
                    className={action === "sessions" ? "sm:max-w-4xl" : undefined}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (triggerRef.current?.isConnected && !triggerRef.current.disabled)
                            triggerRef.current.focus();
                        else onRestoreFocus?.(user.id!);
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>
                            {user.email}
                            {action === "sessions"
                                ? " 的有效登录会话。"
                                : action === "revoke"
                                  ? " 的所有设备将退出登录。"
                                  : action === "ban"
                                    ? " 封禁后会话将立即撤销。"
                                    : action === "edit"
                                      ? " 的角色变更将撤销已有会话。"
                                      : " 的封禁信息将清除。"}
                        </DialogDescription>
                    </DialogHeader>
                    {action === "sessions" ? (
                        <UserSessions
                            userId={user.id!}
                            onCurrentRevoked={async () => {
                                setAction(null);
                                await onSuccess(user.id!);
                            }}
                        />
                    ) : (
                        <form className="grid gap-4" onSubmit={submit}>
                            {action === "edit" && (
                                <>
                                    {mayEdit && (
                                        <label className="grid gap-1.5 text-sm">
                                            <span className="font-medium">名称</span>
                                            <Input
                                                name="name"
                                                defaultValue={user.name ?? ""}
                                                required
                                                maxLength={255}
                                                disabled={mutation.pending}
                                            />
                                        </label>
                                    )}
                                    {mayRole && (
                                        <label className="grid gap-1.5 text-sm">
                                            <span className="font-medium">角色</span>
                                            <RoleSelect
                                                value={role}
                                                onChange={setRole}
                                                disabled={mutation.pending}
                                            />
                                        </label>
                                    )}
                                </>
                            )}
                            {action === "ban" && (
                                <>
                                    <label className="grid gap-1.5 text-sm">
                                        <span className="font-medium">封禁原因</span>
                                        <Input
                                            name="reason"
                                            maxLength={1000}
                                            disabled={mutation.pending}
                                        />
                                    </label>
                                    <label className="grid gap-1.5 text-sm">
                                        <span className="font-medium">封禁到期</span>
                                        <Input
                                            aria-label="封禁到期"
                                            aria-describedby={banHelpID}
                                            name="expires"
                                            type="datetime-local"
                                            disabled={mutation.pending}
                                        />
                                        <span
                                            id={banHelpID}
                                            className="text-xs text-muted-foreground"
                                        >
                                            留空表示长期封禁。
                                        </span>
                                    </label>
                                </>
                            )}
                            <ErrorMessage error={mutation.error} />
                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => changeAction(null)}
                                >
                                    取消
                                </Button>
                                <Button type="submit" disabled={mutation.pending}>
                                    {mutation.pending
                                        ? "处理中"
                                        : action === "edit"
                                          ? "保存"
                                          : "确认"}
                                </Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
