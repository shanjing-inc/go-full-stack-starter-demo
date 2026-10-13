import { z } from "zod";

const uuid = z.string().uuid();
const text = (min: number, max: number) =>
    z.string().refine((value) => value.length >= min && value.length <= max);
const content = text(1, 2000);
export const commandSchema = z.object({ requestId: uuid, responseKey: uuid, content });
export type Command = z.infer<typeof commandSchema>;
export const broadcastSchema = z.object({
    topic: z.literal("demo:bus:broadcast"),
    messageId: z.string().min(1),
    messageBody: content,
});
export const socketMessageSchema = z.object({
    type: z.string(),
    payload: z.unknown(),
    sentAt: z.string(),
});
const readySchema = z.object({ requestId: uuid, responseKey: uuid });
const resultSchema = z.object({
    type: z.literal("bus.query.result"),
    requestId: uuid,
    responseKey: uuid,
    content: text(0, 8000),
    index: z.number().int().min(1).max(3),
    total: z.number().int().min(1).max(3),
});
const errorSchema = z.object({ code: z.string().min(1), message: text(1, 2000) });
const doneSchema = z.object({ reason: z.string().min(1) });
export type QueryEvent =
    | { event: "ready"; data: z.infer<typeof readySchema> }
    | { event: "result"; data: z.infer<typeof resultSchema> }
    | { event: "error"; data: z.infer<typeof errorSchema> }
    | { event: "done"; data: z.infer<typeof doneSchema> };

/** 严格校验 SSE 业务载荷；未知事件交给调用方作为协议错误处理。 */
export function parseQueryEvent(event: string, raw: string): QueryEvent {
    const value: unknown = JSON.parse(raw);
    switch (event) {
        case "ready":
            return { event, data: readySchema.parse(value) };
        case "result":
            return { event, data: resultSchema.parse(value) };
        case "error":
            return { event, data: errorSchema.parse(value) };
        case "done":
            return { event, data: doneSchema.parse(value) };
        default:
            throw new Error("收到未知 SSE 事件");
    }
}

/** 归整文本并对齐后端 UTF-16 长度边界。 */
export function inputText(value: string): string {
    return content.parse(value.trim());
}
