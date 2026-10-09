# Go 测试布局规范

更新日期：2026-10-08。

## 固定约定

Go 包级测试与被测业务源码放在同一目录，文件名统一使用 `*_test.go`。正式模块为：

- `/home/dream/wwwroot/go-starter/packages/go-server-kit`。
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo`。

```text
/home/dream/wwwroot/go-starter/packages/go-server-kit/
├── infra/database/
│   ├── dsn.go
│   ├── dsn_test.go
│   └── testdata/connection_urls.json
└── modules/auth/
    ├── service.go
    └── auth_test.go

/home/dream/wwwroot/go-starter/projects/multi-database-demo/
└── internal/web/
    ├── server.go
    └── server_test.go
```

同目录支持两种测试包声明：

- `package auth` 等同包测试：验证私有函数、字段、并发状态及故障注入。
- `package schedule_test` 等外部测试包：显式导入业务包，验证导出接口。

新增测试沿用业务目录和既有包边界；场景增多时，在该目录内按功能拆分 `*_test.go` 文件。测试结构调整须获得用户明确授权。前端浏览器测试、历史 POC 和工具模块延续各自既有布局。

## 布局门禁

`/home/dream/wwwroot/go-starter/scripts/project.py` 的 `validate_go_test_layout` 在 `pnpm test`、`pnpm test:go`、`pnpm test:go:coverage` 和 `pnpm check` 加载 Go 包前检查：

1. 正式 Go 模块使用业务目录承载包级测试，仓库根级和模块根级 `tests/` 目录会触发布局错误。
2. 每个测试目录包含业务 Go 源码；测试包名使用业务包名或业务包名加 `_test`。
3. `.test.go` 文件名触发错误，提示统一使用 `*_test.go`。

扫描跳过 Go 的隐藏目录、下划线目录、`testdata`、vendor、前端依赖和构建产物。布局失败时立即终止本次检查／测试命令；脚本回归覆盖合法包声明、集中目录、独立测试目录、错误包名、错误后缀和三个命令入口的失败阻断。

仓库协作规则同步保存在 `/home/dream/wwwroot/go-starter/AGENTS.md`。

## Fixture 与 Schema 契约

连接 URL 合约样本位于 `/home/dream/wwwroot/go-starter/packages/go-server-kit/infra/database/testdata/connection_urls.json`，Python 与 Go 测试共享该文件。

协议参考样本位于 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/fixtures`。Web 测试从 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/web` 读取：

- `../fixtures/reference-cases.json`。
- `../fixtures/reference-admin.graphql` 与 `../fixtures/reference-member.graphql`。
- `../../schema/common.graphqls` 与 `../../schema/{admin,member}.graphqls`。

Schema 契约持续校验 SDL 读取、Query 存在性、字段类型、参数和可空性。admin 的 `getCurrentPermissions` 保持 `[String!]!` 返回类型与零参数，member 端点保持该字段缺席。`TestPermissionsQueryContract` 保留 8 个子用例；实际 SDL 比对和变异回归复用同一契约校验函数。

## 回归与覆盖率入口

```bash
cd /home/dream/wwwroot/go-starter

# 完整 Go、Python、Dashboard 回归
rtk pnpm test

# 两个正式模块的全部 Go 测试
rtk pnpm test:go

# 全部 Go 测试及业务代码覆盖率
rtk pnpm test:go:coverage

# 格式、Go vet 与前端类型检查
rtk pnpm check

# 覆盖率函数明细
rtk proxy /home/dream/wwwroot/go-starter/.tools/go/bin/go tool cover -func=/home/dream/wwwroot/go-starter/coverage/go.out
```

入口自动重建内嵌前端。完整 Go 测试使用两个模块的 `./...` 范围，同时发现同包测试和外部包测试。覆盖率选择基础设施、业务模块、传输、公共 JSON 校验、应用 cmd、internal 和 webui 包，结果写入 `/home/dream/wwwroot/go-starter/coverage/go.out`。

PostgreSQL Docker 专项使用业务包范围：

- `./packages/go-server-kit/infra/database/...`。
- `./packages/go-server-kit/modules/auth`。
- `./projects/multi-database-demo/internal/service`。

Redis、MySQL、PostgreSQL 与外部进程用例延续原有环境变量门禁；依赖缺席的用例明确报告跳过。完整 Docker、浏览器、race、生产 TLS／代理／Secure Cookie、旧库和容量验收分别记录实际执行结果。

## 2026-10-08 整合审查

本次将 29 个测试文件与 1 个连接 URL fixture 迁回业务目录。正式模块共有 54 个测试文件、151 个顶层测试入口。迁回文件与 HEAD 逐项比对，允许调整仅为 Web 测试读取 fixture 和 SDL 的相对路径。业务源码、导出 API、生成物和数据库迁移延续现有内容。

当前规范集中维护于本文。迁移与恢复的历史过程由 Git 历史及 `/home/dream/wwwroot/go-starter/.runtime/test-layout-restoration` 中的既有证据留存。本轮审查和复验日志位于 `/home/dream/wwwroot/go-starter/.runtime/test-layout-review`。

### 本轮复验结果

| 验证项                      | 结果                                                                     | 日志／证据                                  |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| 全部改动与迁回内容          | 29 个测试文件及 1 个 fixture 核对通过；151 个顶层入口逐项一致            | `inventory.json`、`scope-review.json`       |
| `rtk pnpm test`             | 最终快照通过；工程脚本 29 项、Docker 验收脚本 45 项、Dashboard 54 项通过 | `full-test-final.log`                       |
| `rtk pnpm check`            | 格式检查、Go vet 和两个前端类型检查通过                                  | `full-check.log`                            |
| `rtk pnpm test:go:coverage` | 隔离 Redis 环境通过；业务语句覆盖率 55.7%，84 个业务源码文件             | `go-coverage.log`、`coverage-functions.log` |
| Go 测试发现与执行           | 151 个顶层入口完整保留；计入子用例后 510 项通过、19 项跳过               | `go-json.log`、`validation.json`            |
| 可读性文档与链接            | 211 行表格记录逐项保留，仅同步测试路径；仓库绝对文档链接核对通过         | `scope-review.json`                         |
| 临时资源清理                | 两轮隔离 Redis 进程退出、端口关闭                                        | `validation.json`                           |

19 个跳过用例依赖独立 MySQL／PostgreSQL 测试库或外部 Web／Redis 进程。本轮覆盖 SQLite、隔离 Redis、Schema 契约、Go／Python／Dashboard 回归及验收脚本的模拟测试。真实 MySQL／PostgreSQL、完整 Docker、浏览器、生产环境和旧库／容量专项保留独立验收边界。

race 编译预检因当前环境缺少 `gcc` 受阻，日志为 `race-preflight.log`；race 专项待配置 C 编译器后执行。
