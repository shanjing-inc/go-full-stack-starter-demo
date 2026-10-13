/** 使用现有 Yoga 处理器及完整 SDL 捕获协议样本；数据库与会话由内存替身提供。 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const reference = process.env.REFERENCE_REPO;
if (!reference)
    throw new Error("重新捕获参考 fixture 需要显式 REFERENCE_REPO；日常测试只读取现有 fixture");
const referenceModule = (name) => import(pathToFileURL(resolve(reference, name)).href);
const { createGraphQLYogaHandler } = await referenceModule(
    "packages/astro-full-stack-starter/src/graphql/yoga.ts",
);
const { GraphQLResolverError } = await referenceModule(
    "packages/astro-full-stack-starter/src/graphql/errors.ts",
);
const { serializeDateTime } = await referenceModule(
    "packages/astro-full-stack-starter/src/graphql/utils.ts",
);
const { GET, HEAD } = await referenceModule(
    "projects/deno-mysql-demo/src/pages/api/rest/internal/health.ts",
);
const target = dirname(fileURLToPath(import.meta.url));
const require = createRequire(`${reference}/packages/astro-full-stack-starter/package.json`);
const { buildSchema } = require("graphql");
const fields = "id name slug status createdAt updatedAt";
const lookup = `query GetShop($where: ShopFilters!) { getShop(where: $where) { ${fields} } }`;
const operation = (id) => ({ query: lookup, variables: { where: { id: { eq: id } } } });
const shop = {
    id: 1,
    name: "示例店铺",
    slug: "demo",
    status: "active",
    createdAt: new Date("2025-01-02T03:04:05.987Z"),
    updatedAt: new Date("2025-01-02T03:04:05.987Z"),
};
const cases = [];
function add(name, endpoint, method, body, mode = "exact", headers = {}) {
    const entry = { name, endpoint, method, mode, headers };
    if (method === "GET" && body) {
        const params = new URLSearchParams({ query: body.query });
        if (body.variables) params.set("variables", JSON.stringify(body.variables));
        if (body.operationName) params.set("operationName", body.operationName);
        entry.search = `?${params}`;
    } else if (body !== undefined) {
        entry.body = typeof body === "string" ? body : JSON.stringify(body);
        entry.headers["content-type"] ??= "application/json";
    }
    cases.push(entry);
}
add("health_get", "health", "GET");
add("health_head", "health", "HEAD");
add("member_post", "member", "POST", operation(1));
add("admin_get", "admin", "GET", operation(1));
add("nullable_missing", "member", "POST", operation(99));
for (const id of [400, 403, 410, 503, 500]) add(`error_${id}`, "member", "POST", operation(id));
add("partial_error", "member", "POST", {
    query: `{ ok: getShop(where:{id:{eq:1}}){id} denied: getShop(where:{id:{eq:403}}){id} }`,
});
add("directive_skip", "member", "POST", {
    query: `query($show:Boolean!){ getShop(where:{id:{eq:1}}) @include(if:$show){id} }`,
    variables: { show: false },
});
add("directive_include", "member", "POST", {
    query: `query($show:Boolean!){ getShop(where:{id:{eq:1}}) @include(if:$show){id} }`,
    variables: { show: true },
});
const create = {
    query: `mutation($set:CreateShopSetInput!){createShop(set:$set){${fields}}}`,
    variables: { set: { name: "新店铺", slug: "new-shop" } },
};
add("admin_mutation", "admin", "POST", create);
add("member_schema_isolation", "member", "POST", create, "request-error");
add("get_mutation", "admin", "GET", create, "request-error");
add("batch_success", "member", "POST", [operation(1), operation(99)]);
add("batch_mixed", "member", "POST", [operation(403), operation(1)]);
add(
    "batch_limit",
    "member",
    "POST",
    Array.from({ length: 10 }, () => operation(1)),
);
add(
    "batch_over_limit",
    "member",
    "POST",
    Array.from({ length: 11 }, () => operation(1)),
    "request-error",
);
add("batch_empty", "member", "POST", []);
add("invalid_field", "member", "POST", { query: "{ secretField }" }, "request-error");
add("invalid_syntax", "member", "POST", { query: "{" }, "request-error");
add("invalid_json", "member", "POST", "{", "request-error");
add("unsupported_method", "member", "PUT", operation(1), "request-error");
add("preflight", "member", "OPTIONS", undefined, "preflight", {
    origin: "http://localhost:5173",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
});

add("modern_invalid_field", "member", "POST", { query: "{ secretField }" }, "request-error", {
    accept: "application/graphql-response+json",
});
add("modern_invalid_syntax", "member", "POST", { query: "{" }, "request-error", {
    accept: "application/graphql-response+json",
});
add("modern_success", "member", "POST", operation(1), "exact", {
    accept: "application/graphql-response+json",
});
const multiOperation =
    "query First {getShop(where:{id:{eq:99}}){id}} query Second {getShop(where:{id:{eq:1}}){id}}";
add("operation_name_post", "member", "POST", { query: multiOperation, operationName: "Second" });
add("operation_name_get", "member", "GET", { query: multiOperation, operationName: "Second" });
add("missing_operation_name", "member", "POST", { query: multiOperation }, "request-error");
add(
    "invalid_variables",
    "member",
    "POST",
    { query: lookup, variables: { where: { id: { eq: "bad" } } } },
    "request-error",
);
add("missing_variables", "member", "POST", { query: lookup }, "request-error");

add(
    "unknown_operation_name",
    "member",
    "POST",
    { query: multiOperation, operationName: "Absent" },
    "request-error",
);
add(
    "modern_invalid_variables",
    "member",
    "POST",
    { query: lookup, variables: { where: { id: { eq: "bad" } } } },
    "request-error",
    { accept: "application/graphql-response+json" },
);
add("modern_batch", "member", "POST", [operation(1), operation(99)], "exact", {
    accept: "application/graphql-response+json",
});
add("modern_empty_batch", "member", "POST", [], "exact", {
    accept: "application/graphql-response+json",
});

const paths = {
    member: "/api/graphql/member",
    admin: "/api/graphql/admin",
    health: "/api/rest/internal/health",
};
const codes = {
    400: "BAD_USER_INPUT",
    403: "FORBIDDEN",
    410: "NOT_FOUND",
    503: "SERVICE_UNAVAILABLE",
};
const messages = {
    400: "输入参数无效",
    403: "操作权限不足",
    410: "目标资源不存在",
    503: "服务暂时不可用",
};
const schemas = {};
const sources = {};
for (const endpoint of ["member", "admin"]) {
    const filename = `${reference}/projects/deno-mysql-demo/src/graphql/generated/${endpoint}-schema.graphql`;
    const text = readFileSync(filename, "utf8");
    sources[`projects/deno-mysql-demo/src/graphql/generated/${endpoint}-schema.graphql`] =
        createHash("sha256").update(text).digest("hex");
    writeFileSync(resolve(target, `reference-${endpoint}.graphql`), text);
    schemas[endpoint] = text;
}
for (const filename of [
    "packages/astro-full-stack-starter/src/graphql/yoga.ts",
    "packages/astro-full-stack-starter/src/graphql/errors.ts",
    "packages/astro-full-stack-starter/src/graphql/utils.ts",
    "projects/deno-mysql-demo/src/pages/api/rest/internal/health.ts",
]) {
    sources[filename] = createHash("sha256")
        .update(readFileSync(`${reference}/${filename}`))
        .digest("hex");
}
for (const entry of cases) {
    let response;
    const request = new Request(`http://localhost${paths[entry.endpoint]}${entry.search ?? ""}`, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
    });
    if (entry.endpoint === "health") {
        response = (entry.method === "HEAD" ? HEAD : GET)({ request });
    } else {
        const schema = buildSchema(schemas[entry.endpoint]);
        schema.getType("DateTime").serialize = serializeDateTime;
        schema.getType("DateTime").coerceOutputValue = serializeDateTime;
        schema.getQueryType().getFields().getShop.resolve = (_source, args) => {
            const id = args.where.id?.eq;
            if (codes[id]) throw new GraphQLResolverError(messages[id], codes[id]);
            if (id === 500)
                throw new Error("mysql://secret-user:secret-password@private-db/internal-trace");
            return id === 1 ? { ...shop } : null;
        };
        if (entry.endpoint === "admin") {
            schema.getMutationType().getFields().createShop.resolve = (_source, args) => ({
                ...shop,
                id: 2,
                name: args.set.name,
                slug: args.set.slug,
                status: args.set.status ?? "active",
            });
        }
        const handler = createGraphQLYogaHandler({
            graphqlEndpoint: paths[entry.endpoint],
            schema,
            graphiql: false,
            batching: { limit: 10 },
        });
        response = await handler({ request });
    }
    const text = await response.text();
    entry.expected = { status: response.status };
    if (entry.endpoint === "health") entry.expected.text = text;
    else if (text) entry.expected.json = JSON.parse(text);
    entry.expected.headers = Object.fromEntries(
        [
            "content-type",
            "cache-control",
            "allow",
            "access-control-allow-origin",
            "access-control-allow-methods",
            "access-control-allow-headers",
        ]
            .map((key) => [key, response.headers.get(key)])
            .filter(([, value]) => value !== null),
    );
}
writeFileSync(
    resolve(target, "reference-cases.json"),
    JSON.stringify(
        {
            description:
                "完整参考 SDL + 现有 Yoga/health 处理器；业务 Resolver 使用内存替身。解析与校验错误比较状态及结构。",
            sources,
            versions: {
                node: process.version,
                graphql: JSON.parse(
                    readFileSync(
                        `${reference}/packages/astro-full-stack-starter/node_modules/graphql/package.json`,
                        "utf8",
                    ),
                ).version,
                yoga: JSON.parse(
                    readFileSync(
                        `${reference}/packages/astro-full-stack-starter/node_modules/graphql-yoga/package.json`,
                        "utf8",
                    ),
                ).version,
            },
            cases,
        },
        null,
        2,
    ) + "\n",
);
for (const entry of cases) console.log(`${entry.name}: ${entry.expected.status}`);
console.log(`已捕获 ${cases.length} 项参考协议样本。`);
