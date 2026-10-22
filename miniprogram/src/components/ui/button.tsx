import type { ButtonProps as TaroButtonProps } from "@tarojs/components";
import { toTouchEvent } from "./native-tap";

type NativeButtonProps = JSX.IntrinsicElements["t-button"];

export interface ButtonProps
    extends
        Omit<TaroButtonProps, "size">,
        Omit<NativeButtonProps, keyof TaroButtonProps | `on${string}` | "variant"> {
    variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
    /** 官方外观优先于语义 variant 的默认映射。 */
    appearance?: NativeButtonProps["variant"];
    size?: "sm" | "default" | "lg" | NativeButtonProps["size"];
    fullWidth?: boolean;
}

export function Button({
    variant = "default",
    size = "default",
    fullWidth,
    block,
    theme,
    appearance,
    disabled = false,
    loading = false,
    className = "",
    onClick,
    formType,
    type: _nativeType,
    plain: _plain,
    onGetUserInfo,
    onGetPhoneNumber,
    onGetRealTimePhoneNumber,
    onCreateLiveActivity,
    onOpenSetting,
    onLaunchApp,
    onChooseAvatar,
    onAgreePrivacyAuthorization,
    ...props
}: ButtonProps) {
    const blocked = disabled || loading;
    const isBlock = fullWidth ?? block ?? false;
    return (
        <t-button
            {...props}
            className={`ui-button ${isBlock ? "ui-button--full" : ""} ${className}`}
            theme={
                theme ??
                (variant === "destructive"
                    ? "danger"
                    : variant === "secondary"
                      ? "light"
                      : variant === "ghost"
                        ? "default"
                        : "primary")
            }
            variant={
                appearance ??
                (variant === "outline" ? "outline" : variant === "ghost" ? "text" : "base")
            }
            size={
                size === "sm"
                    ? "small"
                    : size === "lg"
                      ? "large"
                      : size === "default"
                        ? "medium"
                        : size
            }
            block={isBlock}
            type={formType}
            disabled={blocked}
            loading={loading}
            onTap={(event) => {
                if (!blocked) onClick?.(toTouchEvent(event));
            }}
            onGetuserinfo={onGetUserInfo}
            onGetphonenumber={onGetPhoneNumber}
            onGetrealtimephonenumber={onGetRealTimePhoneNumber}
            onCreateliveactivity={onCreateLiveActivity}
            onOpensetting={onOpenSetting}
            onLaunchapp={onLaunchApp}
            onChooseavatar={onChooseAvatar}
            onAgreeprivacyauthorization={onAgreePrivacyAuthorization}
        />
    );
}
