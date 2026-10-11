// 操作选择与 SDL 同步；运行时片段随引用它的操作一起发送。
// 含片段的操作先声明静态模板，保证 Codegen 可抽取，再在导出时拼接片段。
const USER_FIELDS = /* GraphQL */ `
    fragment DashboardUserFields on UserItem {
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
`;
const QUEUE_RECORD_FIELDS = /* GraphQL */ `
    fragment DashboardQueueRecordFields on QueueExecutionRecord {
        id
        jobId
        name
        queueName
        executionNumber
        state
        statusHint
        sortAt
        queuedAt
        processedAt
        finishedAt
        runtimeMs
        attempts
        retryOfRecordId
        latestRecordId
        currentJobState
        canRetry
        retryDisabledReason
        data
        returnValue
        opts
        meta
        failedReason
        stacktrace
    }
`;
export const GET_DASHBOARD_SESSION = /* GraphQL */ `
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
`;

export const DASHBOARD_QUEUE_SCHEDULES = /* GraphQL */ `
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
`;

export const DASHBOARD_QUEUE = /* GraphQL */ `
    query dashboardQueue {
        getQueueDashboard {
            updatedAt
            queueCount
            hasOnlineWorkers
            capabilities {
                supportsWorkerPresence
                supportsPauseState
                supportsSchedules
                supportsRetry
            }
            overview {
                onlineWorkers
                waiting
                active
                delayed
                retrying
                failed
                completed
                succeededExecutions24h
                failedExecutions24h
            }
            queues {
                queueName
                physicalQueueName
                concurrency
                workerProcessName
                workerProcessGroup
                workerCount
                isListening
                isPaused
                waiting
                active
                delayed
                retrying
                failed
                completed
                succeededExecutions24h
                failedExecutions24h
            }
            workerProcesses {
                name
                processGroup
                queues
                instances
                concurrency
                onlineInstances
                maxMemory
                memoryBytes
                isOnline
            }
        }
    }
`;

export const DASHBOARD_QUEUE_RECORDS = /* GraphQL */ `
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
`;

const DASHBOARD_QUEUE_RECORD_DOCUMENT = /* GraphQL */ `
    query dashboardQueueRecord($recordId: String!) {
        getQueueExecutionRecord(recordId: $recordId) {
            ...DashboardQueueRecordFields
        }
    }
`;
export const DASHBOARD_QUEUE_RECORD = DASHBOARD_QUEUE_RECORD_DOCUMENT.concat(
    "\n",
    QUEUE_RECORD_FIELDS,
);

const RETRY_DASHBOARD_QUEUE_RECORD_DOCUMENT = /* GraphQL */ `
    mutation retryDashboardQueueRecord($set: QueueExecutionRecordSetInput!) {
        updateQueueExecutionRecord(set: $set) {
            noticeMessage
            detail {
                ...DashboardQueueRecordFields
            }
        }
    }
`;
export const RETRY_DASHBOARD_QUEUE_RECORD = RETRY_DASHBOARD_QUEUE_RECORD_DOCUMENT.concat(
    "\n",
    QUEUE_RECORD_FIELDS,
);

export const DASHBOARD_USERS = /* GraphQL */ `
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
`;

const CREATE_DASHBOARD_USER_DOCUMENT = /* GraphQL */ `
    mutation createDashboardUser($set: CreateUserSetInput!) {
        createUser(set: $set) {
            ...DashboardUserFields
        }
    }
`;
export const CREATE_DASHBOARD_USER = CREATE_DASHBOARD_USER_DOCUMENT.concat("\n", USER_FIELDS);

const UPDATE_DASHBOARD_USER_DOCUMENT = /* GraphQL */ `
    mutation updateDashboardUser($set: UpdateUserSetInput!, $where: UserFilters!) {
        updateUser(set: $set, where: $where) {
            ...DashboardUserFields
        }
    }
`;
export const UPDATE_DASHBOARD_USER = UPDATE_DASHBOARD_USER_DOCUMENT.concat("\n", USER_FIELDS);

export const REVOKE_DASHBOARD_USER_SESSIONS = /* GraphQL */ `
    mutation revokeDashboardUserSessions($userId: ID!) {
        revokeUserSessions(userId: $userId)
    }
`;

export const LIST_DASHBOARD_USER_SESSIONS = /* GraphQL */ `
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
`;

export const REVOKE_DASHBOARD_USER_SESSION = /* GraphQL */ `
    mutation revokeDashboardUserSession($userId: ID!, $sessionId: ID!) {
        revokeUserSession(userId: $userId, sessionId: $sessionId)
    }
`;

export const CREATE_ADMIN_SHOP = /* GraphQL */ `
    mutation createAdminShop($set: CreateShopSetInput!) {
        createShop(set: $set) {
            id
            name
            slug
            status
            createdAt
            updatedAt
        }
    }
`;

export const LIST_ADMIN_SHOPS = /* GraphQL */ `
    query listAdminShops($where: ShopFilters, $limit: Int, $offset: Int) {
        listShops(
            where: $where
            limit: $limit
            offset: $offset
            orderBy: { createdAt: { direction: desc, priority: 1 } }
        ) {
            id
            name
            slug
            status
            createdAt
            updatedAt
        }
    }
`;
