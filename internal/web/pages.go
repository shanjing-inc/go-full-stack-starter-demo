package server

import (
    "context"
    "encoding/json"
    "errors"
    "io"
    "net/http"
    "time"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    records "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/pages"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/tasks"
    "github.com/hibiken/asynq"
    "github.com/labstack/echo/v5"
)

// QueueTestPath 定义演示任务投递接口路径。
const QueueTestPath = "/api/rest/demo/queue-test"

// QueueTestDispatcher 让页面投递复用应用任务定义，便于隔离测试。
type QueueTestDispatcher interface {
    Enqueue(context.Context, string, string) (*asynq.TaskInfo, error)
}

// QueueTestRecords 仅暴露列表读取，页面限定演示任务类型及最近 20 条。
type QueueTestRecords interface {
    List(context.Context, records.ListQuery) (*records.RecordsPayload, error)
}

// registerPages 注册公开 SSR 与演示投递入口，读取和写入分别复核权限并限制队列 I/O 时间。
func registerPages(e *echo.Echo, config Config) {
    home := func(c *echo.Context) error { return pages.Render(c, pages.Home(config.PublicAssets), http.StatusOK) }
    e.GET("/", home)
    e.HEAD("/", home)
    e.GET("/public/theme.js", pages.Theme)
    e.HEAD("/public/theme.js", pages.Theme)
    queuePage := func(c *echo.Context) error {
        data := pages.QueuePage(config.PublicAssets)
        // HEAD 只验证资源存在，跳过会话和队列 I/O。
        if c.Request().Method == http.MethodHead {
            return pages.Render(c, data, http.StatusOK)
        }
        if config.Authentication == nil {
            return pages.Render(c, data, http.StatusOK)
        }
        if err := config.Authentication.AuthenticatePage(c); err != nil {
            if errors.Is(err, auth.ErrUnauthorized) || errors.Is(err, auth.ErrBanned) {
                return pages.Render(c, data, http.StatusOK)
            }

            data.Message = "会话校验暂时不可用，请稍后重试"
            return pages.Render(c, data, http.StatusServiceUnavailable)
        }

        user, _ := auth.UserFrom(c.Request().Context())
        if !config.Authentication.Allows(user, "dashboard", "access:admin") || !config.Authentication.Allows(user, "queue", "read") {
            data.Message = "当前账号缺少队列读取权限"
            return pages.Render(c, data, http.StatusForbidden)
        }

        data.CanRead, data.UserName = true, user.Name
        data.CanDispatch = config.QueueTest != nil && config.Authentication.Allows(user, "queue", "retry")
        source := config.QueueTestRecords
        if source == nil && config.Queue != nil {
            source = config.Queue
        }
        if source == nil {
            data.CanDispatch = false
            data.Message = "队列服务暂时不可用"
            return pages.Render(c, data, http.StatusServiceUnavailable)
        }

        ctx, cancel := context.WithTimeout(c.Request().Context(), 3*time.Second)
        defer cancel()
        rows, err := source.List(ctx, records.ListQuery{
            Status:         "recent",
            JobName:        tasks.QueueTestType,
            Limit:          20,
            OrderBy:        "sortAt",
            OrderDirection: "desc",
        })
        if err != nil {
            data.Message = "执行记录读取失败，请稍后刷新"
            return pages.Render(c, data, http.StatusServiceUnavailable)
        }

        for _, row := range rows.Records {
            data.Records = append(data.Records, pages.ProjectRecord(row))
        }

        return pages.Render(c, data, http.StatusOK)
    }
    e.GET("/test/queue", queuePage)
    e.HEAD("/test/queue", queuePage)

    e.POST(QueueTestPath, func(c *echo.Context) error {
        if config.Authentication == nil || config.QueueTest == nil {
            return c.JSON(http.StatusServiceUnavailable, map[string]string{"message": "队列服务暂时不可用"})
        }

        ctx, cancel := context.WithTimeout(c.Request().Context(), 3*time.Second)
        defer cancel()
        user, err := config.Authentication.AuthorizeCurrent(ctx, "queue", "read", "retry")
        if err != nil {
            return err
        }
        if !config.Authentication.Allows(user, "dashboard", "access:admin") {
            return c.JSON(http.StatusForbidden, map[string]string{"message": "当前账号缺少后台访问权限"})
        }

        var input struct {
            Queue string `json:"queue"`
            Mode  string `json:"mode"`
        }
        c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 4096)
        decoder := json.NewDecoder(c.Request().Body)
        decoder.DisallowUnknownFields()
        if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || (!tasks.ValidTestQueue(input.Queue) && input.Queue != "all") || !tasks.ValidTestMode(input.Mode) {
            return c.JSON(http.StatusBadRequest, map[string]string{"message": "请选择有效的队列和执行模式"})
        }

        queues := []string{input.Queue}
        if input.Queue == "all" {
            queues = []string{"critical", "default", "low"}
        }

        type result struct {
            Queue string `json:"queue"`
            ID    string `json:"id,omitempty"`
            Error string `json:"error,omitempty"`
        }
        results := []result{}
        successful := 0
        for _, queue := range queues {
            row := result{Queue: queue}
            info, err := config.QueueTest.Enqueue(ctx, queue, input.Mode)
            if err != nil {
                row.Error = "任务投递失败，请稍后重试"
            } else {
                row.ID = info.ID
                successful++
            }

            results = append(results, row)
        }

        status := http.StatusAccepted
        if successful == 0 {
            status = http.StatusServiceUnavailable
        }

        message := "投递请求已完成，刷新页面查看执行记录"
        if successful == 0 {
            message = "任务投递失败，请稍后重试"
        }
        return c.JSON(status, map[string]any{"results": results, "message": message})
    })
}
