package database

// 本文件覆盖启动握手期限、取消时连接池清理、成功后的上下文解绑及 PostgreSQL 错误翻译。

import (
    "context"
    "database/sql"
    "database/sql/driver"
    "errors"
    "io"
    "net"
    "sync/atomic"
    "testing"
    "time"

    mysqldriver "github.com/go-sql-driver/mysql"
    "github.com/jackc/pgx/v5/pgconn"
    "gorm.io/driver/mysql"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

func TestOpenMySQLHandshakeDeadline(t *testing.T) {
    listener, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        t.Fatal(err)
    }
    defer listener.Close()
    peers := make(chan net.Conn, 1)
    go func() {
        peer, err := listener.Accept()
        if err == nil {
            peers <- peer
        }
    }()
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    result := make(chan error, 1)
    started := time.Now()
    go func() {
        db, err := Open(ctx, "mysql", "probe@tcp("+listener.Addr().String()+")/probe")
        if db != nil {
            pool, _ := db.DB()
            pool.Close()
        }
        result <- err
    }()
    var peer net.Conn
    select {
    case peer = <-peers:
        defer peer.Close()
    case <-time.After(2 * time.Second):
        t.Fatal("未收到数据库握手连接")
    }

    select {
    case err := <-result:
        if !errors.Is(err, context.DeadlineExceeded) {
            t.Fatalf("应返回启动超时：%v", err)
        }
    case <-time.After(time.Second):
        t.Fatal("数据库握手超过 context 超时仍未返回")
    }

    t.Logf("慢握手在 %s 内结束", time.Since(started))
    peer.SetReadDeadline(time.Now().Add(time.Second))
    if _, err := peer.Read(make([]byte, 1)); err != io.EOF {
        t.Fatalf("超时后应关闭连接：%v", err)
    }
}

func TestOpenCanceledContext(t *testing.T) {
    for _, driver := range []string{"mysql", "postgres", "sqlite"} {
        t.Run(driver, func(t *testing.T) {
            ctx, cancel := context.WithCancel(context.Background())
            cancel()
            // 无效 DSN 验证入口直接处理已取消的 context。
            db, err := Open(ctx, driver, "无效 DSN")
            if db != nil || !errors.Is(err, context.Canceled) {
                t.Fatalf("应返回取消错误：%v %v", db, err)
            }
        })
    }
}

func TestOpenSQLiteDetachesStartupContext(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    db, err := Open(ctx, "sqlite", ":memory:")
    if err != nil {
        t.Fatal(err)
    }

    pool, err := db.DB()
    if err != nil {
        t.Fatal(err)
    }
    defer pool.Close()
    cancel()
    var value int
    if err := db.WithContext(context.Background()).Raw("SELECT 1").Scan(&value).Error; err != nil || value != 1 {
        t.Fatalf("启动 context 结束后的查询应独立运行：%d %v", value, err)
    }
    if db.ConnPool != pool || db.Statement.ConnPool != pool {
        t.Fatal("初始化后应恢复原始连接池")
    }
}

// 使用可控连接分别阻塞版本探测和首次 Ping，覆盖初始化的两个阶段。
type initializationConnector struct {
    stage  string
    closed atomic.Bool
    stop   chan struct{}
}

func (c *initializationConnector) Connect(ctx context.Context) (driver.Conn, error) {
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    return &initializationConnection{connector: c}, nil
}

func (c *initializationConnector) Driver() driver.Driver { return initializationDriver{} }

type initializationDriver struct{}

func (initializationDriver) Open(string) (driver.Conn, error) {
    return nil, errors.New("测试连接使用 Connector")
}

type initializationConnection struct{ connector *initializationConnector }

func (c *initializationConnection) Close() error {
    c.connector.closed.Store(true)
    return nil
}

func (*initializationConnection) Prepare(string) (driver.Stmt, error) {
    return nil, errors.New("测试连接只处理版本查询")
}

func (*initializationConnection) Begin() (driver.Tx, error) {
    return nil, errors.New("测试连接只处理版本查询")
}

func (c *initializationConnection) wait(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-c.connector.stop:
        return errors.New("测试结束")
    }
}

func (c *initializationConnection) QueryContext(ctx context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
    if query != "SELECT VERSION()" {
        return nil, errors.New("版本查询语句无效")
    }
    if c.connector.stage == "version" {
        return nil, c.wait(ctx)
    }
    return &versionRows{}, nil
}

func (c *initializationConnection) Ping(ctx context.Context) error {
    if c.connector.stage == "ping" {
        return c.wait(ctx)
    }
    return nil
}

type versionRows struct{ read bool }

func (*versionRows) Columns() []string { return []string{"version"} }

func (*versionRows) Close() error { return nil }

func (r *versionRows) Next(values []driver.Value) error {
    if r.read {
        return io.EOF
    }

    values[0], r.read = "8.0.46", true
    return nil
}

func TestInitializeDeadlineClosesPool(t *testing.T) {
    for _, stage := range []string{"version", "ping"} {
        t.Run(stage, func(t *testing.T) {
            connector := &initializationConnector{stage: stage, stop: make(chan struct{})}
            defer close(connector.stop)
            pool := sql.OpenDB(connector)
            defer pool.Close()
            ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
            defer cancel()
            result := make(chan error, 1)
            go func() {
                _, err := initialize(ctx, "mysql", "probe@tcp(localhost:3306)/probe", pool)
                result <- err
            }()
            select {
            case err := <-result:
                if !errors.Is(err, context.DeadlineExceeded) {
                    t.Fatalf("初始化阶段应返回超时：%v", err)
                }
            case <-time.After(time.Second):
                t.Fatal("初始化阶段超过 context 超时仍未返回")
            }

            if !connector.closed.Load() || pool.PingContext(context.Background()) == nil {
                t.Fatal("初始化失败应关闭连接和连接池")
            }
        })
    }
}

func TestInitializeMySQLDetachesStartupContext(t *testing.T) {
    connector := &initializationConnector{stop: make(chan struct{})}
    defer close(connector.stop)
    pool := sql.OpenDB(connector)
    defer pool.Close()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    db, err := initialize(ctx, "mysql", "probe@tcp(localhost:3306)/probe", pool)
    if err != nil {
        t.Fatal(err)
    }
    cancel()
    dialect := db.Dialector.(*mysql.Dialector)
    if dialect.ServerVersion != "8.0.46" || dialect.Conn != pool || db.ConnPool != pool || db.Statement.ConnPool != pool {
        t.Fatal("初始化后应保留版本探测结果并恢复原始连接池")
    }

    var version string
    if err := db.WithContext(context.Background()).Raw("SELECT VERSION()").Scan(&version).Error; err != nil || version != "8.0.46" {
        t.Fatalf("启动 context 结束后的查询应独立运行：%s %v", version, err)
    }
    if err := db.AddError(&mysqldriver.MySQLError{Number: 1062}); !errors.Is(err, gorm.ErrDuplicatedKey) {
        t.Fatalf("应保留 MySQL 错误转译：%v", err)
    }
}

// PostgreSQL Ping 的握手使用启动 context，连接在超时后释放。
func TestOpenPostgreSQLHandshakeDeadline(t *testing.T) {
    listener, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        t.Fatal(err)
    }
    defer listener.Close()
    closed := make(chan struct{})
    go func() {
        peer, err := listener.Accept()
        if err != nil {
            return
        }
        defer peer.Close()
        _, _ = io.Copy(io.Discard, peer)
        close(closed)
    }()
    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()
    db, err := Open(ctx, "postgres", "postgres://probe@"+listener.Addr().String()+"/probe?sslmode=disable")
    if db != nil || !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("PostgreSQL 握手应服从启动 deadline：%v %v", db, err)
    }

    select {
    case <-closed:
    case <-time.After(time.Second):
        t.Fatal("PostgreSQL 超时连接释放失败")
    }
}

func TestPostgreSQLDriverAndErrorTranslation(t *testing.T) {
    if SQLDriver("postgres") != "pgx" || SQLDriver("mysql") != "mysql" || SQLDriver("sqlite") != "sqlite" {
        t.Fatal("SQL 驱动映射漂移")
    }

    dialect := postgres.New(postgres.Config{}).(*postgres.Dialector)
    if !IsDuplicate(dialect.Translate(&pgconn.PgError{Code: "23505"})) {
        t.Fatal("PostgreSQL 唯一约束错误转换失败")
    }
    if !errors.Is(dialect.Translate(&pgconn.PgError{Code: "23503"}), gorm.ErrForeignKeyViolated) {
        t.Fatal("PostgreSQL 外键错误转换失败")
    }
}
