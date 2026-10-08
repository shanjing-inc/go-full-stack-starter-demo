package queue

// 本文件覆盖执行结果的上下文隔离，防止并发任务互相覆盖结果。

import (
    "context"
    "encoding/json"
    "errors"
    "sync/atomic"
    "testing"
    "time"

    infra "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/internal/testredis"
    "github.com/google/uuid"
    "github.com/hibiken/asynq"
)

// 同一原任务复用时，每次执行单独采集结果，并保留上一执行快照。
func TestExecutionResultIsolation(t *testing.T) {
    for _, tc := range []struct {
        name   string
        manual bool
        result string
        fail   bool
        panic  bool
    }{
        {name: "人工重试成功且结果为空", manual: true},
        {name: "自动重试成功且结果为空"},
        {
            name:   "人工重试失败且结果为空",
            manual: true,
            fail:   true,
        },
        {name: "自动重试失败且结果为空", fail: true},
        {
            name:   "人工重试写入新结果",
            manual: true,
            result: `{"attempt":2}`,
        },
        {name: "自动重试写入相同结果", result: `{"attempt":1}`},
        {
            name:   "人工重试写入文本结果",
            manual: true,
            result: "本次执行结果",
        },
        {
            name:   "人工重试异常且结果为空",
            manual: true,
            panic:  true,
        },
    } {
        t.Run(tc.name, func(t *testing.T) {
            s, config, opt := redisService(t, &memoryInspector{})
            inspector := asynq.NewInspector(opt)
            defer inspector.Close()
            s.inspector = inspector
            config.Observer = s
            client := asynq.NewClient(opt)
            defer client.Close()
            var calls atomic.Int32
            server := asynq.NewServer(opt, asynq.Config{
                Concurrency:              1,
                Queues:                   map[string]int{config.Queue("default"): 1},
                TaskCheckInterval:        20 * time.Millisecond,
                DelayedTaskCheckInterval: 50 * time.Millisecond,
                ShutdownTimeout:          time.Second,
                RetryDelayFunc:           func(int, error, *asynq.Task) time.Duration { return time.Millisecond },
            })
            handler := asynq.HandlerFunc(func(ctx context.Context, task *asynq.Task) error {
                if calls.Add(1) == 1 {
                    if _, err := task.ResultWriter().Write([]byte(`{"attempt":1}`)); err != nil {
                        return err
                    }

                    err := errors.New("首次执行失败")
                    if tc.manual {
                        return errors.Join(err, asynq.SkipRetry)
                    }
                    return err
                }
                if tc.result != "" {
                    if _, err := task.ResultWriter().Write([]byte(tc.result)); err != nil {
                        return err
                    }
                }
                if tc.panic {
                    panic("本次执行异常")
                }
                if tc.fail {
                    return errors.New("本次执行失败")
                }
                return nil
            })
            if err := server.Start(s.Wrap(handler)); err != nil {
                t.Fatal(err)
            }
            defer server.Shutdown()
            ctx := context.Background()
            info, err := infra.Enqueue(ctx, client, config, "default", "test:result-isolation", map[string]string{}, uuid.NewString(), 1, time.Second)
            if err != nil {
                t.Fatal(err)
            }
            if tc.manual {
                testredis.Wait(t, func() bool {
                    current, err := inspector.GetTaskInfo(info.Queue, info.ID)
                    return err == nil && current.State == asynq.TaskStateArchived
                })
                records, err := s.List(ctx, ListQuery{Status: "failed"})
                if err != nil || records.Total != 1 {
                    t.Fatal(records, err)
                }
                if _, err := s.Retry(ctx, records.Records[0].ID, "1", "验收管理员"); err != nil {
                    t.Fatal(err)
                }
            }

            state, status := asynq.TaskStateCompleted, "completed"
            if tc.fail || tc.panic {
                state, status = asynq.TaskStateArchived, "failed"
            }
            testredis.Wait(t, func() bool {
                current, err := inspector.GetTaskInfo(info.Queue, info.ID)
                return err == nil && current.State == state && calls.Load() == 2
            })
            records, err := s.List(ctx, ListQuery{Status: "all"})
            if err != nil || records.Total != 2 {
                t.Fatal(records, err)
            }

            var expected any
            if tc.result != "" && json.Unmarshal([]byte(tc.result), &expected) != nil {
                expected = tc.result
            }

            wanted, _ := json.Marshal(expected)
            for _, record := range records.Records {
                if record.JobID != info.ID {
                    t.Fatal("原任务身份", record)
                }

                got, _ := json.Marshal(record.ReturnValue)
                switch record.ExecutionNumber {
                case 1:
                    if record.Status != "failed" || string(got) != `{"attempt":1}` {
                        t.Fatalf("上一执行快照：%+v", record)
                    }
                case 2:
                    if record.Status != status || string(got) != string(wanted) {
                        t.Fatalf("本次执行结果：status=%s result=%s，期望 %s／%s", record.Status, got, status, wanted)
                    }
                default:
                    t.Fatal("执行序号", record)
                }
            }

            current, err := inspector.GetTaskInfo(info.Queue, info.ID)
            if err != nil || string(current.Result) != tc.result {
                t.Fatal("原任务仅保留本次结果", current, err)
            }
        })
    }
}
