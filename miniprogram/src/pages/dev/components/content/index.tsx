import { Title, Text } from "../../../../components/ui/typography";
import { useState } from "react";
import { ThemePage } from "../../../../components/theme/theme-page";
import { Card } from "../../../../components/ui/card";
import { Cell, CellGroup } from "../../../../components/ui/cell";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Button } from "../../../../components/ui/button";

export default function ContentExamplesPage() {
    const [cellMessage, setCellMessage] = useState("点击列表项查看反馈");
    const [message, setMessage] = useState("点击空态操作体验反馈");
    return (
        <ThemePage>
            <Title>内容展示</Title>
            <Text className="mt-2 block" size="caption" theme="secondary">
                卡片分组、列表信息与空态操作。
            </Text>
            <Card className="mt-4" title="卡片" description="标题、说明与内容组合为同一信息区域。">
                <Text className="block">卡片内容使用正文层级，四边留白保持一致。</Text>
            </Card>
            <Card
                className="mt-4"
                title="列表"
                description="列表项可展示说明、右侧信息与点击反馈。"
            >
                <CellGroup>
                    <Cell
                        title="消息设置"
                        description="管理通知与提醒"
                        note="已开启"
                        arrow
                        hover
                        onClick={() => setCellMessage("已点击：消息设置")}
                    />
                    <Cell title="配送方式" note="标准配送" />
                </CellGroup>
                <Text className="block" size="caption" theme="secondary">
                    {cellMessage}
                </Text>
            </Card>
            <Card className="mt-4" title="空态">
                <EmptyState
                    title="暂无内容"
                    description="完成首次操作后，内容将显示在这里。"
                    action={
                        <Button variant="outline" onClick={() => setMessage("可以开始首次操作")}>
                            开始体验
                        </Button>
                    }
                />
            </Card>
            <Text className="mt-3 block" size="caption" theme="secondary">
                {message}
            </Text>
        </ThemePage>
    );
}
