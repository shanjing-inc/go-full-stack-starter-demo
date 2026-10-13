import { fileURLToPath } from "node:url";
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
export default {
    schema: ["common", "member"].map((name) => path(`../share/schema/${name}.graphqls`)),
    documents: [path("src/graphql/member/operations.ts")],
    silent: true,
    generates: {
        [path("src/graphql/member/generated.ts")]: {
            plugins: ["typescript-operations"],
            config: {
                skipTypename: true,
                enumsAsTypes: true,
                arrayInputCoercion: false,
                avoidOptionals: { field: true },
                strictScalars: true,
                scalars: { DateTime: { input: "string", output: "string" } },
            },
        },
    },
};
