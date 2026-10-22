import { useMemo } from "react";
import { useTheme } from "../theme/use-theme";

export type CheckboxGroupProps = JSX.IntrinsicElements["t-checkbox-group"];

export function CheckboxGroup({
    disabled,
    readonly,
    onChange,
    className = "",
    options,
    keys,
    style,
    ...props
}: CheckboxGroupProps) {
    const { theme } = useTheme();
    const padding = theme.style["--td-checkbox-vertical-padding"] ?? "32rpx 0";
    const spacing: Record<string, string> = { "--td-checkbox-vertical-padding": padding };
    const readonlyOptions = useReadonlyOptions(options, readonly, keys);
    // TD 的单项 disabled=false 会覆盖组禁用，需在原生子项响应前同步状态。
    const nativeOptions = useMemo(
        () =>
            disabled
                ? readonlyOptions?.map((option) =>
                      typeof option === "object" ? { ...option, disabled: true } : option,
                  )
                : readonlyOptions,
        [readonlyOptions, disabled],
    );
    // TD 1.17.0 不清理空 options；仅跨空选项边界重建，保留普通更新的非受控状态。
    return (
        <t-checkbox-group
            key={nativeOptions?.length ? "populated" : "empty"}
            {...props}
            style={
                typeof style === "string"
                    ? `--td-checkbox-vertical-padding:${padding};${style}`
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
