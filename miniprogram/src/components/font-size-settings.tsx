import { useState } from "react";
import { View } from "@tarojs/components";
import { fontSizeOptions, isFontSize } from "./theme/font-size";
import { fontSizeStore } from "./theme/font-size-store";
import { useTheme } from "./theme/use-theme";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Cell } from "./ui/cell";
import { RadioGroup } from "./ui/radio-group";
import { Text, Title } from "./ui/typography";

export function FontSizeSettings() {
    const { fontSize } = useTheme();
    const [visible, setVisible] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const label = fontSizeOptions.find((option) => option.value === fontSize)?.label;
    return (
        <>
            <Card className="mt-6">
                <Cell
                    title="字号设置"
                    note={label}
                    arrow
                    bordered={false}
                    onClick={() => setVisible(true)}
                />
            </Card>
            <t-popup
                visible={visible}
                placement="bottom"
                showOverlay
                preventScrollThrough
                closeBtn
                closeOnOverlayClick
                onVisibleChange={(event) => setVisible(event.detail.visible)}
            >
                <View
                    className="ui-popup-content"
                    style={{ background: "var(--card)", color: "var(--foreground)" }}
                >
                    <Title level="h5">字号设置</Title>
                    <Text className="mt-2 block" size="caption" theme="secondary">
                        文字大小立即生效，并记住本机选择。
                    </Text>
                    <RadioGroup
                        className="mt-3"
                        direction="horizontal"
                        borderless
                        style="--td-radio-vertical-padding:24rpx 16rpx"
                        value={fontSize}
                        options={fontSizeOptions.map(({ label, value }) => ({ label, value }))}
                        onChange={(event) => {
                            if (!isFontSize(event.detail.value)) return;
                            setSaveFailed(!fontSizeStore.setFontSize(event.detail.value));
                        }}
                    />
                    <Card className="mt-4" title="预览文字" description="辅助说明也会随字号调整。">
                        <Text>选择舒适的字号，轻松阅读。</Text>
                    </Card>
                    {saveFailed && (
                        <Text className="mt-3 block" size="caption" theme="error">
                            保存失败，当前字号已生效。请重试保存。
                        </Text>
                    )}
                    <View className="mt-4">
                        <Button
                            fullWidth
                            onClick={() => {
                                if (saveFailed) setSaveFailed(!fontSizeStore.setFontSize(fontSize));
                                else setVisible(false);
                            }}
                        >
                            {saveFailed ? "重试保存" : "完成"}
                        </Button>
                    </View>
                </View>
            </t-popup>
        </>
    );
}
