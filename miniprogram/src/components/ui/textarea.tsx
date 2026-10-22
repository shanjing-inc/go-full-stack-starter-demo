import { useTheme } from "../theme/use-theme";

export type TextareaProps = JSX.IntrinsicElements["t-textarea"];

export function Textarea({
    disabled,
    readonly,
    cursorColor,
    onChange,
    className = "",
    style,
    ...props
}: TextareaProps) {
    const { theme } = useTheme();
    const padding = theme.style["--td-textarea-padding"] ?? "32rpx 0";
    const spacing: Record<string, string> = { "--td-textarea-padding": padding };
    return (
        <t-textarea
            {...props}
            style={
                typeof style === "string"
                    ? `--td-textarea-padding:${padding};${style}`
                    : { ...spacing, ...style }
            }
            className={`block ${className}`}
            disabled={disabled}
            readonly={readonly}
            cursorColor={cursorColor ?? theme.colors.primary}
            onChange={(event) => {
                if (!disabled && !readonly) onChange?.(event);
            }}
        />
    );
}
