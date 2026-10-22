import { defaultColors, defaultMetrics, type ThemeMode, type ThemeOverrides } from "./tokens";
import { tdesignVariables } from "./tdesign";
import { projectTheme } from "./project";
import { fontSizeOffsets, type FontSize } from "./font-size";

export function resolveTheme(
    mode: ThemeMode,
    overrides: ThemeOverrides = projectTheme,
    fontSize: FontSize = "standard",
) {
    const colors = { ...defaultColors[mode], ...overrides.colors?.[mode] };
    const metrics = { ...defaultMetrics, ...overrides.metrics };
    for (const name of ["font-body", "font-caption", "font-title", "font-section"] as const) {
        metrics[name] += fontSizeOffsets[fontSize];
    }
    const style: Record<string, string> = {};
    for (const [name, value] of Object.entries(colors)) style[`--${name}`] = value;
    for (const [name, value] of Object.entries(metrics)) style[`--${name}`] = `${value}rpx`;
    Object.assign(style, tdesignVariables(mode, colors, metrics, overrides, fontSize));
    return {
        mode,
        colors,
        metrics,
        style,
        navigation: {
            backgroundColor: colors.background,
            frontColor: mode === "dark" ? ("#ffffff" as const) : ("#000000" as const),
        },
    };
}

export type ResolvedTheme = ReturnType<typeof resolveTheme>;
export const themes = { light: resolveTheme("light"), dark: resolveTheme("dark") };
