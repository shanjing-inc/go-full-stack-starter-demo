import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { decodeDashboardFontSize, isDashboardFontSize } from "./font-size.js";

export type Theme = "light" | "dark";
type Preferences = {
    theme: Theme;
    setTheme(theme: Theme): void;
    fontSize: number;
    setFontSize(size: number): void;
};
const Context = createContext<Preferences | null>(null);
function stored(key: string) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
export function DashboardPreferences({
    children,
    storageKey = "dashboard",
}: {
    children: ReactNode;
    storageKey?: string;
}) {
    const [theme, setTheme] = useState<Theme>(() =>
        stored(`${storageKey}:theme`) === "dark" ? "dark" : "light",
    );
    const [fontSize, setFontSize] = useState(() =>
        decodeDashboardFontSize(stored(`${storageKey}:font-size`)),
    );
    useEffect(() => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.fontSize = `${fontSize}px`;
        try {
            localStorage.setItem(`${storageKey}:theme`, theme);
            localStorage.setItem(`${storageKey}:font-size`, String(fontSize));
        } catch {
            /* 受限环境保留当前会话设置。 */
        }
    }, [theme, fontSize, storageKey]);
    return (
        <Context
            value={{
                theme,
                setTheme,
                fontSize,
                setFontSize: (size) => {
                    if (isDashboardFontSize(size)) setFontSize(size);
                },
            }}
        >
            {children}
        </Context>
    );
}
export function useDashboardPreferences() {
    const value = useContext(Context);
    if (!value) throw new Error("DashboardPreferences 上下文缺失");
    return value;
}
