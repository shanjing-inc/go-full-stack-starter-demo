import { Title, Text, Paragraph } from "../../../components/ui/typography";
import { View } from "@tarojs/components";
import { ThemePage } from "../../../components/theme/theme-page";
import { useTheme } from "../../../components/theme/use-theme";
import { Card } from "../../../components/ui/card";

const swatches = [
    "background",
    "heading",
    "card",
    "primary",
    "secondary",
    "muted",
    "accent",
    "success",
    "warning",
    "destructive",
] as const;

export default function DesignSystemPage() {
    const { theme } = useTheme();
    return (
        <ThemePage>
            <Title>设计规范</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                统一配色、文字层级与布局尺度。
            </Text>
            <Text className="mt-2 block" size="caption" theme="secondary">
                当前外观：{theme.mode === "dark" ? "暗色" : "亮色"}，跟随微信系统主题。
            </Text>
            <Card
                className="mt-4"
                title="语义配色"
                description="背景与文字配对使用，亮暗模式保持相同语义。"
            >
                <View className="grid grid-cols-2 gap-4">
                    {swatches.map((name) => (
                        <View key={name}>
                            <View
                                className="ui-swatch"
                                style={{ backgroundColor: theme.colors[name] }}
                            />
                            <Text className="mt-2 block" size="caption">
                                {name}
                            </Text>
                            <Text className="block" size="caption" theme="secondary">
                                {theme.colors[name]}
                            </Text>
                        </View>
                    ))}
                </View>
            </Card>
            <Card
                className="mt-4"
                title="文字与尺度"
                description="页面与控件使用统一文字层级，控件尺寸沿用 TDesign。"
            >
                <Title>页面标题 · {theme.metrics["font-title"]}rpx</Title>
                <Title className="mt-3" level="h5">
                    区域标题 · {theme.metrics["font-section"]}rpx
                </Title>
                <Paragraph className="mt-3">
                    正文 · {theme.metrics["font-body"]}rpx · 页面内容
                </Paragraph>
                <Text className="mt-3 block" size="caption" theme="secondary">
                    辅助文字 · {theme.metrics["font-caption"]}rpx · 页面说明
                </Text>
            </Card>
            <Card
                className="mt-4"
                title="布局与间距"
                description="间距以 8rpx 为步长，外部间距由父容器管理。"
            >
                <View className="flex flex-col gap-3">
                    <Text>常用间距 · 8 / 16 / 24 / 32 / 48rpx</Text>
                    <Text>页面左右留白 · {theme.metrics["page-padding"]}rpx</Text>
                    <Text>卡片四边留白 · {theme.metrics["card-padding"]}rpx</Text>
                    <Text>基础圆角 · {theme.metrics.radius}rpx</Text>
                    <View
                        className="border border-border bg-muted"
                        style={{
                            borderRadius: `${theme.metrics.radius}rpx`,
                            padding: `${theme.metrics["card-padding"]}rpx`,
                        }}
                    >
                        <Text className="block" size="caption" theme="secondary">
                            边框、圆角与四边等距留白示意
                        </Text>
                    </View>
                </View>
            </Card>
        </ThemePage>
    );
}
