import { defaultMetrics, type ThemeColors, type ThemeMode, type ThemeOverrides } from "./tokens";
import type { FontSize } from "./font-size";

function blend(color: string, target: string, amount: number) {
    const channels = [1, 3, 5].map((i) =>
        Math.round(
            parseInt(color.slice(i, i + 2), 16) * (1 - amount) +
                parseInt(target.slice(i, i + 2), 16) * amount,
        ),
    );
    return "#" + channels.map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 统一页面与官方控件的文字角色，颜色与尺寸仅映射项目的显式覆盖。 */
export function tdesignVariables(
    mode: ThemeMode,
    colors: ThemeColors,
    metrics: typeof defaultMetrics,
    overrides: ThemeOverrides,
    fontSize: FontSize = "standard",
) {
    const family = "var(--td-font-family, PingFang SC, Microsoft YaHei, Arial, sans-serif)";
    const body = metrics["font-body"];
    const caption = metrics["font-caption"];
    const section = metrics["font-section"];
    // 小与标准沿用官方行框；大字号增加行高，控件高度同步留出空间。
    const growth = fontSize === "large" ? 6 : 0;
    const style: Record<string, string> = {
        "--td-font-body-large": `400 ${body}rpx / ${48 + growth}rpx ${family}`,
        "--td-font-body-medium": `400 ${body}rpx / ${44 + growth}rpx ${family}`,
        "--td-font-body-small": `400 ${caption}rpx / ${40 + growth}rpx ${family}`,
        "--td-font-body-extraSmall": `400 ${caption}rpx / ${32 + growth}rpx ${family}`,
        "--td-font-mark-large": `500 ${body}rpx / ${48 + growth}rpx ${family}`,
        "--td-font-mark-medium": `500 ${body}rpx / ${44 + growth}rpx ${family}`,
        "--td-font-title-large": `500 ${section}rpx / ${48 + growth}rpx ${family}`,
        "--td-font-size-base": `${body}rpx`,
        "--td-font-size-m": `${body}rpx`,
        "--td-picker-item-font-size": `${body}rpx`,
        "--td-cell-description-font": `400 ${caption}rpx / ${40 + growth}rpx ${family}`,
        "--td-cell-note-font-size": `${caption}rpx`,
    };
    if (growth) {
        style["--td-button-extra-small-height"] = `${56 + growth}rpx`;
        style["--td-tab-bar-height"] = `${80 + growth}rpx`;
        style["--td-checkbox-title-line-height"] = `${48 + growth}rpx`;
        style["--td-radio-label-line-height"] = `${48 + growth}rpx`;
    }
    const custom = overrides.colors?.[mode] ?? {};
    const mapping: Partial<Record<keyof ThemeColors, string[]>> = {
        background: ["--td-bg-color-page"],
        foreground: ["--td-text-color-primary"],
        card: ["--td-bg-color-container"],
        "muted-foreground": ["--td-text-color-secondary", "--td-text-color-placeholder"],
        border: ["--td-border-level-1-color", "--td-component-stroke"],
        input: ["--td-input-border-color"],
        primary: ["--td-brand-color", "--td-text-color-brand", "--td-text-color-link"],
        "primary-foreground": ["--td-button-primary-color"],
        secondary: ["--td-button-light-bg-color", "--td-button-light-border-color"],
        "secondary-foreground": ["--td-button-light-color"],
        accent: ["--td-tag-primary-light-color"],
        "accent-foreground": ["--td-tag-primary-color"],
        success: ["--td-tag-success-light-color"],
        "success-foreground": ["--td-tag-success-color"],
        warning: ["--td-tag-warning-light-color"],
        "warning-foreground": ["--td-tag-warning-color"],
        destructive: ["--td-error-color", "--td-button-danger-bg-color", "--td-tag-danger-color"],
        "destructive-foreground": ["--td-button-danger-color"],
    };
    for (const name of Object.keys(custom) as (keyof ThemeColors)[]) {
        for (const variable of mapping[name] ?? []) style[variable] = colors[name];
    }
    if (custom.primary) {
        const target = mode === "dark" ? "#ffffff" : "#000000";
        style["--td-brand-color-active"] = blend(colors.primary, target, 0.15);
        style["--td-brand-color-disabled"] = blend(colors.primary, colors.card, 0.65);
        style["--td-brand-color-light"] = blend(colors.primary, colors.card, 0.9);
        style["--td-brand-color-light-active"] = blend(colors.primary, colors.card, 0.8);
        // Tag 的默认浅色直接引用色阶，需一起覆盖。
        style["--td-tag-primary-light-color"] = custom.accent ?? style["--td-brand-color-light"];
        style["--td-tag-primary-color"] = custom["accent-foreground"] ?? colors.primary;
    }
    if (custom.destructive) {
        const target = mode === "dark" ? "#ffffff" : "#000000";
        const disabled = blend(colors.destructive, colors.card, 0.65);
        style["--td-error-color-active"] = blend(colors.destructive, target, 0.15);
        // 官方危险按钮的禁用背景和 Tag 浅底直接引用红色色阶，需要显式覆盖。
        style["--td-button-danger-disabled-bg"] = disabled;
        style["--td-button-danger-disabled-border-color"] = disabled;
        style["--td-tag-danger-light-color"] = blend(colors.destructive, colors.card, 0.9);
    }
    const customMetrics = overrides.metrics ?? {};
    if (customMetrics.radius !== undefined) {
        style["--td-radius-default"] = `${metrics.radius}rpx`;
        style["--td-radius-extraLarge"] = `${metrics.radius * 2}rpx`;
    }
    for (const [metric, variable] of [
        ["control-height", "--td-button-medium-height"],
        ["control-height-sm", "--td-button-small-height"],
        ["control-height-lg", "--td-button-large-height"],
    ] as const) {
        if (growth || customMetrics[metric] !== undefined)
            style[variable] = `${metrics[metric] + growth}rpx`;
    }
    if (customMetrics["input-height"] !== undefined)
        style["--td-input-vertical-padding"] =
            `${Math.max(0, (metrics["input-height"] - 48) / 2)}rpx 0`;
    return { ...style, ...overrides.tdesign?.[mode] };
}
