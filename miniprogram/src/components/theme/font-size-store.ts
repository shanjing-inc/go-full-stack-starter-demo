import Taro from "@tarojs/taro";
import { isFontSize, type FontSize } from "./font-size";

export const FONT_SIZE_STORAGE_KEY = "go-starter:ui-font-size";
type FontSizePlatform = Pick<typeof Taro, "getStorageSync" | "setStorageSync">;

/** 字号是本机阅读偏好，与系统亮暗主题及登录状态独立。 */
export function createFontSizeStore(platform: FontSizePlatform) {
    let size: FontSize = "standard";
    const listeners = new Set<() => void>();
    try {
        const stored: unknown = platform.getStorageSync(FONT_SIZE_STORAGE_KEY);
        if (isFontSize(stored)) size = stored;
    } catch {
        /* 存储不可用时仍允许以标准字号打开页面。 */
    }
    return {
        getSnapshot: () => size,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        /** 返回保存是否成功；写入失败仍应用到当前会话，重复选择可重试保存。 */
        setFontSize(next: unknown): boolean {
            if (!isFontSize(next)) return false;
            let saved = true;
            try {
                platform.setStorageSync(FONT_SIZE_STORAGE_KEY, next);
            } catch {
                saved = false;
            }
            if (next !== size) {
                size = next;
                listeners.forEach((listener) => listener());
            }
            return saved;
        },
    };
}

export const fontSizeStore = createFontSizeStore(Taro);
