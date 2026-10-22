import Taro from "@tarojs/taro";
import type { ResolvedTheme } from "./resolve";

type NativeAppearance = Pick<typeof Taro, "setNavigationBarColor" | "setBackgroundColor">;

/** 串行应用原生外观，并合并等待期间的主题，旧请求不会在最后覆盖新选择。 */
export function createNativeThemeSync(platform: NativeAppearance) {
    let pending: ResolvedTheme | undefined;
    let running: Promise<void> | undefined;
    return function sync(theme: ResolvedTheme): Promise<void> {
        pending = theme;
        if (!running) {
            running = (async () => {
                while (pending) {
                    const current = pending;
                    pending = undefined;
                    await Promise.allSettled([
                        Promise.resolve().then(() =>
                            platform.setNavigationBarColor(current.navigation),
                        ),
                        Promise.resolve().then(() =>
                            platform.setBackgroundColor({
                                backgroundColor: current.colors.background,
                                backgroundColorTop: current.colors.background,
                                backgroundColorBottom: current.colors.background,
                            }),
                        ),
                    ]);
                }
                running = undefined;
            })();
        }
        return running;
    };
}

export const syncNativeTheme = createNativeThemeSync(Taro);
