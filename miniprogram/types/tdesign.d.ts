import type { TdTitleProps } from "tdesign-miniprogram/miniprogram_dist/title/type";
import type { TdTextProps } from "tdesign-miniprogram/miniprogram_dist/text/type";
import type { TdParagraphProps } from "tdesign-miniprogram/miniprogram_dist/paragraph/type";
import type { Attributes, ReactNode } from "react";
import type { NativeTapEvent } from "../src/components/ui/native-tap";
import type {
    ButtonProps,
    InputProps,
    ViewProps,
    CommonEventFunction,
    TextareaProps,
} from "@tarojs/components";
import type { TdButtonProps } from "tdesign-miniprogram/miniprogram_dist/button/type";
import type { TdLoadingProps } from "tdesign-miniprogram/miniprogram_dist/loading/type";
import type { TdInputProps } from "tdesign-miniprogram/miniprogram_dist/input/type";
import type { TdEmptyProps } from "tdesign-miniprogram/miniprogram_dist/empty/type";
import type { TdStickyProps } from "tdesign-miniprogram/miniprogram_dist/sticky/type";
import type { TdTagProps } from "tdesign-miniprogram/miniprogram_dist/tag/type";
import type { TdDialogProps } from "tdesign-miniprogram/miniprogram_dist/dialog/type";
import type { TdPopupProps } from "tdesign-miniprogram/miniprogram_dist/popup/type";
import type { TdPickerProps } from "tdesign-miniprogram/miniprogram_dist/picker/type";
import type { TdPickerItemProps } from "tdesign-miniprogram/miniprogram_dist/picker-item/type";
import type { TdSwitchProps, SwitchValue } from "tdesign-miniprogram/miniprogram_dist/switch/type";
import type {
    TdCheckboxGroupProps,
    CheckboxGroupValue,
} from "tdesign-miniprogram/miniprogram_dist/checkbox-group/type";
import type {
    TdRadioGroupProps,
    RadioValue,
} from "tdesign-miniprogram/miniprogram_dist/radio-group/type";
import type { TdTextareaProps } from "tdesign-miniprogram/miniprogram_dist/textarea/type";
import type { TdCellProps } from "tdesign-miniprogram/miniprogram_dist/cell/type";
import type { TdCellGroupProps } from "tdesign-miniprogram/miniprogram_dist/cell-group/type";
import type { TdDividerProps } from "tdesign-miniprogram/miniprogram_dist/divider/type";
import type { TdTabsProps, TabValue } from "tdesign-miniprogram/miniprogram_dist/tabs/type";
import type { TdTabPanelProps } from "tdesign-miniprogram/miniprogram_dist/tab-panel/type";
import type { TdTabBarProps } from "tdesign-miniprogram/miniprogram_dist/tab-bar/type";
import type { TdTabBarItemProps } from "tdesign-miniprogram/miniprogram_dist/tab-bar-item/type";
import type { TdBadgeProps } from "tdesign-miniprogram/miniprogram_dist/badge/type";

type Values<T> = { [K in keyof T]?: NonNullable<T[K]> extends { value?: infer V } ? V : never };
type Native<T> = Values<T> &
    Attributes & {
        id?: string;
        className?: string;
        style?: ViewProps["style"];
        children?: ReactNode;
        customStyle?: string;
        tClass?: string;
        ariaLabel?: string;
        ariaRole?: string;
        ariaHidden?: boolean;
        ariaLabelledby?: string;
        ariaDescribedby?: string;
        ariaBusy?: boolean;
    };

declare global {
    namespace JSX {
        interface IntrinsicElements {
            "t-title": Native<TdTitleProps> & {
                onExpand?: CommonEventFunction<{ expanded: boolean }>;
            };
            "t-text": Native<TdTextProps> & {
                onExpand?: CommonEventFunction<{ expanded: boolean }>;
                onCopy?: CommonEventFunction<{ text: string }>;
            };
            "t-paragraph": Native<TdParagraphProps> & {
                onExpand?: CommonEventFunction<{ expanded: boolean }>;
            };
            "t-button": Omit<
                Native<TdButtonProps>,
                Exclude<keyof ButtonProps, "size" | "type"> | "loadingProps"
            > &
                Omit<ButtonProps, "size" | "type" | "onTap"> & {
                    loadingProps?: Values<TdLoadingProps>;
                    onTap?: (event: NativeTapEvent) => void;
                    onGetuserinfo?: ButtonProps["onGetUserInfo"];
                    onGetphonenumber?: ButtonProps["onGetPhoneNumber"];
                    onGetrealtimephonenumber?: ButtonProps["onGetRealTimePhoneNumber"];
                    onCreateliveactivity?: ButtonProps["onCreateLiveActivity"];
                    onOpensetting?: ButtonProps["onOpenSetting"];
                    onLaunchapp?: ButtonProps["onLaunchApp"];
                    onChooseavatar?: ButtonProps["onChooseAvatar"];
                    onAgreeprivacyauthorization?: ButtonProps["onAgreePrivacyAuthorization"];
                };
            "t-input": Omit<InputProps, "password" | "type"> &
                Omit<Native<TdInputProps>, keyof InputProps | "type"> & {
                    type?: Values<TdInputProps>["type"];
                    onChange?: InputProps["onInput"];
                    onEnter?: InputProps["onConfirm"];
                    onKeyboardheightchange?: InputProps["onKeyboardHeightChange"];
                    onNicknamereview?: InputProps["onNickNameReview"];
                    onClear?: CommonEventFunction;
                    borderless?: boolean;
                };
            "t-tag": Native<TdTagProps> & {
                onClick?: (event: NativeTapEvent) => void;
                onClose?: (event: NativeTapEvent) => void;
            };
            "t-empty": Native<TdEmptyProps>;
            "t-dialog": Native<TdDialogProps> & {
                onConfirm?: CommonEventFunction;
                onCancel?: CommonEventFunction;
                onClose?: CommonEventFunction;
            };
            "t-popup": Native<TdPopupProps> & {
                onVisibleChange?: CommonEventFunction<{ visible: boolean }>;
            };
            "t-picker": Native<TdPickerProps> & {
                onConfirm?: CommonEventFunction<{ value: (string | number)[]; label: string[] }>;
                onCancel?: CommonEventFunction;
                onClose?: CommonEventFunction;
            };
            "t-picker-item": Native<TdPickerItemProps>;
            "t-switch": Native<TdSwitchProps> & {
                onChange?: CommonEventFunction<{ value: SwitchValue }>;
            };
            "t-checkbox-group": Native<TdCheckboxGroupProps> & {
                onChange?: CommonEventFunction<{ value: CheckboxGroupValue }>;
            };
            "t-radio-group": Omit<Native<TdRadioGroupProps>, "value" | "defaultValue"> & {
                value?: RadioValue | null;
                defaultValue?: RadioValue | null;
                onChange?: CommonEventFunction<{ value: RadioValue | null; index?: number }>;
            };
            "t-textarea": Native<TdTextareaProps> & {
                onChange?: TextareaProps["onInput"];
                onEnter?: TextareaProps["onConfirm"];
                onFocus?: TextareaProps["onFocus"];
                onBlur?: TextareaProps["onBlur"];
                onLineChange?: TextareaProps["onLineChange"];
                onKeyboardheightchange?: TextareaProps["onKeyboardHeightChange"];
            };
            "t-cell": Native<TdCellProps> & { onClick?: CommonEventFunction };
            "t-cell-group": Native<TdCellGroupProps>;
            "t-divider": Native<TdDividerProps>;
            "t-tabs": Omit<Native<TdTabsProps>, "stickyProps"> & {
                stickyProps?: Values<TdStickyProps>;
                onChange?: CommonEventFunction<{ value: TabValue; label: string }>;
                onClick?: CommonEventFunction<{ value: TabValue; label: string }>;
                onScroll?: CommonEventFunction;
                onError?: CommonEventFunction;
            };
            "t-tab-panel": Native<TdTabPanelProps>;
            "t-tab-bar": Native<TdTabBarProps> & {
                onChange?: CommonEventFunction<{
                    value: NonNullable<Values<TdTabBarProps>["value"]>;
                }>;
            };
            "t-tab-bar-item": Omit<Native<TdTabBarItemProps>, "badgeProps"> & {
                badgeProps?: Values<TdBadgeProps>;
            };
        }
    }
}
