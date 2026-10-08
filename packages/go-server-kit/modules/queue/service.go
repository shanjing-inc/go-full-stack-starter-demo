// Package queue 汇总队列执行历史、人工重试与后台状态，公开数据经安全投影。
package queue

import (
    "context"
    "encoding/json"
    "errors"
    "slices"
    "strings"
    "time"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/schedule"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/httperr"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/transport/requestmeta"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

// Service 结合原生队列检查器与 Redis 独立历史，维护执行链、后台安全投影和重试审计。
type Service struct {
    redis     *redis.Client
    inspector Inspector
    config    infra.Config
    prefix    string
    retention time.Duration
    now       func() time.Time
    schedules []schedule.Definition
}

// New 校验依赖、保留期与唯一调度名，复制调度定义并建立版本化历史命名空间。
func New(r *redis.Client, inspector Inspector, config infra.Config, retention time.Duration, definitions ...schedule.Definition) (*Service, error) {
    if r == nil || inspector == nil || config.Validate() != nil || retention < time.Hour || retention > 365*24*time.Hour {
        return nil, errors.New("执行记录配置无效")
    }

    seen := map[string]bool{}
    for _, d := range definitions {
        if _, err := d.Parse(); err != nil {
            return nil, err
        }
        if seen[d.Name] {
            return nil, errors.New("计划任务名称重复")
        }

        seen[d.Name] = true
    }

    return &Service{
        schedules: slices.Clone(definitions),
        redis:     r,
        inspector: inspector,
        config:    config,
        prefix:    config.Namespace + ":queue-records:v1:",
        retention: retention,
        now:       time.Now,
    }, nil
}

// template 把原生任务转换为执行记录模板，保留 JSON 载荷及原生重试选项。
func (s *Service) template(info *asynq.TaskInfo) *Record {
    var data any
    if json.Unmarshal(info.Payload, &data) != nil {
        data = string(info.Payload)
    }

    now := milliseconds(s.now())
    return &Record{
        JobID:             info.ID,
        JobName:           info.Type,
        Name:              info.Type,
        QueueName:         strings.TrimPrefix(info.Queue, s.config.Namespace+"-"),
        PhysicalQueueName: info.Queue,
        Data:              data,
        QueuedAt:          &now,
        Attempts:          info.Retried,
        Opts: map[string]any{
            "maxRetry":    info.MaxRetry,
            "timeoutMs":   info.Timeout.Milliseconds(),
            "retentionMs": info.Retention.Milliseconds(),
        },
        Stacktrace: []string{},
    }
}

// Enqueued 幂等建立初始执行记录，Worker 已先行建立任务链时复用现有链。
func (s *Service) Enqueued(ctx context.Context, info *asynq.TaskInfo) error {
    base := s.template(info)
    key := s.taskKey(base)
    return s.change(ctx, key, func(tx *redis.Tx, meta map[string]string) error {
        // Worker 可能已先行建立记录；以现有任务链为准。
        if meta["latest"] != "" {
            return nil
        }

        r := nextRecord(base, meta, s.now())
        if info.State == asynq.TaskStateScheduled {
            r.Status = "delayed"
            r.State = "delayed"
            r.StatusHint = "delayed"
        }

        _, err := tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
            s.save(ctx, p, r, "")
            p.HSet(ctx, key, "latest", r.ID, "pending", r.ID, "sequence", r.ExecutionNumber)
            return nil
        })
        return err
    })
}

// Get 读取指定历史并结合原任务状态计算重试能力，返回前执行敏感字段脱敏。
func (s *Service) Get(ctx context.Context, id string) (*Record, error) {
    r, err := s.raw(ctx, id)
    if _, ok := err.(*recordMissing); ok {
        return nil, &httperr.Error{Code: "NOT_FOUND", Message: err.Error()}
    }
    if err != nil {
        return nil, err
    }

    latest, err := s.redis.HGet(ctx, s.taskKey(r), "latest").Result()
    if err != nil {
        return nil, unavailable()
    }

    r.LatestRecordID = latest
    info, err := s.inspector.GetTaskInfo(r.PhysicalQueueName, r.JobID)
    switch {
    case errors.Is(err, asynq.ErrTaskNotFound), errors.Is(err, asynq.ErrQueueNotFound):
        r.CurrentJobState = "missing"
        r.RetryDisabledReason = "原任务已清理，执行历史继续保留"
    case err != nil:
        return nil, unavailable()
    default:
        r.CurrentJobState = info.State.String()
        switch {
        case latest != r.ID:
            r.RetryDisabledReason = "请通过最新执行记录发起重试"
        case r.Status != "failed":
            r.RetryDisabledReason = "最终失败后可重试"
        case info.State != asynq.TaskStateArchived:
            r.RetryDisabledReason = "任务仍在排队、执行或自动重试中"
        default:
            r.CanRetry = true
        }
    }

    return s.project(r), nil
}

// Retry 先原子预留新记录，再恢复 Asynq 原任务；Worker 通过 Manual 标记限制为单次执行。
func (s *Service) Retry(ctx context.Context, id, actorID, actorName string) (*Record, error) {
    if actorID == "" {
        return nil, &httperr.Error{Code: "FORBIDDEN", Message: "操作人身份无效"}
    }

    r, err := s.raw(ctx, id)
    if _, missing := err.(*recordMissing); missing {
        return nil, bad("执行记录已过期或不存在")
    }
    if err != nil {
        return nil, err
    }

    request, _ := requestmeta.RequestFrom(ctx)
    audit := &Audit{
        RequestID: request.RequestID,
        ID:        uuid.NewString(),
        ActorID:   actorID,
        ActorName: actorName,
        At:        milliseconds(s.now()),
        JobID:     r.JobID,
        RecordID:  id,
        Outcome:   "failed",
    }
    fail := func(reason string, e error) (*Record, error) {
        audit.Reason = reason
        auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
        defer cancel()
        _, saveErr := s.redis.TxPipelined(auditCtx, func(p redis.Pipeliner) error {
            s.saveAudit(auditCtx, p, r, audit)
            return nil
        })
        if saveErr != nil {
            return nil, unavailable()
        }
        return nil, e
    }
    info, err := s.inspector.GetTaskInfo(r.PhysicalQueueName, r.JobID)
    if errors.Is(err, asynq.ErrTaskNotFound) || errors.Is(err, asynq.ErrQueueNotFound) {
        return fail("原任务已清理", conflict("原任务已清理，执行历史继续保留"))
    }
    if err != nil {
        return fail("任务状态读取失败", unavailable())
    }
    if info.State != asynq.TaskStateArchived || r.Status != "failed" {
        return fail("任务仍在执行或自动重试中", conflict("仅最新最终失败记录支持重试"))
    }

    key := s.taskKey(r)
    var reserved *Record
    err = s.change(ctx, key, func(tx *redis.Tx, meta map[string]string) error {
        if meta["latest"] != id || meta["pending"] != "" {
            return conflict("任务已有新执行记录，请刷新后查看")
        }

        reserved = nextRecord(s.template(info), meta, s.now())
        reserved.Manual = true
        reserved.Meta = map[string]any{
            "actorId":     actorID,
            "actorName":   actorName,
            "requestedAt": audit.At,
        }
        audit.NewRecordID = reserved.ID
        audit.Outcome = "scheduling"
        _, e := tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
            s.save(ctx, p, reserved, "")
            s.saveAudit(ctx, p, r, audit)
            p.HSet(ctx, key, "latest", reserved.ID, "pending", reserved.ID, "sequence", reserved.ExecutionNumber, "audit", audit.ID)
            return nil
        })
        return e
    })
    if err != nil {
        audit.Outcome = "failed"
        audit.NewRecordID = ""
        return fail("任务状态已变化", err)
    }
    // 预留成功后完成短事务，HTTP 断开仍会留下确定的安排结果。
    finalize, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
    defer cancel()
    if err = s.inspector.RunTask(r.PhysicalQueueName, r.JobID); err != nil {
        // Redis 返回结果可能丢失；通过原任务状态判断实际安排结果。
        current, checkErr := s.inspector.GetTaskInfo(r.PhysicalQueueName, r.JobID)
        if checkErr != nil && !errors.Is(checkErr, asynq.ErrTaskNotFound) && !errors.Is(checkErr, asynq.ErrQueueNotFound) {
            // 状态读取故障时保留预留，维护流程继续复核实际安排结果。
            return nil, unavailable()
        }
        if checkErr != nil || current.State == asynq.TaskStateArchived {
            audit.Outcome = "failed"
            audit.Reason = "安排重试失败"
            rollback := s.change(finalize, key, func(tx *redis.Tx, meta map[string]string) error {
                _, e := tx.TxPipelined(finalize, func(p redis.Pipeliner) error {
                    if meta["pending"] == reserved.ID && meta["latest"] == reserved.ID {
                        s.remove(finalize, p, reserved)
                        p.HSet(finalize, key, "latest", id, "sequence", r.ExecutionNumber)
                        p.HDel(finalize, key, "pending", "audit")
                    }
                    s.saveAudit(finalize, p, r, audit)
                    return nil
                })
                return e
            })
            if rollback != nil {
                return nil, unavailable()
            }
            return nil, unavailable()
        }
    }

    audit.Outcome = "success"
    audit.Reason = "已安排重试"
    _, err = s.redis.TxPipelined(finalize, func(p redis.Pipeliner) error {
        s.saveAudit(finalize, p, r, audit)
        return nil
    })
    if err != nil {
        return nil, unavailable()
    }
    return s.Get(finalize, reserved.ID)
}

// Dashboard 汇总三个逻辑队列的原生状态、近 24 小时执行次数和消费进程信息。
func (s *Service) Dashboard(ctx context.Context) (*DashboardPayload, error) {
    result := &DashboardPayload{
        Capabilities:    &Capabilities{SupportsRetry: true, SupportsSchedules: len(s.schedules) > 0},
        Overview:        &Overview{},
        Queues:          []*Snapshot{},
        WorkerProcesses: []*WorkerProcess{},
        UpdatedAt:       milliseconds(s.now()),
    }
    known, err := s.inspector.Queues()
    if err != nil {
        return nil, unavailable()
    }

    for _, name := range []string{"critical", "default", "low"} {
        physical := s.config.Queue(name)
        q := &asynq.QueueInfo{}
        var err error
        if slices.Contains(known, physical) {
            q, err = s.inspector.GetQueueInfo(physical)
        }
        if errors.Is(err, asynq.ErrQueueNotFound) {
            q = &asynq.QueueInfo{}
        } else if err != nil {
            return nil, unavailable()
        }

        item := &Snapshot{
            QueueName:         name,
            PhysicalQueueName: physical,
            Description:       "Asynq 队列",
            Waiting:           q.Pending,
            Active:            q.Active,
            Delayed:           q.Scheduled,
            Retrying:          q.Retry,
            Failed:            q.Archived,
            Completed:         q.Completed,
        }
        start := strconvNumber(milliseconds(s.now().Add(-24 * time.Hour)))
        success, e := s.redis.ZCount(ctx, s.key("finished:"+name+":completed"), start, "+inf").Result()
        if e != nil {
            return nil, unavailable()
        }

        failed, e := s.redis.ZCount(ctx, s.key("finished:"+name+":failed"), start, "+inf").Result()
        if e != nil {
            return nil, unavailable()
        }

        item.SucceededExecutions24h = int(success)
        item.FailedExecutions24h = int(failed)
        result.Queues = append(result.Queues, item)
        o := result.Overview
        o.Waiting += item.Waiting
        o.Active += item.Active
        o.Delayed += item.Delayed
        o.Retrying += item.Retrying
        o.Failed += item.Failed
        o.Completed += item.Completed
        o.SucceededExecutions24h += item.SucceededExecutions24h
        o.FailedExecutions24h += item.FailedExecutions24h
    }

    result.QueueCount = len(result.Queues)
    if err := s.workerProcesses(ctx, result); err != nil {
        return nil, unavailable()
    }
    return result, nil
}

// Schedules 沿用代码注册的调度定义与 Redis 运行观测。
func (s *Service) Schedules(ctx context.Context) (*schedule.Payload, error) {
    result, err := schedule.Dashboard(ctx, s.redis, s.config, s.schedules)
    if err != nil {
        return nil, unavailable()
    }
    return result, nil
}
