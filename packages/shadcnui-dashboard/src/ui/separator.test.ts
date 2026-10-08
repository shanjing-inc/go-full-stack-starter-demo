import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Separator } from "./separator.js";

describe("分隔线方向与样式", () => {
    it("默认横线使用 Radix 方向属性设置宽高", () => {
        const html = renderToStaticMarkup(createElement(Separator));
        expect(html).toContain('data-orientation="horizontal"');
        expect(html).toContain("data-[orientation=horizontal]:h-px");
        expect(html).toContain("data-[orientation=horizontal]:w-full");
    });
    it("竖线使用 Radix 方向属性设置宽度并保留顶栏高度", () => {
        const html = renderToStaticMarkup(
            createElement(Separator, { orientation: "vertical", className: "mr-2 h-4" }),
        );
        expect(html).toContain('data-orientation="vertical"');
        expect(html).toContain("data-[orientation=vertical]:w-px");
        expect(html).toContain("mr-2 h-4");
    });
    it("语义竖线提供可访问方向", () => {
        const html = renderToStaticMarkup(
            createElement(Separator, { orientation: "vertical", decorative: false }),
        );
        expect(html).toContain('role="separator"');
        expect(html).toContain('aria-orientation="vertical"');
    });
});
