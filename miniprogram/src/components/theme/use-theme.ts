import { useMemo, useSyncExternalStore } from "react";
import { themeStore } from "./store";
import { resolveTheme } from "./resolve";
import { fontSizeStore } from "./font-size-store";

export function useTheme() {
    const mode = useSyncExternalStore(
        themeStore.subscribe,
        themeStore.getSnapshot,
        themeStore.getSnapshot,
    );
    const fontSize = useSyncExternalStore(
        fontSizeStore.subscribe,
        fontSizeStore.getSnapshot,
        fontSizeStore.getSnapshot,
    );
    const theme = useMemo(() => resolveTheme(mode, undefined, fontSize), [mode, fontSize]);
    return { mode, fontSize, theme };
}
