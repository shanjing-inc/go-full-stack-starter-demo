import { Title, Text } from "../../components/ui/typography";
import { Navigator, View } from "@tarojs/components";
import { ThemePage } from "../../components/theme/theme-page";
import { Card } from "../../components/ui/card";
import { FontSizeSettings } from "../../components/font-size-settings";

export default function IndexPage() {
    return (
        <ThemePage>
            <Title>小程序示例</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                查看设计规范、组件示例与功能测试。
            </Text>
            <View className="mt-6 flex flex-col gap-4">
                <Navigator
                    url="/pages/dev/design-system/index"
                    openType="navigate"
                    hoverClass="opacity-80"
                >
                    <Card title="设计规范" description="查看统一配色、文字层级与布局尺度。">
                        <Text className="block" size="caption" style={{ color: "var(--primary)" }}>
                            查看规范 →
                        </Text>
                    </Card>
                </Navigator>
                <Navigator
                    url="/pages/dev/components/index"
                    openType="navigate"
                    hoverClass="opacity-80"
                >
                    <Card title="组件示例" description="分类体验基础、导航、表单、内容与弹层组件。">
                        <Text className="block" size="caption" style={{ color: "var(--primary)" }}>
                            查看组件 →
                        </Text>
                    </Card>
                </Navigator>
                <Navigator
                    url="/pages/dev/batch-test/index"
                    openType="navigate"
                    hoverClass="opacity-80"
                >
                    <Card
                        title="批量请求测试"
                        description="账号登录、店铺查询与单次及并发请求诊断。"
                    >
                        <Text className="block" size="caption" style={{ color: "var(--primary)" }}>
                            进入测试 →
                        </Text>
                    </Card>
                </Navigator>
            </View>
            <FontSizeSettings />
        </ThemePage>
    );
}
