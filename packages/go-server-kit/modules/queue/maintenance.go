package queue

import (
    "context"
    "encoding/json"
    "errors"
    "log/slog"
    "strconv"
    "time"

    "github.com/hibiken/asynq"
    "github.com/redis/go-redis/v9"
)

// reindexActivityBatch 分批修复首版历史索引，保留记录内容与任务链保留时间。
// 游标按 namespace 持久化；重复处理幂等，WATCH 保护并发执行与清理。
func (s *Service) reindexActivityBatch(ctx context.Context) error {
    cursorKey := s.key("activity-order:cursor")
    state, err := s.redis.Get(ctx, cursorKey).Result()
    if err != nil && !errors.Is(err, redis.Nil) {
        return unavailable()
    }
    if state == "done" {
        return nil
    }

    previousState := state
    cursor, _ := strconv.ParseUint(state, 10, 64)
    values, next, err := s.redis.ZScan(ctx, s.key("all"), cursor, "*", 100).Result()
    if err != nil {
        return unavailable()
    }

    for j := 0; j < len(values); j += 2 {
        id := values[j]
        r, err := s.raw(ctx, id)
        if _, missing := err.(*recordMissing); missing {
            continue
        }
        if err != nil {
            return err
        }
        if err = s.change(ctx, s.taskKey(r), func(tx *redis.Tx, meta map[string]string) error {
            current, e := s.raw(ctx, id)
            if _, missing := e.(*recordMissing); missing {
                return nil
            }
            if e != nil {
                return e
            }

            score := activityTime(current)
            if score == current.SortAt && current.CreatedAt != 0 {
                return nil
            }
            if current.CreatedAt == 0 {
                current.CreatedAt = current.SortAt
            }

            current.SortAt = score
            body, _ := json.Marshal(current)
            _, e = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
                p.Set(ctx, s.key("record:"+id), body, 0)
                p.ZAdd(ctx, s.key("created:all"), redis.Z{Score: current.CreatedAt, Member: id})
                for _, key := range s.indices(current) {
                    p.ZAdd(ctx, key, redis.Z{Score: score, Member: id})
                }
                // 写入任务元数据版本，保持历史重建与执行写入的串行化。
                p.HSet(ctx, s.taskKey(current), "orderVersion", id)
                return nil
            })
            return e
        }); err != nil {
            return err
        }
    }

    if next == 0 {
        state = "done"
    } else {
        state = strconv.FormatUint(next, 10)
    }
    // 比较原游标后推进，避免并行请求用较早批次覆盖已经完成的游标。
    if err = s.redis.Eval(ctx, `
local current=redis.call("GET",KEYS[1]) or ""
if current==ARGV[1] then redis.call("SET",KEYS[1],ARGV[2]) end
return 1
`, []string{cursorKey}, previousState, state).Err(); err != nil {
        return unavailable()
    }
    return nil
}

// remove 在清理流水线中移除单条历史及其状态、创建时间和完成时间索引。
func (s *Service) remove(ctx context.Context, p redis.Pipeliner, r *Record) {
    p.Del(ctx, s.key("record:"+r.ID))
    p.ZRem(ctx, s.key("reconcile"), r.ID)
    p.ZRem(ctx, s.key("created:all"), r.ID)
    for _, key := range s.indices(r) {
        p.ZRem(ctx, key, r.ID)
    }

    for _, status := range []string{"completed", "failed"} {
        p.ZRem(ctx, s.key("finished:"+status), r.ID)
        p.ZRem(ctx, s.key("finished:"+r.QueueName+":"+status), r.ID)
    }

    p.SRem(ctx, s.key("chain:"+taskToken(r.PhysicalQueueName, r.JobID)), r.ID)
}

// Cleanup 按任务链清理独立历史。活动、排队和自动重试链持续保留。
func (s *Service) Cleanup(ctx context.Context) (int, error) {
    cutoff := milliseconds(s.now().Add(-s.retention))
    tokens, err := s.redis.ZRangeByScore(ctx, s.key("tasks"), &redis.ZRangeBy{Min: "-inf", Max: strconvNumber(cutoff), Count: 100}).Result()
    if err != nil {
        return 0, err
    }

    removed := 0
    for _, token := range tokens {
        key := s.key("task:" + token)
        err = s.change(ctx, key, func(tx *redis.Tx, meta map[string]string) error {
            score, e := tx.ZScore(ctx, s.key("tasks"), token).Result()
            if errors.Is(e, redis.Nil) {
                return nil
            }
            if e != nil {
                return e
            }
            if score > cutoff {
                return nil
            }

            info, e := s.inspector.GetTaskInfo(meta["queue"], meta["id"])
            if e != nil && !errors.Is(e, asynq.ErrTaskNotFound) && !errors.Is(e, asynq.ErrQueueNotFound) {
                return e
            }
            if e == nil && info.State != asynq.TaskStateArchived && info.State != asynq.TaskStateCompleted {
                // 活动链移到下一清理周期，其他过期链继续获得处理机会。
                _, e = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
                    p.HSet(ctx, key, "retentionCheck", s.now().UnixMilli())
                    p.ZAdd(ctx, s.key("tasks"), redis.Z{Score: milliseconds(s.now()), Member: token})
                    return nil
                })
                return e
            }
            // 未完成的安排先由恢复流程复核，避免边界处清理重试预留。
            if meta["pending"] != "" {
                return nil
            }

            ids, e := tx.SMembers(ctx, s.key("chain:"+token)).Result()
            if e != nil {
                return e
            }

            audits, e := tx.SMembers(ctx, s.key("audits:"+token)).Result()
            if e != nil {
                return e
            }

            records := []*Record{}
            for _, id := range ids {
                r, e := s.raw(ctx, id)
                if e != nil {
                    return e
                }

                records = append(records, r)
            }

            _, e = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
                for _, r := range records {
                    s.remove(ctx, p, r)
                }

                for _, id := range audits {
                    p.Del(ctx, s.key("audit:"+id))
                }

                p.Del(ctx, key, s.key("chain:"+token), s.key("audits:"+token))
                p.ZRem(ctx, s.key("tasks"), token)
                return nil
            })
            if e == nil {
                removed += len(records)
            }
            return e
        })
        if err != nil {
            return removed, err
        }
    }

    return removed, nil
}

// Reconcile 修复 Worker 中断和 Redis 结果写入故障留下的非终态记录。
func (s *Service) Reconcile(ctx context.Context) error {
    if err := s.reindexActivityBatch(ctx); err != nil {
        return err
    }
    {
        ids, err := s.redis.ZRangeByScore(ctx, s.key("reconcile"), &redis.ZRangeBy{
            Min:   "-inf",
            Max:   strconvNumber(milliseconds(s.now().Add(-2 * time.Minute))),
            Count: 100,
        }).Result()
        if err != nil {
            return err
        }

        for _, id := range ids {
            r, err := s.raw(ctx, id)
            if err != nil {
                if _, missing := err.(*recordMissing); missing {
                    if err = s.redis.ZRem(ctx, s.key("reconcile"), id).Err(); err != nil {
                        return err
                    }
                    continue
                }
                return err
            }

            status := r.Status
            // 每轮检查后轮转，长期排队任务与大批历史都能持续获得复核机会。
            if err = s.redis.ZAddXX(ctx, s.key("reconcile"), redis.Z{Score: milliseconds(s.now()), Member: id}).Err(); err != nil {
                return err
            }

            info, err := s.inspector.GetTaskInfo(r.PhysicalQueueName, r.JobID)
            missing := errors.Is(err, asynq.ErrTaskNotFound) || errors.Is(err, asynq.ErrQueueNotFound)
            if err != nil && !missing {
                return err
            }
            if !missing && (info.State == asynq.TaskStatePending || info.State == asynq.TaskStateScheduled || info.State == asynq.TaskStateActive || info.State == asynq.TaskStateRetry) {
                // 原任务已经离开归档，恢复进程中断留下的安排审计。
                if err = s.change(ctx, s.taskKey(r), func(tx *redis.Tx, meta map[string]string) error {
                    if meta["latest"] != r.ID || meta["audit"] == "" {
                        return nil
                    }

                    audit, e := s.schedulingAudit(ctx, tx, meta)
                    if e != nil {
                        return e
                    }

                    audit.Outcome = "success"
                    audit.Reason = "原任务已安排重试"
                    _, e = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
                        s.saveAudit(ctx, p, r, audit)
                        p.HDel(ctx, s.taskKey(r), "audit")
                        return nil
                    })
                    return e
                }); err != nil {
                    return err
                }
            }
            if !missing && info.State == asynq.TaskStateActive {
                continue
            }
            if status == "active" {
                if !missing && info.State == asynq.TaskStateCompleted {
                    var result any
                    _ = json.Unmarshal(info.Result, &result)
                    if err = s.finish(ctx, r, nil, result); err != nil {
                        return err
                    }
                } else {
                    reason := "执行中断，任务已恢复"
                    if missing {
                        reason = "原任务已清理，执行结果待业务核对"
                    } else if info.LastErr != "" {
                        reason = info.LastErr
                    }

                    r.Interrupted = true
                    if err = s.finish(ctx, r, errors.New(reason), nil); err != nil {
                        return err
                    }
                }
            } else if missing || info.State == asynq.TaskStateArchived || info.State == asynq.TaskStateCompleted {
                // 入队／安排记录尚未开始：恢复旧失败记录并留下失败审计。
                key := s.taskKey(r)
                if err = s.change(ctx, key, func(tx *redis.Tx, meta map[string]string) error {
                    if meta["pending"] != r.ID {
                        return nil
                    }

                    var audit *Audit
                    if meta["audit"] != "" {
                        body, e := tx.Get(ctx, s.key("audit:"+meta["audit"])).Bytes()
                        if e != nil {
                            return e
                        }

                        audit = &Audit{}
                        if json.Unmarshal(body, audit) != nil {
                            return unavailable()
                        }

                        audit.Outcome = "failed"
                        audit.Reason = "安排中断，任务状态已复核"
                    }

                    _, e := tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
                        if r.Manual && r.RetryOfRecordID != nil {
                            s.remove(ctx, p, r)
                            p.HSet(ctx, key, "latest", *r.RetryOfRecordID, "sequence", r.ExecutionNumber-1)
                        } else {
                            s.end(r, errors.New("执行前原任务已结束或清理"), nil)
                            s.save(ctx, p, r, status)
                        }
                        p.HDel(ctx, key, "pending", "audit")
                        if audit != nil {
                            s.saveAudit(ctx, p, r, audit)
                        }
                        return nil
                    })
                    return e
                }); err != nil {
                    return err
                }
            }
        }
    }
    return nil
}

// Maintain 在 Worker 生命周期内周期恢复与清理，退出由调用方等待。
func (s *Service) Maintain(ctx context.Context) {
    tick := time.NewTicker(time.Minute)
    defer tick.Stop()
    for {
        check, cancel := context.WithTimeout(ctx, 20*time.Second)
        err := s.Reconcile(check)
        if err == nil {
            _, err = s.Cleanup(check)
        }
        cancel()
        if err != nil && ctx.Err() == nil {
            slog.Error("执行记录维护失败")
        }

        select {
        case <-ctx.Done():
            return
        case <-tick.C:
        }
    }
}

// schedulingAudit 读取任务链尚未确认的人工安排审计。
func (s *Service) schedulingAudit(ctx context.Context, tx *redis.Tx, meta map[string]string) (*Audit, error) {
    if meta["audit"] == "" {
        return nil, nil
    }

    body, err := tx.Get(ctx, s.key("audit:"+meta["audit"])).Bytes()
    if err != nil {
        return nil, err
    }

    audit := &Audit{}
    if json.Unmarshal(body, audit) != nil {
        return nil, unavailable()
    }
    return audit, nil
}
