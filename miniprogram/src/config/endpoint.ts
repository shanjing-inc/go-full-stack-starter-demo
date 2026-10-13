export function normalizeEndpoint(value: string): string {
    const normalized = value.trim().replace(/\/+$/u, "");
    if (!normalized) return "";
    // 小程序运行时使用字符串校验，保持对微信 JS 环境的兼容。
    if (!/^https?:\/\/[^/?#\s:@]+(?::\d+)?\/api\/graphql\/member$/u.test(normalized))
        throw new Error("TARO_APP_GRAPHQL_ENDPOINT 需要完整的 Member GraphQL HTTP(S) 地址。");
    return normalized;
}
export const GRAPHQL_ENDPOINT = normalizeEndpoint(
    typeof APP_GRAPHQL_ENDPOINT_BUILD === "string" ? APP_GRAPHQL_ENDPOINT_BUILD : "",
);
