export const fontSizeOptions = [
    { label: "小", value: "small" },
    { label: "标准", value: "standard" },
    { label: "大", value: "large" },
] as const;

export type FontSize = (typeof fontSizeOptions)[number]["value"];
export const fontSizeOffsets: Record<FontSize, number> = { small: -4, standard: 0, large: 4 };

export function isFontSize(value: unknown): value is FontSize {
    return fontSizeOptions.some((option) => option.value === value);
}
