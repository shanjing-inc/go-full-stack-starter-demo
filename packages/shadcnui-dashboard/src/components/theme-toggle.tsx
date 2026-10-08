"use client";

import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "../ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { useDashboardPreferences } from "../preferences.js";

export function ThemeToggle() {
    const { setTheme, theme } = useDashboardPreferences();
    const isDark = theme === "dark";
    const label = isDark ? "切换浅色主题" : "切换深色主题";
    const Icon = isDark ? SunIcon : MoonIcon;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={label}
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                >
                    <Icon className="size-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}
