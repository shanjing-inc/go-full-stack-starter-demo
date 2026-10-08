import type {
    DashboardAdapter,
    DashboardSession,
    DashboardUserItem,
    DashboardUserSessionItem,
    DashboardQueueOverview,
    DashboardQueueSchedules,
    DashboardQueueRecords,
    DashboardQueueRecord,
} from "@shanjing/shadcnui-dashboard";
import { ApiError, cancelDashboardRequests, getJSON, graphql } from "./request";
export const adapter: DashboardAdapter = {
    async getSession(signal) {
        const data = await graphql<{
            getCurrentUser: {
                id: string;
                name: string;
                email: string;
                image: string | null;
                role: string | null;
            } | null;
            getCurrentPermissions: string[];
        }>(
            `
                query getDashboardSession {
                    getCurrentUser {
                        id
                        name
                        email
                        image
                        role
                    }
                    getCurrentPermissions
                }
            `,
            {},
            signal,
            true,
        );
        if (data.getCurrentUser === null) return { user: null, permissions: [] };
        if (
            !data.getCurrentUser?.id ||
            !Array.isArray(data.getCurrentPermissions) ||
            data.getCurrentPermissions.some((permission) => typeof permission !== "string")
        ) {
            throw new ApiError("身份响应无效", 200, "INVALID_RESPONSE");
        }
        const user = data.getCurrentUser;
        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
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
        const data = await graphql<{ getQueueSchedules: DashboardQueueSchedules }>(
            `
                query dashboardQueueSchedules {
                    getQueueSchedules {
                        scheduleCount
                        schedulerInstanceCount
                        schedulerLeader
                        updatedAt
                        schedules {
                            name
                            cron
                            timezone
                            jobName
                            queueName
                            description
                            enabled
                            nextRunAt
                            lastActivityAt
                            status
                            statusText
                        }
                        heartbeats {
                            instanceId
                            lastHeartbeatAt
                            role
                        }
                    }
                }
            `,
            {},
            signal,
        );
        if (
            !data.getQueueSchedules ||
            !Array.isArray(data.getQueueSchedules.schedules) ||
            !Array.isArray(data.getQueueSchedules.heartbeats)
        )
            throw new Error("计划任务响应无效");
        return data.getQueueSchedules;
    },
    async getQueueDashboard(signal) {
        const data = await graphql<{ getQueueDashboard: DashboardQueueOverview }>(
            `query dashboardQueue { getQueueDashboard { updatedAt queueCount hasOnlineWorkers capabilities { supportsWorkerPresence supportsPauseState supportsSchedules supportsRetry } overview { onlineWorkers ${queueCounts} } queues { queueName physicalQueueName concurrency workerProcessName workerProcessGroup workerCount isListening isPaused ${queueCounts} } workerProcesses {name processGroup queues instances concurrency onlineInstances maxMemory memoryBytes isOnline} } }`,
            {},
            signal,
        );
        return data.getQueueDashboard;
    },
    async getQueueRecords(query, signal) {
        const data = await graphql<{ listQueueExecutionRecords: DashboardQueueRecords }>(
            `
                query dashboardQueueRecords(
                    $status: String!
                    $orderBy: String
                    $orderDirection: String
                    $queueName: String
                    $jobName: String
                    $from: Float
                    $to: Float
                    $limit: Int
                    $offset: Int
                ) {
                    listQueueExecutionRecords(
                        status: $status
                        queueName: $queueName
                        jobName: $jobName
                        from: $from
                        to: $to
                        limit: $limit
                        offset: $offset
                        orderBy: $orderBy
                        orderDirection: $orderDirection
                    ) {
                        total
                        records {
                            id
                            jobId
                            jobName
                            queueName
                            physicalQueueName
                            executionNumber
                            status
                            sortAt
                            queuedAt
                            processedAt
                            finishedAt
                            runtimeMs
                        }
                    }
                }
            `,
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
        const data = await graphql<{ getQueueExecutionRecord: DashboardQueueRecord }>(
            `query dashboardQueueRecord($recordId:String!) { getQueueExecutionRecord(recordId:$recordId) { ${queueRecordFields} } }`,
            { recordId },
            signal,
        );
        return data.getQueueExecutionRecord;
    },
    async retryQueueRecord(recordId, signal) {
        const data = await graphql<{
            updateQueueExecutionRecord: { detail: DashboardQueueRecord; noticeMessage: string };
        }>(
            `mutation retryDashboardQueueRecord($set:QueueExecutionRecordSetInput!) {updateQueueExecutionRecord(set:$set) {noticeMessage detail { ${queueRecordFields} }}}`,
            { set: { recordId } },
            signal,
        );
        return data.updateQueueExecutionRecord;
    },
    async getUsers(query, signal) {
        const data = await graphql<{ listUsers: DashboardUserItem[] }>(
            `
                query dashboardUsers($where: UserFilters, $limit: Int, $offset: Int) {
                    listUsers(
                        where: $where
                        limit: $limit
                        offset: $offset
                        orderBy: { createdAt: { direction: desc, priority: 1 } }
                    ) {
                        id
                        name
                        email
                        image
                        role
                        emailVerified
                        banned
                        banReason
                        banExpires
                        createdAt
                        updatedAt
                    }
                }
            `,
            query,
            signal,
        );
        if (!Array.isArray(data.listUsers)) throw new Error("用户列表响应无效");
        return data.listUsers;
    },
    async createUser(set, signal) {
        const data = await graphql<{ createUser: DashboardUserItem[] }>(
            `
            mutation createDashboardUser($set: CreateUserSetInput!) {
                createUser(set: $set) { ${userFields} }
            }
        `,
            { set },
            signal,
        );
        if (!Array.isArray(data.createUser) || data.createUser.length !== 1)
            throw new Error("创建用户响应无效");
        return data.createUser;
    },
    async updateUser(id, set, signal) {
        const data = await graphql<{ updateUser: DashboardUserItem[] }>(
            `
            mutation updateDashboardUser($set: UpdateUserSetInput!, $where: UserFilters!) {
                updateUser(set: $set, where: $where) { ${userFields} }
            }
        `,
            { set, where: { id: { eq: userID(id) } } },
            signal,
        );
        if (!Array.isArray(data.updateUser) || data.updateUser.length !== 1)
            throw new Error("用户已变更或不存在，请刷新列表");
        return data.updateUser;
    },
    async revokeUserSessions(userId, signal) {
        userID(userId);
        const data = await graphql<{ revokeUserSessions: boolean }>(
            `
                mutation revokeDashboardUserSessions($userId: ID!) {
                    revokeUserSessions(userId: $userId)
                }
            `,
            { userId },
            signal,
        );
        if (data.revokeUserSessions !== true) throw new Error("撤销会话响应无效");
    },
    async getUserSessions(userId, query, signal) {
        userID(userId);
        const data = await graphql<{ listUserSessions: DashboardUserSessionItem[] }>(
            `
                query listDashboardUserSessions($userId: ID!, $limit: Int!, $offset: Int!) {
                    listUserSessions(userId: $userId, limit: $limit, offset: $offset) {
                        id
                        userId
                        ipAddress
                        userAgent
                        createdAt
                        updatedAt
                        expiresAt
                        current
                    }
                }
            `,
            { userId, ...query },
            signal,
        );
        if (!Array.isArray(data.listUserSessions)) throw new Error("会话列表响应无效");
        return data.listUserSessions;
    },
    async revokeUserSession(userId, sessionId, signal) {
        userID(userId);
        userID(sessionId);
        const data = await graphql<{ revokeUserSession: boolean }>(
            `
                mutation revokeDashboardUserSession($userId: ID!, $sessionId: ID!) {
                    revokeUserSession(userId: $userId, sessionId: $sessionId)
                }
            `,
            { userId, sessionId },
            signal,
        );
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

const userFields = `id name email image role emailVerified banned banReason banExpires createdAt updatedAt`;
function userID(value: string) {
    const id = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(id) || id <= 0 || id > 2147483647)
        throw new Error("用户 ID 无效");
    return id;
}

const queueCounts = `waiting active delayed retrying failed completed succeededExecutions24h failedExecutions24h`;
const queueRecordFields = `id jobId name queueName executionNumber state statusHint sortAt queuedAt processedAt finishedAt runtimeMs attempts retryOfRecordId latestRecordId currentJobState canRetry retryDisabledReason data returnValue opts meta failedReason stacktrace`;
