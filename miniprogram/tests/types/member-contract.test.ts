import type {
    GetMemberShopQuery,
    GetMemberShopQueryVariables,
} from "../../src/graphql/member/generated";
function check(data: GetMemberShopQuery) {
    // @ts-expect-error 店铺查询允许空记录，访问前需要检查。
    const unsafe = data.getShop.id;
    if (data.getShop) {
        const id: string | null = data.getShop.id;
        const date: string | null = data.getShop.createdAt;
        // @ts-expect-error ID 字段自身仍然可空。
        const strict: string = data.getShop.id;
        return { id, date, strict };
    }
    return unsafe;
}
const valid: GetMemberShopQueryVariables = { where: { id: { eq: 1 } } };
// @ts-expect-error where 是必填输入。
const missing: GetMemberShopQueryVariables = {};
// @ts-expect-error ID 筛选接受整数输入。
const invalid: GetMemberShopQueryVariables = { where: { id: { eq: "1" } } };
void [check, valid, missing, invalid];
