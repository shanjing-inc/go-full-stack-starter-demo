import {
    GET_DASHBOARD_SESSION,
    DASHBOARD_QUEUE_SCHEDULES,
    DASHBOARD_QUEUE,
    DASHBOARD_QUEUE_RECORDS,
    DASHBOARD_QUEUE_RECORD,
    RETRY_DASHBOARD_QUEUE_RECORD,
    DASHBOARD_USERS,
    CREATE_DASHBOARD_USER,
    UPDATE_DASHBOARD_USER,
    REVOKE_DASHBOARD_USER_SESSIONS,
    LIST_DASHBOARD_USER_SESSIONS,
    REVOKE_DASHBOARD_USER_SESSION,
} from "./graphql/admin/operations";
import type {
    GetDashboardSessionQuery,
    GetDashboardSessionQueryVariables,
    DashboardQueueSchedulesQuery,
    DashboardQueueSchedulesQueryVariables,
    DashboardQueueQuery,
    DashboardQueueQueryVariables,
    DashboardQueueRecordsQuery,
    DashboardQueueRecordsQueryVariables,
    DashboardQueueRecordQuery,
    DashboardQueueRecordQueryVariables,
    RetryDashboardQueueRecordMutation,
    RetryDashboardQueueRecordMutationVariables,
    DashboardUsersQuery,
    DashboardUsersQueryVariables,
    CreateDashboardUserMutation,
    CreateDashboardUserMutationVariables,
    UpdateDashboardUserMutation,
    UpdateDashboardUserMutationVariables,
    RevokeDashboardUserSessionsMutation,
    RevokeDashboardUserSessionsMutationVariables,
    ListDashboardUserSessionsQuery,
    ListDashboardUserSessionsQueryVariables,
    RevokeDashboardUserSessionMutation,
    RevokeDashboardUserSessionMutationVariables,
} from "./graphql/admin/generated";
import type { DashboardAdapter, DashboardSession } from "@shanjing/shadcnui-dashboard";
import { ApiError, cancelDashboardRequests, getJSON, graphql } from "./request";
export const adapter: DashboardAdapter = {
    async getSession(signal) {
        const data = await graphql<GetDashboardSessionQuery, GetDashboardSessionQueryVariables>(
            GET_DASHBOARD_SESSION,
            {},
            signal,
            true,
        );
        const user = data.getCurrentUser;
        if (user === null) return { user: null, permissions: [] };
        if (
            !user?.id ||
            !Array.isArray(data.getCurrentPermissions) ||
            data.getCurrentPermissions.some((permission) => typeof permission !== "string")
        ) {
            throw new ApiError("身份响应无效", 200, "INVALID_RESPONSE");
        }
        return {
            user: {
                id: user.id,
                name: user.name ?? "",
                email: user.email ?? "",
                avatar: user.image ?? undefined,
                role: user.role ?? undefined,
            },
            permissions: data.getCurrentPermissions,
            mode: "authenticated",
        } satisfies DashboardSession;
    },
    getSystemData<T>(resource: string, signal: AbortSignal) {
        if (resource !== "overview") throw new Error("系统数据资源无效");
        return getJSON<T>("/api/rest/demo/overview", signal);
    },
    async getQueueSchedules(signal) {
        const data = await graphql<
            DashboardQueueSchedulesQuery,
            DashboardQueueSchedulesQueryVariables
        >(DASHBOARD_QUEUE_SCHEDULES, {}, signal);
        if (
            !data.getQueueSchedules ||
            !Array.isArray(data.getQueueSchedules.schedules) ||
            !Array.isArray(data.getQueueSchedules.heartbeats)
        )
            throw new Error("计划任务响应无效");
        return data.getQueueSchedules;
    },
    async getQueueDashboard(signal) {
        const data = await graphql<DashboardQueueQuery, DashboardQueueQueryVariables>(
            DASHBOARD_QUEUE,
            {},
            signal,
        );
        return data.getQueueDashboard;
    },
    async getQueueRecords(query, signal) {
        const data = await graphql<DashboardQueueRecordsQuery, DashboardQueueRecordsQueryVariables>(
            DASHBOARD_QUEUE_RECORDS,
            {
                ...query,
                status: query.status === "all" ? "recent" : query.status,
                orderBy: query.orderBy ?? "updatedAt",
                orderDirection: query.orderDirection ?? "desc",
            },
            signal,
        );
        return data.listQueueExecutionRecords;
    },
    async getQueueRecord(recordId, signal) {
        const data = await graphql<DashboardQueueRecordQuery, DashboardQueueRecordQueryVariables>(
            DASHBOARD_QUEUE_RECORD,
            { recordId },
            signal,
        );
        return data.getQueueExecutionRecord;
    },
    async retryQueueRecord(recordId, signal) {
        const data = await graphql<
            RetryDashboardQueueRecordMutation,
            RetryDashboardQueueRecordMutationVariables
        >(RETRY_DASHBOARD_QUEUE_RECORD, { set: { recordId } }, signal);
        return data.updateQueueExecutionRecord;
    },
    async getUsers(query, signal) {
        const data = await graphql<DashboardUsersQuery, DashboardUsersQueryVariables>(
            DASHBOARD_USERS,
            query,
            signal,
        );
        if (!Array.isArray(data.listUsers)) throw new Error("用户列表响应无效");
        return data.listUsers;
    },
    async createUser(set, signal) {
        const data = await graphql<
            CreateDashboardUserMutation,
            CreateDashboardUserMutationVariables
        >(CREATE_DASHBOARD_USER, { set }, signal);
        if (!Array.isArray(data.createUser) || data.createUser.length !== 1)
            throw new Error("创建用户响应无效");
        return data.createUser;
    },
    async updateUser(id, set, signal) {
        const data = await graphql<
            UpdateDashboardUserMutation,
            UpdateDashboardUserMutationVariables
        >(UPDATE_DASHBOARD_USER, { set, where: { id: { eq: userID(id) } } }, signal);
        if (!Array.isArray(data.updateUser) || data.updateUser.length !== 1)
            throw new Error("用户已变更或不存在，请刷新列表");
        return data.updateUser;
    },
    async revokeUserSessions(userId, signal) {
        userID(userId);
        const data = await graphql<
            RevokeDashboardUserSessionsMutation,
            RevokeDashboardUserSessionsMutationVariables
        >(REVOKE_DASHBOARD_USER_SESSIONS, { userId }, signal);
        if (data.revokeUserSessions !== true) throw new Error("撤销会话响应无效");
    },
    async getUserSessions(userId, query, signal) {
        userID(userId);
        const data = await graphql<
            ListDashboardUserSessionsQuery,
            ListDashboardUserSessionsQueryVariables
        >(LIST_DASHBOARD_USER_SESSIONS, { userId, ...query }, signal);
        if (!Array.isArray(data.listUserSessions)) throw new Error("会话列表响应无效");
        return data.listUserSessions;
    },
    async revokeUserSession(userId, sessionId, signal) {
        userID(userId);
        userID(sessionId);
        const data = await graphql<
            RevokeDashboardUserSessionMutation,
            RevokeDashboardUserSessionMutationVariables
        >(REVOKE_DASHBOARD_USER_SESSION, { userId, sessionId }, signal);
        if (data.revokeUserSession !== true) throw new Error("撤销会话响应无效");
    },
    async signOut() {
        const response = await fetch("/api/auth/sign-out", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
        if (!response.ok) throw new Error("退出失败，请重试");
        cancelDashboardRequests();
        location.assign("/admin/login");
    },
};

function userID(value: string) {
    const id = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(id) || id <= 0 || id > 2147483647)
        throw new Error("用户 ID 无效");
    return id;
}
