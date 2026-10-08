import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable } from "./components/data-table.js";
import { DateTimeCell } from "./components/date-time-cell.js";
import { DateTimeRangeInput } from "./components/date-time-range-input.js";
import { StatusBadge } from "./components/status-badge.js";
import {
    TablePagination,
    formatTablePaginationLabel,
    tablePageSizeOptions,
} from "./components/table-pagination.js";
import { formatDashboardDateTime } from "./date-time.js";

const render = renderToStaticMarkup;

describe("参考后台表格组件", () => {
    it("队列自定义分页保留既有默认选项", () => {
        expect(tablePageSizeOptions).toEqual([10, 20, 50]);
        const html = render(
            createElement(TablePagination, {
                itemCount: 25,
                totalCount: 25,
                page: 1,
                pageSize: 100,
                pageSizeOptions: [20, 50, 100],
                loading: false,
                onPageChange: () => {},
                onPageSizeChange: () => {},
            }),
        );
        expect(html).toContain("第 1 页 · 显示 1–25 条，共 25 条");
        expect(html).toContain('aria-label="每页条数"');
        expect(html.match(/disabled=""/g)).toHaveLength(2);
    });
    it("保留带边框表格和独立空态", () => {
        const html = render(
            createElement(DataTable<{ id: string }>, {
                columns: [{ key: "id", header: "ID", render: (item) => item.id }],
                emptyText: "暂无店铺",
                getRowKey: (item) => item.id,
                items: [],
            }),
        );
        expect(html).toContain("overflow-hidden rounded-lg border bg-background");
        expect(html).toContain("min-w-max");
        expect(html).toContain("暂无店铺");
    });
    it("状态颜色与中文标签各自保持语义", () => {
        const html = render(createElement(StatusBadge, { status: "active", label: "启用" }));
        expect(html).toContain("border-emerald-200");
        expect(html).toContain("dark:text-emerald-300");
        expect(html).toContain("启用");
        expect(render(createElement(StatusBadge, { status: "inactive" }))).toContain(
            "border-zinc-200",
        );
        expect(render(createElement(StatusBadge, { status: "custom" }))).toContain(
            "text-muted-foreground",
        );
    });
    it("成功状态标签在浅色和深色主题下使用绿色", () => {
        const html = render(createElement(StatusBadge, { status: "completed", label: "成功" }));
        for (const className of [
            "border-emerald-200",
            "bg-emerald-50",
            "text-emerald-700",
            "dark:border-emerald-900",
            "dark:bg-emerald-950/40",
            "dark:text-emerald-300",
        ]) {
            expect(html).toContain(className);
        }
        expect(html.replace(/<[^>]+>/g, "")).toBe("成功");
    });
    it("时间格式支持时区、空值和异常值", () => {
        expect(formatDashboardDateTime(null)).toBe("-");
        expect(formatDashboardDateTime("invalid")).toBe("-");
        const time = formatDashboardDateTime("2026-10-04T03:04:05Z", { timeZone: "UTC" });
        expect(time).toContain("2026");
        expect(time).toContain("03:04:05");
        expect(render(createElement(DateTimeCell, { value: null }))).toContain(
            "text-muted-foreground",
        );
        expect(render(createElement(DateTimeCell, { value: "invalid" }))).toContain("invalid");
    });
    it("时间范围使用统一外框，时间标签保留在无障碍属性中", () => {
        const html = render(
            createElement(DateTimeRangeInput, {
                value: { from: "2026-10-05T08:59", to: "2026-10-05T09:01" },
                onChange: () => {},
                className: "col-span-full",
            }),
        );
        expect(html).toContain('role="group" aria-label="时间范围"');
        expect(html).toContain('data-slot="date-time-range-input"');
        expect(html.match(/type="datetime-local"/g)).toHaveLength(2);
        expect(html).toContain('aria-label="开始时间"');
        expect(html).toContain('aria-label="结束时间"');
        expect(html).toContain('value="2026-10-05T08:59"');
        expect(html).toContain('value="2026-10-05T09:01"');
        expect(html).toContain("col-span-full");
        expect(html.replace(/<[^>]+>/g, "")).toBe("至");
    });
    it("分页标签使用当前页数量，空页范围从零开始", () => {
        expect(formatTablePaginationLabel({ itemCount: 5, page: 2, pageSize: 20 })).toBe(
            "第 2 页 · 本页 5 条",
        );
        expect(
            formatTablePaginationLabel({ itemCount: 5, page: 2, pageSize: 20, totalCount: 25 }),
        ).toBe("第 2 页 · 显示 21–25 条，共 25 条");
        expect(
            formatTablePaginationLabel({ itemCount: 0, page: 3, pageSize: 20, totalCount: 25 }),
        ).toBe("第 3 页 · 显示 0–0 条，共 25 条");
    });
    it("额外记录判定关闭整页末尾的下一页，加载时锁定翻页", () => {
        const props = {
            itemCount: 20,
            page: 1,
            pageSize: 20,
            loading: false,
            hasNext: false,
            onPageChange: () => {},
            onPageSizeChange: () => {},
        };
        const html = render(createElement(TablePagination, props));
        expect(html).toContain('aria-label="每页条数"');
        expect(html.match(/disabled=""/g)).toHaveLength(2);
        const next = render(createElement(TablePagination, { ...props, hasNext: true }));
        expect(next.match(/disabled=""/g)).toHaveLength(1);
        const loading = render(
            createElement(TablePagination, { ...props, page: 2, hasNext: true, loading: true }),
        );
        expect(loading.match(/disabled=""/g)).toHaveLength(2);
    });
});
