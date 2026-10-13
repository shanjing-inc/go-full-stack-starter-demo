import { createContext, useContext } from "react";
import type { DashboardSession } from "@shanjing/shadcnui-dashboard";

export type SessionState = {
    status: "loading" | "ready" | "anonymous" | "error" | "forbidden";
    session: DashboardSession | null;
    error: string;
};
export const SessionContext = createContext<
    (SessionState & { refresh: () => Promise<void> }) | null
>(null);
export function useSession() {
    const context = useContext(SessionContext);
    if (!context) throw new Error("会话 Provider 缺失");
    return context;
}

/** 登录回跳限于当前后台，保留筛选与分页参数。 */
export function safeReturnTo(value: string | null): string {
    if (!value || !value.startsWith("/admin")) return "/";
    try {
        const url = new URL(value, window.location.origin);
        const path = decodeURIComponent(url.pathname);
        if (
            url.origin !== window.location.origin ||
            (path !== "/admin" && !path.startsWith("/admin/")) ||
            path.includes("\\") ||
            path.slice(6).startsWith("//") ||
            /^\/admin\/(login|install)(\/|$)/.test(path)
        )
            return "/";
        return `${url.pathname.slice(6) || "/"}${url.search}${url.hash}`;
    } catch {
        return "/";
    }
}
