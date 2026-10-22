import { useCallback, useEffect, useRef, useState } from "react";
import { View, type InputProps as TaroInputProps } from "@tarojs/components";
import { useTheme } from "../theme/use-theme";

type NativeInputProps = JSX.IntrinsicElements["t-input"];

export interface InputProps
    extends
        Omit<TaroInputProps, "type">,
        Omit<NativeInputProps, keyof TaroInputProps | `on${string}` | "type"> {
    invalid?: boolean;
    type?: NativeInputProps["type"];
    onClear?: NativeInputProps["onClear"];
}

export function Input({
    invalid = false,
    status,
    className = "",
    onFocus,
    onBlur,
    focus,
    disabled = false,
    password,
    type,
    onInput,
    onConfirm,
    onKeyboardHeightChange,
    onNickNameReview,
    cursorColor,
    placeholderClass,
    defaultValue,
    value,
    ...props
}: InputProps) {
    const { theme } = useTheme();
    const initialValue = useRef(defaultValue);
    const [focusRequested, setFocusRequested] = useState(!!focus);
    const focusedRef = useRef(false);
    const requestFocus = useCallback(() => {
        if (!disabled && !focusedRef.current) setFocusRequested(true);
    }, [disabled]);
    useEffect(() => {
        setFocusRequested(!disabled && !!focus);
        if (disabled) {
            focusedRef.current = false;
        }
    }, [focus, disabled]);
    // 仅在 Input 外壳内去除重复留白，项目显式主题覆盖优先。
    const inputSpacing: Record<string, string> = {
        "--td-input-vertical-padding": theme.style["--td-input-vertical-padding"] ?? "32rpx 0",
        "--td-input-border-left-space": theme.style["--td-input-border-left-space"] ?? "0",
    };
    return (
        <View className="ui-input-shell" style={inputSpacing} onClick={requestFocus}>
            <t-input
                {...props}
                value={value ?? initialValue.current}
                className={`ui-input ${className}`}
                type={password ? "password" : (type ?? "text")}
                status={invalid ? "error" : (status ?? "default")}
                cursorColor={cursorColor ?? theme.colors.primary}
                onChange={onInput}
                onEnter={onConfirm}
                onKeyboardheightchange={onKeyboardHeightChange}
                onNicknamereview={onNickNameReview}
                disabled={disabled}
                focus={!disabled && focusRequested}
                placeholderClass={placeholderClass}
                onFocus={(event) => {
                    focusedRef.current = true;
                    onFocus?.(event);
                }}
                onBlur={(event) => {
                    focusedRef.current = false;
                    setFocusRequested(false);
                    onBlur?.(event);
                }}
            />
        </View>
    );
}
