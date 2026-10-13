import { parseQueryEvent, type QueryEvent } from "./protocol";

/** 增量拆分 SSE 行，支持任意分块、CR/LF/CRLF、多行 data 和注释心跳。 */
export class SSEDecoder {
    private pending = "";
    private event = "message";
    private data: string[] = [];
    private size = 0;
    private readonly encoder = new TextEncoder();

    push(chunk: string, final = false): { event: string; data: string }[] {
        this.pending += chunk;
        const events: { event: string; data: string }[] = [];
        while (true) {
            const end = this.pending.search(/[\r\n]/);
            if (
                end < 0 ||
                (!final && this.pending[end] === "\r" && end === this.pending.length - 1)
            )
                break;
            const line = this.pending.slice(0, end);
            const width = this.pending.slice(end, end + 2) === "\r\n" ? 2 : 1;
            this.pending = this.pending.slice(end + width);
            this.size += this.encoder.encode(line).length + width;
            if (this.size > 65536) throw new Error("SSE 事件超过大小限制");
            if (line === "") {
                if (this.data.length)
                    events.push({ event: this.event, data: this.data.join("\n") });
                this.event = "message";
                this.data = [];
                this.size = 0;
            } else if (!line.startsWith(":")) {
                const colon = line.indexOf(":");
                const field = colon < 0 ? line : line.slice(0, colon);
                const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
                if (field === "event") this.event = value;
                if (field === "data") this.data.push(value);
            }
        }
        if (this.encoder.encode(this.pending).length + this.size > 65536)
            throw new Error("SSE 事件超过大小限制");
        return events;
    }
}

/** 每次 POST 独占读取器，所有终止路径释放流；事件按请求标识校验并去重。 */
export async function queryDevice(
    requestId: string,
    content: string,
    signal: AbortSignal,
    onEvent: (event: QueryEvent) => void,
): Promise<void> {
    const response = await fetch("/api/rest/bus/query", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ requestId, content }),
        signal,
    });
    if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new Error("登录会话已过期，请重新登录");
        if (response.status === 403) throw new Error("当前请求缺少权限或来源校验失败");
        throw new Error(`查询请求失败（HTTP ${response.status}）`);
    }
    if (
        response.headers.get("content-type")?.split(";")[0].trim() !== "text/event-stream" ||
        !response.body
    ) {
        await response.body?.cancel();
        throw new Error("查询响应需要 SSE 事件流");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const parser = new SSEDecoder();
    let responseKey = "";
    let failure = "";
    let total = 0;
    const received = new Set<number>();
    try {
        while (true) {
            const chunk = await reader.read();
            const text = decoder.decode(chunk.value, { stream: !chunk.done });
            for (const raw of parser.push(text, chunk.done)) {
                const event = parseQueryEvent(raw.event, raw.data);
                switch (event.event) {
                    case "ready":
                        if (responseKey || event.data.requestId !== requestId)
                            throw new Error("查询就绪标识无效");
                        responseKey = event.data.responseKey;
                        break;
                    case "result": {
                        const result = event.data;
                        if (
                            !responseKey ||
                            failure ||
                            result.requestId !== requestId ||
                            result.responseKey !== responseKey ||
                            result.index > result.total ||
                            (total && total !== result.total)
                        ) {
                            throw new Error("查询回执关联或序号无效");
                        }
                        total = result.total;
                        if (received.has(result.index)) continue;
                        received.add(result.index);
                        break;
                    }
                    case "error":
                        if (!responseKey || failure) throw new Error("查询错误事件顺序无效");
                        failure = event.data.code;
                        break;
                    case "done":
                        if (
                            !responseKey ||
                            (failure
                                ? event.data.reason !== failure
                                : event.data.reason !== "completed" ||
                                  !total ||
                                  received.size !== total)
                        ) {
                            throw new Error("查询结束状态无效");
                        }
                        onEvent(event);
                        return;
                }
                onEvent(event);
            }
            if (chunk.done) throw new Error("SSE 连接提前结束，查询回执尚未完成");
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
