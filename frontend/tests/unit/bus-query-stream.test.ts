import { afterEach, describe, expect, it, vi } from "vitest";
import { queryDevice, SSEDecoder } from "../../src/features/bus/query-stream";
import { inputText, type QueryEvent } from "../../src/features/bus/protocol";

const requestId = "b650f920-dfe7-4079-92f7-b2bb3b9b0f00";
const responseKey = "b650f920-dfe7-4079-92f7-b2bb3b9b0f01";
const ready = { requestId, responseKey };
const result = (index: number, total = 2) => ({
    type: "bus.query.result",
    ...ready,
    content: `结果${index}`,
    index,
    total,
});
function event(type: string, data: unknown) {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
function mockStream(raw: string, width = 7) {
    const bytes = new TextEncoder().encode(raw);
    let offset = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset === bytes.length) {
                controller.close();
                return;
            }
            controller.enqueue(bytes.slice(offset, offset + width));
            offset = Math.min(offset + width, bytes.length);
        },
        cancel,
    });
    const fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    return { fetch, cancel, stream };
}
async function run(raw: string, width?: number) {
    const mocked = mockStream(raw, width);
    const events: QueryEvent[] = [];
    await queryDevice(requestId, "查询", new AbortController().signal, (value) =>
        events.push(value),
    );
    return { ...mocked, events };
}
afterEach(() => vi.unstubAllGlobals());

describe("Bus SSE 增量读取", () => {
    it("支持跨块 CR/LF/CRLF、多行 data、注释心跳及最终 CR", () => {
        const parser = new SSEDecoder();
        expect(parser.push(": 心跳\r")).toEqual([]);
        expect(parser.push("\nevent: result\r\ndata: 第一行\rdata: 第二行\r")).toEqual([]);
        expect(parser.push("\r", true)).toEqual([{ event: "result", data: "第一行\n第二行" }]);
    });
    it("限制未终止行和累计事件大小", () => {
        expect(() => new SSEDecoder().push("x".repeat(65537))).toThrow("大小限制");
        expect(() => new SSEDecoder().push("界".repeat(21846))).toThrow("大小限制");
        expect(() => new SSEDecoder().push(`data: ${"😀".repeat(16384)}\n`)).toThrow("大小限制");
        const parser = new SSEDecoder();
        parser.push(`data: ${"x".repeat(40000)}\n`);
        expect(() => parser.push(`data: ${"y".repeat(30000)}\n`)).toThrow("大小限制");
    });
    it("按 UTF-16 长度归整输入", () => {
        expect(inputText(" \uFEFF查询\u3000")).toBe("查询");
        expect(() => inputText(" ")).toThrow();
        expect(() => inputText("😀".repeat(1001))).toThrow();
    });
    it("逐字节解析中文、乱序回执、去重，并验证完整结束", async () => {
        const raw =
            event("ready", ready) +
            ": heartbeat\n\n" +
            event("result", result(2)) +
            event("result", result(2)) +
            event("result", result(1)) +
            event("done", { reason: "completed" });
        const { events, fetch, stream } = await run(raw, 1);
        expect(events.map((value) => value.event)).toEqual(["ready", "result", "result", "done"]);
        expect(stream.locked).toBe(false);
        expect(fetch).toHaveBeenCalledWith(
            "/api/rest/bus/query",
            expect.objectContaining({
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                body: JSON.stringify({ requestId, content: "查询" }),
            }),
        );
    });
    it("设备错误由 error + done 收敛，主动取消读取器", async () => {
        const { events, cancel } = await run(
            event("ready", ready) +
                event("error", { code: "DEVICE_OFFLINE", message: "设备离线" }) +
                event("done", { reason: "DEVICE_OFFLINE" }) +
                "尚未读取的尾部".repeat(100),
        );
        expect(events.map((value) => value.event)).toEqual(["ready", "error", "done"]);
        expect(cancel).toHaveBeenCalledOnce();
    });
    it.each([
        ["请求标识", event("ready", { ...ready, requestId: responseKey })],
        [
            "响应标识",
            event("ready", ready) + event("result", { ...result(1), responseKey: requestId }),
        ],
        ["重复就绪", event("ready", ready) + event("ready", ready)],
        ["回执先于握手", event("result", result(1))],
        ["序号超出总数", event("ready", ready) + event("result", result(3, 2))],
        [
            "总数漂移",
            event("ready", ready) + event("result", result(1)) + event("result", result(2, 3)),
        ],
        [
            "缺少回执",
            event("ready", ready) +
                event("result", result(1)) +
                event("done", { reason: "completed" }),
        ],
        ["缺少 done", event("ready", ready) + event("result", result(1, 1))],
        ["非法 JSON", "event: ready\ndata: {\n\n"],
        ["未知事件", event("gap", {})],
        [
            "错误后成功",
            event("ready", ready) +
                event("error", { code: "X", message: "失败" }) +
                event("done", { reason: "completed" }),
        ],
    ])("拒绝%s并释放读取器", async (_, raw) => {
        const { stream } = mockStream(raw);
        await expect(
            queryDevice(requestId, "查询", new AbortController().signal, () => {}),
        ).rejects.toThrow();
        expect(stream.locked).toBe(false);
    });
    it.each([401, 403, 429, 503])("显示 HTTP %s 错误", async (status) => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
        await expect(
            queryDevice(requestId, "查询", new AbortController().signal, () => {}),
        ).rejects.toThrow();
    });
    it("拒绝 JSON 成功响应", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response("{}", { headers: { "Content-Type": "application/json" } }),
                ),
        );
        await expect(
            queryDevice(requestId, "查询", new AbortController().signal, () => {}),
        ).rejects.toThrow("SSE");
    });
    it("终止信号传给 fetch，各请求具有独立读取器", async () => {
        const a = new AbortController();
        const b = new AbortController();
        vi.stubGlobal(
            "fetch",
            vi.fn(
                (_: string, init: RequestInit) =>
                    new Promise((_, reject) => {
                        init.signal?.addEventListener(
                            "abort",
                            () => reject(new DOMException("取消", "AbortError")),
                            { once: true },
                        );
                    }),
            ),
        );
        const first = queryDevice(requestId, "A", a.signal, () => {}).catch(
            (error: unknown) => error,
        );
        const second = queryDevice(responseKey, "B", b.signal, () => {}).catch(
            (error: unknown) => error,
        );
        a.abort();
        expect(await first).toBeInstanceOf(DOMException);
        expect(b.signal.aborted).toBe(false);
        b.abort();
        await second;
    });
});
