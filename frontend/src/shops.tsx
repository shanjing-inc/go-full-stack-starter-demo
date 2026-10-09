import { graphql as gql } from "./request";
import { useSession } from "./session-context";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useSearchParams } from "react-router";
import { FilterIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import {
    Button,
    Input,
    DataTable,
    DateTimeCell,
    StatusBadge,
    TablePagination,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SELECT_EMPTY_VALUE,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    type DataTableColumn,
} from "@shanjing/shadcnui-dashboard";

type Shop = {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string | null;
    updatedAt: string | null;
};
function pageNumber(value: string | null) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 && number <= 1000000 ? number : 1;
}
export function Shops() {
    const [params, setParams] = useSearchParams();
    const { session } = useSession();
    const canCreate = session?.permissions.includes("shop:create") ?? false;
    const createController = useRef<AbortController | null>(null);
    useEffect(() => () => createController.current?.abort(), []);
    const page = pageNumber(params.get("page"));
    const pageSize = [10, 20, 50].includes(Number(params.get("pageSize")))
        ? Number(params.get("pageSize"))
        : 20;
    const filterSlug = params.get("slug") ?? "";
    const filterStatus = ["active", "inactive"].includes(params.get("status") ?? "")
        ? params.get("status")!
        : "";
    const [draftSlug, setDraftSlug] = useState(filterSlug);
    const [draftStatus, setDraftStatus] = useState(filterStatus);
    const [rows, setRows] = useState<Shop[]>([]);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState("");
    const [revision, setRevision] = useState(0);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [creating, setCreating] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [createError, setCreateError] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        setDraftSlug(filterSlug);
        setDraftStatus(filterStatus);
    }, [filterSlug, filterStatus]);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setListError("");
        setRows([]);
        setHasNext(false);
        const where = {
            ...(filterSlug ? { slug: { like: `%${filterSlug}%` } } : {}),
            ...(filterStatus ? { status: { eq: filterStatus } } : {}),
        };
        // 微任务执行前先经过 effect 清理，StrictMode 首轮重放可提前取消请求。
        queueMicrotask(() => {
            if (controller.signal.aborted) return;
            gql<{ listShops: Shop[] }>(
                `query listAdminShops($where:ShopFilters,$limit:Int,$offset:Int){
                    listShops(where:$where,limit:$limit,offset:$offset,orderBy:{createdAt:{direction:desc,priority:1}}){id name slug status createdAt updatedAt}
                }`,
                { where, limit: pageSize + 1, offset: (page - 1) * pageSize },
                controller.signal,
            )
                .then((data) => {
                    if (controller.signal.aborted) return;
                    const shops = data.listShops ?? [];
                    setRows(shops.slice(0, pageSize));
                    setHasNext(shops.length > pageSize);
                })
                .catch((error) => {
                    if (!controller.signal.aborted)
                        setListError(error instanceof Error ? error.message : "列表读取失败");
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false);
                });
        });
        return () => controller.abort();
    }, [page, pageSize, filterSlug, filterStatus, revision]);

    function navigate(
        nextPage: number,
        size = pageSize,
        nextSlug = filterSlug,
        nextStatus = filterStatus,
        refresh = false,
    ) {
        const next = new URLSearchParams();
        if (nextPage > 1) next.set("page", String(nextPage));
        if (size !== 20) next.set("pageSize", String(size));
        if (nextSlug) next.set("slug", nextSlug);
        if (nextStatus) next.set("status", nextStatus);
        setParams(next);
        // 参数变化由 URL 驱动查询；参数相同时显式刷新一次。
        if (
            refresh &&
            nextPage === page &&
            size === pageSize &&
            nextSlug === filterSlug &&
            nextStatus === filterStatus
        ) {
            setRevision((value) => value + 1);
        }
    }
    async function create(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!canCreate || creating) return;
        const controller = new AbortController();
        createController.current = controller;
        setCreating(true);
        setCreateError("");
        setMessage("");
        try {
            await gql<{ createShop: Shop }>(
                `mutation($set:CreateShopSetInput!){createShop(set:$set){id name slug status createdAt updatedAt}}`,
                { set: { name, slug } },
                controller.signal,
            );
            if (controller.signal.aborted) return;
            setMessage("店铺创建成功，列表已返回第一页并清除筛选。");
            setCreateOpen(false);
            navigate(1, pageSize, "", "", true);
        } catch (error) {
            if (!controller.signal.aborted)
                setCreateError(error instanceof Error ? error.message : "创建失败");
        } finally {
            if (!controller.signal.aborted) setCreating(false);
            if (createController.current === controller) createController.current = null;
        }
    }
    const columns: DataTableColumn<Shop>[] = [
        { key: "id", header: "ID", render: (shop) => shop.id },
        {
            key: "name",
            header: "名称",
            render: (shop) => <span className="font-medium">{shop.name}</span>,
        },
        { key: "slug", header: "唯一标识", render: (shop) => shop.slug },
        {
            key: "status",
            header: "状态",
            render: (shop) => (
                <StatusBadge
                    status={shop.status}
                    label={
                        shop.status === "active"
                            ? "启用"
                            : shop.status === "inactive"
                              ? "停用"
                              : shop.status
                    }
                />
            ),
        },
        {
            key: "createdAt",
            header: "创建时间",
            render: (shop) => <DateTimeCell value={shop.createdAt} />,
        },
        {
            key: "updatedAt",
            header: "更新时间",
            render: (shop) => <DateTimeCell value={shop.updatedAt} />,
        },
    ];
    return (
        <div className="flex min-w-0 flex-col gap-6" data-testid="shop-list-page">
            <section className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h1 className="mt-1 text-2xl font-semibold tracking-normal">店铺列表</h1>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        查看店铺基本信息与状态。{loading ? "" : `当前 ${rows.length} 条记录。`}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={loading}
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        <RefreshCwIcon />
                        刷新列表
                    </Button>
                    {canCreate && (
                        <Sheet
                            open={createOpen}
                            onOpenChange={(open) => {
                                if (creating) return;
                                setCreateOpen(open);
                                if (open) {
                                    setCreateError("");
                                    setMessage("");
                                }
                            }}
                        >
                            <SheetTrigger asChild>
                                <Button type="button">
                                    <PlusIcon />
                                    创建店铺
                                </Button>
                            </SheetTrigger>
                            <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
                                <SheetHeader className="shrink-0 border-b pr-12">
                                    <SheetTitle>创建店铺</SheetTitle>
                                    <SheetDescription>
                                        填写名称与唯一标识，新店铺默认启用。
                                    </SheetDescription>
                                </SheetHeader>
                                <form
                                    id="create-shop-form"
                                    onSubmit={create}
                                    className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
                                >
                                    <label className="grid gap-2 text-sm font-medium">
                                        名称
                                        <Input
                                            value={name}
                                            onChange={(event) => setName(event.target.value)}
                                            maxLength={255}
                                            required
                                        />
                                    </label>
                                    <label className="grid gap-2 text-sm font-medium">
                                        唯一标识
                                        <Input
                                            value={slug}
                                            onChange={(event) => setSlug(event.target.value)}
                                            maxLength={255}
                                            required
                                        />
                                    </label>
                                    {createError && (
                                        <p
                                            role="alert"
                                            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                                        >
                                            {createError}
                                        </p>
                                    )}
                                </form>
                                <SheetFooter className="shrink-0 border-t sm:flex-row sm:justify-end">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={creating}
                                        onClick={() => setCreateOpen(false)}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        form="create-shop-form"
                                        disabled={creating}
                                        type="submit"
                                    >
                                        <SaveIcon />
                                        {creating ? "提交中" : "创建"}
                                    </Button>
                                </SheetFooter>
                            </SheetContent>
                        </Sheet>
                    )}
                </div>
            </section>
            <form
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 rounded-lg border bg-background p-3 *:min-w-0"
                data-testid="shop-filters"
                onSubmit={(event) => {
                    event.preventDefault();
                    navigate(1, pageSize, draftSlug.trim(), draftStatus, true);
                }}
            >
                <Input
                    aria-label="标识筛选"
                    placeholder="唯一标识包含"
                    value={draftSlug}
                    maxLength={255}
                    onChange={(event) => setDraftSlug(event.target.value)}
                />
                <Select
                    value={draftStatus || SELECT_EMPTY_VALUE}
                    onValueChange={(value) =>
                        setDraftStatus(value === SELECT_EMPTY_VALUE ? "" : value)
                    }
                >
                    <SelectTrigger aria-label="状态筛选">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={SELECT_EMPTY_VALUE}>全部状态</SelectItem>
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="inactive">停用</SelectItem>
                    </SelectContent>
                </Select>
                <Button type="submit" className="w-full">
                    <FilterIcon />
                    筛选
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                        setDraftSlug("");
                        setDraftStatus("");
                        navigate(1, pageSize, "", "", true);
                    }}
                >
                    <RotateCcwIcon />
                    重置
                </Button>
            </form>
            {message && (
                <p role="status" className="text-sm text-muted-foreground">
                    {message}
                </p>
            )}
            {listError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <p role="alert">{listError}</p>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRevision((value) => value + 1)}
                    >
                        <RefreshCwIcon />
                        重试
                    </Button>
                </div>
            )}
            <div aria-busy={loading}>
                <DataTable
                    columns={columns}
                    emptyText={
                        loading ? (
                            <p role="status">正在加载店铺…</p>
                        ) : listError ? (
                            "列表读取失败，请重试"
                        ) : (
                            "暂无匹配的店铺"
                        )
                    }
                    getRowKey={(shop) => shop.id}
                    items={rows}
                />
            </div>
            <TablePagination
                itemCount={rows.length}
                loading={loading || !!listError}
                hasNext={hasNext}
                onPageChange={(next) => navigate(next)}
                onPageSizeChange={(size) => navigate(1, size)}
                page={page}
                pageSize={pageSize}
            />
        </div>
    );
}
