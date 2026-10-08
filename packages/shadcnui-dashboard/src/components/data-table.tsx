import type { ReactNode } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.js";

export type DataTableColumn<TItem> = {
    className?: string;
    header: string;
    key: string;
    render: (item: TItem) => ReactNode;
};

type DataTableProps<TItem> = {
    columns: DataTableColumn<TItem>[];
    emptyText: ReactNode;
    getRowKey: (item: TItem) => string;
    items: TItem[];
};

export function DataTable<TItem>({ columns, emptyText, getRowKey, items }: DataTableProps<TItem>) {
    return (
        <div className="min-w-0 overflow-hidden rounded-lg border bg-background">
            <Table className="min-w-max">
                <TableHeader>
                    <TableRow>
                        {columns.map((column) => (
                            <TableHead key={column.key}>{column.header}</TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item) => (
                        <TableRow key={getRowKey(item)}>
                            {columns.map((column) => (
                                <TableCell key={column.key} className={column.className}>
                                    {column.render(item)}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {emptyText}
                </div>
            ) : null}
        </div>
    );
}
