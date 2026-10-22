import type { ButtonProps } from "../../src/components/ui/button";
import type { InputProps } from "../../src/components/ui/input";
import type { TagProps } from "../../src/components/ui/tag";
import type { EmptyStateProps } from "../../src/components/ui/empty-state";
import type { SwitchProps } from "../../src/components/ui/switch";
import type { CheckboxGroupProps } from "../../src/components/ui/checkbox-group";
import type { RadioGroupProps } from "../../src/components/ui/radio-group";
import type { TextareaProps } from "../../src/components/ui/textarea";
import type { CellProps } from "../../src/components/ui/cell";
import type { DividerProps } from "../../src/components/ui/divider";
import type { TabsProps, TabPanelProps } from "../../src/components/ui/tabs";
import type { TabBarProps, TabBarItemProps } from "../../src/components/ui/tab-bar";
import type { ThemeOverrides, ThemeMode } from "../../src/components/theme/tokens";
import type { TitleProps, TextProps, ParagraphProps } from "../../src/components/ui/typography";

const title: TitleProps = {
    level: "h5",
    ellipsis: { row: 2, expandable: true },
    onExpand: (e) => e.detail.expanded,
};
const text: TextProps = {
    size: "caption",
    theme: "secondary",
    copyable: { text: "复制" },
    onCopy: (e) => e.detail.text,
};
const paragraph: ParagraphProps = { content: "正文", ellipsis: true };
// @ts-expect-error 标题层级采用官方枚举。
const invalidTitle: TitleProps = { level: "page" };
// @ts-expect-error 项目正文只提供正文和辅助两档。
const invalidText: TextProps = { size: "large" };
// @ts-expect-error 当前官方展开和收起统一使用 onExpand，不提供 onCollapse。
const invalidCollapse: TitleProps = { onCollapse: () => {} };
void [title, text, paragraph, invalidTitle, invalidText, invalidCollapse];

const share: ButtonProps = { openType: "share", size: "sm", variant: "outline", loading: true };
const password: InputProps = {
    password: true,
    confirmType: "done",
    invalid: true,
    onInput: (event) => event.detail.value,
};
const theme: ThemeOverrides = { colors: { dark: { primary: "#86efac" } }, metrics: { radius: 24 } };
// @ts-expect-error 不接收浏览器事件模型或未定义的变体。
const invalidButton: ButtonProps = { variant: "browser" };
// @ts-expect-error 主题解析只接收实际亮暗模式，系统跟随由状态层处理。
const invalidMode: ThemeMode = "system";
// @ts-expect-error 项目覆盖必须使用已定义的颜色语义。
const invalidTheme: ThemeOverrides = { colors: { light: { brandColor: "#ffffff" } } };
void [share, password, theme, invalidButton, invalidMode, invalidTheme];

const officialTheme: ThemeOverrides = {
    tdesign: { dark: { "--td-brand-color-active": "#43af8a" } },
};
// @ts-expect-error 官方覆盖必须是 --td-* 变量。
const wrongOfficialTheme: ThemeOverrides = { tdesign: { light: { primary: "#ffffff" } } };
void [officialTheme, wrongOfficialTheme];

const toggle: SwitchProps = { value: false, disabled: true, onChange: (e) => e.detail.value };
const checkboxes: CheckboxGroupProps = {
    key: "populated",
    value: ["goods"],
    options: [{ label: "商品", value: "goods", disabled: true }],
};
const radios: RadioGroupProps = {
    value: null,
    allowUncheck: true,
    onChange: (e) => {
        const value: string | number | boolean | null = e.detail.value;
        return value;
    },
};
const textarea: TextareaProps = {
    value: "备注",
    maxlength: 120,
    readonly: true,
    onChange: (e) => e.detail.value,
};
const cell: CellProps = { title: "设置", arrow: true, jumpType: "navigateTo" };
const divider: DividerProps = { content: "分组", dashed: true };
// @ts-expect-error 复选组值必须是数组。
const invalidCheckboxes: CheckboxGroupProps = { value: "goods" };
// @ts-expect-error 不接受浏览器事件模型。
const invalidTextarea: TextareaProps = { onChange: (event: Event) => event.type };
// @ts-expect-error 列表跳转仅接受微信支持的模式。
const invalidCell: CellProps = { jumpType: "push" };
void [
    toggle,
    checkboxes,
    radios,
    textarea,
    cell,
    divider,
    invalidCheckboxes,
    invalidTextarea,
    invalidCell,
];

const tabs: TabsProps = { value: 0, theme: "card", onChange: (event) => event.detail.label };
const panel: TabPanelProps = {
    value: 0,
    label: "概览",
    lazy: true,
    disabled: false,
    children: "内容",
};
const tabBar: TabBarProps = {
    value: "home",
    fixed: false,
    placeholder: true,
    safeAreaInsetBottom: false,
    onChange: (event) => event.detail.value,
};
const tabBarItem: TabBarItemProps = {
    value: "home",
    icon: "home",
    children: "首页",
    badgeProps: { count: 2 },
};
// @ts-expect-error Tabs 只支持官方的主题。
const invalidTabs: TabsProps = { theme: "browser" };
// @ts-expect-error 单个选项卡值不接受数组。
const invalidPanel: TabPanelProps = { value: ["home"] };
// @ts-expect-error 标签栏事件使用微信 event.detail，不接收浏览器事件。
const invalidTabBar: TabBarProps = { onChange: (event: Event) => event.type };
// @ts-expect-error 标签栏跳转仅使用官方的微信导航模式。
const invalidTabBarItem: TabBarItemProps = { linkType: "push" };
void [tabs, panel, tabBar, tabBarItem, invalidTabs, invalidPanel, invalidTabBar, invalidTabBarItem];

const styledButton: ButtonProps = {
    variant: "secondary",
    theme: "danger",
    appearance: "dashed",
    size: "extra-small",
    shape: "round",
    icon: "add",
    ghost: true,
    block: true,
    loadingProps: { theme: "dots" },
};
const styledTag: TagProps = {
    variant: "success",
    theme: "primary",
    appearance: "light-outline",
    shape: "round",
    closable: true,
    onClose: (event) => event.detail.x,
};
const styledInput: InputProps = {
    label: "名称",
    layout: "vertical",
    status: "warning",
    readonly: true,
    clearable: true,
    prefixIcon: "search",
    onClear: () => {},
};
const styledEmpty: EmptyStateProps = {
    title: "暂无结果",
    image: "/assets/empty.png",
    icon: "search",
};
const moreTabs: TabsProps = {
    theme: "tag",
    sticky: true,
    stickyProps: { offsetTop: 20, zIndex: 2 },
};
// @ts-expect-error 外观仅接受官方按钮样式。
const invalidAppearance: ButtonProps = { appearance: "gradient" };
// @ts-expect-error 标签形状保留官方枚举。
const invalidShape: TagProps = { shape: "circle" };
// @ts-expect-error 不再暴露微信 property 描述对象。
const invalidSticky: TabsProps = { stickyProps: { zIndex: { type: Number, value: 2 } } };
void [
    styledButton,
    styledTag,
    styledInput,
    styledEmpty,
    moreTabs,
    invalidAppearance,
    invalidShape,
    invalidSticky,
];
