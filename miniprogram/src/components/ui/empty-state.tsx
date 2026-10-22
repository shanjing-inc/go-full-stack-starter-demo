import { Title, Text } from "./typography";
import type { ReactNode } from "react";
import { View, Slot } from "@tarojs/components";

export interface EmptyStateProps extends Omit<
    JSX.IntrinsicElements["t-empty"],
    "children" | "description"
> {
    title: string;
    description?: string;
    action?: ReactNode;
}

export function EmptyState({
    title,
    description,
    action,
    image,
    icon = image ? undefined : "inbox",
    ...props
}: EmptyStateProps) {
    return (
        <t-empty {...props} image={image} icon={icon}>
            <Slot name="description">
                <Title level="h5">{title}</Title>
                {description && (
                    <Text className="mt-2 block" size="caption" theme="secondary">
                        {description}
                    </Text>
                )}
            </Slot>
            {action && (
                <Slot name="action">
                    <View className="mt-4">{action}</View>
                </Slot>
            )}
        </t-empty>
    );
}
