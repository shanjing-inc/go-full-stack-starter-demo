/** 会话、权限和系统数据由应用接入；身份校验在服务端执行。 */
export type DashboardUser = {
    id: string;
    name: string;
    email: string;
    avatar?: string;
    role?: string;
};
export type DashboardSession = { user: DashboardUser | null; permissions: string[]; mode?: string };
export interface DashboardAdapter {
    getQueueSchedules?(signal: AbortSignal): Promise<DashboardQueueSchedules>;
    getQueueDashboard?(signal: AbortSignal): Promise<DashboardQueueOverview>;
    getQueueRecords?(
        query: DashboardQueueQuery,
        signal: AbortSignal,
    ): Promise<DashboardQueueRecords>;
    getQueueRecord?(recordId: string, signal: AbortSignal): Promise<DashboardQueueRecord>;
    retryQueueRecord?(
        recordId: string,
        signal: AbortSignal,
    ): Promise<{ detail: DashboardQueueRecord; noticeMessage: string }>;
    getSession(signal: AbortSignal): Promise<DashboardSession>;
    getSystemData<T>(resource: string, signal: AbortSignal): Promise<T>;
    signOut(): Promise<void>;
    createUser?(input: DashboardCreateUserInput, signal: AbortSignal): Promise<DashboardUserItem[]>;
    updateUser?(
        id: string,
        input: DashboardUpdateUserInput,
        signal: AbortSignal,
    ): Promise<DashboardUserItem[]>;
    getUserSessions?(
        id: string,
        query: { limit: number; offset: number },
        signal: AbortSignal,
    ): Promise<DashboardUserSessionItem[]>;
    revokeUserSession?(userId: string, sessionId: string, signal: AbortSignal): Promise<void>;
    revokeUserSessions?(id: string, signal: AbortSignal): Promise<void>;
    getUsers?(query: DashboardUserListQuery, signal: AbortSignal): Promise<DashboardUserItem[]>;
}

/** 用户管理查询契约；业务应用负责 GraphQL/REST 传输及服务端权限。 */
export type DashboardUserItem = {
    id: string | null;
    name: string | null;
    email: string | null;
    image: string | null;
    role: string | null;
    emailVerified: boolean | null;
    banned: boolean | null;
    banReason: string | null;
    banExpires: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};
export type DashboardUserListQuery = {
    limit: number;
    offset: number;
    where: {
        email?: { like: string };
        role?: { eq: string };
        banned?: boolean;
        emailVerified?: boolean;
    };
};

export type DashboardCreateUserInput = {
    name: string;
    email: string;
    password: string;
    role?: string;
};
export type DashboardUpdateUserInput = {
    name?: string;
    role?: string;
    banned?: boolean;
    banReason?: string | null;
    banExpires?: string | null;
};

/** 有效会话的安全投影，凭据由服务端管理。 */
export type DashboardUserSessionItem = {
    id: string;
    userId: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    current: boolean;
};

/** 队列快照区分当前任务数量和最近 24 小时执行次数，时间采用 Unix 毫秒。 */
export type DashboardQueueCounts = {
    waiting: number;
    active: number;
    delayed: number;
    retrying: number;
    failed: number;
    completed: number;
    succeededExecutions24h: number;
    failedExecutions24h: number;
};
export type DashboardQueueOverview = {
    overview: DashboardQueueCounts & { onlineWorkers: number };
    capabilities: {
        supportsWorkerPresence: boolean;
        supportsPauseState: boolean;
        supportsSchedules: boolean;
        supportsRetry: boolean;
    };
    queueCount: number;
    hasOnlineWorkers: boolean;
    queues: (DashboardQueueCounts & {
        queueName: string;
        physicalQueueName: string | null;
        concurrency: number | null;
        workerProcessName: string | null;
        workerProcessGroup: string | null;
        workerCount: number;
        isListening: boolean;
        isPaused: boolean;
    })[];
    workerProcesses: {
        name: string;
        processGroup: string;
        queues: string[];
        instances: number | null;
        concurrency?: number | null;
        onlineInstances: number;
        maxMemory: string;
        memoryBytes: number | null;
        isOnline: boolean;
    }[];
    updatedAt: number;
};
export type DashboardQueueQuery = {
    status: string;
    orderBy?: "updatedAt" | "sortAt" | "createdAt";
    orderDirection?: "asc" | "desc";
    queueName?: string;
    jobName?: string;
    from?: number;
    to?: number;
    limit: number;
    offset: number;
};
export type DashboardQueueSummary = {
    id: string;
    jobId: string;
    jobName: string;
    queueName: string;
    physicalQueueName?: string | null;
    status: string;
    executionNumber: number;
    sortAt: number;
    queuedAt: number | null;
    processedAt: number | null;
    finishedAt: number | null;
    runtimeMs: number | null;
};
export type DashboardQueueRecords = { records: DashboardQueueSummary[]; total: number };
export type DashboardQueueRecord = Omit<DashboardQueueSummary, "status" | "jobName"> & {
    name: string;
    state: string;
    statusHint: string;
    latestRecordId: string;
    retryOfRecordId: string | null;
    currentJobState: string;
    canRetry: boolean;
    retryDisabledReason: string;
    data: unknown;
    returnValue: unknown;
    opts: unknown;
    meta: unknown;
    failedReason: string;
    stacktrace: string[];
    attempts: number;
};

/** 代码注册的计划与调度运行信息，时间为 Unix 毫秒。 */
export type DashboardQueueSchedules = {
    scheduleCount: number;
    schedulerInstanceCount: number;
    schedulerLeader: string | null;
    updatedAt: number;
    schedules: {
        name: string;
        cron: string;
        timezone: string;
        jobName: string;
        queueName: string;
        description: string;
        enabled: boolean;
        nextRunAt: number | null;
        lastActivityAt: number | null;
        status: string;
        statusText: string;
    }[];
    heartbeats: {
        instanceId: string;
        lastHeartbeatAt: number;
        role: string;
    }[];
};
