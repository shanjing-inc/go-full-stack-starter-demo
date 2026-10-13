// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../../src/app/app";

vi.mock("../../../src/features/auth/auth-page", () => ({
    AuthPage: ({ install = false }: { install?: boolean }) => (
        <h1>{install ? "初始化管理员" : "邮箱登录"}</h1>
    ),
}));
vi.mock("../../../src/features/auth/session-provider", () => ({
    SessionProvider: ({ children }: { children: ReactNode }) => (
        <section aria-label="会话边界">{children}</section>
    ),
}));
vi.mock("../../../src/app/dashboard-layout", () => ({
    DashboardLayout: function DashboardLayout() {
        const location = useLocation();
        return <h1>{location.pathname + location.search + location.hash}</h1>;
    },
}));

describe("应用路由装配", () => {
    it.each([
        ["/login?returnTo=%2Fadmin%2Fshops", "邮箱登录"],
        ["/install", "初始化管理员"],
    ])("认证入口 %s 保持独立加载", (path, heading) => {
        render(
            <MemoryRouter initialEntries={[path]}>
                <App />
            </MemoryRouter>,
        );
        expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "会话边界" })).toBeNull();
    });

    it.each([
        "/",
        "/shops?page=2",
        "/queues/jobs/failed/record-1?queue=default#detail",
        "/unknown",
    ])("后台入口 %s 保留会话边界与完整地址", (path) => {
        render(
            <MemoryRouter initialEntries={[path]}>
                <App />
            </MemoryRouter>,
        );
        expect(screen.getByRole("region", { name: "会话边界" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: path })).toBeInTheDocument();
    });
});
