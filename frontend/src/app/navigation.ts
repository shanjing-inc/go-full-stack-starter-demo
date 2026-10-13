import { LayoutDashboardIcon, StoreIcon, UsersIcon, ListTodoIcon } from "lucide-react";
import type { DashboardNavItem } from "@shanjing/shadcnui-dashboard";

export const nav: DashboardNavItem[] = [
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
