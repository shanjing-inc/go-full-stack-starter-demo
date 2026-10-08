import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueueOverview } from "./pages/queue-overview.js";

describe("队列控制台区块顺序", () => {
    it("概览后先展示最近执行次数，再展示 Worker 进程与队列负载", () => {
        const html = renderToStaticMarkup(createElement(QueueOverview, { data: null }));
        const sections = Array.from(
            html.matchAll(/<section[^>]*aria-label="([^"]+)"/g),
            (match) => match[1],
        );
        expect(sections).toEqual(["队列概览", "最近 24 小时执行次数", "Worker 进程", "队列负载"]);
        expect(html).toContain("队列负载表统计当前原任务数量。");
    });
});
