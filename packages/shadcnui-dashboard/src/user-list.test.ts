import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { DashboardAdapter, DashboardSession } from "./adapter.js";
import { AdapterContext, SessionContext } from "./dashboard-context.js";
import { UserRoleBadge } from "./components/user-role-badge.js";
import { getInitials } from "./lib/utils.js";
import { UserList } from "./pages/user-list.js";

const adapter: DashboardAdapter = {
    getSession: async () => ({ user: null, permissions: [] }),
    getSystemData: async <T>() => ({}) as T,
    signOut: async () => {},
};
function render(session: DashboardSession | null, value: DashboardAdapter = adapter) {
    return renderToStaticMarkup(
        createElement(
            MemoryRouter,
            { initialEntries: ["/users"] },
            createElement(
                AdapterContext.Provider,
                { value },
                createElement(SessionContext.Provider, { value: session }, createElement(UserList)),
            ),
        ),
    );
}
describe("公共用户列表", () => {
    it("会话加载期间保持查询门禁", () => {
        const html = render(null);
        expect(html).toContain("会话加载中");
        expect(html).toContain('data-slot="session-loading"');
        expect(html).toContain('role="status"');
        expect(html).not.toContain("<table");
    });
    it("缺少权限展示403", () => {
        const html = render({ user: null, permissions: [] });
        expect(html).toContain("403");
        expect(html).not.toContain("<table");
    });
    it("用户权限允许表格与四项筛选", () => {
        const html = render({
            user: { id: "1", name: "管理", email: "admin@example.test" },
            permissions: ["user:list"],
        });
        expect(html).toContain("<table");
        expect(html).toContain("用户列表");
        expect(html.indexOf(">角色</th>")).toBeGreaterThan(-1);
        expect(html.indexOf(">邮箱验证</th>")).toBeGreaterThan(-1);
        expect(html.indexOf(">角色</th>")).toBeLessThan(html.indexOf(">邮箱验证</th>"));
        for (const label of ["邮箱", "角色", "状态", "邮箱验证", "每页条数"])
            expect(html).toContain(`aria-label="${label}"`);
        expect(html).toContain("按权限管理账号");
        expect(html).not.toContain(">操作<");
        expect(html).not.toContain("创建用户");
    });
    it("管理权限与适配器能力共同开启入口", () => {
        const session = {
            user: { id: "1", name: "管理", email: "admin@example.test" },
            permissions: ["user:list", "user:create", "user:update"],
        };
        expect(render(session)).not.toContain("创建用户");
        const html = render(session, {
            ...adapter,
            createUser: async () => [],
            updateUser: async () => [],
        });
        expect(html).toContain("创建用户");
        expect(html).toContain(">操作<");
        expect(html.indexOf("创建用户")).toBeLessThan(html.indexOf("刷新"));
        expect(html).toContain("当前 0 条记录");
        expect(html).toContain("flex min-w-0 flex-col gap-6");
    });
});

describe("参考后台用户样式", () => {
    it.each([
        ["admin", "indigo"],
        ["member", "sky"],
        ["user", "zinc"],
        ["owner", "zinc"],
        ["member,admin", "zinc"],
        [null, "zinc"],
    ])("角色 %s 使用 %s 色系并保留完整标签", (role, tone) => {
        const html = renderToStaticMarkup(createElement(UserRoleBadge, { role }));
        expect(html).toContain(`bg-${tone}-50`);
        expect(html).toContain(`dark:text-${tone}-300`);
        expect(html).toContain("h-6");
        expect(html).toContain(`>${role ?? "unknown"}</span>`);
    });
    it("头像名称为空时使用邮箱缩写", () => {
        expect(getInitials(" ", "user@example.test")).toBe("US");
        expect(getInitials("张三", "user@example.test")).toBe("张三");
    });
});
