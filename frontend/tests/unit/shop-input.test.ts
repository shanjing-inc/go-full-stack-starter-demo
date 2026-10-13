import { describe, expect, it } from "vitest";
import { shopInputSchema } from "../../src/features/shops/shop-input";

describe("店铺创建输入", () => {
    it("归整空白，与后端保持 1–255 个 Unicode 字符边界", () => {
        expect(shopInputSchema.parse({ name: " 示例店铺 ", slug: " demo " })).toEqual({
            name: "示例店铺",
            slug: "demo",
        });
        expect(shopInputSchema.safeParse({ name: "😀".repeat(255), slug: "demo" }).success).toBe(
            true,
        );
        expect(shopInputSchema.safeParse({ name: "😀".repeat(256), slug: "demo" }).success).toBe(
            false,
        );
    });
    it("拒绝空值和非字符串，错误消息保持中文", () => {
        for (const input of [
            { name: "  ", slug: "demo" },
            { name: "demo", slug: "" },
            { name: 1, slug: "demo" },
        ]) {
            const result = shopInputSchema.safeParse(input);
            expect(result.success).toBe(false);
            if (!result.success) expect(result.error.issues[0]?.message).toMatch(/名称|唯一标识/);
        }
    });
});
