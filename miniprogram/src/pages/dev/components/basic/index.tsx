import { Title, Text } from "../../../../components/ui/typography";
import { useState } from "react";
import { View } from "@tarojs/components";
import { ThemePage } from "../../../../components/theme/theme-page";
import { Button, type ButtonProps } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Tag, type TagProps } from "../../../../components/ui/tag";
import { Divider } from "../../../../components/ui/divider";

const buttons: [NonNullable<ButtonProps["variant"]>, string][] = [
    ["default", "主要操作"],
    ["secondary", "次要操作"],
    ["outline", "描边操作"],
    ["ghost", "弱化操作"],
    ["destructive", "危险操作"],
];
const tags: [NonNullable<TagProps["variant"]>, string][] = [
    ["neutral", "待处理"],
    ["brand", "进行中"],
    ["success", "已完成"],
    ["warning", "需注意"],
    ["destructive", "失败"],
];

export default function BasicExamplesPage() {
    const [message, setMessage] = useState("点击按钮体验操作反馈");
    return (
        <ThemePage>
            <Title>基础组件</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                按钮层级、尺寸与状态，以及标签和分割线。
            </Text>
            <Card
                className="mt-4"
                title="按钮"
                description="同一区域突出一个主要操作，加载与禁用时不响应点击。"
            >
                <View className="flex flex-col gap-3">
                    {buttons.map(([variant, label]) => (
                        <Button
                            key={variant}
                            variant={variant}
                            fullWidth
                            onClick={() => setMessage(`已点击：${label}`)}
                        >
                            {label}
                        </Button>
                    ))}
                    <View className="flex flex-wrap items-center gap-2">
                        <Button size="sm">小号</Button>
                        <Button>标准</Button>
                        <Button size="lg">大号</Button>
                    </View>
                    <View className="flex flex-wrap items-center gap-2">
                        <Button
                            theme="primary"
                            appearance="dashed"
                            shape="round"
                            icon="add"
                            onClick={() => setMessage("已点击：新增")}
                        >
                            新增
                        </Button>
                        <Button
                            theme="default"
                            appearance="text"
                            size="sm"
                            onClick={() => setMessage("已点击：文字按钮")}
                        >
                            文字按钮
                        </Button>
                    </View>
                    <Button fullWidth disabled>
                        暂不可用
                    </Button>
                    <Button fullWidth loading>
                        处理中…
                    </Button>
                    <Text size="caption" theme="secondary">
                        {message}
                    </Text>
                </View>
            </Card>
            <Card className="mt-4" title="状态标签">
                <View className="flex flex-wrap gap-2">
                    {tags.map(([variant, label]) => (
                        <Tag key={variant} variant={variant}>
                            {label}
                        </Tag>
                    ))}
                </View>
                <View className="mt-3 flex flex-wrap gap-2">
                    <Tag variant="brand" appearance="outline" shape="round">
                        描边标签
                    </Tag>
                    <Tag variant="success" appearance="dark">
                        深色标签
                    </Tag>
                </View>
            </Card>
            <Card className="mt-4" title="分割线" description="用实线、虚线或文字划分内容。">
                <Divider />
                <Divider content="分组说明" />
                <Divider dashed content="虚线分割" />
            </Card>
        </ThemePage>
    );
}
