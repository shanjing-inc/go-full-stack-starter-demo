// Package main 装配应用 Web 进程及其有界关闭流程。
package main

import (
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/logging"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/modules/auth"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/observability"
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
    worker "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/packages/go-server-kit/infra/queue"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/buildinfo"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/config"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/databasegate"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/realtime"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/service"
    "codeup.aliyun.com/shanjing/labs/go-full-stack-starter.git/projects/multi-database-demo/internal/web"

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
func run() (runErr error) {
    c, err := config.Load("web")
    if err != nil {
        return err
    }

    monitoring := observability.New(c.Monitoring, nil)
    defer func() {
        monitoring.Capture(context.Background(), runErr, "web")
        monitoring.Close(time.Second)
    }()

    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    startup, cancel := context.WithTimeout(ctx, 3*time.Second)
    defer cancel()
    gate, err := databasegate.Open(startup, c.Driver, c.DSN)
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
        Secret:            c.AuthSecret,
        BootstrapToken:    c.BootstrapToken,
        Secure:            !c.Development,
        Development:       c.Development,
        Origins:           c.Origins,
        OptionalAuthPaths: []string{web.AdminPath, web.MemberPath},
        AdminPaths: []string{
            web.QueueTestPath,
            "/api/graphql/admin",
            "/api/rest/demo/tasks",
            "/api/rest/poc/tasks",
        },
        PathPermissions: map[string]auth.Permission{
            web.QueueTestPath:          {Resource: "queue", Action: "retry"},
            "/api/rest/demo/shops/:id": {Resource: "shop", Action: "list"},
            "/api/rest/poc/shops/:id":  {Resource: "shop", Action: "list"},
            "/api/rest/demo/tasks":     {Resource: "queue", Action: "retry"},
            "/api/rest/poc/tasks":      {Resource: "queue", Action: "retry"},
        },
        DashboardPermissions: dashboardPermissions,
    })
    if err != nil {
        return err
    }

    publicAssets, err := web.PublicAssets()
    if err != nil {
        return err
    }

    queueTest := tasks.QueueTestService{Client: client, Redis: r, Config: c.Worker}
    api, runtime, err := server.Register(web.New(service.NewDatabase(db), web.Config{
        PublicAssets:   publicAssets,
        QueueTest:      queueTest,
        AllowedOrigins: c.Origins,
        Logger:         monitoring.GraphQLLogger(slog.Default()),
        Introspection:  c.Development,
        Authentication: authentication,
        Queue:          records,
    }), b, realtime)
    if err != nil {
        return err
    }
    monitoring.RegisterHTTP(api)
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

    listener, err := net.Listen("tcp", c.Address)
    if err != nil {
        return errors.New("Web 监听失败")
    }
    defer listener.Close()
    httpServer := &http.Server{
        Handler: web.WithHealth(web.Handler(api, c.Development), func(check context.Context) error {
            if err := gate.Check(check); err != nil {
                return err
            }
            return r.Ping(check).Err()
        }),
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
