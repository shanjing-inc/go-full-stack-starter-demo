// Package main 装配应用 Web 进程及其有界关闭流程。
package main

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/logging"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/tasks"
    "context"
    "encoding/json"
    "errors"
    "io"
    "log/slog"
    "net"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
    _ "time/tzdata"

    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/bus"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/database/revision"
    worker "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/buildinfo"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/config"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/realtime"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    web "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/webui"

    queuerecords "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/queue"
    "github.com/hibiken/asynq"
    "github.com/labstack/echo/v5"
)

// dashboardPermissions 为所有有效身份提供 demo:read，完整 owner/admin 角色追加 demo:write。
func dashboardPermissions(user *auth.User) []string {
    permissions := []string{"demo:read"}
    if auth.HasRole(user, "owner", "admin") {
        permissions = append(permissions, "demo:write")
    }
    return permissions
}

// main 装配结构化日志并运行 Web，启动或退出失败时返回非零退出码。
func main() {
    slog.SetDefault(logging.New(os.Stdout, slog.LevelInfo))
    if err := run(); err != nil {
        slog.Error("Web 退出", "error", err)
        os.Exit(1)
    }
}

// run 先核验配置、数据库版本与依赖，再装配路由；信号取消后按配置期限收敛 Web 和实时连接。
func run() error {
    c, err := config.Load("web")
    if err != nil {
        return err
    }

    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    startup, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()
    gate, err := schema.Open(startup, c.Driver, c.DSN, c.Version)
    if err != nil {
        return err
    }
    defer gate.Close()
    r, opt, err := worker.Open(c.Worker)
    if err != nil {
        return errors.New("Redis 配置失败")
    }
    defer r.Close()
    if r.Ping(startup).Err() != nil {
        return errors.New("Redis 启动检查失败")
    }

    inspector := asynq.NewInspector(opt)
    defer inspector.Close()
    records, err := queuerecords.New(r, inspector, c.Worker, c.QueueRecordRetention, tasks.DemoSchedule)
    if err != nil {
        return err
    }

    c.Worker.Observer = records
    client := asynq.NewClient(opt)
    defer client.Close()
    b, err := bus.New(r, bus.Config{
        Prefix:      c.Worker.Namespace,
        Environment: "default",
        Name:        "bus-demo",
        InstanceID:  c.Worker.Instance,
    })
    if err != nil {
        return err
    }
    defer b.Close()
    realtime := server.Defaults()
    realtime.Origins = c.Origins
    db, err := database.Open(startup, c.Driver, c.DSN)
    if err != nil {
        return err
    }

    sqlDB, _ := db.DB()
    defer sqlDB.Close()
    authentication, err := auth.New(db, auth.Config{
        Secret:         c.AuthSecret,
        BootstrapToken: c.BootstrapToken,
        Secure:         !c.Development,
        Origins:        c.Origins,
        AdminPaths: []string{
            web.QueueTestPath,
            "/api/graphql/admin",
            "/api/rest/demo/overview",
            "/api/rest/demo/tasks",
            "/api/rest/poc/tasks",
            "/api/rest/demo/session",
        },
        PathPermissions: map[string]auth.Permission{
            web.QueueTestPath:          {Resource: "queue", Action: "retry"},
            "/api/rest/demo/shops/:id": {Resource: "shop", Action: "list"},
            "/api/rest/poc/shops/:id":  {Resource: "shop", Action: "list"},
            "/api/rest/demo/overview":  {Resource: "shop", Action: "list"},
            "/api/rest/demo/tasks":     {Resource: "queue", Action: "retry"},
            "/api/rest/poc/tasks":      {Resource: "queue", Action: "retry"},
        },
        DashboardPath:        "/api/rest/demo/session",
        DashboardPermissions: dashboardPermissions,
    })
    if err != nil {
        return err
    }

    publicAssets, err := webui.PublicAssets()
    if err != nil {
        return err
    }

    queueTest := tasks.QueueTestService{Client: client, Redis: r, Config: c.Worker}
    api, runtime, err := server.Register(web.New(service.NewDatabase(db), web.Config{
        PublicAssets:   publicAssets,
        QueueTest:      queueTest,
        AllowedOrigins: c.Origins,
        Logger:         slog.Default(),
        Introspection:  c.Development,
        Authentication: authentication,
        Queue:          records,
    }), b, realtime)
    if err != nil {
        return err
    }
    if err := authentication.Register(api, auth.RedisLimiter{Client: r, Prefix: c.Worker.Namespace}); err != nil {
        return err
    }

    buildHandler := func(e *echo.Context) error {
        return e.JSON(200, map[string]any{
            "revision": buildinfo.Revision,
            "role":     "web",
            "pid":      os.Getpid(),
        })
    }
    api.GET("/api/rest/demo/build", buildHandler)
    api.GET("/api/rest/poc/build", buildHandler)
    api.GET("/health/live", func(e *echo.Context) error { return e.JSON(200, map[string]any{"status": "alive"}) })
    api.GET("/health/ready", func(e *echo.Context) error {
        check, done := context.WithTimeout(e.Request().Context(), time.Second)
        defer done()
        if gate.Check(check) != nil || r.Ping(check).Err() != nil {
            return e.JSON(503, map[string]any{"status": "unavailable"})
        }
        return e.JSON(200, map[string]any{"status": "ready"})
    })
    taskHandler := func(e *echo.Context) error {
        var p tasks.Payload
        request := e.Request()
        request.Body = http.MaxBytesReader(e.Response(), request.Body, 4096)
        decoder := json.NewDecoder(request.Body)
        decoder.DisallowUnknownFields()
        if decoder.Decode(&p) != nil || decoder.Decode(new(any)) != io.EOF || p.Key == "" || len(p.Key) > 512 || p.WorkMS < 0 || p.WorkMS > 5000 {
            return e.JSON(400, map[string]string{"error": "任务参数无效"})
        }

        enqueue, done := context.WithTimeout(request.Context(), time.Second)
        defer done()
        task, err := tasks.Enqueue(enqueue, client, c.Worker, p)
        if errors.Is(err, asynq.ErrTaskIDConflict) {
            return e.JSON(409, map[string]string{"error": "任务已投递"})
        }
        if err != nil {
            return e.JSON(503, map[string]string{"error": "任务投递失败"})
        }
        return e.JSON(202, map[string]string{"id": task.ID})
    }
    api.POST("/api/rest/demo/tasks", taskHandler)
    api.POST("/api/rest/poc/tasks", taskHandler)

    api.GET("/api/rest/demo/overview", func(e *echo.Context) error {
        var count int64
        if db.WithContext(e.Request().Context()).Table("shop").Count(&count).Error != nil {
            return e.JSON(503, map[string]string{"error": "数据读取失败"})
        }
        return e.JSON(200, map[string]any{"shops": count, "backend": "Go / Echo", "mode": "development"})
    })
    listener, err := net.Listen("tcp", c.Address)
    if err != nil {
        return errors.New("Web 监听失败")
    }
    defer listener.Close()
    httpServer := &http.Server{
        Handler:           webui.Handler(api),
        ReadHeaderTimeout: 3 * time.Second,
        ReadTimeout:       10 * time.Second,
        IdleTimeout:       30 * time.Second,
    }
    served := make(chan error, 1)
    go func() { served <- httpServer.Serve(listener) }()
    slog.Info("Web 就绪", "revision", buildinfo.Revision, "pid", os.Getpid(), "address", listener.Addr().String())
    select {
    case err = <-served:
        runtime.Close()
        return err
    case <-ctx.Done():
    }

    cleaned := make(chan struct{})
    go func() {
        runtime.Close()
        close(cleaned)
    }()
    shutdown, done := context.WithTimeout(context.Background(), c.Shutdown)
    defer done()
    select {
    case <-cleaned:
    case <-shutdown.Done():
        httpServer.Close()
        return errors.New("实时连接退出超时")
    }

    if err = httpServer.Shutdown(shutdown); err != nil {
        httpServer.Close()
        return errors.New("Web 优雅退出超时")
    }

    err = <-served
    if errors.Is(err, http.ErrServerClosed) {
        slog.Info("Web 已退出")
        return nil
    }
    return err
}
