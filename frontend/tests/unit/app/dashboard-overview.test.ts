import { beforeEach, describe, expect, it, vi } from "vitest";
import { adapter } from "../../../src/app/dashboard-adapter";
import { ApiError, graphql } from "../../../src/lib/request";

vi.mock("../../../src/lib/request", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../src/lib/request")>()),
    graphql: vi.fn(),
}));

beforeEach(() => vi.mocked(graphql).mockReset());

describe("首页概览 GraphQL 适配", () => {
    it.each([0, 42])("保留概览数据和取消信号，店铺数 %i", async (shops) => {
        const overview = { shops, backend: "Go / Echo", mode: "development" };
        vi.mocked(graphql).mockResolvedValue({ getDashboardOverview: overview });
        const signal = new AbortController().signal;
        await expect(adapter.getSystemData("overview", signal)).resolves.toEqual(overview);
        expect(graphql).toHaveBeenCalledWith(
            expect.stringContaining("getDashboardOverview"),
            {},
            signal,
        );
    });

    it.each([null, undefined, {}, { shops: "1", backend: "Go / Echo", mode: "development" }])(
        "概览结构异常触发统一响应错误：%j",
        async (getDashboardOverview) => {
            vi.mocked(graphql).mockResolvedValue({ getDashboardOverview });
            await expect(
                adapter.getSystemData("overview", new AbortController().signal),
            ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
        },
    );

    it("保留 GraphQL 认证、权限和取消错误", async () => {
        for (const error of [
            new ApiError("会话已过期", 401, "UNAUTHORIZED"),
            new ApiError("权限不足", 403, "FORBIDDEN"),
            new DOMException("请求已取消", "AbortError"),
        ]) {
            vi.mocked(graphql).mockRejectedValueOnce(error);
            await expect(
                adapter.getSystemData("overview", new AbortController().signal),
            ).rejects.toBe(error);
        }
    });

    it("校验系统数据资源名称", async () => {
        await expect(
            Promise.resolve().then(() =>
                adapter.getSystemData("unknown", new AbortController().signal),
            ),
        ).rejects.toThrow("系统数据资源无效");
        expect(graphql).toHaveBeenCalledTimes(0);
    });
});
