export type TabBarProps = JSX.IntrinsicElements["t-tab-bar"];
export type TabBarItemProps = JSX.IntrinsicElements["t-tab-bar-item"];

/** fixed、placeholder 和底部安全区沿用官方配置，页面内展示应显式关闭 fixed。 */
export function TabBar(props: TabBarProps) {
    return <t-tab-bar {...props} />;
}

export function TabBarItem(props: TabBarItemProps) {
    return <t-tab-bar-item {...props} />;
}
