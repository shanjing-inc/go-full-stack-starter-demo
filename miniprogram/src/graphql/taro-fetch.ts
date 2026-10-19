import Taro from "@tarojs/taro";
import { GRAPHQL_ENDPOINT } from "../config/endpoint";
import { clearAuthToken, getAuthToken } from "../auth/session";

export class TransportError extends Error {
    constructor(
        message: string,
        readonly code: string,
    ) {
        super(message);
    }
}

export type RequestHeaders = Record<string, string>;
export function normalizeHeaders(value: HeadersInit | undefined): RequestHeaders {
    if (!value) return {};
    if (Array.isArray(value))
        return Object.fromEntries(value.map(([key, val]) => [key.toLowerCase(), val]));
    if (typeof (value as Headers).forEach === "function") {
        const result: RequestHeaders = {};
        (value as Headers).forEach((val, key) => {
            result[key.toLowerCase()] = val;
        });
        return result;
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key.toLowerCase(), String(val)]),
    );
}
function aborted(): Error {
    const error = new Error("请求已取消");
    error.name = "AbortError";
    return error;
}

// 混合认证端点通过 GraphQL 错误表达失效会话，单条和批量响应共用同一边界。
function unauthorized(data: unknown): boolean {
    if (typeof data === "string") {
        try {
            return unauthorized(JSON.parse(data));
        } catch {
            return false;
        }
    }
    if (Array.isArray(data)) return data.some(unauthorized);
    if (!data || typeof data !== "object" || !("errors" in data) || !Array.isArray(data.errors))
        return false;
    return data.errors.some(
        (error: unknown) =>
            error &&
            typeof error === "object" &&
            "extensions" in error &&
            error.extensions &&
            typeof error.extensions === "object" &&
            "code" in error.extensions &&
            error.extensions.code === "UNAUTHORIZED",
    );
}

// 显式提供 fetch 兼容层，网络请求统一交给微信平台。
export const taroFetch: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
        if (init?.signal?.aborted) {
            reject(aborted());
            return;
        }
        let task: ReturnType<typeof Taro.request> | undefined;
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            init?.signal?.removeEventListener("abort", cancel);
            callback();
        };
        const cancel = () => {
            finish(() => reject(aborted()));
            task?.abort();
        };
        init?.signal?.addEventListener("abort", cancel, { once: true });
        try {
            const url =
                typeof input === "string" ? input : "url" in input ? input.url : String(input);
            const token = url === GRAPHQL_ENDPOINT ? getAuthToken() : "";
            const headers = normalizeHeaders(init?.headers);
            if (token) headers.authorization = `Bearer ${token}`;
            task = Taro.request({
                url,
                method: "POST",
                timeout: 15000,
                data: init?.body as string | undefined,
                header: headers,
            });
            // 消费 Taro 的 Promise 结算，同时保留原始 requestTask 的 abort 能力。
            void task.then(
                (response) => {
                    if (settled) return;
                    try {
                        if (
                            url === GRAPHQL_ENDPOINT &&
                            (response.statusCode === 401 || unauthorized(response.data))
                        ) {
                            if (token) clearAuthToken(token);
                            finish(() =>
                                reject(
                                    new TransportError(
                                        "登录已失效，请重新登录后重试",
                                        "UNAUTHORIZED",
                                    ),
                                ),
                            );
                            return;
                        }
                        const headers = normalizeHeaders(response.header as RequestHeaders);
                        const text =
                            typeof response.data === "string"
                                ? response.data
                                : JSON.stringify(response.data);
                        finish(() =>
                            resolve({
                                ok: response.statusCode >= 200 && response.statusCode < 300,
                                status: response.statusCode,
                                statusText: String(response.statusCode),
                                headers: {
                                    get: (key: string) => headers[key.toLowerCase()] ?? null,
                                },
                                text: async () => text,
                            } as Response),
                        );
                    } catch (error) {
                        finish(() => reject(error));
                    }
                },
                (error: unknown) => {
                    const message =
                        error && typeof error === "object" && "errMsg" in error
                            ? String(error.errMsg)
                            : "";
                    const timeout = message.toLowerCase().includes("timeout");
                    finish(() =>
                        reject(
                            new TransportError(
                                timeout ? "请求超时，请重试" : "网络请求失败，请检查服务地址和网络",
                                timeout ? "TIMEOUT" : "NETWORK_ERROR",
                            ),
                        ),
                    );
                },
            );
        } catch (error) {
            finish(() => reject(error));
        }
    });
