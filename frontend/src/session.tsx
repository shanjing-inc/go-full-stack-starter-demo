import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { adapter } from "./adapter";
import { ApiError, cancelDashboardRequests, subscribeRequests } from "./request";
import { SessionContext, type SessionState } from "./session-context";

const REVALIDATE_AFTER = 60_000;
export function SessionProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<SessionState>({
        status: "loading",
        session: null,
        error: "",
    });
    const active = useRef(false);
    const request = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
    const lastValidated = useRef(0);
    const refresh = useCallback(() => {
        if (request.current) return request.current.promise;
        const controller = new AbortController();
        const promise = adapter
            .getSession(controller.signal)
            .then((session) => {
                if (!active.current || controller.signal.aborted) return;
                lastValidated.current = Date.now();
                if (!session.user) cancelDashboardRequests();
                setState({
                    status: session.user ? "ready" : "anonymous",
                    session: session.user ? session : null,
                    error: "",
                });
            })
            .catch((error: unknown) => {
                if (!active.current || controller.signal.aborted) return;
                const message = error instanceof Error ? error.message : "会话服务暂时不可用";
                if (
                    error instanceof ApiError &&
                    (error.status === 401 ||
                        ["UNAUTHORIZED", "UNAUTHENTICATED"].includes(error.code))
                ) {
                    cancelDashboardRequests();
                    setState({ status: "anonymous", session: null, error: "" });
                } else if (
                    error instanceof ApiError &&
                    (error.status === 403 || ["FORBIDDEN", "USER_BANNED"].includes(error.code))
                ) {
                    cancelDashboardRequests();
                    setState({ status: "forbidden", session: null, error: message });
                } else {
                    setState((current) => ({
                        ...current,
                        status: current.session ? "ready" : "error",
                        error: `会话服务暂时不可用：${message}`,
                    }));
                }
            })
            .finally(() => {
                if (request.current?.controller === controller) request.current = null;
            });
        request.current = { controller, promise };
        return promise;
    }, []);
    useEffect(() => {
        active.current = true;
        const controller = new AbortController();
        const unsubscribe = subscribeRequests((event) => {
            if (event === "forbidden") {
                void refresh();
                return;
            }
            request.current?.controller.abort();
            cancelDashboardRequests();
            setState({
                status: event === "banned" ? "forbidden" : "anonymous",
                session: null,
                error: event === "banned" ? "当前账号已被封禁，请联系管理员" : "",
            });
        });
        // StrictMode 首轮清理先于微任务，首次进入后台只发出一次身份查询。
        queueMicrotask(() => {
            if (!controller.signal.aborted) void refresh();
        });
        const focus = () => {
            if (Date.now() - lastValidated.current >= REVALIDATE_AFTER) void refresh();
        };
        window.addEventListener("focus", focus);
        return () => {
            active.current = false;
            controller.abort();
            request.current?.controller.abort();
            request.current = null;
            unsubscribe();
            window.removeEventListener("focus", focus);
            cancelDashboardRequests();
        };
    }, [refresh]);
    return <SessionContext value={{ ...state, refresh }}>{children}</SessionContext>;
}
