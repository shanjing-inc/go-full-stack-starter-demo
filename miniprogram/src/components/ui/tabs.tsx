export type TabsProps = JSX.IntrinsicElements["t-tabs"];
export type TabPanelProps = JSX.IntrinsicElements["t-tab-panel"];

/** 保持原生父子结构，由 TD 负责内容面板的激活、隐藏和延迟渲染。 */
export function Tabs(props: TabsProps) {
    return <t-tabs {...props} />;
}

export function TabPanel(props: TabPanelProps) {
    return <t-tab-panel {...props} />;
}
