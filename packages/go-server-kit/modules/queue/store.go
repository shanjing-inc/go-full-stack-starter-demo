package queue

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "strconv"
    "time"

    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"
)

func (s *Service) key(part string) string { return s.prefix + part }

// taskToken 按物理队列和任务 ID 的完整边界计算摘要，隔离不同队列的同名任务。
func taskToken(queue, id string) string {
    h := sha256.Sum256([]byte(queue + "\x00" + id))
    return hex.EncodeToString(h[:])
}

func (s *Service) taskKey(r *Record) string {
    return s.key("task:" + taskToken(r.PhysicalQueueName, r.JobID))
}

func (s *Service) indices(r *Record) []string {
    return []string{
        s.key("all"),
        s.key("status:" + r.Status),
        s.key("queue:" + r.QueueName),
        s.key("type:" + r.JobName),
    }
}

// raw 校验 UUID 后读取内部原始快照，供安全投影与恢复操作共享。
func (s *Service) raw(ctx context.Context, id string) (*Record, error) {
    if _, err := uuid.Parse(id); len(id) != 36 || err != nil {
        return nil, bad("执行记录 ID 无效")
    }

    body, err := s.redis.Get(ctx, s.key("record:"+id)).Bytes()
    if errors.Is(err, redis.Nil) {
        return nil, &recordMissing{}
    }
    if err != nil {
        return nil, unavailable()
    }

    var r Record
    if json.Unmarshal(body, &r) != nil {
        return nil, unavailable()
    }
    return &r, nil
}

type recordMissing struct{}

// Error 返回历史记录缺失的固定消息，供业务错误映射使用。
func (*recordMissing) Error() string { return "执行记录已过期或不存在" }

// change 使用任务元数据 WATCH 串行化记录分配、执行完成和重试预留。
func (s *Service) change(ctx context.Context, key string, fn func(*redis.Tx, map[string]string) error) error {
    for i := 0; i < 20; i++ {
        err := s.redis.Watch(ctx, func(tx *redis.Tx) error {
            meta, err := tx.HGetAll(ctx, key).Result()
            if err != nil {
                return err
            }
            return fn(tx, meta)
        }, key)
        if !errors.Is(err, redis.TxFailedErr) {
            return err
        }
    }

    return conflict("任务状态正在变化，请刷新后重试")
}

// save 在调用方事务流水线中保存快照、状态索引、执行计数索引与任务链关联。
func (s *Service) save(ctx context.Context, p redis.Pipeliner, r *Record, previousStatus string) {
    if r.CreatedAt == 0 {
        r.CreatedAt = r.SortAt
    }

    r.SortAt = activityTime(r)
    body, _ := json.Marshal(r)
    p.Set(ctx, s.key("record:"+r.ID), body, 0)
    if previousStatus != "" && previousStatus != r.Status {
        p.ZRem(ctx, s.key("status:"+previousStatus), r.ID)
    }

    for _, key := range s.indices(r) {
        p.ZAdd(ctx, key, redis.Z{Score: r.SortAt, Member: r.ID})
    }

    p.ZAdd(ctx, s.key("created:all"), redis.Z{Score: r.CreatedAt, Member: r.ID})
    // 24 小时次数按结束时间统计，单次执行只计一次。
    if r.FinishedAt != nil && r.ProcessedAt != nil && (r.Status == "completed" || r.Status == "failed") {
        p.ZAdd(ctx, s.key("finished:"+r.Status), redis.Z{Score: *r.FinishedAt, Member: r.ID})
        p.ZAdd(ctx, s.key("finished:"+r.QueueName+":"+r.Status), redis.Z{Score: *r.FinishedAt, Member: r.ID})
    }
    if r.Status == "active" || r.Status == "waiting" || r.Status == "delayed" {
        p.ZAdd(ctx, s.key("reconcile"), redis.Z{Score: milliseconds(s.now()), Member: r.ID})
    } else {
        p.ZRem(ctx, s.key("reconcile"), r.ID)
    }

    token := taskToken(r.PhysicalQueueName, r.JobID)
    p.SAdd(ctx, s.key("chain:"+token), r.ID)
    p.HSet(ctx, s.taskKey(r), "queue", r.PhysicalQueueName, "id", r.JobID)
    p.ZAdd(ctx, s.key("tasks"), redis.Z{Score: milliseconds(s.now()), Member: token})
}

// saveAudit 在任务链中保存重试审计并更新审计版本，供 WATCH 检测并发修改。
func (s *Service) saveAudit(ctx context.Context, p redis.Pipeliner, r *Record, a *Audit) {
    body, _ := json.Marshal(a)
    p.Set(ctx, s.key("audit:"+a.ID), body, 0)
    p.HSet(ctx, s.taskKey(r), "auditVersion", uuid.NewString())
    p.ZAdd(ctx, s.key("tasks"), redis.Z{Score: milliseconds(s.now()), Member: taskToken(r.PhysicalQueueName, r.JobID)})
    p.SAdd(ctx, s.key("audits:"+taskToken(r.PhysicalQueueName, r.JobID)), a.ID)
}

// nextRecord 复制任务模板并分配下一执行序号，清空上次结果与执行时间。
func nextRecord(info *Record, meta map[string]string, now time.Time) *Record {
    seq, _ := strconv.Atoi(meta["sequence"])
    r := *info
    r.ID = uuid.NewString()
    r.ExecutionNumber = seq + 1
    r.CreatedAt = milliseconds(now)
    r.SortAt = r.CreatedAt
    r.Status = "waiting"
    r.State = "waiting"
    r.StatusHint = "waiting"
    r.Interrupted = false
    r.ProcessedAt = nil
    r.FinishedAt = nil
    r.RuntimeMs = nil
    r.FailedReason = ""
    r.ReturnValue = nil
    r.Stacktrace = []string{}
    r.CanRetry = false
    r.LatestRecordID = r.ID
    if meta["latest"] != "" {
        id := meta["latest"]
        r.RetryOfRecordID = &id
    }
    return &r
}

// activityTime 沿用参考的最近活动时间：结束、开始、入队依次回退。
func activityTime(r *Record) float64 {
    if r.FinishedAt != nil {
        return *r.FinishedAt
    }
    if r.ProcessedAt != nil {
        return *r.ProcessedAt
    }
    if r.QueuedAt != nil {
        return *r.QueuedAt
    }
    return r.SortAt
}

const listScript = `
local target=KEYS[1]
local waiting=target..':waiting'
local source={KEYS[2]}
local start=3
if ARGV[5]=='waiting' then
    redis.call('ZUNIONSTORE',waiting,2,KEYS[3],KEYS[4],'AGGREGATE','MAX')
    redis.call('PEXPIRE',waiting,30000)
    table.insert(source,waiting)
    start=5
end
for i=start,#KEYS do table.insert(source,KEYS[i]) end
local args={target,#source}
for _,key in ipairs(source) do table.insert(args,key) end
table.insert(args,'WEIGHTS')
for i=1,#source do table.insert(args,i==1 and 1 or 0) end
table.insert(args,'AGGREGATE');table.insert(args,'SUM')
redis.call('ZINTERSTORE',unpack(args))
redis.call('PEXPIRE',target,30000)
local count=redis.call('ZCOUNT',target,ARGV[1],ARGV[2])
local ids
if ARGV[6]=='asc' then
    ids=redis.call('ZRANGEBYSCORE',target,ARGV[1],ARGV[2],'LIMIT',ARGV[3],ARGV[4])
else
    ids=redis.call('ZREVRANGEBYSCORE',target,ARGV[2],ARGV[1],'LIMIT',ARGV[3],ARGV[4])
end
redis.call('DEL',target,waiting)
return {count,ids}
`

// List 校验分页和筛选后原子求交集索引，再读取安全投影；waiting 包含等待及延迟记录。
func (s *Service) List(ctx context.Context, q ListQuery) (*RecordsPayload, error) {
    if q.Limit == 0 {
        q.Limit = 20
    }
    if (q.Limit != 20 && q.Limit != 50 && q.Limit != 100) || q.Offset < 0 || q.Offset > 1000000 {
        return nil, bad("分页数量支持 20、50、100，偏移范围为 0–1000000")
    }
    if q.OrderBy != "" && q.OrderBy != "updatedAt" && q.OrderBy != "sortAt" && q.OrderBy != "createdAt" {
        return nil, bad("排序字段支持 updatedAt、sortAt、createdAt")
    }
    if q.OrderDirection != "" && q.OrderDirection != "desc" && q.OrderDirection != "asc" {
        return nil, bad("排序方向支持 asc、desc")
    }
    if !validStatus(q.Status) {
        return nil, bad("执行状态无效")
    }
    if q.QueueName != "" && q.QueueName != "default" && q.QueueName != "critical" && q.QueueName != "low" {
        return nil, bad("队列筛选无效")
    }
    if len(q.JobName) > 255 {
        return nil, bad("任务类型过长")
    }
    if q.From != nil && (*q.From < 0 || *q.From > 1e15) || q.To != nil && (*q.To < 0 || *q.To > 1e15) || q.From != nil && q.To != nil && *q.From > *q.To {
        return nil, bad("时间范围无效")
    }
    // 首次列表读取完成剩余历史回填，保证分页总量与时间排序使用统一索引。
    // Worker 的恢复流程按批推进；这里复用持久化游标，后续查询只检查完成标记。
    for {
        if err := s.reindexActivityBatch(ctx); err != nil {
            return nil, err
        }

        state, err := s.redis.Get(ctx, s.key("activity-order:cursor")).Result()
        if err != nil {
            return nil, unavailable()
        }
        if state == "done" {
            break
        }
    }

    all := s.key("all")
    if q.OrderBy == "createdAt" {
        all = s.key("created:all")
    }

    keys := []string{s.key("view:" + uuid.NewString()), all}
    if q.Status == "waiting" {
        keys = append(keys, s.key("status:waiting"), s.key("status:delayed"))
    } else if q.Status != "" && q.Status != "all" && q.Status != "recent" {
        keys = append(keys, s.key("status:"+q.Status))
    }
    if q.QueueName != "" {
        keys = append(keys, s.key("queue:"+q.QueueName))
    }
    if q.JobName != "" {
        keys = append(keys, s.key("type:"+q.JobName))
    }

    low, high := "-inf", "+inf"
    if q.From != nil {
        low = strconv.FormatFloat(*q.From, 'f', -1, 64)
    }
    if q.To != nil {
        high = strconv.FormatFloat(*q.To, 'f', -1, 64)
    }

    result, err := s.redis.Eval(ctx, listScript, keys, low, high, q.Offset, q.Limit, q.Status, q.OrderDirection).Slice()
    if err != nil {
        return nil, unavailable()
    }

    payload := &RecordsPayload{
        Total:        int(result[0].(int64)),
        Limit:        q.Limit,
        Offset:       q.Offset,
        Status:       q.Status,
        UpdatedAt:    milliseconds(s.now()),
        IsRecentPage: q.Status == "" || q.Status == "all" || q.Status == "recent",
        Records:      []*Record{},
    }
    for _, v := range result[1].([]interface{}) {
        r, err := s.raw(ctx, v.(string))
        if err != nil {
            if _, ok := err.(*recordMissing); ok {
                continue
            }
            return nil, err
        }

        payload.Records = append(payload.Records, s.project(r))
    }

    return payload, nil
}

func validStatus(status string) bool {
    return status == "" || status == "all" || status == "recent" || status == "waiting" || status == "active" || status == "completed" || status == "failed" || status == "delayed"
}
