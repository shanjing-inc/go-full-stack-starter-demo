import { describe, it, expect } from "vitest";
import {
    navigationPageTitle,
    navigationSubItemActive,
    permittedNavigation,
    type DashboardNavItem,
} from "./navigation.js";
const icon = () => null;
describe("权限导航", () => {
    it("会话加载期间展示公共项", () => {
        expect(
            permittedNavigation(
                [
                    { id: "public", title: "概览", url: "/", icon, items: [] },
                    {
                        id: "private",
                        title: "管理",
                        url: "/admin",
                        icon,
                        items: [],
                        permission: "manage",
                    },
                ],
                [],
            ).map((x) => x.id),
        ).toEqual(["public"]);
    });
    it("按适配器权限展示入口", () => {
        const items: DashboardNavItem[] = [
            { id: "private", title: "管理", url: "/admin", icon, items: [], permission: "manage" },
        ];
        expect(permittedNavigation(items, ["manage"])).toEqual(items);
    });
});

describe("当前页面标题", () => {
    const items: DashboardNavItem[] = [
        { id: "home", title: "系统概览", url: "/", icon, items: [] },
        { id: "users", title: "用户列表", url: "/users", icon, items: [], permission: "user:list" },
        {
            id: "group",
            title: "设置",
            url: null,
            icon,
            items: [{ id: "profile", title: "个人资料", url: "/settings/profile" }],
        },
    ];
    it.each([
        ["/", "系统概览"],
        ["/users", "用户列表"],
        ["/users/?email=test#row", "用户列表"],
        ["/settings/profile", "个人资料"],
        ["/unknown", "页面不存在"],
        ["/users/other", "页面不存在"],
    ])("解析 %s", (url, title) => {
        expect(navigationPageTitle(items, url)).toBe(title);
    });
    it("受限页面标题遵循可见导航", () => {
        expect(navigationPageTitle(permittedNavigation(items, []), "/users")).toBe("页面不存在");
    });
});

describe("队列详情导航", () => {
    const child = {
        id: "failed",
        title: "失败任务",
        url: "/queues/jobs/failed",
        match: "/queues/jobs/failed/:recordId",
    };
    const items: DashboardNavItem[] = [
        {
            id: "queues",
            title: "队列管理",
            url: "/queues",
            icon,
            items: [child],
            permission: "queue:read",
        },
    ];
    it.each([
        ["/queues/jobs/failed", true],
        ["/queues/jobs/failed/record-1", true],
        ["/queues/jobs/failed/record-1/?page=2#detail", true],
        ["/queues/jobs/failed/record-1/unknown", false],
        ["/queues/jobs/unknown/record-1", false],
        ["/queues/jobs/waiting/record-1", false],
    ])("详情匹配 %s", (url, active) => {
        expect(navigationSubItemActive(child, url)).toBe(active);
        expect(navigationPageTitle(items, url)).toBe(active ? "失败任务" : "页面不存在");
    });
    it("详情标题继承父分组查看权限", () => {
        expect(
            navigationPageTitle(permittedNavigation(items, []), "/queues/jobs/failed/record-1"),
        ).toBe("页面不存在");
    });
});
