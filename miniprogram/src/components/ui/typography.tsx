import { View, type ViewProps } from "@tarojs/components";

export type TitleProps = JSX.IntrinsicElements["t-title"];
type TextSize = "body" | "caption";
export type TextProps = JSX.IntrinsicElements["t-text"] & { size?: TextSize };
export type ParagraphProps = JSX.IntrinsicElements["t-paragraph"] & { size?: TextSize };

// 布局类交给外层 View；原生根节点的内联样式复位官方间距并保留主题字号。
function typographyStyle(defaults: Record<string, string | number>, style: ViewProps["style"]) {
    return typeof style === "string"
        ? Object.entries(defaults)
              .map(
                  ([name, value]) =>
                      `${name.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase())}:${value}`,
              )
              .join(";") + `;${style}`
        : { ...defaults, ...style };
}

export function Title({ level = "h4", className = "", style, ...props }: TitleProps) {
    const defaults: Record<string, string | number> = { margin: 0, color: "var(--heading)" };
    if (level === "h4" || level === "h5") {
        defaults.fontSize = level === "h4" ? "var(--font-title)" : "var(--font-section)";
        defaults.fontWeight = 500;
        defaults.lineHeight = level === "h4" ? "1.3" : "1.4";
    }
    return (
        <View className={className}>
            <t-title {...props} level={level} style={typographyStyle(defaults, style)} />
        </View>
    );
}

/** theme=primary 沿官方表示主文字色；品牌链接通过实例 style 使用项目主色。 */
export function Text({ size = "body", className = "", style, ...props }: TextProps) {
    return (
        <View className={`ui-typography-text ${className}`}>
            <t-text
                {...props}
                style={typographyStyle(
                    { margin: 0, fontSize: `var(--font-${size})`, lineHeight: "1.5" },
                    style,
                )}
            />
        </View>
    );
}

export function Paragraph({ size = "body", className = "", style, ...props }: ParagraphProps) {
    return (
        <View className={className}>
            <t-paragraph
                {...props}
                style={typographyStyle(
                    { margin: 0, fontSize: `var(--font-${size})`, lineHeight: "1.5" },
                    style,
                )}
            />
        </View>
    );
}
