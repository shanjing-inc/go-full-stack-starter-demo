import { useState } from "react";
import { Routes, Route, Navigate, useLocation, useSearchParams } from "react-router";
import {
    Dashboard,
    SessionLoading,
    Button,
    UserList as UsersPage,
} from "@shanjing/shadcnui-dashboard";
import { adapter } from "./dashboard-adapter";
import { nav } from "./navigation";
import { SessionProvider } from "../features/auth/session-provider";
import { useSession } from "../features/auth/session-context";
import { OverviewPage } from "../features/overview/overview-page";
import { ShopsPage } from "../features/shops/shops-page";
import QueueRoutes from "../features/queues/queue-routes";

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
export function DashboardLayout() {
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
                <Route path="/" element={<OverviewPage />} />
                <Route path="/queue" element={<LegacyQueueRedirect />} />
                <Route path="/queues/*" element={<QueueRoutes />} />
                <Route path="/shops" element={<ShopsPage />} />
                <Route path="/users" element={<UsersPage onCurrentUserChange={refresh} />} />
                <Route path="*" element={<h1>页面不存在</h1>} />
            </Routes>
        </Dashboard>
    );
}

export default function DashboardEntry() {
    return (
        <SessionProvider>
            <DashboardLayout />
        </SessionProvider>
    );
}
