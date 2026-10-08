/** 只捕获参考 WS/Bus schema 与编解码器，Go SSE 使用独立协议。 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as query from "/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/lib/bus-query-protocol.ts";
import * as ws from "/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/websocket/protocol/messages.ts";
import { handleStandardWebSocketMessage } from "/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/websocket/protocol/standard-handlers.ts";
import {
    encodeBusMessage,
    decodeBusMessage,
} from "/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/bus/core/codec.ts";
import { encodeRedisBusChannel } from "/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/bus/adapters/redis.ts";

const reference = "/home/dream/wwwroot/astro-full-stack-starter";
const require = createRequire(`${reference}/packages/astro-full-stack-starter/package.json`);
const { z } = require("zod");
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const key = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const cases = [];
function schema(name, kind, value, validator) {
    const result = validator.safeParse(value);
    cases.push({
        name,
        kind,
        input: JSON.stringify(value),
        valid: result.success,
        ...(result.success ? { expected: result.data } : {}),
    });
}
const input = { requestId: id, content: "  查询中文😀\n " };
schema("query_trim", "query", input, query.busQueryInputSchema);
schema(
    "query_bom_trim",
    "query",
    { ...input, content: "\ufeff查询\ufeff" },
    query.busQueryInputSchema,
);
schema(
    "query_0085_preserved",
    "query",
    { ...input, content: "\u0085查询\u0085" },
    query.busQueryInputSchema,
);
schema("query_empty", "query", { ...input, content: " \n " }, query.busQueryInputSchema);
schema("query_bad_uuid", "query", { ...input, requestId: "bad" }, query.busQueryInputSchema);
schema("query_unknown", "query", { ...input, extra: true }, query.busQueryInputSchema);
schema(
    "query_utf16_max",
    "query",
    { ...input, content: "😀".repeat(1000) },
    query.busQueryInputSchema,
);
schema(
    "query_utf16_over",
    "query",
    { ...input, content: "😀".repeat(1001) },
    query.busQueryInputSchema,
);
schema(
    "query_case_sensitive",
    "query",
    { RequestId: id, content: "ok" },
    query.busQueryInputSchema,
);
schema("query_null", "query", { ...input, content: null }, query.busQueryInputSchema);
schema(
    "query_nil_uuid",
    "query",
    { ...input, requestId: "00000000-0000-0000-0000-000000000000" },
    query.busQueryInputSchema,
);
const command = { ...input, responseKey: key, type: "bus.query.execute" };
schema("command_trim", "command", command, query.busQueryCommandSchema);
schema("command_type", "command", { ...command, type: "bad" }, query.busQueryCommandSchema);
schema(
    "command_responsekey",
    "command",
    { ...command, responseKey: "bad" },
    query.busQueryCommandSchema,
);
const receipt = {
    requestId: id,
    responseKey: key,
    type: "bus.query.result",
    content: "结果\n中文",
    index: 1,
    total: 3,
};
schema("receipt_result", "receipt", receipt, query.busQueryReceiptSchema);
schema(
    "receipt_empty_content",
    "receipt",
    { ...receipt, content: "" },
    query.busQueryReceiptSchema,
);
schema(
    "receipt_error",
    "receipt",
    { requestId: id, responseKey: key, type: "bus.query.error", message: "设备报错" },
    query.busQueryReceiptSchema,
);
schema("receipt_extra_null", "receipt", { ...receipt, message: null }, query.busQueryReceiptSchema);
schema("receipt_missing", "receipt", { ...receipt, index: undefined }, query.busQueryReceiptSchema);
schema("receipt_index_zero", "receipt", { ...receipt, index: 0 }, query.busQueryReceiptSchema);
schema("receipt_index_over", "receipt", { ...receipt, index: 4 }, query.busQueryReceiptSchema);
schema("receipt_fraction", "receipt", { ...receipt, total: 1.5 }, query.busQueryReceiptSchema);
schema("receipt_total_over", "receipt", { ...receipt, total: 4 }, query.busQueryReceiptSchema);
// broadcast 的消息字段约束来自参考 schema；REST strict 约定另由真实 HTTP 测试覆盖。
const broadcast = z.object({ messageBody: z.string().min(1).max(2000) }).strict();
schema("broadcast_valid", "broadcast", { messageBody: "公开广播" }, broadcast);
schema("broadcast_unknown", "broadcast", { messageBody: "ok", extra: true }, broadcast);
schema("broadcast_case_sensitive", "broadcast", { MessageBody: "ok" }, broadcast);
schema("broadcast_empty", "broadcast", { messageBody: "" }, broadcast);
schema("broadcast_utf16_max", "broadcast", { messageBody: "😀".repeat(1000) }, broadcast);
schema("broadcast_utf16_over", "broadcast", { messageBody: "😀".repeat(1001) }, broadcast);
const envelope = {
    version: 1,
    id,
    topic: query.BUS_QUERY_COMMAND_TOPIC,
    publishedAt: 1735787045987,
    payload: command,
    sourceInstanceId: "reference-web",
};
for (const [name, value] of [
    ["bus_envelope", envelope],
    ["bus_payload_null", { ...envelope, payload: null }],
    ["bus_version", { ...envelope, version: 2 }],
    ["bus_unknown", { ...envelope, extra: true }],
    ["bus_timestamp_missing", { ...envelope, publishedAt: undefined }],
    ["bus_timestamp_null", { ...envelope, publishedAt: null }],
    ["bus_timestamp_negative", { ...envelope, publishedAt: -1 }],
    ["bus_timestamp_fraction", { ...envelope, publishedAt: 1.5 }],
    ["bus_topic_empty", { ...envelope, topic: "" }],
    ["bus_case_sensitive", { ...envelope, version: undefined, Version: 1 }],
    ["bus_unicode_surrogate", { ...envelope, payload: "\ud800" }],
    ["bus_reserved_key", { ...envelope, payload: { constructor: "bad" } }],
]) {
    const raw = JSON.stringify(value);
    try {
        cases.push({
            name,
            kind: "envelope",
            input: raw,
            valid: true,
            expected: decodeBusMessage(raw),
        });
    } catch {
        cases.push({ name, kind: "envelope", input: raw, valid: false });
    }
}
process.env.REDIS_KEY_PREFIX = " :应用:: ";
process.env.NODE_ENV = "development";
const identity = { name: "bus-demo", environment: "default" };
cases.push({
    name: "redis_channel_utf8",
    kind: "channel",
    input: JSON.stringify({ prefix: process.env.REDIS_KEY_PREFIX, ...identity, topic: "频道:😀" }),
    valid: true,
    expected: encodeRedisBusChannel(identity, "频道:😀"),
});
const RealDate = Date;
globalThis.Date = class extends RealDate {
    constructor(...args) {
        super(...(args.length ? args : ["2025-01-02T03:04:05.987Z"]));
    }
};
for (const [name, input] of [
    ["ws_ping", { type: "ping", payload: { timestamp: 123.5, extra: true } }],
    ["ws_ping_empty", { type: "ping" }],
    ["ws_echo", { type: "echo", payload: { message: "中文😀", extra: true } }],
]) {
    const message = ws.parseWebSocketClientMessage(
        JSON.stringify(input),
        ws.standardClientMessageSchema,
    );
    let output;
    handleStandardWebSocketMessage(message, {
        sendMessage(value) {
            output = ws.createWebSocketMessage(value);
        },
    });
    cases.push({ name, kind: "ws", input: JSON.stringify(input), valid: true, expected: output });
}
globalThis.Date = RealDate;
const files = [
    "projects/deno-mysql-demo/src/lib/bus-query-protocol.ts",
    "projects/deno-mysql-demo/src/websocket/adapters/bus-query.ts",
    "projects/deno-mysql-demo/src/websocket/adapters/bus-broadcast.ts",
    "projects/deno-mysql-demo/src/websocket/features/bus-broadcast.ts",
    "projects/deno-mysql-demo/src/pages/api/rest/bus/broadcast.ts",
    "packages/astro-full-stack-starter/src/websocket/protocol/messages.ts",
    "packages/astro-full-stack-starter/src/websocket/protocol/standard-handlers.ts",
    "packages/astro-full-stack-starter/src/bus/core/codec.ts",
    "packages/astro-full-stack-starter/src/bus/adapters/redis.ts",
    "packages/astro-full-stack-starter/src/redis/config.ts",
];
const sources = Object.fromEntries(
    files.map((p) => [
        p,
        createHash("sha256")
            .update(readFileSync(resolve(reference, p)))
            .digest("hex"),
    ]),
);
const result = {
    reference,
    capturedAt: "2026-10-03",
    node: process.version,
    zod: require("zod/package.json").version,
    sources,
    cases,
};
writeFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "reference-cases.json"),
    JSON.stringify(result, null, 2) + "\n",
);
console.log(`捕获 ${cases.length} 项 WS 与 Bus 样本；SSE 使用 Go 独立设计。`);
