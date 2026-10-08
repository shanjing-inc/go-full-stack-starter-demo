"use client";

import { useState } from "react";
import { TypeIcon } from "lucide-react";

import { Button } from "../ui/button.js";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { getDashboardFontSizeOption, dashboardFontSizeOptions } from "../font-size.js";
import { useDashboardPreferences } from "../preferences.js";

export function FontSizeSelector() {
    const { fontSize, setFontSize } = useDashboardPreferences();
    const [menuOpen, setMenuOpen] = useState(false);
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const selectedOption = getDashboardFontSizeOption(fontSize);
    const label = `字号：${selectedOption.label}`;

    return (
        <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
                setMenuOpen(open);
                if (open) setTooltipOpen(false);
            }}
        >
            <Tooltip open={tooltipOpen && !menuOpen} onOpenChange={setTooltipOpen}>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label={label}>
                            <TypeIcon className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel>字号大小</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={String(fontSize)}
                    onValueChange={(value) => setFontSize(Number(value))}
                >
                    {dashboardFontSizeOptions.map((option) => (
                        <DropdownMenuRadioItem key={option.px} value={String(option.px)}>
                            <span>{option.label}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                                {option.px}px
                            </span>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
