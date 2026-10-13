import * as Sentry from "@sentry/react";
import { subscribeRequestErrors } from "./request";

type MonitoringEnvironment = {
    VITE_SENTRY_DSN?: string;
    VITE_SENTRY_ENVIRONMENT?: string;
    VITE_SENTRY_RELEASE?: string;
};
let unsubscribe: (() => void) | undefined;

export function shouldCapture(error: unknown): boolean {
    if (error && typeof error === "object") {
        const candidate = error as { name?: string; status?: number; code?: string };
        if (candidate.name === "AbortError") return false;
        if (candidate.name === "ApiError") {
            return (
                (candidate.status ?? 0) >= 500 ||
                ["INTERNAL_SERVER_ERROR", "INVALID_RESPONSE"].includes(candidate.code ?? "")
            );
        }
    }
    return true;
}

// 输出白名单：保留定位所需的编译文件与行列，移除所有动态业务内容。
export function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
    return {
        type: undefined,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: event.platform,
        level: event.level,
        release: event.release,
        environment: event.environment,
        exception: {
            values: event.exception?.values?.map((exception) => ({
                type: "Error",
                value: "前端内部异常",
                stacktrace: {
                    frames: exception.stacktrace?.frames?.map((frame) => {
                        const filename = frame.filename?.split(/[?#]/)[0];
                        return {
                            filename: filename?.match(/\/admin\/assets\/[\w.-]+\.js$/)?.[0],
                            lineno: frame.lineno,
                            colno: frame.colno,
                            in_app: frame.in_app,
                        };
                    }),
                },
            })),
        },
    };
}

export function initializeMonitoring(
    env: MonitoringEnvironment,
    overrides: Pick<Sentry.BrowserOptions, "transport"> = {},
): boolean {
    unsubscribe?.();
    unsubscribe = undefined;
    if (!env.VITE_SENTRY_DSN?.trim()) return false;
    try {
        const dsn = new URL(env.VITE_SENTRY_DSN);
        if (
            !["https:", "http:"].includes(dsn.protocol) ||
            !dsn.username ||
            !/\/\d+$/.test(dsn.pathname)
        )
            return false;
        Sentry.init({
            ...overrides,
            dsn: env.VITE_SENTRY_DSN,
            environment: env.VITE_SENTRY_ENVIRONMENT || "production",
            release: env.VITE_SENTRY_RELEASE || undefined,
            dataCollection: {
                userInfo: false,
                cookies: false,
                httpHeaders: false,
                httpBodies: [],
                urlQueryParams: false,
                graphQL: { document: false, variables: false },
                genAI: { inputs: false, outputs: false },
                databaseQueryData: false,
                queues: false,
                stackFrameVariables: false,
                frameContextLines: 0,
            },
            defaultIntegrations: false,
            integrations: [
                Sentry.globalHandlersIntegration(),
                Sentry.browserApiErrorsIntegration(),
                Sentry.dedupeIntegration(),
            ],
            tracesSampleRate: 0,
            beforeSend(event, hint) {
                if (!shouldCapture(hint.originalException)) return null;
                hint.attachments = [];
                return sanitizeEvent(event);
            },
        });
        unsubscribe = subscribeRequestErrors((error) => {
            if (shouldCapture(error)) Sentry.captureException(error);
        });
        return true;
    } catch {
        // 监控配置及 SDK 故障由应用降级处理，保留正常启动。
        return false;
    }
}
