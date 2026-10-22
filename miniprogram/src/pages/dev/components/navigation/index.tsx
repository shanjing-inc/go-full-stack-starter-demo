import { Title, Text } from "../../../../components/ui/typography";
import { useState } from "react";
import { View } from "@tarojs/components";
import { ThemePage } from "../../../../components/theme/theme-page";
import { Card } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Tabs, TabPanel, type TabsProps } from "../../../../components/ui/tabs";
import { TabBar, TabBarItem, type TabBarProps } from "../../../../components/ui/tab-bar";

const columns = [
    { value: "home", label: "首页", icon: "home" },
    { value: "category", label: "分类", icon: "app" },
    { value: "profile", label: "我的", icon: "user" },
];

export default function NavigationExamplesPage() {
    const [tab, setTab] = useState<TabsProps["value"]>("overview");
    const [tagTab, setTagTab] = useState<TabsProps["value"]>("goods");
    const [column, setColumn] = useState<TabBarProps["value"]>("home");
    const [actions, setActions] = useState(0);
    return (
        <ThemePage>
            <Title>导航组件</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                在不同内容和栏目之间切换，选中状态即时回填。
            </Text>
            <Card
                className="mt-4"
                title="带内容的选项卡"
                description="下划线样式；切换概览与详情，未开放的标签不可选择。"
            >
                <Tabs theme="line" value={tab} onChange={(event) => setTab(event.detail.value)}>
                    <TabPanel label="概览" value="overview">
                        <View className="flex flex-col gap-3 py-4">
                            <Title level="h5">商品概览</Title>
                            <Text>在同一页面切换内容，保留当前的操作记录。</Text>
                            <Button
                                variant="outline"
                                onClick={() => setActions((count) => count + 1)}
                            >
                                记录操作
                            </Button>
                        </View>
                    </TabPanel>
                    <TabPanel label="详情" value="detail" lazy>
                        <View className="flex flex-col gap-3 py-4">
                            <Title level="h5">配送与售后</Title>
                            <Text>此面板首次选中时展示，之后切换保留内容。</Text>
                            <Button variant="outline" onClick={() => setTab("overview")}>
                                返回概览
                            </Button>
                        </View>
                    </TabPanel>
                    <TabPanel label="未开放" value="disabled" disabled>
                        <Text className="block py-4" size="caption" theme="secondary">
                            此选项暂不可用。
                        </Text>
                    </TabPanel>
                </Tabs>
                <Text className="mt-3 block" size="caption" theme="secondary">
                    当前选项：{tab === "detail" ? "详情" : "概览"} · 已记录 {actions} 次操作
                </Text>
            </Card>
            <Card
                className="mt-4"
                title="标签式选项卡"
                description="通过选中项的背景区分栏目，独立切换下方内容。"
            >
                <Tabs
                    theme="tag"
                    value={tagTab}
                    onChange={(event) => setTagTab(event.detail.value)}
                >
                    <TabPanel label="商品" value="goods">
                        <View className="flex flex-col gap-3 py-4">
                            <Title level="h5">商品管理</Title>
                            <Text>查看商品资料与库存信息。</Text>
                        </View>
                    </TabPanel>
                    <TabPanel label="订单" value="orders">
                        <View className="flex flex-col gap-3 py-4">
                            <Title level="h5">订单管理</Title>
                            <Text>查看订单进度与配送信息。</Text>
                        </View>
                    </TabPanel>
                </Tabs>
            </Card>
            <Card
                className="mt-4"
                title="标签栏"
                description="图标、文字与徽标组合；此处仅切换示例栏目。"
            >
                <TabBar
                    value={column}
                    fixed={false}
                    safeAreaInsetBottom={false}
                    onChange={(event) => setColumn(event.detail.value)}
                >
                    {columns.map(({ value, label, icon }) => (
                        <TabBarItem
                            key={value}
                            value={value}
                            icon={icon}
                            badgeProps={value === "profile" ? { count: 2 } : undefined}
                        >
                            {label}
                        </TabBarItem>
                    ))}
                </TabBar>
                <Text className="mt-4 block" size="caption" theme="secondary">
                    当前栏目：{columns.find((item) => item.value === column)?.label}
                </Text>
            </Card>
        </ThemePage>
    );
}
