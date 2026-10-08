import { matchPath } from "react-router";
import type { ComponentType } from "react";
export type DashboardNavSubItem = {
    id: string;
    title: string;
    url: string;
    /** 显式声明详情匹配规则，列表入口和详情共用标题及活跃状态。 */
    match?: string;
};
const normalize = (url: string) => url.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
export function navigationSubItemActive(item: DashboardNavSubItem, pathname: string) {
    const current = normalize(pathname);
    return normalize(item.url) === current || !!(item.match && matchPath(item.match, current));
}
export type DashboardNavItem = {
    id: string;
    title: string;
    icon: ComponentType<{ className?: string }>;
    url: string | null;
    items: DashboardNavSubItem[];
    permission?: string;
};
export function permittedNavigation(items: DashboardNavItem[], permissions: readonly string[]) {
    return items.filter((item) => !item.permission || permissions.includes(item.permission));
}

/** 标题使用当前可见导航，兼容查询参数、锚点与尾部斜杠。 */
export function navigationPageTitle(items: DashboardNavItem[], pathname: string) {
    const current = normalize(pathname);
    for (const item of items) {
        const child = item.items.find((entry) => navigationSubItemActive(entry, current));
        if (child) return child.title;
        if (item.url && normalize(item.url) === current) return item.title;
    }
    return "页面不存在";
}
