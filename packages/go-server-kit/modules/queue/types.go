// Package queue 提供 Redis 执行历史、后台查询与 Asynq 原任务重试。
package queue

import (
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "github.com/hibiken/asynq"
)

// Record 的内部快照保留原始参数；外部读取统一经过安全投影。
type Record struct {
    ID                  string   `json:"id"`
    JobID               string   `json:"jobId"`
    JobName             string   `json:"jobName"`
    Name                string   `json:"name"`
    QueueName           string   `json:"queueName"`
    PhysicalQueueName   string   `json:"physicalQueueName"`
    ExecutionNumber     int      `json:"executionNumber"`
    RetryOfRecordID     *string  `json:"retryOfRecordId"`
    LatestRecordID      string   `json:"latestRecordId"`
    Status              string   `json:"status"`
    State               string   `json:"state"`
    StatusHint          string   `json:"statusHint"`
    CreatedAt           float64  `json:"createdAt"`
    SortAt              float64  `json:"sortAt"`
    QueuedAt            *float64 `json:"queuedAt"`
    ProcessedAt         *float64 `json:"processedAt"`
    FinishedAt          *float64 `json:"finishedAt"`
    RuntimeMs           *float64 `json:"runtimeMs"`
    Attempts            int      `json:"attempts"`
    Data                any      `json:"data"`
    ReturnValue         any      `json:"returnValue"`
    Opts                any      `json:"opts"`
    Meta                any      `json:"meta"`
    FailedReason        string   `json:"failedReason"`
    Stacktrace          []string `json:"stacktrace"`
    CurrentJobState     string   `json:"currentJobState"`
    CanRetry            bool     `json:"canRetry"`
    RetryDisabledReason string   `json:"retryDisabledReason"`
    Manual              bool     `json:"manual"`
    Interrupted         bool     `json:"interrupted,omitempty"`
}

// Audit 保存人工重试的请求、操作人、原记录与新记录及安排结果。
type Audit struct {
    RequestID   string  `json:"requestId"`
    ID          string  `json:"id"`
    ActorID     string  `json:"actorId"`
    ActorName   string  `json:"actorName"`
    At          float64 `json:"at"`
    JobID       string  `json:"jobId"`
    RecordID    string  `json:"recordId"`
    NewRecordID string  `json:"newRecordId"`
    Outcome     string  `json:"outcome"`
    Reason      string  `json:"reason"`
}

// ListQuery 描述历史列表筛选、分页及毫秒时间范围；零 limit 使用默认值。
type ListQuery struct {
    Status, QueueName, JobName string
    OrderBy, OrderDirection    string
    Limit, Offset              int
    From, To                   *float64
}

// RecordsPayload 返回安全投影记录与分页统计，IsRecentPage 表示最近活动页。
type RecordsPayload struct {
    Records              []*Record
    Total, Limit, Offset int
    Status               string
    UpdatedAt            float64
    IsRecentPage         bool
}

// Capabilities 声明当前队列适配器支持的后台操作与在线观测能力。
type Capabilities struct{ SupportsPauseState, SupportsRetry, SupportsSchedules, SupportsWorkerPresence bool }

// Overview 汇总当前任务状态、在线消费进程及近 24 小时执行次数。
type Overview struct {
    Waiting, Active, Delayed, Retrying, Failed, Completed, OnlineWorkers int
    SucceededExecutions24h, FailedExecutions24h                          int
}

// WorkerProcess 聚合同组消费进程；空并发或内存采样表示当前无法提供统一数值。
type WorkerProcess struct {
    Name, ProcessGroup, MaxMemory string
    Instances, Concurrency        *int
    OnlineInstances               int
    IsOnline                      bool
    MemoryBytes                   *float64
    Queues                        []string
}

// Snapshot 提供逻辑队列的原生状态统计、消费绑定和执行次数。
type Snapshot struct {
    Binding, MaxMemory, WorkerProcessGroup, WorkerProcessName *string
    Concurrency                                               *int
    QueueName, PhysicalQueueName, Description                 string
    Waiting, Active, Delayed, Retrying, Failed, Completed     int
    SucceededExecutions24h, FailedExecutions24h               int
    IsListening, IsPaused                                     bool
    WorkerCount                                               int
}

// DashboardPayload 组合后台能力、队列快照、进程及整体在线状态。
type DashboardPayload struct {
    Capabilities     *Capabilities
    Overview         *Overview
    Queues           []*Snapshot
    QueueCount       int
    UpdatedAt        float64
    WorkerProcesses  []*WorkerProcess
    HasOnlineWorkers bool
}

// Inspector 保留 Asynq 原生状态操作，便于隔离测试与生产注入。
type Inspector interface {
    Queues() ([]string, error)
    GetTaskInfo(string, string) (*asynq.TaskInfo, error)
    GetQueueInfo(string) (*asynq.QueueInfo, error)
    RunTask(string, string) error
}

func bad(message string) error { return &httperr.Error{Code: "BAD_USER_INPUT", Message: message} }

func conflict(message string) error { return &httperr.Error{Code: "CONFLICT", Message: message} }

func unavailable() error {
    return &httperr.Error{Code: "SERVICE_UNAVAILABLE", Message: "队列服务暂时不可用"}
}

func milliseconds(t time.Time) float64 { return float64(t.UnixMilli()) }

func number(v float64) *float64 { return &v }
