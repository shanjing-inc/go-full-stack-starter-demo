import Taro from "@tarojs/taro";
import type { ThemeMode } from "./tokens";

type ThemeListener = (event: { theme: ThemeMode }) => void;
interface ThemePlatform {
    getAppBaseInfo?: () => { theme?: string };
    getSystemInfoSync?: () => { theme?: string };
    onThemeChange?: (listener: ThemeListener) => void;
    offThemeChange?: (listener: ThemeListener) => void;
}
function isMode(value: unknown): value is ThemeMode {
    return value === "light" || value === "dark";
}

/** 主题完全由微信系统状态决定，不读取或写入用户偏好。 */
export function createThemeStore(platform: ThemePlatform) {
    let mode: ThemeMode = "light";
    let listening = false;
    const listeners = new Set<() => void>();
    const update = (next: unknown) => {
        if (!isMode(next) || next === mode) return;
        mode = next;
        listeners.forEach((listener) => listener());
    };
    const refresh = () => {
        // 优先新接口；旧基础库继续使用同步系统信息。
        for (const read of [platform.getAppBaseInfo, platform.getSystemInfoSync]) {
            try {
                const current = read?.call(platform)?.theme;
                if (isMode(current)) {
                    update(current);
                    return;
                }
            } catch {
                /* 读取失败时保留最近系统状态，首次读取失败沿用亮色。 */
            }
        }
    };
    const onChange: ThemeListener = ({ theme }) => update(theme);
    refresh();
    return {
        getSnapshot: () => mode,
        refresh,
        subscribe(listener: () => void) {
            listeners.add(listener);
            if (!listening && platform.onThemeChange) {
                try {
                    platform.onThemeChange(onChange);
                    listening = true;
                } catch {
                    /* 不支持监听时，页面显示仍会主动读取。 */
                }
            }
            refresh();
            return () => {
                listeners.delete(listener);
                if (!listeners.size && listening && platform.offThemeChange) {
                    try {
                        platform.offThemeChange(onChange);
                        listening = false;
                    } catch {
                        /* 平台不支持解除时，不阻止组件卸载。 */
                    }
                }
            };
        },
    };
}

export const themeStore = createThemeStore(Taro);
