import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FontSizeSelector } from "./components/font-size-selector.js";
import { DashboardPreferences } from "./preferences.js";
import { TooltipProvider } from "./ui/tooltip.js";
import {
    dashboardFontSizeOptions,
    decodeDashboardFontSize,
    getDashboardFontSizeOption,
    isDashboardFontSize,
} from "./font-size.js";

afterEach(() => vi.unstubAllGlobals());

describe("字号偏好", () => {
    it("选项与参考后台一致", () => {
        expect(dashboardFontSizeOptions).toEqual([
            { label: "紧凑", px: 16 },
            { label: "标准", px: 17 },
            { label: "舒展", px: 18 },
        ]);
        expect([14, 16, 17, 18, 20, NaN].map(isDashboardFontSize)).toEqual([
            false,
            true,
            true,
            true,
            false,
            false,
        ]);
        expect(getDashboardFontSizeOption(99)).toEqual({ label: "标准", px: 17 });
    });

    it.each([
        [null, 17],
        ["", 17],
        ["invalid", 17],
        ["0", 17],
        ["20", 17],
        ["14", 16],
        ["16", 16],
        ["17", 17],
        ["18", 18],
    ])("存储值 %s 恢复为 %s", (value, expected) => {
        expect(decodeDashboardFontSize(value)).toBe(expected);
    });

    it("按应用存储键恢复当前选项，并显示图标按钮", () => {
        const getItem = vi.fn((key: string) => (key === "custom:font-size" ? "18" : null));
        vi.stubGlobal("localStorage", { getItem });
        const html = renderToStaticMarkup(
            createElement(DashboardPreferences, {
                storageKey: "custom",
                children: createElement(TooltipProvider, null, createElement(FontSizeSelector)),
            }),
        );
        expect(getItem).toHaveBeenCalledWith("custom:font-size");
        expect(getItem).not.toHaveBeenCalledWith("dashboard:font-size");
        expect(html).toContain('aria-label="字号：舒展"');
        expect(html).toContain('data-variant="ghost"');
        expect(html).toContain('data-size="icon"');
        expect(html).toContain("<svg");
    });

    it("存储受限时使用标准字号", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("存储受限");
            },
        });
        const html = renderToStaticMarkup(
            createElement(DashboardPreferences, {
                children: createElement(TooltipProvider, null, createElement(FontSizeSelector)),
            }),
        );
        expect(html).toContain('aria-label="字号：标准"');
    });
});
