import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, gql } from "@apollo/client";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { CombinedGraphQLErrors, ServerError, ServerParseError } from "@apollo/client/errors";
import { getOperationAST, print } from "graphql";
import { Observable, catchError, map, throwError } from "rxjs";

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

const errorListeners = new Set<(error: unknown) => void>();
export function subscribeRequestErrors(listener: (error: unknown) => void) {
    errorListeners.add(listener);
    return () => {
        errorListeners.delete(listener);
    };
}
function notifyError(error: unknown) {
    for (const listener of errorListeners) {
        try {
            listener(error);
        } catch {
            /* 监控故障保持请求错误语义。 */
        }
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
    if (event)
        for (const listener of listeners) {
            try {
                listener(event);
            } catch (listenerError) {
                notifyError(listenerError);
            }
        }
    return error;
}

type GraphqlErrorDetail = { message?: string; extensions?: { code?: unknown } };
function graphQLError(errors: readonly GraphqlErrorDetail[], status: number) {
    const detail =
        errors.find((item) =>
            ["UNAUTHORIZED", "UNAUTHENTICATED", "USER_BANNED"].includes(
                String(item.extensions?.code ?? ""),
            ),
        ) ?? errors[0];
    return new ApiError(
        detail?.message ?? "GraphQL 请求失败",
        status,
        String(detail?.extensions?.code ?? "GRAPHQL_ERROR"),
    );
}
function validateGraphqlErrors(
    errors: unknown,
    status: number,
): asserts errors is GraphqlErrorDetail[] | null | undefined {
    if (
        errors != null &&
        (!Array.isArray(errors) ||
            errors.some((item) => !item || typeof item !== "object" || Array.isArray(item)))
    )
        throw new ApiError("GraphQL 错误响应格式无效", status, "INVALID_RESPONSE");
}

async function request<T>(path: string, init: RequestInit, identity = false): Promise<T> {
    const controller = new AbortController();
    const signal = init.signal;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    pending.add(controller);
    try {
        if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
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
            const error = new ApiError(
                body?.message ?? `请求失败 ${response.status}`,
                response.status,
                body?.code ??
                    (response.status === 401
                        ? "UNAUTHORIZED"
                        : response.status === 403
                          ? "FORBIDDEN"
                          : "HTTP_ERROR"),
            );
            throw report(error, identity);
        }
        if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
        validateGraphqlErrors(body?.errors, response.status);
        if (body?.errors?.length) {
            pending.delete(controller);
            throw report(graphQLError(body.errors, response.status), identity);
        }
        return body as T;
    } catch (error) {
        notifyError(error);
        throw error;
    } finally {
        pending.delete(controller);
        signal?.removeEventListener("abort", abort);
    }
}
export function getJSON<T>(path: string, signal: AbortSignal) {
    return request<T>(path, { signal });
}
const graphqlPath = "/api/graphql/admin";
// 与 Go 兼容传输层的 maxBatch 和 MaxBodyBytes 保持一致。
const maxQueryBatch = 10;
const maxQueryBodyBytes = 1 << 20;
const batchInterval = 1;
let batchKey = 0;
let batchCount = 0;
let batchBytes = 2;
let batchTimer: ReturnType<typeof setTimeout> | undefined;

// Apollo 负责排队、分发与取消；这里只为正文大小提供批分组键。
function queryBatchKey(operation: ApolloLink.Operation) {
    batchTimer ??= setTimeout(() => {
        batchKey++;
        batchCount = 0;
        batchBytes = 2;
        batchTimer = undefined;
    }, batchInterval);
    const bytes = new TextEncoder().encode(
        JSON.stringify({
            operationName: operation.operationName,
            variables: operation.variables,
            query: print(operation.query),
        }),
    ).byteLength;
    if (
        batchCount &&
        (batchCount === maxQueryBatch || batchBytes + bytes + 1 > maxQueryBodyBytes)
    ) {
        batchKey++;
        batchCount = 0;
        batchBytes = 2;
    }
    batchBytes += bytes + (batchCount ? 1 : 0);
    batchCount++;
    return String(batchKey);
}

// 保留单操作对象正文；多操作正文由 BatchHttpLink 生成。
const apolloFetch: typeof fetch = (input, init) => {
    if (typeof init?.body === "string") {
        const operations: unknown = JSON.parse(init.body);
        if (Array.isArray(operations) && operations.length === 1)
            init = { ...init, body: JSON.stringify(operations[0]) };
    }
    return fetch(input, init);
};
const transport = {
    uri: graphqlPath,
    credentials: "include" as const,
    fetchOptions: { cache: "no-store" as const },
    includeExtensions: false,
    includeUnusedVariables: true,
    fetch: apolloFetch,
};

function validateGraphqlResult(result: unknown, status: number) {
    if (!result || typeof result !== "object" || Array.isArray(result))
        throw new ApiError("GraphQL 响应格式无效", status, "INVALID_RESPONSE");
    const errors = "errors" in result ? result.errors : undefined;
    validateGraphqlErrors(errors, status);
    if (!(Array.isArray(errors) && errors.length) && !("data" in result && result.data))
        throw new ApiError("GraphQL 响应缺少数据", status, "INVALID_RESPONSE");
}

// 每条逻辑操作的取消只退订自己；Apollo 在整批退订后中止共享 HTTP。
const lifecycleLink = new ApolloLink(
    (operation, forward) =>
        new Observable((observer) => {
            const signal = operation.getContext().dashboardSignal as AbortSignal;
            const abort = () => observer.error(new DOMException("请求已取消", "AbortError"));
            if (signal.aborted) {
                abort();
                return;
            }
            signal.addEventListener("abort", abort, { once: true });
            const subscription = forward(operation)
                .pipe(
                    map((result) => {
                        validateGraphqlResult(
                            result,
                            operation.getContext().response?.status ?? 200,
                        );
                        return result;
                    }),
                    catchError((error: unknown) =>
                        throwError(() =>
                            error instanceof TypeError && operation.getContext().response
                                ? new ApiError("GraphQL 响应格式无效", 200, "INVALID_RESPONSE")
                                : error,
                        ),
                    ),
                )
                .subscribe({
                    next: (result) => observer.next(result),
                    error: (error: unknown) => observer.error(error),
                    complete: () => observer.complete(),
                });
            return () => {
                signal.removeEventListener("abort", abort);
                subscription.unsubscribe();
            };
        }),
);
const client = new ApolloClient({
    cache: new InMemoryCache(),
    queryDeduplication: false,
    link: ApolloLink.from([
        lifecycleLink,
        ApolloLink.split(
            (operation) =>
                !operation.getContext().identity &&
                getOperationAST(operation.query)?.operation === "query",
            new BatchHttpLink({
                ...transport,
                batchMax: maxQueryBatch,
                batchInterval,
                batchKey: queryBatchKey,
            }),
            new HttpLink(transport),
        ),
    ]),
    defaultOptions: {
        query: { fetchPolicy: "no-cache" },
        mutate: { fetchPolicy: "no-cache" },
    },
});

const httpErrors = new WeakMap<ServerError, ApiError>();
const reportedHttpErrors = new WeakSet<ApiError>();
function apolloError(error: unknown): unknown {
    if (CombinedGraphQLErrors.is(error)) {
        return graphQLError(error.errors, 200);
    }
    if (ServerError.is(error)) {
        if (error.statusCode < 300)
            return new ApiError("GraphQL 响应缺少数据", error.statusCode, "INVALID_RESPONSE");
        const previous = httpErrors.get(error);
        if (previous) return previous;
        let body;
        try {
            body = JSON.parse(error.bodyText);
        } catch {
            /* 非 JSON 代理错误沿用 HTTP 状态。 */
        }
        const normalized = new ApiError(
            body?.message ?? `请求失败 ${error.statusCode}`,
            error.statusCode,
            body?.code ??
                (error.statusCode === 401
                    ? "UNAUTHORIZED"
                    : error.statusCode === 403
                      ? "FORBIDDEN"
                      : "HTTP_ERROR"),
        );
        httpErrors.set(error, normalized);
        return normalized;
    }
    if (ServerParseError.is(error))
        return new ApiError("服务响应格式无效", error.statusCode, "INVALID_RESPONSE");
    // Apollo 为批响应数量和缺失数据错误保留原始 result。
    if (error instanceof Error && "result" in error)
        return new ApiError("GraphQL 批响应格式或数量无效", 200, "INVALID_RESPONSE");
    return error;
}

export async function graphql<TResult, TVariables extends object>(
    query: string,
    variables: TVariables,
    signal?: AbortSignal,
    identity = false,
): Promise<TResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const finish = () => {
        pending.delete(controller);
        signal?.removeEventListener("abort", abort);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    pending.add(controller);
    try {
        if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
        const document = gql(query);
        const operation = getOperationAST(document);
        if (!operation || operation.operation === "subscription")
            throw new ApiError("GraphQL 操作需要唯一的 query 或 mutation", 200, "INVALID_REQUEST");
        const options = {
            errorPolicy: "none" as const,
            variables: JSON.parse(JSON.stringify(variables)) as TVariables,
            context: { dashboardSignal: controller.signal, identity },
        };
        const result = await (operation.operation === "mutation"
            ? client.mutate<TResult, TVariables>({ ...options, mutation: document })
            : client.query<TResult, TVariables>({ ...options, query: document }));
        finish();
        if (!result.data) throw new ApiError("GraphQL 响应缺少数据", 200, "INVALID_RESPONSE");
        return result.data as TResult;
    } catch (cause) {
        // 先移出 pending，再通知认证层，保留原始请求错误。
        finish();
        const error = apolloError(cause);
        if (error instanceof ApiError) {
            if (!ServerError.is(cause) || !reportedHttpErrors.has(error)) {
                if (ServerError.is(cause)) reportedHttpErrors.add(error);
                report(error, identity);
            }
        }
        notifyError(error);
        throw error;
    } finally {
        finish();
    }
}
