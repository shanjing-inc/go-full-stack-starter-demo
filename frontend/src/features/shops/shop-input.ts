import { z } from "zod";

function requiredText(label: string) {
    return z
        .string({ error: `${label}需要文本` })
        .trim()
        .refine((value) => {
            const length = Array.from(value).length;
            return length >= 1 && length <= 255;
        }, `${label}需要 1–255 个字符`);
}

// 仅校验用户创建输入；GraphQL 操作类型继续由 SDL 生成。
export const shopInputSchema = z.object({
    name: requiredText("名称"),
    slug: requiredText("唯一标识"),
});
