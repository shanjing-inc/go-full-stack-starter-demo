package queue

// 本文件覆盖活动时间与创建时间排序、waiting 合并 delayed、筛选分页和旧活动索引回填。

import (
    "context"
    "encoding/json"
    "fmt"
    "sync"
    "testing"
    "time"

    "github.com/redis/go-redis/v9"
)

func TestActivityOrderAndCreatedOrder(t *testing.T) {
    s, _, _ := redisService(t, &memoryInspector{})
    ctx := context.Background()
    now := time.Now().Truncate(time.Millisecond)
    s.now = func() time.Time { return now }
    old := seed(t, s, "old", "demo", "default", "failed", now.Add(-time.Hour))
    newer := seed(t, s, "new", "demo", "default", "failed", now.Add(-time.Minute))
    old.FinishedAt = number(milliseconds(now))
    _, err := s.redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        s.save(ctx, p, old, "failed")
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }

    for _, tc := range []struct{ field, direction, first string }{
        {"", "", old.ID}, {"updatedAt", "desc", old.ID}, {"sortAt", "desc", old.ID},
        {"updatedAt", "asc", newer.ID}, {"createdAt", "desc", newer.ID}, {"createdAt", "asc", old.ID},
    } {
        t.Run(tc.field+"/"+tc.direction, func(t *testing.T) {
            page, err := s.List(ctx, ListQuery{
                Status:         "recent",
                OrderBy:        tc.field,
                OrderDirection: tc.direction,
            })
            if err != nil {
                t.Fatal(err)
            }
            if len(page.Records) != 2 || page.Records[0].ID != tc.first || !page.IsRecentPage {
                t.Fatalf("排序结果错误：%+v", page)
            }
        })
    }

    page, err := s.List(ctx, ListQuery{Status: "recent", Offset: 20})
    if err != nil || !page.IsRecentPage {
        t.Fatal(page, err)
    }

    page, err = s.List(ctx, ListQuery{Status: "failed"})
    if err != nil || page.IsRecentPage {
        t.Fatal(page, err)
    }

    page, err = s.List(ctx, ListQuery{Status: "recent", From: number(milliseconds(now.Add(-time.Second)))})
    if err != nil || page.Total != 1 || page.Records[0].ID != old.ID {
        t.Fatal(page, err)
    }

    for _, q := range []ListQuery{{OrderBy: "name"}, {OrderDirection: "invalid"}} {
        _, err = s.List(ctx, q)
        expectCode(t, err, "BAD_USER_INPUT")
    }
    // 执行开始后使用开始时间，创建时间保持入队时刻。
    active := seed(t, s, "active", "demo", "default", "waiting", now.Add(-2*time.Hour))
    active.Status = "active"
    active.ProcessedAt = number(milliseconds(now.Add(time.Second)))
    _, err = s.redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
        s.save(ctx, p, active, "waiting")
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }

    page, err = s.List(ctx, ListQuery{OrderBy: "updatedAt"})
    if err != nil || page.Records[0].ID != active.ID || active.CreatedAt != milliseconds(now.Add(-2*time.Hour)) {
        t.Fatal(page, err)
    }
}

func TestWaitingIncludesDelayedWithFiltersAndPagination(t *testing.T) {
    s, _, _ := redisService(t, &memoryInspector{})
    ctx := context.Background()
    now := time.Now().Truncate(time.Millisecond)
    for i := 0; i < 25; i++ {
        status := "waiting"
        if i%2 == 1 {
            status = "delayed"
        }
        seed(t, s, fmt.Sprint(i), "demo", "default", status, now.Add(time.Duration(i)*time.Second))
    }

    seed(t, s, "other-queue", "demo", "low", "delayed", now)
    seed(t, s, "other-type", "another", "default", "waiting", now)
    seed(t, s, "completed", "demo", "default", "completed", now)
    q := ListQuery{
        Status:         "waiting",
        QueueName:      "default",
        JobName:        "demo",
        Limit:          20,
        OrderDirection: "asc",
    }
    page, err := s.List(ctx, q)
    if err != nil || page.Total != 25 || len(page.Records) != 20 {
        t.Fatal(page, err)
    }

    for i, r := range page.Records {
        if r.JobID != fmt.Sprint(i) {
            t.Fatalf("合并排序错误：%+v", r)
        }
    }

    q.Offset = 20
    page, err = s.List(ctx, q)
    if err != nil || page.Total != 25 || len(page.Records) != 5 || page.Records[0].JobID != "20" {
        t.Fatal(page, err)
    }

    q.Offset = 0
    q.From = number(milliseconds(now.Add(20 * time.Second)))
    q.To = number(milliseconds(now.Add(24 * time.Second)))
    page, err = s.List(ctx, q)
    if err != nil || page.Total != 5 {
        t.Fatal(page, err)
    }

    page, err = s.List(ctx, ListQuery{Status: "delayed", QueueName: "default", JobName: "demo"})
    if err != nil || page.Total != 12 {
        t.Fatal(page, err)
    }

    keys, err := s.redis.Keys(ctx, s.key("view:*")).Result()
    if err != nil || len(keys) != 0 {
        t.Fatalf("临时筛选索引残留：%v %v", keys, err)
    }
}

func TestLegacyActivityIndexBackfill(t *testing.T) {
    s, _, _ := redisService(t, &memoryInspector{})
    ctx := context.Background()
    now := time.Now().Truncate(time.Millisecond)
    s.now = func() time.Time { return now }
    var latest *Record
    for i := 0; i < 250; i++ {
        created := now.Add(time.Duration(i-250) * time.Minute)
        r := seed(t, s, fmt.Sprint(i), "demo", "default", "completed", created)
        // 模拟首版：主索引存创建时间，记录缺少 createdAt 和独立创建索引。
        r.CreatedAt = 0
        r.SortAt = milliseconds(created)
        r.FinishedAt = number(milliseconds(now.Add(-time.Duration(i) * time.Second)))
        if i == 0 {
            latest = r
        }

        body, _ := json.Marshal(r)
        _, err := s.redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
            p.Set(ctx, s.key("record:"+r.ID), body, 0)
            p.ZRem(ctx, s.key("created:all"), r.ID)
            for _, key := range s.indices(r) {
                p.ZAdd(ctx, key, redis.Z{Score: r.SortAt, Member: r.ID})
            }

            return nil
        })
        if err != nil {
            t.Fatal(err)
        }
    }

    token := taskToken(latest.PhysicalQueueName, latest.JobID)
    before, err := s.redis.ZScore(ctx, s.key("tasks"), token).Result()
    if err != nil {
        t.Fatal(err)
    }
    if err = s.reindexActivityBatch(ctx); err != nil {
        t.Fatal(err)
    }

    state, err := s.redis.Get(ctx, s.key("activity-order:cursor")).Result()
    if err != nil || state == "done" {
        t.Fatalf("回填应分批推进：%s %v", state, err)
    }
    // 并行首次查询接续回填，游标继续单向推进到完成标记。
    var wg sync.WaitGroup
    failures := make(chan error, 4)
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            page, e := s.List(ctx, ListQuery{Status: "recent", OrderBy: "updatedAt"})
            if e != nil {
                failures <- e
                return
            }
            if page.Total != 250 || page.Records[0].ID != latest.ID {
                failures <- fmt.Errorf("并行回填排序或总量错误")
            }
        }()
    }

    wg.Wait()
    close(failures)
    for e := range failures {
        t.Fatal(e)
    }
    // 首次列表接续全部剩余批次，再给出完整的排序和总量。
    page, err := s.List(ctx, ListQuery{Status: "recent", OrderBy: "updatedAt"})
    if err != nil || page.Total != 250 || page.Records[0].ID != latest.ID {
        t.Fatal(page, err)
    }

    page, err = s.List(ctx, ListQuery{OrderBy: "createdAt", OrderDirection: "asc"})
    if err != nil || page.Total != 250 || page.Records[0].ID != latest.ID {
        t.Fatal(page, err)
    }

    migrated, err := s.raw(ctx, latest.ID)
    if err != nil || migrated.CreatedAt != latest.SortAt || migrated.SortAt != *latest.FinishedAt {
        t.Fatal(migrated, err)
    }

    after, err := s.redis.ZScore(ctx, s.key("tasks"), token).Result()
    if err != nil || before != after {
        t.Fatalf("回填改变历史保留期：%v %v %v", before, after, err)
    }

    beforeBody, _ := s.redis.Get(ctx, s.key("record:"+latest.ID)).Result()
    if err = s.reindexActivityBatch(ctx); err != nil {
        t.Fatal(err)
    }

    afterBody, _ := s.redis.Get(ctx, s.key("record:"+latest.ID)).Result()
    if beforeBody != afterBody {
        t.Fatal("重复回填改变已迁移记录")
    }

    state, _ = s.redis.Get(ctx, s.key("activity-order:cursor")).Result()
    if state != "done" {
        t.Fatal(state)
    }
}
