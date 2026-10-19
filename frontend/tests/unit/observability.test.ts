// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import {
    ApiError,
    graphql,
    notifyRequestError,
    subscribeRequestErrors,
} from "../../src/lib/request";
import * as Sentry from "@sentry/react";
import { initializeMonitoring, sanitizeEvent, shouldCapture } from "../../src/lib/observability";

afterEach(async () => {
    initializeMonitoring({});
    vi.unstubAllGlobals();
    await Sentry.close(100);
});

describe("前端错误监控", () => {
    it("默认关闭，业务错误与取消保持静默", () => {
        expect(initializeMonitoring({})).toBe(false);
        expect(shouldCapture(new ApiError("认证服务暂时不可用", 200, "SERVICE_UNAVAILABLE"))).toBe(
            true,
        );
        for (const code of [
            "INVALID_CREDENTIALS",
            "UNAUTHORIZED",
            "USER_BANNED",
            "ALREADY_INSTALLED",
            "INSTALL_DISABLED",
            "RATE_LIMITED",
        ]) {
            expect(shouldCapture(new ApiError("预期认证错误", 200, code))).toBe(false);
        }
        expect(shouldCapture(new DOMException("cancel", "AbortError"))).toBe(false);
        expect(
            shouldCapture(
                Object.assign(new Error("password=secret"), {
                    name: "ApiError",
                    status: 403,
                    code: "FORBIDDEN",
                }),
            ),
        ).toBe(false);
        expect(
            shouldCapture(
                Object.assign(new Error("internal"), {
                    name: "ApiError",
                    status: 200,
                    code: "INTERNAL_SERVER_ERROR",
                }),
            ),
        ).toBe(true);
        expect(shouldCapture(new Error("unexpected"))).toBe(true);
    });
    it("白名单输出移除请求、用户、面包屑和异常消息", () => {
        const event = sanitizeEvent({
            type: undefined,
            message: "secret",
            user: { email: "secret@example.com" },
            request: { url: "https://example.com/?token=secret", headers: { Cookie: "secret" } },
            extra: { password: "secret" },
            breadcrumbs: [{ message: "secret" }],
            contexts: { custom: { DSN: "secret" } },
            tags: { token: "secret" },
            exception: {
                values: [
                    {
                        type: "Error",
                        value: "secret",
                        stacktrace: {
                            frames: [
                                {
                                    filename:
                                        "https://example.com/admin/assets/index-abc.js?token=secret",
                                    function: "secret",
                                    lineno: 12,
                                    colno: 3,
                                },
                            ],
                        },
                    },
                ],
            },
        });
        expect(JSON.stringify(event)).not.toContain("secret");
        expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.lineno).toBe(12);
    });
    it("自定义 transport 收到脱敏事件，错误采集故障保持隔离", async () => {
        const envelopes: unknown[] = [];
        expect(
            initializeMonitoring(
                { VITE_SENTRY_DSN: "https://public@example.com/1" },
                {
                    transport: () => ({
                        send: async (envelope) => {
                            envelopes.push(envelope);
                            return {};
                        },
                        flush: async () => true,
                    }),
                },
            ),
        ).toBe(true);
        Sentry.captureException(new Error("password=secret"));
        await Sentry.flush(1000);
        expect(envelopes).toHaveLength(1);
        expect(JSON.stringify(envelopes)).not.toContain("password=secret");
        expect(
            initializeMonitoring(
                { VITE_SENTRY_DSN: "https://public@example.com/1" },
                {
                    transport: () => {
                        throw new Error("secret DSN");
                    },
                },
            ),
        ).toBe(false);
        expect(initializeMonitoring({ VITE_SENTRY_DSN: "invalid secret DSN" })).toBe(false);
    });
    it("请求错误过滤与 React 降级组件通过真实 SDK 上报脱敏事件", async () => {
        const envelopes: unknown[] = [];
        initializeMonitoring(
            { VITE_SENTRY_DSN: "https://public@example.com/1" },
            {
                transport: () => ({
                    send: async (envelope) => {
                        envelopes.push(envelope);
                        return {};
                    },
                    flush: async () => true,
                }),
            },
        );
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () =>
                    JSON.stringify({
                        errors: [
                            {
                                message: "password=secret",
                                extensions: { code: "INTERNAL_SERVER_ERROR" },
                            },
                        ],
                    }),
            }),
        );
        await expect(graphql("query{hello}", {})).rejects.toBeInstanceOf(ApiError);
        await Sentry.flush(1000);
        expect(envelopes).toHaveLength(1);
        expect(JSON.stringify(envelopes)).not.toContain("password=secret");
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")));
        await expect(graphql("query{hello}", {})).rejects.toMatchObject({ name: "AbortError" });
        await Sentry.flush(1000);
        expect(envelopes).toHaveLength(1);
        function Broken(): never {
            throw new Error("component secret");
        }
        render(
            createElement(
                Sentry.ErrorBoundary,
                { fallback: createElement("p", { role: "alert" }, "页面发生异常，请刷新后重试。") },
                createElement(Broken),
            ),
            { onCaughtError: () => {} },
        );
        expect(screen.getByRole("alert")).toHaveTextContent("页面发生异常，请刷新后重试。");
        await Sentry.flush(1000);
        expect(envelopes).toHaveLength(2);
        expect(JSON.stringify(envelopes)).not.toContain("component secret");
    });
});

describe("请求错误订阅", () => {
    it("请求错误通知与取消订阅保持一致", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeRequestErrors(listener);
        const error = new Error("请求失败");
        try {
            notifyRequestError(error);
            expect(listener).toHaveBeenCalledExactlyOnceWith(error);
            unsubscribe();
            notifyRequestError(error);
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            unsubscribe();
        }
    });

    it("订阅者故障保持后续通知和原始错误身份", () => {
        const error = new Error("原始请求错误");
        const listener = vi.fn();
        const removeFailure = subscribeRequestErrors(() => {
            throw new Error("监控故障");
        });
        const removeListener = subscribeRequestErrors(listener);
        try {
            expect(() => notifyRequestError(error)).not.toThrow();
            expect(listener).toHaveBeenCalledExactlyOnceWith(error);
        } finally {
            removeFailure();
            removeListener();
        }
    });
});
