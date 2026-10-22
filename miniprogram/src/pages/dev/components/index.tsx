import { Title, Text } from "../../../components/ui/typography";
import { Navigator, View } from "@tarojs/components";
import { ThemePage } from "../../../components/theme/theme-page";
import { Card } from "../../../components/ui/card";

const categories = [
    {
        path: "basic",
        title: "基础组件",
        description: "按钮、状态标签与分割线。",
    },
    {
        path: "navigation",
        title: "导航组件",
        description: "带内容的选项卡与图标标签栏。",
    },
    {
        path: "form",
        title: "表单组件",
        description: "输入框、开关、单选、多选与多行输入。",
    },
    {
        path: "content",
        title: "内容展示",
        description: "卡片、列表与空态。",
    },
    {
        path: "overlay",
        title: "弹层与选择",
        description: "对话框、底部弹层与选择器。",
    },
];

export default function ComponentExamplesPage() {
    return (
        <ThemePage>
            <Title>组件示例</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                按用途查看组件样式、状态与交互。
            </Text>
            <View className="mt-6 flex flex-col gap-4">
                {categories.map(({ path, title, description }) => (
                    <Navigator
                        key={path}
                        url={`/pages/dev/components/${path}/index`}
                        openType="navigate"
                        hoverClass="opacity-80"
                    >
                        <Card title={title} description={description}>
                            <Text
                                className="block"
                                size="caption"
                                style={{ color: "var(--primary)" }}
                            >
                                查看示例 →
                            </Text>
                        </Card>
                    </Navigator>
                ))}
            </View>
        </ThemePage>
    );
}
