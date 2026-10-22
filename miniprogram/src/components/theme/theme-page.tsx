import { useEffect, type PropsWithChildren } from "react";
import { View } from "@tarojs/components";
import { useDidShow } from "@tarojs/taro";
import { useTheme } from "./use-theme";
import { themes } from "./resolve";
import { themeStore } from "./store";
import { syncNativeTheme } from "./native";

export function ThemePage({ children }: PropsWithChildren) {
    const { theme } = useTheme();
    useEffect(() => {
        void syncNativeTheme(theme);
    }, [theme]);
    useDidShow(() => {
        themeStore.refresh();
        void syncNativeTheme(themes[themeStore.getSnapshot()]);
    });
    return (
        <View className="ui-page" data-theme={theme.mode} style={theme.style}>
            {children}
        </View>
    );
}
