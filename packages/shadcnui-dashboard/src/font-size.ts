/** 与参考后台保持一致的字号选项，存储继续使用像素值。 */
export const dashboardFontSizeOptions = [
    { label: "紧凑", px: 16 },
    { label: "标准", px: 17 },
    { label: "舒展", px: 18 },
] as const;

export const defaultDashboardFontSize = 17;

export function isDashboardFontSize(size: number): boolean {
    return dashboardFontSizeOptions.some((option) => option.px === size);
}

export function decodeDashboardFontSize(value: string | null): number {
    const size = Number(value);
    // 旧版最小字号迁移为紧凑，已有 16px／18px 设置继续保留。
    if (size === 14) return 16;
    return isDashboardFontSize(size) ? size : defaultDashboardFontSize;
}

export function getDashboardFontSizeOption(size: number) {
    return (
        dashboardFontSizeOptions.find((option) => option.px === size) ?? dashboardFontSizeOptions[1]
    );
}
