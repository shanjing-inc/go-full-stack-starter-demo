package queue

import (
    "context"
    "encoding/json"
    "errors"
    "log/slog"
    "time"

    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

// begin 在任务链 WATCH 保护下接管待执行记录或分配新记录，保存恢复执行的中断证据。
func (s *Service) begin(ctx context.Context, t *asynq.Task) (*Record, error) {
    id, _ := asynq.GetTaskID(ctx)
    name, _ := asynq.GetQueueName(ctx)
    attempts, _ := asynq.GetRetryCount(ctx)
    maxRetry, _ := asynq.GetMaxRetry(ctx)
    if id == "" || name == "" {
        return nil, errors.New("执行上下文缺少任务身份")
    }

    base := s.template(&asynq.TaskInfo{
        ID:       id,
        Queue:    name,
        Type:     t.Type(),
        Payload:  t.Payload(),
        Retried:  attempts,
        MaxRetry: maxRetry,
    })
    if info, e := s.inspector.GetTaskInfo(name, id); e == nil {
        base = s.template(info)
    }

    key := s.taskKey(base)
    var record *Record
    err := s.change(ctx, key, func(tx *redis.Tx, meta map[string]string) error {
        record = nil
        previous := ""
        if pending := meta["pending"]; pending != "" {
            r, e := s.raw(ctx, pending)
            if e != nil {
                return e
            }

            record = r
            previous = r.Status
        }

        var interrupted *Record
        if record == nil {
            record = nextRecord(base, meta, s.now())
            if meta["latest"] != "" {
                old, e := s.raw(ctx, meta["latest"])
                if e != nil {
                    return e
                }
                // 宕机恢复／租约回收会触发新执行；保留上一执行的中断证据。
                if old.Status == "active" {
                    interrupted = old
                    interrupted.Interrupted = true
                    s.end(interrupted, errors.New("执行中断，任务已恢复"), nil)
                }
                // 维护补记中断后，恢复执行继续保留人工单次边界。
                record.Manual = old.Manual && (old.Status == "active" || old.Interrupted)
            }
        }

        record.Status = "active"
        record.State = "active"
        record.StatusHint = "active"
        record.Attempts = attempts
        record.ProcessedAt = number(milliseconds(s.now()))
        audit, e := s.schedulingAudit(ctx, tx, meta)
        if e != nil {
            return e
        }
        if audit != nil {
            audit.Outcome = "success"
            audit.Reason = "已开始重试"
        }

        _, e = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
            if audit != nil {
                s.saveAudit(ctx, p, record, audit)
                p.HDel(ctx, key, "audit")
            }
            if interrupted != nil {
                s.save(ctx, p, interrupted, "active")
            }
            s.save(ctx, p, record, previous)
            p.HSet(ctx, key, "latest", record.ID, "sequence", record.ExecutionNumber)
            p.HDel(ctx, key, "pending")
            return nil
        })
        return e
    })
    return record, err
}

// end 填充结束时间、耗时、结果及成功或失败状态。
func (s *Service) end(r *Record, err error, result any) {
    finish := milliseconds(s.now())
    r.FinishedAt = &finish
    if r.ProcessedAt != nil {
        r.RuntimeMs = number(max(0, finish-*r.ProcessedAt))
    }

    r.ReturnValue = result
    r.Status = "completed"
    if err != nil {
        r.Status = "failed"
        r.FailedReason = err.Error()
    }

    r.State = r.Status
    r.StatusHint = r.Status
}

// finish 仅完成仍处于 active 的历史记录，状态已经收敛时保持幂等。
func (s *Service) finish(ctx context.Context, r *Record, err error, result any) error {
    return s.change(ctx, s.taskKey(r), func(tx *redis.Tx, meta map[string]string) error {
        current, e := s.raw(ctx, r.ID)
        if e != nil {
            return e
        }
        if current.Status != "active" {
            return nil
        }
        s.end(r, err, result)
        _, e = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
            s.save(ctx, p, r, "active")
            return nil
        })
        return e
    })
}

// Wrap 包围业务处理器记录执行生命周期，收敛 panic；人工重试失败后维持单次执行边界。
func (s *Service) Wrap(next asynq.Handler) asynq.Handler {
    return asynq.HandlerFunc(func(ctx context.Context, t *asynq.Task) (err error) {
        record, err := s.begin(ctx, t)
        if err != nil {
            slog.Error("执行记录建立失败", "type", t.Type())
            // 记录故障时归档原任务，恢复后可显式重试，保持人工执行单次边界。
            return errors.Join(errors.New("执行记录暂时不可用"), asynq.SkipRetry)
        }

        resultReady := false
        defer func() {
            if recover() != nil {
                err = errors.New("任务执行发生异常")
            }

            endCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
            defer cancel()
            var result any
            if resultReady {
                if info, e := s.inspector.GetTaskInfo(record.PhysicalQueueName, record.JobID); e == nil && len(info.Result) > 0 {
                    if json.Unmarshal(info.Result, &result) != nil {
                        result = string(info.Result)
                    }
                }
            }
            if e := s.finish(endCtx, record, err, result); e != nil {
                slog.Error("执行结果记录保存失败", "record", record.ID)
            }
            if record.Manual && err != nil {
                err = errors.Join(err, asynq.SkipRetry)
            }
        }()
        // 原任务复用时先清空原生结果；历史结果继续保留在上一执行快照中。
        if writer := t.ResultWriter(); writer != nil {
            if _, e := writer.Write(nil); e != nil {
                slog.Error("执行结果初始化失败", "record", record.ID)
                return errors.Join(errors.New("执行结果初始化失败"), asynq.SkipRetry)
            }

            resultReady = true
        }
        return next.ProcessTask(ctx, t)
    })
}
