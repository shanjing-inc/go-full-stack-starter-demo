// 自动生成：运行 pnpm codegen 更新，请通过 SDL 和操作源文件修改。
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
    | T
    | { [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never };
export type IntFilters = {
    eq?: number | null | undefined;
    gt?: number | null | undefined;
    gte?: number | null | undefined;
    inArray?: Array<number> | null | undefined;
    isNotNull?: boolean | null | undefined;
    isNull?: boolean | null | undefined;
    lt?: number | null | undefined;
    lte?: number | null | undefined;
    ne?: number | null | undefined;
    notInArray?: Array<number> | null | undefined;
};

export type ShopFilters = {
    id?: IntFilters | null | undefined;
    slug?: StringFilters | null | undefined;
    status?: StringFilters | null | undefined;
};

export type StringFilters = {
    eq?: string | null | undefined;
    gt?: string | null | undefined;
    gte?: string | null | undefined;
    ilike?: string | null | undefined;
    inArray?: Array<string> | null | undefined;
    isNotNull?: boolean | null | undefined;
    isNull?: boolean | null | undefined;
    like?: string | null | undefined;
    lt?: string | null | undefined;
    lte?: string | null | undefined;
    ne?: string | null | undefined;
    notIlike?: string | null | undefined;
    notInArray?: Array<string> | null | undefined;
    notLike?: string | null | undefined;
};

export type GetMemberShopQueryVariables = Exact<{
    where: ShopFilters;
}>;

export type GetMemberShopQuery = {
    getShop: {
        id: string | null;
        name: string | null;
        slug: string | null;
        status: string | null;
        createdAt: string | null;
        updatedAt: string | null;
    } | null;
};
