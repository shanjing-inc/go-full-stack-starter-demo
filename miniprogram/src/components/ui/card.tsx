import { Title, Text } from "./typography";
import { View, type ViewProps } from "@tarojs/components";

export interface CardProps extends ViewProps {
    title?: string;
    description?: string;
}

export function Card({ title, description, children, className = "", ...props }: CardProps) {
    return (
        <View {...props} className={`ui-card ${className}`}>
            {(title || description) && (
                <View className="ui-card-heading">
                    {title && <Title level="h5">{title}</Title>}
                    {description && (
                        <Text className="mt-2 block" size="caption" theme="secondary">
                            {description}
                        </Text>
                    )}
                </View>
            )}
            {children}
        </View>
    );
}
