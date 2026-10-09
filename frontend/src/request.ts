export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

type RequestEvent = "unauthorized" | "forbidden" | "banned";
const listeners = new Set<(event: RequestEvent) => void>();
const pending = new Set<AbortController>();

export function subscribeRequests(listener: (event: RequestEvent) => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export function cancelDashboardRequests() {
    for (const controller of pending) controller.abort();
}
function report(error: ApiError, identity: boolean) {
    const event =
        error.code === "USER_BANNED"
            ? "banned"
            : error.status === 401 || ["UNAUTHORIZED", "UNAUTHENTICATED"].includes(error.code)
              ? "unauthorized"
              : (error.status === 403 || error.code === "FORBIDDEN") && !identity
                ? "forbidden"
                : null;
    if (event) for (const listener of listeners) listener(event);
    return error;
}

async function request<T>(path: string, init: RequestInit, identity = false): Promise<T> {
    const controller = new AbortController();
    const signal = init.signal;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    pending.add(controller);
    try {
        const response = await fetch(path, {
            ...init,
            signal: controller.signal,
            credentials: "include",
            cache: "no-store",
        });
        // 保留非 JSON 错误响应的 HTTP 状态，代理故障也能进入统一错误边界。
        const text = await response.text();
        if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
        let body;
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            if (response.ok)
                throw new ApiError("服务响应格式无效", response.status, "INVALID_RESPONSE");
        }
        if (!response.ok) {
            throw report(
                new ApiError(
                    body?.message ?? `请求失败 ${response.status}`,
                    response.status,
                    body?.code ??
                        (response.status === 401
                            ? "UNAUTHORIZED"
                            : response.status === 403
                              ? "FORBIDDEN"
                              : "HTTP_ERROR"),
                ),
                identity,
            );
        }
        if (body?.errors?.length) {
            // 并行字段的认证错误优先处理，避免被其他业务错误遮蔽。
            const error =
                body.errors.find((item: { extensions?: { code?: string } }) =>
                    ["UNAUTHORIZED", "UNAUTHENTICATED", "USER_BANNED"].includes(
                        item.extensions?.code ?? "",
                    ),
                ) ?? body.errors[0];
            throw report(
                new ApiError(
                    error.message ?? "GraphQL 请求失败",
                    response.status,
                    error.extensions?.code ?? "GRAPHQL_ERROR",
                ),
                identity,
            );
        }
        if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
        return body as T;
    } finally {
        pending.delete(controller);
        signal?.removeEventListener("abort", abort);
    }
}
export function getJSON<T>(path: string, signal: AbortSignal) {
    return request<T>(path, { signal });
}
export async function graphql<T>(
    query: string,
    variables: unknown = {},
    signal?: AbortSignal,
    identity = false,
): Promise<T> {
    const body = await request<{ data?: T }>(
        "/api/graphql/admin",
        {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, variables }),
        },
        identity,
    );
    if (!body?.data) throw new ApiError("GraphQL 响应缺少数据", 200, "INVALID_RESPONSE");
    return body.data;
}
