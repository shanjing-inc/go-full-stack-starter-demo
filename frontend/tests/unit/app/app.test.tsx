// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../src/app/app";

afterEach(() => vi.restoreAllMocks());

vi.mock("../../../src/features/auth/auth-page", () => ({
    AuthPage: ({ install = false }: { install?: boolean }) => (
        <h1>{install ? "初始化管理员" : "邮箱登录"}</h1>
    ),
}));
vi.mock("../../../src/app/dashboard-layout", () => ({
    default: function DashboardLayout() {
        const location = useLocation();
        return <h1>{location.pathname + location.search + location.hash}</h1>;
    },
}));

describe("应用路由装配", () => {
    it.each([
        ["/login?returnTo=%2Fadmin%2Fshops", "邮箱登录"],
        ["/install", "初始化管理员"],
    ])("认证入口 %s 保持认证页面", (path, heading) => {
        render(
            <MemoryRouter initialEntries={[path]}>
                <App />
            </MemoryRouter>,
        );
        expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    });

    it.each([
        "/",
        "/shops?page=2",
        "/queues/jobs/failed/record-1?queue=default#detail",
        "/unknown",
    ])("后台同步入口 %s 保留完整地址", (path) => {
        render(
            <MemoryRouter initialEntries={[path]}>
                <App />
            </MemoryRouter>,
        );
        expect(screen.getByRole("heading", { name: path })).toBeInTheDocument();
    });
});
