import { useEffect, useState, type SubmitEvent } from "react";
import {
    Routes,
    Route,
    Link,
    Navigate,
    useLocation,
    useNavigate,
    useSearchParams,
} from "react-router";
import { LayoutDashboardIcon, StoreIcon, UsersIcon, ListTodoIcon } from "lucide-react";
import {
    Dashboard,
    SessionLoading,
    UserList,
    QueuePage,
    QueueSchedulesPage,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    Button,
    Input,
    type DashboardNavItem,
} from "@shanjing/shadcnui-dashboard";
import { adapter } from "./adapter";
import { Shops } from "./shops";
import { SessionProvider } from "./session";
import { safeReturnTo, useSession } from "./session-context";
const nav: DashboardNavItem[] = [
    { id: "overview", title: "系统概览", url: "/", icon: LayoutDashboardIcon, items: [] },
    {
        id: "users",
        title: "用户列表",
        url: "/users",
        icon: UsersIcon,
        items: [],
        permission: "user:list",
    },
    {
        id: "shops",
        title: "店铺列表",
        url: "/shops",
        icon: StoreIcon,
        items: [],
        permission: "demo:read",
    },
    {
        id: "queues",
        title: "队列管理",
        url: "/queues",
        icon: ListTodoIcon,
        items: [
            { id: "queue-console", title: "控制台", url: "/queues" },
            ...[
                ["recent", "最近任务"],
                ["active", "运行中任务"],
                ["completed", "已完成任务"],
                ["failed", "失败任务"],
                ["waiting", "等待任务"],
            ].map(([status, title]) => ({
                id: `queue-${status}`,
                title: title!,
                url: `/queues/jobs/${status}`,
                match: `/queues/jobs/${status}/:recordId`,
            })),
            { id: "queue-schedules", title: "计划任务", url: "/queues/schedules" },
        ],
        permission: "queue:read",
    },
];
function Overview() {
    const [data, setData] = useState<{ shops: number; backend: string } | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        const c = new AbortController();
        queueMicrotask(() => {
            if (c.signal.aborted) return;
            adapter
                .getSystemData<{ shops: number; backend: string }>("overview", c.signal)
                .then((d) => {
                    if (!c.signal.aborted) setData(d);
                })
                .catch(() => {
                    if (!c.signal.aborted) setError("概览读取失败");
                });
        });
        return () => c.abort();
    }, []);
    return (
        <>
            <h1 className="text-2xl font-semibold">系统概览</h1>
            {error && <p role="alert">{error}</p>}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>后端运行栈</CardTitle>
                    </CardHeader>
                    <CardContent>{data?.backend ?? "加载中"}</CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>店铺数量</CardTitle>
                    </CardHeader>
                    <CardContent data-testid="shop-count">{data?.shops ?? "加载中"}</CardContent>
                </Card>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>团队复用边界</CardTitle>
                </CardHeader>
                <CardContent>
                    公共 Dashboard 提供壳层、导航、主题和组件。应用维护菜单、路由、业务页面及 API
                    适配。
                </CardContent>
            </Card>
            <Link to="/shops">进入店铺列表</Link>
        </>
    );
}
function Authentication({ install = false }: { install?: boolean }) {
    const navigate = useNavigate();
    const location = useLocation();
    const initialization = location.state as { initializedEmail?: string } | null;
    const [name, setName] = useState("");
    const [email, setEmail] = useState(initialization?.initializedEmail ?? "");
    const [password, setPassword] = useState("");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState<{ installed: boolean; enabled: boolean } | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        setStatus(null);
        setError("");
        fetch("/api/auth/install-status", { signal: controller.signal, credentials: "include" })
            .then(async (response) => {
                if (!response.ok) throw new Error("初始化状态读取失败");
                return response.json();
            })
            .then((current) => {
                if (!controller.signal.aborted) setStatus(current);
            })
            .catch((err) => {
                if (!controller.signal.aborted) setError(err.message);
            });
        return () => controller.abort();
    }, [install]);
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
            const passwordBytes = new TextEncoder().encode(password).length;
            // 旧凭据登录采用独立上限，覆盖原 128 个 UTF-16 码元的多字节密码。
            if (install ? passwordBytes < 8 || passwordBytes > 128 : passwordBytes > 512) {
                throw new Error(install ? "密码长度需要 8–128 字节" : "密码长度最多 512 字节");
            }
            const response = await fetch(
                install ? "/api/auth/initialize" : "/api/auth/sign-in/email",
                {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        install
                            ? { name, email, password, bootstrapToken: token }
                            : { email, password },
                    ),
                },
            );
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || "认证请求失败");
            setPassword("");
            setToken("");
            if (install) {
                setStatus({ installed: true, enabled: false });
                setEmail(result.user.email);
                navigate("/login", {
                    replace: true,
                    state: { initializedEmail: result.user.email },
                });
            } else {
                const returnTo = new URLSearchParams(location.search).get("returnTo");
                if (returnTo === "/test/queue") {
                    window.location.assign("/test/queue");
                } else {
                    navigate(safeReturnTo(returnTo), { replace: true });
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "认证请求失败");
        } finally {
            setBusy(false);
        }
    }
    if (!install && status && !status.installed) {
        return <Navigate to="/install" replace />;
    }
    return (
        <main className="mx-auto max-w-md p-6 pt-16">
            <Card>
                <CardHeader>
                    <CardTitle>
                        <h1>{install ? "初始化管理员" : "邮箱登录"}</h1>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {!install && initialization?.initializedEmail && status?.installed && (
                        <p role="status" className="mb-4">
                            管理员初始化成功，请使用刚设置的邮箱和密码登录。
                        </p>
                    )}
                    {install && status && !status.enabled ? (
                        <p>{status.installed ? "管理员已初始化" : "初始化入口已关闭"}</p>
                    ) : (
                        <form className="grid gap-4" onSubmit={submit}>
                            {install && (
                                <label className="grid gap-2">
                                    名称
                                    <Input
                                        autoComplete="name"
                                        required
                                        maxLength={255}
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </label>
                            )}
                            <label className="grid gap-2">
                                邮箱
                                <Input
                                    type="email"
                                    autoComplete="username"
                                    required
                                    maxLength={255}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </label>
                            <label className="grid gap-2">
                                密码
                                <Input
                                    type="password"
                                    autoComplete={install ? "new-password" : "current-password"}
                                    required
                                    maxLength={install ? 128 : 512}
                                    aria-describedby={install ? "password-requirements" : undefined}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </label>
                            {install && (
                                <p
                                    id="password-requirements"
                                    className="text-sm text-muted-foreground"
                                >
                                    8–128 字节；8 个英文字符或 3 个常用汉字达到最低长度。
                                </p>
                            )}
                            {install && (
                                <label className="grid gap-2">
                                    初始化密钥
                                    <Input
                                        type="password"
                                        autoComplete="off"
                                        required
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                    />
                                </label>
                            )}
                            <Button disabled={busy || !status} type="submit">
                                {busy ? "提交中" : install ? "创建管理员" : "登录"}
                            </Button>
                        </form>
                    )}
                    {error && (
                        <p role="alert" className="mt-4 text-destructive">
                            {error}
                        </p>
                    )}
                    {install && (
                        <Link className="mt-4 block underline" to="/login">
                            前往登录
                        </Link>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}
/** 保留首批单页地址中的筛选、页码与详情深链。 */
function LegacyQueueRedirect() {
    const [search] = useSearchParams();
    const next = new URLSearchParams(search);
    const oldStatus = next.get("status");
    const record = next.get("record");
    const status = ["waiting", "active", "completed", "failed"].includes(oldStatus ?? "")
        ? oldStatus
        : "recent";
    if (oldStatus !== "delayed") next.delete("status");
    next.delete("record");
    const list = !!record || search.size > 0;
    const pathname = list
        ? `/queues/jobs/${status}${record ? `/${encodeURIComponent(record)}` : ""}`
        : "/queues";
    return <Navigate to={{ pathname, search: next.toString() }} replace />;
}
function ProtectedDashboard() {
    const location = useLocation();
    const { status, session, error, refresh } = useSession();
    const [logoutError, setLogoutError] = useState("");
    if (status === "anonymous") {
        const returnTo = `/admin${location.pathname === "/" ? "/" : location.pathname}${location.search}${location.hash}`;
        return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
    }
    if (status === "loading")
        return (
            <main>
                <SessionLoading fullPage />
            </main>
        );
    if (status === "error" || status === "forbidden")
        return (
            <main className="grid gap-4 p-8">
                <p role="alert">{error || "当前账号缺少后台访问权限"}</p>
                <Button onClick={() => void refresh()}>重试会话</Button>
                <Button
                    variant="outline"
                    onClick={() =>
                        void adapter.signOut().catch(() => setLogoutError("退出失败，请重试"))
                    }
                >
                    退出登录
                </Button>
                {logoutError && <p role="alert">{logoutError}</p>}
            </main>
        );
    // 延续既有浏览器偏好键，保留工程更名前的主题与字号。
    return (
        <Dashboard
            title="Multi Database Demo"
            adapter={adapter}
            navItems={nav}
            storageKey="go-mysql-demo"
            session={session}
        >
            {error && (
                <div role="alert" className="flex items-center gap-4 text-destructive">
                    {error}
                    <Button variant="outline" onClick={() => void refresh()}>
                        重试会话
                    </Button>
                </div>
            )}
            <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/queue" element={<LegacyQueueRedirect />} />
                <Route path="/queues" element={<QueuePage />} />
                <Route path="/queues/schedules" element={<QueueSchedulesPage />} />
                <Route path="/queues/jobs/:status" element={<QueuePage />} />
                <Route path="/queues/jobs/:status/:recordId" element={<QueuePage />} />
                <Route path="/shops" element={<Shops />} />
                <Route path="/users" element={<UserList onCurrentUserChange={refresh} />} />
                <Route path="*" element={<h1>页面不存在</h1>} />
            </Routes>
        </Dashboard>
    );
}
export function App() {
    return (
        <Routes>
            <Route path="/login" element={<Authentication />} />
            <Route path="/install" element={<Authentication install />} />
            <Route
                path="*"
                element={
                    <SessionProvider>
                        <ProtectedDashboard />
                    </SessionProvider>
                }
            />
        </Routes>
    );
}
