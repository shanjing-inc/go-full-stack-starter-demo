import { useTheme } from "../theme/use-theme";

export type RadioGroupProps = JSX.IntrinsicElements["t-radio-group"];

export function RadioGroup({
    disabled,
    readonly,
    onChange,
    className = "",
    options,
    keys,
    style,
    ...props
}: RadioGroupProps) {
    const { theme } = useTheme();
    const padding = theme.style["--td-radio-vertical-padding"] ?? "32rpx 0";
    const spacing: Record<string, string> = { "--td-radio-vertical-padding": padding };
    const nativeOptions = useReadonlyOptions(options, readonly, keys);
    return (
        <t-radio-group
            {...props}
            style={
                typeof style === "string"
                    ? `--td-radio-vertical-padding:${padding};${style}`
                    : { ...spacing, ...style }
            }
            options={nativeOptions}
            keys={keys}
            className={`block ${className}`}
            disabled={disabled}
            readonly={readonly}
            onChange={(event) => {
                if (!disabled && !readonly) onChange?.(event);
            }}
        />
    );
}
import { useReadonlyOptions } from "./use-readonly-options";
