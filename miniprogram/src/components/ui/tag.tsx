import type { TextProps } from "@tarojs/components";
import { toTouchEvent } from "./native-tap";

type NativeTagProps = JSX.IntrinsicElements["t-tag"];

export interface TagProps
    extends TextProps, Omit<NativeTagProps, keyof TextProps | `on${string}` | "variant"> {
    variant?: "neutral" | "brand" | "success" | "warning" | "destructive";
    appearance?: NativeTagProps["variant"];
    onClose?: TextProps["onClick"];
}

export function Tag({
    variant = "neutral",
    className = "",
    children,
    onClick,
    onClose,
    theme,
    appearance = "light",
    ...props
}: TagProps) {
    return (
        <t-tag
            {...props}
            className={`ui-tag ${className}`}
            onClick={onClick ? (event) => onClick(toTouchEvent(event)) : undefined}
            onClose={onClose ? (event) => onClose(toTouchEvent(event)) : undefined}
            theme={
                theme ??
                (variant === "neutral"
                    ? "default"
                    : variant === "brand"
                      ? "primary"
                      : variant === "destructive"
                        ? "danger"
                        : variant)
            }
            variant={appearance}
        >
            {children}
        </t-tag>
    );
}
