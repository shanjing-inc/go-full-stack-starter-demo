import { createContext, useContext } from "react";
import type { DashboardAdapter, DashboardSession } from "./adapter.js";

// 上下文与 Hook 独立于组件热更新边界，保持已有会话与应用状态。
export const AdapterContext = createContext<DashboardAdapter | null>(null);
export const SessionContext = createContext<DashboardSession | null>(null);

export function useDashboardAdapter() {
    const adapter = useContext(AdapterContext);
    if (!adapter) throw new Error("Dashboard 适配器缺失");
    return adapter;
}

export function useDashboardSession() {
    return useContext(SessionContext);
}
