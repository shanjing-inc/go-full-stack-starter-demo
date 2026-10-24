// @vitest-environment jsdom
import template from "../../../backend/internal/pages/templates/bus.gohtml?raw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountBusPage } from "../../src/features/bus/bus-page";
import { queryDevice } from "../../src/features/bus/query-stream";

vi.mock("../../src/features/bus/query-stream", () => ({ queryDevice: vi.fn() }));
const requestId = "b650f920-dfe7-4079-92f7-b2bb3b9b0f00";
const responseKey = "b650f920-dfe7-4079-92f7-b2bb3b9b0f01";
class FakeSocket extends EventTarget {
    static OPEN = 1;
    static all: FakeSocket[] = [];
    readyState = 0;
    send = vi.fn();
    close = vi.fn((code = 1000) => {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code }));
    });
    constructor(public url: URL) {
        super();
        FakeSocket.all.push(this);
    }
    receive(type: string, payload: unknown) {
        this.readyState = 1;
        this.dispatchEvent(
            new MessageEvent("message", {
                data: JSON.stringify({ type, payload, sentAt: new Date().toISOString() }),
            }),
        );
    }
}
let dispose: () => void = () => {};
let root: HTMLElement;
function node<T extends HTMLElement>(selector: string): T {
    return root.querySelector<T>(selector)!;
}
function submit(selector: string) {
    node(selector).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
function mount(enabled = true) {
    document.body.innerHTML = template
        .replaceAll("{{.CanUseBus}}", String(enabled))
        .replaceAll("{{if not .CanUseBus}}disabled{{end}}", enabled ? "" : "disabled")
        .replace(/{{[^}]*}}/g, "");
    root = document.querySelector<HTMLElement>("[data-bus-page]")!;
    node<HTMLTextAreaElement>("#bus-query-content").value = "查询设备状态";
    dispose = mountBusPage(root);
}
async function flush() {
    await vi.waitFor(() =>
        expect(node<HTMLButtonElement>("[data-query-log] button").disabled).toBe(true),
    );
}
beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.mocked(queryDevice).mockReset().mockResolvedValue();
    mount();
});
afterEach(() => {
    dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
});

it("采用真实 SSR 模板，Tab 可通过键盘切换且保留连接", () => {
    expect(node("[data-bus-panel=query]").hidden).toBe(true);
    const tab = node<HTMLButtonElement>("[data-bus-tab=broadcast]");
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(node("[data-bus-panel=query]").hidden).toBe(false);
    expect(node("[data-bus-tab=query]").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(node("[data-bus-tab=query]"));
});
it("匿名连接打开登录引导弹窗，可取消且不创建连接；发布与查询仍禁用", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    dispose();
    mount(false);
    const dialog = node<HTMLDialogElement>("[data-bus-login-dialog]");
    expect(dialog).not.toBeNull();
    // jsdom 尚未实现原生 dialog 的打开和关闭；焦点与 Esc 由浏览器回归验证。
    dialog.showModal = vi.fn(() => {
        dialog.open = true;
    });
    dialog.close = vi.fn(() => {
        dialog.open = false;
    });
    expect(node("[data-broadcast-connect]")).toBeEnabled();
    node("[data-broadcast-connect]").click();
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("a")).toHaveAttribute(
        "href",
        "/admin/login?returnTo=%2Ftest%2Fbus",
    );
    expect(node("[data-broadcast-status]")).toHaveTextContent("请先登录后再连接");
    node("[data-bus-login-cancel]").click();
    expect(dialog.open).toBe(false);
    node("[data-bus-tab=query]").click();
    expect(node("[data-device-connect]")).toBeEnabled();
    node("[data-device-connect]").click();
    expect(dialog.open).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(node("[data-device-status]")).toHaveTextContent("请先登录后再连接");
    expect(node("#bus-message")).toBeDisabled();
    expect(node("#broadcast-publish")).toBeDisabled();
    expect(node("[data-device-mode]")).toBeDisabled();
    expect(node("[data-query-submit]")).toBeDisabled();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    submit("[data-broadcast-form]");
    submit("[data-query-form]");
    expect(FakeSocket.all).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(queryDevice).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(dialog.open).toBe(false);
});
it("等待服务端订阅就绪，安全显示广播并清空记录", () => {
    node("[data-broadcast-connect]").click();
    const socket = FakeSocket.all[0];
    expect(socket.url.pathname).toBe("/api/websocket/bus-broadcast");
    expect(node("[data-broadcast-status]").textContent).toContain("等待订阅");
    socket.receive("ready", {});
    expect(node("[data-broadcast-status]").textContent).toBe("广播订阅已就绪");
    socket.receive("bus.broadcast.message", {
        topic: "demo:bus:broadcast",
        messageId: "id-1",
        messageBody: "<img src=x onerror=alert(1)>",
    });
    expect(node("[data-broadcast-log]").textContent).toContain("<img src=x onerror=alert(1)>");
    expect(node("[data-broadcast-log]").querySelector("img")).toBeNull();
    for (let i = 0; i < 35; i++)
        socket.receive("bus.broadcast.message", {
            topic: "demo:bus:broadcast",
            messageId: `id-${i}`,
            messageBody: "内容",
        });
    expect(node("[data-broadcast-log]").children).toHaveLength(30);
    node("[data-broadcast-clear]").click();
    expect(node("#broadcast-empty").textContent).toContain("已清空");
});
it("模拟成功回执使用 WebSocket payload，断开清理待发送计时器", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    node("[data-device-connect]").click();
    const socket = FakeSocket.all[0];
    socket.receive("bus.query.ready", {});
    expect(node("[data-device-status]").textContent).toContain("设备已就绪");
    socket.receive("bus.query.execute", { requestId, responseKey, content: "查询" });
    await vi.advanceTimersByTimeAsync(200);
    expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({
            type: "bus.query.result",
            payload: { requestId, responseKey, content: "设备回执 1/1：查询", index: 1, total: 1 },
        }),
    );
    socket.receive("bus.query.execute", { requestId, responseKey: requestId, content: "第二笔" });
    node("[data-device-connect]").click();
    await vi.advanceTimersByTimeAsync(3000);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(node("[data-device-status]").textContent).toContain("连接已关闭");
});
it("错误与超时模拟模式，重复命令按 responseKey 去重", async () => {
    vi.useFakeTimers();
    node<HTMLSelectElement>("[data-device-mode]").value = "error";
    node("[data-device-connect]").click();
    const socket = FakeSocket.all[0];
    const command = { requestId, responseKey, content: "查询" };
    socket.receive("bus.query.execute", command);
    socket.receive("bus.query.execute", command);
    await vi.advanceTimersByTimeAsync(800);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0]).type).toBe("bus.query.error");
    node<HTMLSelectElement>("[data-device-mode]").value = "timeout";
    socket.receive("bus.query.execute", { ...command, responseKey: requestId });
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.send).toHaveBeenCalledTimes(1);
});
it("查询注册后接收即时事件，按 index 排序并安全显示文本", async () => {
    vi.mocked(queryDevice).mockImplementation(async (id, _, __, onEvent) => {
        expect(node("[data-query-log]").firstElementChild?.getAttribute("data-request-id")).toBe(
            id,
        );
        onEvent({ event: "ready", data: { requestId: id, responseKey } });
        for (const index of [2, 1])
            onEvent({
                event: "result",
                data: {
                    type: "bus.query.result",
                    requestId: id,
                    responseKey,
                    content: "<script>结果</script>",
                    index,
                    total: 2,
                },
            });
        onEvent({ event: "done", data: { reason: "completed" } });
    });
    submit("[data-query-form]");
    await flush();
    expect(node("[data-query-status]").textContent).toBe("查询完成 · 2 条回执");
    expect(
        Array.from(root.querySelectorAll<HTMLElement>("[data-result-index]")).map(
            (item) => item.dataset.resultIndex,
        ),
    ).toEqual(["1", "2"]);
    expect(node("[data-query-log]").querySelector("script")).toBeNull();
});
it("取消隔离、并发配额、清空全部请求和离开页面收敛", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(queryDevice).mockImplementation((_, __, signal) => {
        signals.push(signal);
        return new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new DOMException("取消", "AbortError")), {
                once: true,
            }),
        );
    });
    for (let i = 0; i < 8; i++) submit("[data-query-form]");
    expect(node<HTMLButtonElement>("[data-query-submit]").disabled).toBe(true);
    node<HTMLButtonElement>("[data-query-log] button").click();
    await vi.waitFor(() =>
        expect(node<HTMLButtonElement>("[data-query-submit]").disabled).toBe(false),
    );
    expect(signals.filter((signal) => signal.aborted)).toHaveLength(1);
    expect(node("[data-query-log]").textContent).toContain("查询已取消");
    node("[data-query-clear]").click();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(
        node("#query-history").parentElement?.querySelector("[data-log-empty]")?.textContent,
    ).toContain("已清空");
    submit("[data-query-form]");
    node("[data-broadcast-connect]").click();
    window.dispatchEvent(new Event("pagehide"));
    expect(signals.at(-1)?.aborted).toBe(true);
    expect(FakeSocket.all[0].close).toHaveBeenCalled();
});
it("广播发布与失败反馈，超时关闭待握手连接", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "published-id" }))),
    );
    submit("[data-broadcast-form]");
    await vi.waitFor(() =>
        expect(node("[data-broadcast-feedback]").textContent).toContain("published-id"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    submit("[data-broadcast-form]");
    await vi.waitFor(() =>
        expect(node("[data-broadcast-feedback]").textContent).toContain("登录会话已过期"),
    );
    vi.useFakeTimers();
    node("[data-broadcast-connect]").click();
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeSocket.all[0].close).toHaveBeenCalled();
});

it("沿用参考页的下划线 Tab、单行广播和双列内嵌记录结构", () => {
    expect(node("[role=tablist]").classList.contains("border-b")).toBe(true);
    expect(
        node("[data-bus-tab=broadcast]").classList.contains("aria-selected:border-primary"),
    ).toBe(true);
    expect(node("#bus-message").tagName).toBe("INPUT");
    expect(node("[data-broadcast-form]").classList.contains("border-t")).toBe(true);
    expect(node("[data-device-log]").closest("[aria-labelledby=device-heading]")).not.toBeNull();
    expect(node("[data-query-log]").closest("[aria-labelledby=query-heading]")).not.toBeNull();
    expect(root.querySelectorAll("#broadcast-topic-flow > ol > li")).toHaveLength(3);
    expect(root.querySelectorAll("#query-topic-flow > ol > li")).toHaveLength(4);
    expect(root.querySelectorAll("#query-topic-flow > dl > div")).toHaveLength(2);
});
it("记录更新同步清空按钮与空状态，设备清空保持连接和待发送回执", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(node<HTMLButtonElement>("[data-device-clear]").disabled).toBe(true);
    node("[data-device-connect]").click();
    const socket = FakeSocket.all[0];
    socket.receive("bus.query.ready", {});
    socket.receive("bus.query.execute", { requestId, responseKey, content: "查询" });
    expect(node<HTMLButtonElement>("[data-device-clear]").disabled).toBe(false);
    const placeholder =
        node("[data-device-log]").parentElement!.querySelector<HTMLElement>("[data-log-empty]")!;
    expect(placeholder.hidden).toBe(true);
    node("[data-device-clear]").click();
    expect(node("[data-device-log]").children).toHaveLength(0);
    expect(placeholder.hidden).toBe(false);
    expect(node<HTMLButtonElement>("[data-device-clear]").disabled).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(placeholder.hidden).toBe(true);
    expect(node<HTMLButtonElement>("[data-device-clear]").disabled).toBe(false);
});
