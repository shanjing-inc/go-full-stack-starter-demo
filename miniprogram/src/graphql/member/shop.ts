import { GRAPHQL_ENDPOINT } from "../../config/endpoint";
import { client } from "../client";
import { GET_MEMBER_SHOP } from "./operations";
import type { GetMemberShopQueryVariables, GetMemberShopQuery } from "./generated";
export type Shop = NonNullable<GetMemberShopQuery["getShop"]>;
export type ShopWhere = GetMemberShopQueryVariables["where"];

export function lookupWhere(value: string): ShopWhere {
    const normalized = value.trim();
    if (!normalized) throw new Error("请输入店铺 ID 或 slug");
    if (/^\d+$/u.test(normalized)) {
        const id = Number(normalized);
        if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647)
            throw new Error("店铺 ID 需要 1–2147483647 的整数");
        return { id: { eq: id } };
    }
    if (/^[+-]\d+$/u.test(normalized)) throw new Error("店铺 ID 需要正整数");
    if (normalized.length > 255) throw new Error("店铺 slug 长度最多 255 字符");
    return { slug: { eq: normalized } };
}
export async function getShop(where: ShopWhere): Promise<Shop | null> {
    if (!GRAPHQL_ENDPOINT)
        throw new Error("请在 miniprogram/.env 配置 TARO_APP_GRAPHQL_ENDPOINT 后重新构建");
    const result = await client.query({ query: GET_MEMBER_SHOP, variables: { where } });
    if (!result.data || !("getShop" in result.data))
        throw new Error("店铺查询响应缺少 getShop 字段");
    return result.data.getShop;
}
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "请求失败，请重试";
}
export interface DiagnosticRow {
    index: number;
    durationMs: number;
    shop: Shop | null;
    error?: string;
}
export const BATCH_SIZE = 5;
export async function diagnoseBatch(
    where: ShopWhere,
    count: 1 | typeof BATCH_SIZE = BATCH_SIZE,
): Promise<DiagnosticRow[]> {
    return Promise.all(
        Array.from({ length: count }, async (_, offset) => {
            const index = offset + 1;
            const start = Date.now();
            try {
                const shop = await getShop(where);
                return { index, durationMs: Date.now() - start, shop };
            } catch (error) {
                return {
                    index,
                    durationMs: Date.now() - start,
                    shop: null,
                    error: errorMessage(error),
                };
            }
        }),
    );
}
