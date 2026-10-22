// 自动生成：运行 pnpm codegen 更新，请通过 SDL 和操作源文件修改。
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
    T | { [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never };
export type CreateShopSetInput = {
    name: string;
    slug: string;
    status?: string | null | undefined;
};

export type CreateUserSetInput = {
    email: string;
    name: string;
    password: string;
    role?: string | null | undefined;
};

export type InitializeAdminInput = {
    bootstrapToken: string;
    email: string;
    name: string;
    password: string;
};

export type IntFilters = {
    eq?: number | null | undefined;
    gt?: number | null | undefined;
    gte?: number | null | undefined;
    inArray?: Array<number> | null | undefined;
    isNotNull?: boolean | null | undefined;
    isNull?: boolean | null | undefined;
    lt?: number | null | undefined;
    lte?: number | null | undefined;
    ne?: number | null | undefined;
    notInArray?: Array<number> | null | undefined;
};

export type QueueExecutionRecordSetInput = {
    recordId: string;
    statusHint?: string | null | undefined;
};

export type ShopFilters = {
    id?: IntFilters | null | undefined;
    slug?: StringFilters | null | undefined;
    status?: StringFilters | null | undefined;
};

export type SignInWithEmailInput = {
    email: string;
    password: string;
};

export type StringFilters = {
    eq?: string | null | undefined;
    gt?: string | null | undefined;
    gte?: string | null | undefined;
    ilike?: string | null | undefined;
    inArray?: Array<string> | null | undefined;
    isNotNull?: boolean | null | undefined;
    isNull?: boolean | null | undefined;
    like?: string | null | undefined;
    lt?: string | null | undefined;
    lte?: string | null | undefined;
    ne?: string | null | undefined;
    notIlike?: string | null | undefined;
    notInArray?: Array<string> | null | undefined;
    notLike?: string | null | undefined;
};

export type UpdateUserSetInput = {
    banExpires?: string | null | undefined;
    banReason?: string | null | undefined;
    banned?: boolean | null | undefined;
    name?: string | null | undefined;
    role?: string | null | undefined;
};

export type UserFilters = {
    banned?: boolean | null | undefined;
    email?: StringFilters | null | undefined;
    emailVerified?: boolean | null | undefined;
    id?: IntFilters | null | undefined;
    role?: StringFilters | null | undefined;
};

export type DashboardUserFieldsFragment = {
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

export type DashboardQueueRecordFieldsFragment = {
    id: string;
    jobId: string;
    name: string;
    queueName: string;
    executionNumber: number;
    state: string;
    statusHint: string;
    sortAt: number;
    queuedAt: number | null;
    processedAt: number | null;
    finishedAt: number | null;
    runtimeMs: number | null;
    attempts: number;
    retryOfRecordId: string | null;
    latestRecordId: string;
    currentJobState: string;
    canRetry: boolean;
    retryDisabledReason: string;
    data: unknown;
    returnValue: unknown;
    opts: unknown;
    meta: unknown;
    failedReason: string;
    stacktrace: Array<string>;
};

export type GetDashboardOverviewQueryVariables = Exact<{ [key: string]: never }>;

export type GetDashboardOverviewQuery = {
    getDashboardOverview: { shops: number; backend: string; mode: string };
};

export type GetDashboardSessionQueryVariables = Exact<{ [key: string]: never }>;

export type GetDashboardSessionQuery = {
    getCurrentPermissions: Array<string>;
    getCurrentUser: {
        id: string | null;
        name: string | null;
        email: string | null;
        image: string | null;
        role: string | null;
    } | null;
};

export type DashboardQueueSchedulesQueryVariables = Exact<{ [key: string]: never }>;

export type DashboardQueueSchedulesQuery = {
    getQueueSchedules: {
        scheduleCount: number;
        schedulerInstanceCount: number;
        schedulerLeader: string | null;
        updatedAt: number;
        schedules: Array<{
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
        }>;
        heartbeats: Array<{ instanceId: string; lastHeartbeatAt: number; role: string }>;
    };
};

export type DashboardQueueQueryVariables = Exact<{ [key: string]: never }>;

export type DashboardQueueQuery = {
    getQueueDashboard: {
        updatedAt: number;
        queueCount: number;
        hasOnlineWorkers: boolean;
        capabilities: {
            supportsWorkerPresence: boolean;
            supportsPauseState: boolean;
            supportsSchedules: boolean;
            supportsRetry: boolean;
        };
        overview: {
            onlineWorkers: number;
            waiting: number;
            active: number;
            delayed: number;
            retrying: number;
            failed: number;
            completed: number;
            succeededExecutions24h: number;
            failedExecutions24h: number;
        };
        queues: Array<{
            queueName: string;
            physicalQueueName: string | null;
            concurrency: number | null;
            workerProcessName: string | null;
            workerProcessGroup: string | null;
            workerCount: number;
            isListening: boolean;
            isPaused: boolean;
            waiting: number;
            active: number;
            delayed: number;
            retrying: number;
            failed: number;
            completed: number;
            succeededExecutions24h: number;
            failedExecutions24h: number;
        }>;
        workerProcesses: Array<{
            name: string;
            processGroup: string;
            queues: Array<string>;
            instances: number | null;
            concurrency: number | null;
            onlineInstances: number;
            maxMemory: string;
            memoryBytes: number | null;
            isOnline: boolean;
        }>;
    };
};

export type DashboardQueueRecordsQueryVariables = Exact<{
    status: string;
    orderBy?: string | null | undefined;
    orderDirection?: string | null | undefined;
    queueName?: string | null | undefined;
    jobName?: string | null | undefined;
    from?: number | null | undefined;
    to?: number | null | undefined;
    limit?: number | null | undefined;
    offset?: number | null | undefined;
}>;

export type DashboardQueueRecordsQuery = {
    listQueueExecutionRecords: {
        total: number;
        records: Array<{
            id: string;
            jobId: string;
            jobName: string;
            queueName: string;
            physicalQueueName: string | null;
            executionNumber: number;
            status: string;
            sortAt: number;
            queuedAt: number | null;
            processedAt: number | null;
            finishedAt: number | null;
            runtimeMs: number | null;
        }>;
    };
};

export type DashboardQueueRecordQueryVariables = Exact<{
    recordId: string;
}>;

export type DashboardQueueRecordQuery = {
    getQueueExecutionRecord: {
        id: string;
        jobId: string;
        name: string;
        queueName: string;
        executionNumber: number;
        state: string;
        statusHint: string;
        sortAt: number;
        queuedAt: number | null;
        processedAt: number | null;
        finishedAt: number | null;
        runtimeMs: number | null;
        attempts: number;
        retryOfRecordId: string | null;
        latestRecordId: string;
        currentJobState: string;
        canRetry: boolean;
        retryDisabledReason: string;
        data: unknown;
        returnValue: unknown;
        opts: unknown;
        meta: unknown;
        failedReason: string;
        stacktrace: Array<string>;
    };
};

export type RetryDashboardQueueRecordMutationVariables = Exact<{
    set: QueueExecutionRecordSetInput;
}>;

export type RetryDashboardQueueRecordMutation = {
    updateQueueExecutionRecord: {
        noticeMessage: string;
        detail: {
            id: string;
            jobId: string;
            name: string;
            queueName: string;
            executionNumber: number;
            state: string;
            statusHint: string;
            sortAt: number;
            queuedAt: number | null;
            processedAt: number | null;
            finishedAt: number | null;
            runtimeMs: number | null;
            attempts: number;
            retryOfRecordId: string | null;
            latestRecordId: string;
            currentJobState: string;
            canRetry: boolean;
            retryDisabledReason: string;
            data: unknown;
            returnValue: unknown;
            opts: unknown;
            meta: unknown;
            failedReason: string;
            stacktrace: Array<string>;
        };
    };
};

export type DashboardUsersQueryVariables = Exact<{
    where?: UserFilters | null | undefined;
    limit?: number | null | undefined;
    offset?: number | null | undefined;
}>;

export type DashboardUsersQuery = {
    listUsers: Array<{
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
    }> | null;
};

export type CreateDashboardUserMutationVariables = Exact<{
    set: CreateUserSetInput;
}>;

export type CreateDashboardUserMutation = {
    createUser: Array<{
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
    }>;
};

export type UpdateDashboardUserMutationVariables = Exact<{
    set: UpdateUserSetInput;
    where: UserFilters;
}>;

export type UpdateDashboardUserMutation = {
    updateUser: Array<{
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
    }>;
};

export type RevokeDashboardUserSessionsMutationVariables = Exact<{
    userId: string | number;
}>;

export type RevokeDashboardUserSessionsMutation = { revokeUserSessions: boolean };

export type ListDashboardUserSessionsQueryVariables = Exact<{
    userId: string | number;
    limit: number;
    offset: number;
}>;

export type ListDashboardUserSessionsQuery = {
    listUserSessions: Array<{
        id: string;
        userId: string;
        ipAddress: string | null;
        userAgent: string | null;
        createdAt: string;
        updatedAt: string;
        expiresAt: string;
        current: boolean;
    }>;
};

export type RevokeDashboardUserSessionMutationVariables = Exact<{
    userId: string | number;
    sessionId: string | number;
}>;

export type RevokeDashboardUserSessionMutation = { revokeUserSession: boolean };

export type CreateAdminShopMutationVariables = Exact<{
    set: CreateShopSetInput;
}>;

export type CreateAdminShopMutation = {
    createShop: {
        id: string | null;
        name: string | null;
        slug: string | null;
        status: string | null;
        createdAt: string | null;
        updatedAt: string | null;
    };
};

export type ListAdminShopsQueryVariables = Exact<{
    where?: ShopFilters | null | undefined;
    limit?: number | null | undefined;
    offset?: number | null | undefined;
}>;

export type ListAdminShopsQuery = {
    listShops: Array<{
        id: string | null;
        name: string | null;
        slug: string | null;
        status: string | null;
        createdAt: string | null;
        updatedAt: string | null;
    }> | null;
};

export type GetInstallStatusQueryVariables = Exact<{ [key: string]: never }>;

export type GetInstallStatusQuery = { getInstallStatus: { installed: boolean; enabled: boolean } };

export type InitializeAdminMutationVariables = Exact<{
    input: InitializeAdminInput;
}>;

export type InitializeAdminMutation = {
    initializeAdmin: { id: string | null; email: string | null };
};

export type SignInWithEmailMutationVariables = Exact<{
    input: SignInWithEmailInput;
}>;

export type SignInWithEmailMutation = {
    signInWithEmail: { id: string | null; email: string | null };
};

export type SignOutMutationVariables = Exact<{ [key: string]: never }>;

export type SignOutMutation = { signOut: boolean };
