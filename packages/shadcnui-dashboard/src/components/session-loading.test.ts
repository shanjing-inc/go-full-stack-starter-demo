import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionLoading } from "./session-loading.js";

describe("会话加载样式", () => {
    it("提供读屏状态提示并隐藏装饰内容", () => {
        const html = renderToStaticMarkup(createElement(SessionLoading));
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-atomic="true"');
        expect(html).toContain("会话加载中");
        expect(html).toContain("正在确认登录状态与访问权限，请稍候。");
        expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
        expect(html.match(/data-slot="skeleton"/g)).toHaveLength(3);
    });
    it("内嵌与全屏布局共用无边框居中样式及主题配色", () => {
        const compact = renderToStaticMarkup(createElement(SessionLoading));
        const fullPage = renderToStaticMarkup(createElement(SessionLoading, { fullPage: true }));
        expect(compact).toContain("min-h-72");
        expect(fullPage).toContain("min-h-svh");
        for (const html of [compact, fullPage]) {
            expect(html).toContain("bg-background");
            expect(html).toContain("items-center justify-center");
            expect(html).toContain("flex flex-col items-center gap-3");
            expect(html).toContain("text-center");
            expect(html).not.toContain("border");
            expect(html).not.toContain("shadow");
            expect(html).toContain("text-muted-foreground");
            expect(html).toContain("w-full max-w-sm");
        }
    });
    it("加载动画遵循减少动态效果偏好", () => {
        const html = renderToStaticMarkup(createElement(SessionLoading));
        expect(html).toContain("motion-safe:animate-spin");
        expect(html.match(/motion-reduce:animate-none/g)).toHaveLength(3);
    });
});
