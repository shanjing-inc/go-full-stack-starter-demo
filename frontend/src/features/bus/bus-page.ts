import { z } from "zod";
import {
    broadcastSchema,
    commandSchema,
    inputText,
    socketMessageSchema,
    type Command,
} from "./protocol";
import { queryDevice } from "./query-stream";

const errorMessage = (error: unknown) =>
    error instanceof SyntaxError
        ? "消息 JSON 格式无效"
        : error instanceof TypeError
          ? "连接或响应解析失败，请检查后端状态"
          : error instanceof z.ZodError
            ? "内容需为 1–2000 个字符，消息格式须符合协议"
            : error instanceof Error
              ? error.message
              : "操作失败，请检查连接状态";

/** 公开 SSR 页的局部增强；所有接收内容通过 textContent 展示。 */
export function mountBusPage(root: HTMLElement): () => void {
    const listeners = new AbortController();
    function element<T extends HTMLElement>(selector: string): T {
        const value = root.querySelector<T>(selector);
        if (!value) throw new Error(`Bus 页面缺少元素：${selector}`);
        return value;
    }
    const broadcastStatus = element("[data-broadcast-status]");
    const deviceStatus = element("[data-device-status]");
    const broadcastConnect = element<HTMLButtonElement>("[data-broadcast-connect]");
    const deviceConnect = element<HTMLButtonElement>("[data-device-connect]");
    const loginDialog = element<HTMLDialogElement>("[data-bus-login-dialog]");
    const broadcastLog = element<HTMLOListElement>("[data-broadcast-log]");
    const deviceLog = element<HTMLOListElement>("[data-device-log]");
    const queryLog = element<HTMLOListElement>("[data-query-log]");
    const feedback = element("[data-query-feedback]");
    const querySubmit = element<HTMLButtonElement>("[data-query-submit]");
    const queries = new Map<
        string,
        { controller: AbortController; item: HTMLLIElement; active: boolean }
    >();
    const simulations = new Map<string, AbortController>();
    const seenCommands = new Set<string>();
    let broadcastSocket: WebSocket | undefined;
    let deviceSocket: WebSocket | undefined;
    let sending = false;

    function on(target: EventTarget, name: string, handler: EventListener) {
        target.addEventListener(name, handler, { signal: listeners.signal });
    }
    on(element("[data-bus-login-cancel]"), "click", () => loginDialog.close());
    function historyState(list: HTMLOListElement, populated: boolean, message?: string) {
        const placeholder = list.parentElement?.querySelector<HTMLElement>("[data-log-empty]");
        const clearButton =
            list.parentElement?.querySelector<HTMLButtonElement>("button[aria-controls]");
        if (placeholder) {
            placeholder.hidden = populated;
            if (message) placeholder.textContent = message;
        }
        if (clearButton) clearButton.disabled = !populated;
    }
    function empty(list: HTMLOListElement, message: string) {
        list.replaceChildren();
        historyState(list, false, message);
    }
    function log(list: HTMLOListElement, message: string) {
        historyState(list, true);
        const item = document.createElement("li");
        item.className =
            "rounded-lg border bg-background p-3 text-sm/6 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]";
        item.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
        list.prepend(item);
        while (list.children.length > 30) list.lastElementChild?.remove();
    }
    function tab(name: string, focus = false) {
        root.querySelectorAll<HTMLButtonElement>("[data-bus-tab]").forEach((button) => {
            const selected = button.dataset.busTab === name;
            button.setAttribute("aria-selected", String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focus) button.focus();
        });
        root.querySelectorAll<HTMLElement>("[data-bus-panel]").forEach((panel) => {
            panel.hidden = panel.dataset.busPanel !== name;
        });
    }
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-bus-tab]"));
    for (const [index, button] of tabs.entries()) {
        on(button, "click", () => tab(button.dataset.busTab || "broadcast"));
        on(button, "keydown", (event) => {
            const key = (event as KeyboardEvent).key;
            const next =
                key === "Home"
                    ? 0
                    : key === "End"
                      ? tabs.length - 1
                      : key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : key === "ArrowLeft"
                          ? (index + tabs.length - 1) % tabs.length
                          : -1;
            if (next >= 0) {
                event.preventDefault();
                tab(tabs[next].dataset.busTab || "broadcast", true);
            }
        });
    }
    tab("broadcast");

    function cancelSimulations() {
        for (const controller of simulations.values()) controller.abort();
        simulations.clear();
        seenCommands.clear();
    }
    async function wait(delay: number, signal: AbortSignal) {
        await new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
                reject(new DOMException("已取消", "AbortError"));
                return;
            }
            const abort = () => {
                clearTimeout(timer);
                reject(new DOMException("已取消", "AbortError"));
            };
            const timer = setTimeout(() => {
                signal.removeEventListener("abort", abort);
                resolve();
            }, delay);
            signal.addEventListener("abort", abort, { once: true });
        });
    }
    async function simulate(command: Command, socket: WebSocket) {
        if (seenCommands.has(command.responseKey)) return;
        seenCommands.add(command.responseKey);
        if (seenCommands.size > 100) seenCommands.delete(seenCommands.values().next().value!);
        const send = (type: string, payload: object) => {
            if (deviceSocket === socket && socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ type, payload }));
        };
        const ids = { requestId: command.requestId, responseKey: command.responseKey };
        if (simulations.size >= 8) {
            send("bus.query.error", { ...ids, message: "设备模拟器并发配额已满" });
            return;
        }
        const mode = element<HTMLSelectElement>("[data-device-mode]").value;
        log(deviceLog, `收到查询 ${command.requestId}\n${command.content}`);
        if (mode === "timeout") {
            log(deviceLog, "超时模式：保持设备在线，等待服务端查询期限结束。");
            return;
        }
        const controller = new AbortController();
        simulations.set(command.responseKey, controller);
        try {
            const total = 1 + Math.floor(Math.random() * 3);
            for (let index = 1; index <= total; index++) {
                await wait(200 + Math.floor(Math.random() * 501), controller.signal);
                if (mode === "error") {
                    send("bus.query.error", { ...ids, message: "设备模拟器返回演示错误" });
                    log(deviceLog, `已返回设备错误 · ${command.requestId}`);
                    return;
                }
                const content = `设备回执 ${index}/${total}：${command.content}`;
                send("bus.query.result", { ...ids, content, index, total });
                log(deviceLog, content);
            }
        } catch (error) {
            if (!controller.signal.aborted) log(deviceLog, errorMessage(error));
        } finally {
            simulations.delete(command.responseKey);
        }
    }

    function connect(device: boolean) {
        const status = device ? deviceStatus : broadcastStatus;
        if (root.dataset.enabled !== "true") {
            status.textContent = "请先登录后再连接";
            if (!loginDialog.open) loginDialog.showModal();
            return;
        }
        const previous = device ? deviceSocket : broadcastSocket;
        if (previous) {
            previous.close(1000, "用户断开");
            if (device) cancelSimulations();
            return;
        }
        const button = device ? deviceConnect : broadcastConnect;
        const records = device ? deviceLog : broadcastLog;
        const label = device ? "设备" : " Bus WebSocket";
        const url = new URL(
            device ? "/api/websocket/bus-query" : "/api/websocket/bus-broadcast",
            window.location.href,
        );
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        let socket: WebSocket;
        try {
            socket = new WebSocket(url);
        } catch (error) {
            status.textContent = errorMessage(error);
            return;
        }
        if (device) deviceSocket = socket;
        else broadcastSocket = socket;
        status.textContent = "正在连接并等待订阅就绪…";
        button.textContent = `断开${label}`;
        const current = () => (device ? deviceSocket : broadcastSocket) === socket;
        const handshake = setTimeout(() => {
            if (current()) {
                status.textContent = "订阅握手超时，请检查登录与后端连接";
                socket.close();
            }
        }, 8000);
        socket.addEventListener("message", (event) => {
            if (!current()) return;
            try {
                const message = socketMessageSchema.parse(JSON.parse(String(event.data)));
                if (
                    (device && message.type === "bus.query.ready") ||
                    (!device && message.type === "ready")
                ) {
                    clearTimeout(handshake);
                    status.textContent = device ? "设备已就绪，等待查询" : "广播订阅已就绪";
                } else if (device && message.type === "bus.query.execute") {
                    void simulate(commandSchema.parse(message.payload), socket);
                } else if (!device && message.type === "bus.broadcast.message") {
                    const value = broadcastSchema.parse(message.payload);
                    log(records, `${value.messageBody}\nmessageId: ${value.messageId}`);
                } else if (message.type === "error") {
                    const value = z.object({ message: z.string() }).parse(message.payload);
                    log(records, value.message);
                }
            } catch (error) {
                log(records, errorMessage(error));
            }
        });
        socket.addEventListener("error", () => {
            if (current()) status.textContent = "连接失败，请检查登录会话、来源与后端状态";
        });
        socket.addEventListener("close", (event) => {
            clearTimeout(handshake);
            if (!current()) return;
            if (device) {
                deviceSocket = undefined;
                cancelSimulations();
            } else broadcastSocket = undefined;
            button.textContent = `连接${label}`;
            status.textContent = `连接已关闭（${event.code}），可重新连接`;
        });
    }
    on(broadcastConnect, "click", () => connect(false));
    on(deviceConnect, "click", () => connect(true));
    on(element("[data-broadcast-clear]"), "click", () => {
        empty(broadcastLog, "广播记录已清空。");
    });
    on(element("[data-device-clear]"), "click", () => {
        empty(deviceLog, "设备记录已清空。");
    });
    const broadcasts = new Set<AbortController>();
    on(element("[data-broadcast-form]"), "submit", (event) => {
        event.preventDefault();
        if (sending || root.dataset.enabled !== "true") return;
        const form = event.currentTarget as HTMLFormElement;
        const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
        const result = element("[data-broadcast-feedback]");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        broadcasts.add(controller);
        sending = true;
        button.disabled = true;
        void (async () => {
            try {
                const messageBody = inputText(element<HTMLInputElement>("#bus-message").value);
                const response = await fetch("/api/rest/bus/broadcast", {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messageBody }),
                    signal: controller.signal,
                });
                if (!response.ok)
                    throw new Error(
                        response.status === 401
                            ? "登录会话已过期，请重新登录"
                            : `广播发布失败（HTTP ${response.status}）`,
                    );
                const value = z
                    .object({ messageId: z.string().min(1) })
                    .parse(await response.json());
                result.textContent = `发布成功 · messageId: ${value.messageId}`;
            } catch (error) {
                result.textContent = controller.signal.aborted
                    ? "广播请求已取消或超时"
                    : errorMessage(error);
            } finally {
                clearTimeout(timer);
                broadcasts.delete(controller);
                sending = false;
                button.disabled = false;
            }
        })();
    });

    function quota() {
        querySubmit.disabled =
            Array.from(queries.values()).filter((record) => record.active).length >= 8;
    }
    on(element("[data-query-form]"), "submit", (event) => {
        event.preventDefault();
        if (root.dataset.enabled !== "true" || querySubmit.disabled) return;
        let content: string;
        try {
            content = inputText(element<HTMLTextAreaElement>("#bus-query-content").value);
        } catch (error) {
            feedback.textContent = errorMessage(error);
            return;
        }
        const requestId = crypto.randomUUID();
        const controller = new AbortController();
        const item = document.createElement("li");
        item.className =
            "space-y-3 rounded-lg border bg-background p-3 text-sm/6 text-foreground [overflow-wrap:anywhere]";
        item.dataset.requestId = requestId;
        const title = document.createElement("h4");
        title.className = "text-sm/6 font-semibold whitespace-pre-wrap [overflow-wrap:anywhere]";
        title.textContent = content;
        const status = document.createElement("p");
        status.className = "text-sm text-muted-foreground";
        status.dataset.queryStatus = "";
        status.textContent = "正在发起查询…";
        const keys = document.createElement("p");
        keys.className = "text-xs break-all text-muted-foreground";
        keys.textContent = `requestId: ${requestId}`;
        const results = document.createElement("ol");
        results.className = "space-y-2 text-sm";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className =
            "min-h-11 cursor-pointer text-sm font-medium text-primary hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
        cancel.textContent = "取消查询";
        cancel.addEventListener("click", () => controller.abort("用户取消"), { once: true });
        item.append(title, status, keys, results, cancel);
        historyState(queryLog, true);
        queries.set(requestId, { controller, item, active: true });
        queryLog.prepend(item);
        while (queries.size > 20) {
            const old = Array.from(queries.entries()).find(([, record]) => !record.active);
            if (!old) break;
            old[1].item.remove();
            queries.delete(old[0]);
        }
        quota();
        feedback.textContent = "查询已提交，可继续提交或单独取消。";
        const timer = setTimeout(() => controller.abort("客户端等待超时"), 10000);
        void queryDevice(requestId, content, controller.signal, (event) => {
            if (event.event === "ready") {
                keys.textContent = `requestId: ${requestId}\nresponseKey: ${event.data.responseKey}`;
                status.textContent = "已建立 SSE，等待设备回执…";
            } else if (event.event === "result") {
                const result = document.createElement("li");
                result.className =
                    "rounded-lg border bg-background p-3 whitespace-pre-wrap break-words";
                result.dataset.resultIndex = String(event.data.index);
                result.textContent = `${event.data.index}/${event.data.total} · ${event.data.content}`;
                results.append(result);
                Array.from(results.children)
                    .sort(
                        (a, b) =>
                            Number((a as HTMLElement).dataset.resultIndex) -
                            Number((b as HTMLElement).dataset.resultIndex),
                    )
                    .forEach((child) => results.append(child));
                status.textContent = `已收到 ${results.children.length}/${event.data.total} 条回执`;
            } else if (event.event === "error") {
                status.textContent = `${event.data.message}（${event.data.code}）`;
            } else if (event.data.reason === "completed") {
                status.textContent = `查询完成 · ${results.children.length} 条回执`;
            }
        })
            .catch((error: unknown) => {
                status.textContent = controller.signal.aborted
                    ? controller.signal.reason === "客户端等待超时"
                        ? "客户端等待超时"
                        : "查询已取消"
                    : errorMessage(error);
            })
            .finally(() => {
                clearTimeout(timer);
                const record = queries.get(requestId);
                if (record) record.active = false;
                cancel.disabled = true;
                quota();
            });
    });
    on(element("[data-query-clear]"), "click", () => {
        for (const record of queries.values()) record.controller.abort("用户取消");
        queries.clear();
        empty(queryLog, "查询记录已清空。");
        quota();
    });
    function stop() {
        if (loginDialog.open) loginDialog.close();
        broadcastSocket?.close(1000, "页面离开");
        deviceSocket?.close(1000, "页面离开");
        broadcastSocket = deviceSocket = undefined;
        broadcastConnect.textContent = "连接 Bus WebSocket";
        deviceConnect.textContent = "连接设备";
        broadcastStatus.textContent = "尚未连接";
        deviceStatus.textContent = "设备尚未连接";
        cancelSimulations();
        for (const controller of broadcasts) controller.abort();
        for (const record of queries.values())
            if (record.active) record.controller.abort("页面离开");
    }
    on(window, "pagehide", stop);
    return () => {
        stop();
        listeners.abort();
    };
}
