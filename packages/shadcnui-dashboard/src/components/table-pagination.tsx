import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "../ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.js";

export const tablePageSizeOptions = [10, 20, 50] as const;

type TablePaginationProps = {
    itemCount: number;
    loading: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    page: number;
    pageSize: number;
    totalCount?: number;
    hasNext?: boolean;
    pageSizeOptions?: readonly number[];
};

export function formatTablePaginationLabel({
    itemCount,
    page,
    pageSize,
    totalCount,
}: {
    itemCount: number;
    page: number;
    pageSize: number;
    totalCount?: number;
}) {
    if (typeof totalCount === "number") {
        const shownStart = itemCount > 0 ? (page - 1) * pageSize + 1 : 0;
        const shownEnd = itemCount > 0 ? (page - 1) * pageSize + itemCount : 0;

        return `第 ${page} 页 · 显示 ${shownStart}–${shownEnd} 条，共 ${totalCount} 条`;
    }

    return `第 ${page} 页 · 本页 ${itemCount} 条`;
}

export function TablePagination({
    itemCount,
    loading,
    onPageChange,
    onPageSizeChange,
    page,
    pageSize,
    totalCount,
    hasNext,
    pageSizeOptions = tablePageSizeOptions,
}: TablePaginationProps) {
    const canGoPrevious = page > 1 && !loading;
    const canGoNext =
        typeof totalCount === "number"
            ? page * pageSize < totalCount && !loading
            : (hasNext ?? itemCount >= pageSize) && !loading;
    const label = formatTablePaginationLabel({
        itemCount,
        page,
        pageSize,
        ...(typeof totalCount === "number" ? { totalCount } : {}),
    });

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    value={String(pageSize)}
                    onValueChange={(nextPageSize) => onPageSizeChange(Number(nextPageSize))}
                >
                    <SelectTrigger aria-label="每页条数" className="w-28">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {pageSizeOptions.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                                {option} / 页
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => onPageChange(page - 1)}
                    disabled={!canGoPrevious}
                >
                    <ChevronLeftIcon />
                    上一页
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => onPageChange(page + 1)}
                    disabled={!canGoNext}
                >
                    下一页
                    <ChevronRightIcon />
                </Button>
            </div>
        </div>
    );
}
