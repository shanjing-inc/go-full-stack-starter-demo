import { Title, Text } from "../../../../components/ui/typography";
import { useState } from "react";
import { View } from "@tarojs/components";
import { ThemePage } from "../../../../components/theme/theme-page";
import { Card } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";

export default function OverlayExamplesPage() {
    const [dialogVisible, setDialogVisible] = useState(false);
    const [popupVisible, setPopupVisible] = useState(false);
    const [pickerVisible, setPickerVisible] = useState(false);
    const [selected, setSelected] = useState<(string | number)[]>(["blue"]);
    const [message, setMessage] = useState("打开弹层体验交互");
    return (
        <ThemePage>
            <Title>弹层与选择</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                体验确认、取消、遮罩关闭和选项回填。
            </Text>
            <Card
                className="mt-4"
                title="弹窗与选择器"
                description="体验确认、取消、遮罩关闭和选项回填。"
            >
                <View className="flex flex-col gap-3">
                    <Button fullWidth onClick={() => setDialogVisible(true)}>
                        打开对话框
                    </Button>
                    <Button fullWidth variant="outline" onClick={() => setPopupVisible(true)}>
                        打开底部弹层
                    </Button>
                    <Button fullWidth variant="outline" onClick={() => setPickerVisible(true)}>
                        选择颜色
                    </Button>
                    <Text size="caption" theme="secondary">
                        已选：{selected[0] === "green" ? "绿色" : "蓝色"}
                    </Text>
                </View>
            </Card>
            <Text className="mt-3 block" size="caption" theme="secondary">
                {message}
            </Text>
            <t-dialog
                showOverlay
                preventScrollThrough
                visible={dialogVisible}
                title="确认操作"
                content="这是 TDesign 默认对话框。"
                cancelBtn="取消"
                confirmBtn="确定"
                onConfirm={() => {
                    setDialogVisible(false);
                    setMessage("已确认操作");
                }}
                onCancel={() => setDialogVisible(false)}
                onClose={() => setDialogVisible(false)}
            />
            <t-popup
                showOverlay
                preventScrollThrough
                visible={popupVisible}
                placement="bottom"
                closeBtn
                closeOnOverlayClick
                onVisibleChange={(event) => setPopupVisible(event.detail.visible)}
            >
                <View className="ui-popup-content">
                    <Title level="h5">底部弹层</Title>
                    <Text className="mt-3 block" size="caption" theme="secondary">
                        内容与遮罩跟随系统亮暗主题。
                    </Text>
                    <View className="mt-4">
                        <Button fullWidth onClick={() => setPopupVisible(false)}>
                            完成
                        </Button>
                    </View>
                </View>
            </t-popup>
            <t-picker
                visible={pickerVisible}
                value={selected}
                title="选择颜色"
                usePopup
                autoClose
                header
                cancelBtn
                confirmBtn
                onConfirm={(event) => {
                    setSelected(event.detail.value);
                    setPickerVisible(false);
                }}
                onCancel={() => setPickerVisible(false)}
                onClose={() => setPickerVisible(false)}
            >
                <t-picker-item
                    options={[
                        { label: "蓝色", value: "blue" },
                        { label: "绿色", value: "green" },
                    ]}
                />
            </t-picker>
        </ThemePage>
    );
}
