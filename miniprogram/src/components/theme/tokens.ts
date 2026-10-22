export type ThemeMode = "light" | "dark";
export type HexColor = `#${string}`;

const lightColors = {
    background: "#f3f3f3",
    foreground: "#1a1a1a",
    heading: "#1a1a1a",
    card: "#ffffff",
    "card-foreground": "#1a1a1a",
    primary: "#0052d9",
    "primary-foreground": "#ffffff",
    secondary: "#f2f3ff",
    "secondary-foreground": "#0052d9",
    muted: "#eeeeee",
    "muted-foreground": "#666666",
    accent: "#f2f3ff",
    "accent-foreground": "#0052d9",
    border: "#e7e7e7",
    input: "#e7e7e7",
    ring: "#0052d9",
    success: "#e3f9e9",
    "success-foreground": "#2ba471",
    warning: "#fff1e9",
    "warning-foreground": "#e37318",
    destructive: "#d54941",
    "destructive-foreground": "#ffffff",
} satisfies Record<string, HexColor>;

export type ThemeColors = Record<keyof typeof lightColors, HexColor>;

export const defaultColors: Record<ThemeMode, ThemeColors> = {
    light: lightColors,
    dark: {
        background: "#181818",
        foreground: "#e7e7e7",
        heading: "#e7e7e7",
        card: "#242424",
        "card-foreground": "#e7e7e7",
        primary: "#4582e6",
        "primary-foreground": "#ffffff",
        secondary: "#1b2f51",
        "secondary-foreground": "#4582e6",
        muted: "#2c2c2c",
        "muted-foreground": "#9c9c9c",
        accent: "#1b2f51",
        "accent-foreground": "#4582e6",
        border: "#383838",
        input: "#383838",
        ring: "#4582e6",
        success: "#193a2a",
        "success-foreground": "#059465",
        warning: "#4f2a1d",
        "warning-foreground": "#cf6e2d",
        destructive: "#c64751",
        "destructive-foreground": "#ffffff",
    },
};

export const defaultMetrics = {
    radius: 12,
    "page-padding": 32,
    "card-padding": 32,
    "input-height": 112,
    "control-height": 80,
    "control-height-sm": 64,
    "control-height-lg": 96,
    "font-body": 32,
    "font-caption": 28,
    "font-title": 40,
    "font-section": 36,
};

export interface ThemeOverrides {
    /** 官方组件变量覆盖，仍由项目入口管理；不参与业务语义颜色推导。 */
    tdesign?: Partial<Record<ThemeMode, Partial<Record<`--td-${string}`, string>>>>;
    colors?: Partial<Record<ThemeMode, Partial<ThemeColors>>>;
    metrics?: Partial<typeof defaultMetrics>;
}
