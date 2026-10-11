// 由 typecheck 验证编译期契约；函数保留为类型测试入口。
import { graphql } from "../../request";
import { CREATE_ADMIN_SHOP, LIST_ADMIN_SHOPS } from "./operations";
import type {
    CreateAdminShopMutation,
    CreateAdminShopMutationVariables,
    DashboardQueueRecordQuery,
    GetDashboardSessionQuery,
    ListAdminShopsQuery,
    ListAdminShopsQueryVariables,
} from "./generated";

export function verifyVariables() {
    void graphql<ListAdminShopsQuery, ListAdminShopsQueryVariables>(LIST_ADMIN_SHOPS, {
        where: { slug: { like: "%demo%" } },
        limit: 21,
    });
    void graphql<ListAdminShopsQuery, ListAdminShopsQueryVariables>(LIST_ADMIN_SHOPS, {
        // @ts-expect-error 分页参数遵循 SDL 的 Int。
        limit: "21",
    });
    void graphql<CreateAdminShopMutation, CreateAdminShopMutationVariables>(CREATE_ADMIN_SHOP, {
        // @ts-expect-error 创建店铺的输入包含必填名称。
        set: { slug: "demo" },
    });
    void graphql<ListAdminShopsQuery, ListAdminShopsQueryVariables>(LIST_ADMIN_SHOPS, {
        // @ts-expect-error 已删除或拼错的筛选字段由生成输入类型拦截。
        where: { missing: {} },
    });
}

export function verifyResults(
    session: GetDashboardSessionQuery,
    user: NonNullable<GetDashboardSessionQuery["getCurrentUser"]>,
    record: DashboardQueueRecordQuery,
) {
    // @ts-expect-error 当前用户对象保留 SDL 空值语义。
    const currentUser: NonNullable<GetDashboardSessionQuery["getCurrentUser"]> =
        session.getCurrentUser;
    // @ts-expect-error UserItem.id 保留 SDL 空值语义。
    const id: string = user.id;
    // @ts-expect-error JSON 需要业务层收窄后使用。
    const data: string = record.getQueueExecutionRecord.data;
    return { currentUser, id, data };
}
