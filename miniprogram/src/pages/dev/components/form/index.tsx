import { Title, Text } from "../../../../components/ui/typography";
import { useState } from "react";
import { View } from "@tarojs/components";
import { ThemePage } from "../../../../components/theme/theme-page";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Switch } from "../../../../components/ui/switch";
import { CheckboxGroup, type CheckboxGroupProps } from "../../../../components/ui/checkbox-group";
import { RadioGroup, type RadioGroupProps } from "../../../../components/ui/radio-group";
import { Textarea } from "../../../../components/ui/textarea";
import { Divider } from "../../../../components/ui/divider";

export default function FormExamplesPage() {
    const [value, setValue] = useState("");
    const [search, setSearch] = useState("");
    const [notifications, setNotifications] = useState(false);
    const [subscriptions, setSubscriptions] = useState<NonNullable<CheckboxGroupProps["value"]>>([
        "goods",
    ]);
    const [delivery, setDelivery] = useState<RadioGroupProps["value"]>("standard");
    const [remark, setRemark] = useState("");
    return (
        <ThemePage>
            <Title>表单组件</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                输入、选择与状态回填，体验禁用和只读行为。
            </Text>
            <Card
                className="mt-4"
                title="基础输入框"
                description="横向标签与字段间分割线，错误时显示控件内提示；* 表示必填。"
            >
                <Input
                    id="example-name"
                    label="名称 *"
                    placeholder="请输入名称"
                    value={value}
                    onInput={(event) => setValue(event.detail.value)}
                />
                <Input
                    id="example-error"
                    label="邮箱"
                    tips="请输入有效的邮箱地址"
                    placeholder="name@example.com"
                    value="格式有误"
                    invalid
                />
                <Input
                    id="example-disabled"
                    label="禁用状态"
                    value="当前不可编辑"
                    disabled
                    borderless
                />
            </Card>
            <Card className="mt-4" title="输入框外观" description="前置图标、清除操作与纵向标签。">
                <Input
                    label="搜索"
                    prefixIcon="search"
                    clearable
                    value={search}
                    placeholder="输入后可一键清除"
                    onInput={(event) => setSearch(event.detail.value)}
                    onClear={() => setSearch("")}
                />
                <Input
                    className="mt-4"
                    label="只读信息"
                    layout="vertical"
                    status="warning"
                    value="订单处理中"
                    tips="此字段由系统更新"
                    readonly
                    borderless
                />
            </Card>
            <Card
                className="mt-4"
                title="选择控件"
                description="更改选项会立即回填，禁用与只读状态保持原值。"
            >
                <View className="flex flex-col gap-4">
                    <View className="flex items-center justify-between gap-4">
                        <Text>消息通知 · {notifications ? "已开启" : "已关闭"}</Text>
                        <Switch
                            value={notifications}
                            onChange={(event) => setNotifications(event.detail.value === true)}
                        />
                    </View>
                    <View className="flex items-center justify-between gap-4">
                        <Text theme="secondary">禁用状态</Text>
                        <Switch value disabled />
                    </View>
                    <View className="flex items-center justify-between gap-4">
                        <Text theme="secondary">处理中</Text>
                        <Switch value loading />
                    </View>
                    <Divider />
                    <Text className="block" theme="secondary">
                        订阅内容（多选）
                    </Text>
                    <CheckboxGroup
                        value={subscriptions}
                        options={[
                            { label: "商品动态", value: "goods" },
                            { label: "订单提醒", value: "orders" },
                            { label: "活动通知（暂不可用）", value: "campaigns", disabled: true },
                        ]}
                        onChange={(event) => setSubscriptions(event.detail.value)}
                    />
                    <Text size="caption" theme="secondary">
                        已选 {subscriptions.length} 项
                    </Text>
                    <Text className="block" theme="secondary">
                        配送方式（单选，可再次点击取消）
                    </Text>
                    <RadioGroup
                        value={delivery}
                        allowUncheck
                        options={[
                            { label: "标准配送", value: "standard" },
                            { label: "加急配送", value: "express" },
                            { label: "到店自取（暂不可用）", value: "pickup", disabled: true },
                        ]}
                        onChange={(event) => setDelivery(event.detail.value)}
                    />
                    <Text size="caption" theme="secondary">
                        当前：
                        {delivery === "express"
                            ? "加急配送"
                            : delivery === "standard"
                              ? "标准配送"
                              : "未选择"}
                    </Text>
                    <Text className="block" theme="secondary">
                        只读选项
                    </Text>
                    <CheckboxGroup
                        readonly
                        borderless
                        value={["confirmed"]}
                        options={[{ label: "已确认的设置", value: "confirmed" }]}
                    />
                </View>
            </Card>
            <Card
                className="mt-4"
                title="多行输入"
                description="支持自动增高、字数限制与计数，文字与占位提示保持同一字号。"
            >
                <Textarea
                    label="备注"
                    placeholder="请输入备注，最多 120 字"
                    value={remark}
                    maxlength={120}
                    indicator
                    autosize
                    onChange={(event) => setRemark(event.detail.value)}
                />
                <Textarea
                    className="mt-4"
                    label="只读说明"
                    value="这是一段不可修改的说明。"
                    readonly
                />
                <Textarea className="mt-4" label="禁用状态" value="当前不可编辑" disabled />
            </Card>
        </ThemePage>
    );
}
