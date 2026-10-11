import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export default {
    schema: ["common", "admin", "queue"].map((name) => path(`../schema/${name}.graphqls`)),
    documents: [path("src/graphql/admin/operations.ts")],
    silent: true,
    generates: {
        [path("src/graphql/admin/generated.ts")]: {
            plugins: ["typescript-operations"],
            config: {
                // v6 插件同时生成操作用到的输入类型；响应按实际选择生成。
                skipTypename: true,
                enumsAsTypes: true,
                arrayInputCoercion: false,
                avoidOptionals: { field: true },
                strictScalars: true,
                scalars: {
                    DateTime: { input: "string", output: "string" },
                    JSON: { input: "unknown", output: "unknown" },
                },
            },
        },
    },
};
