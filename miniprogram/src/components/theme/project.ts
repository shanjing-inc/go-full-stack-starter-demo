import type { ThemeOverrides } from "./tokens";

/**
 * 项目主题唯一修改入口。亮暗配色分别覆盖，未配置项沿用默认值。
 * 例如绿色品牌：light.primary = "#166534"，light["primary-foreground"] = "#ffffff"；
 * dark.primary = "#86efac"，dark["primary-foreground"] = "#052e16"。
 * 默认使用 TDesign 视觉；精细调整官方组件可在 tdesign.light/dark 中覆盖 --td-* 变量。
 * 颜色使用六位十六进制值，背景与文字成对检查对比度；尺寸单位为 rpx。
 */
export const projectTheme: ThemeOverrides = {
    colors: { light: {}, dark: {} },
    metrics: {},
};
