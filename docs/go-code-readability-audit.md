# Go 可读性整理覆盖清单

## 范围与验收口径

全仓库盘点 203 个受版本管理的 Go 文件：185 个手写文件完成整理，其中包含 71 个测试文件；18 个生成文件保持逐字节一致。整理规范见 `docs/go-code-readability.md`。

手写文件保留已有中文说明，并按需要补充声明契约、包职责、测试覆盖主题与实现原因，整理处理阶段空行和密集表达式。表中的“说明复核”表示已核验现有注释与声明；字段和简单私有转发的语义由类型说明或代码直接表达。

行为核对覆盖全部 203 个文件：移除普通注释及位置后的 AST、归一化布局标点后的 Token 与字面值、编译与工具指令。混合生成的 Resolver 保留工具头部与生成约定，手写实现按同一规范处理。

## 目录覆盖

| 目录                           | 手写文件 | 测试文件 | 生成文件 |
| ------------------------------ | -------: | -------: | -------: |
| `packages/go-server-kit`       |       73 |       27 |        0 |
| `poc/database`                 |        6 |        2 |        3 |
| `poc/delivery`                 |       10 |        4 |        0 |
| `poc/realtime`                 |       12 |        5 |        0 |
| `poc/web`                      |       16 |        3 |        4 |
| `poc/worker`                   |        6 |        2 |        0 |
| `projects/multi-database-demo` |       60 |       27 |       11 |
| `tools`                        |        2 |        1 |        0 |

## 手写文件

测试文件路径已按当前同目录布局同步，测试组织规则见 [Go 测试布局规范](/home/dream/wwwroot/go-starter/docs/go-test-layout.md)。原有可读性整理结论保留。

每个文件完成说明与布局复核；表中记录本轮实际处理内容。

| 文件                                                                     | 处理内容                               |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `packages/go-server-kit/infra/bus/json.go`                               | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/infra/bus/redis.go`                              | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/cache/cache.go`                            | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/config/env.go`                             | 中文契约与职责说明                     |
| `packages/go-server-kit/infra/database/dsn.go`                           | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/infra/database/errors.go`                        | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/infra/database/open.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/database/open_test.go`                     | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/database/revision/check.go`                | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/lock/lease.go`                             | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/logging/logger.go`                         | 中文契约与职责说明                     |
| `packages/go-server-kit/infra/queue/enqueue.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/queue/process.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/queue/process_test.go`                     | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/queue/queue.go`                            | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/redisconn/open.go`                         | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/schedule/dashboard.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/infra/schedule/dashboard_test.go`                | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/schedule/scheduler.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/internal/jsonobject/decode.go`                   | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/internal/testredis/redis.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/audit.go`                           | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/auth_test.go`                       | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/compatibility_test.go`              | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/connection.go`                      | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/connection_test.go`                 | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/http.go`                            | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/modules/auth/limit_test.go`                      | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/models.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/pages.go`                           | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/modules/auth/password.go`                        | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/password_length_test.go`            | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/permissions.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/queue_permissions_test.go`          | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/roles.go`                           | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/service.go`                         | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/auth/sessions.go`                        | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/modules/auth/sessions_test.go`                   | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/user_mutations.go`                  | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/modules/auth/user_mutations_test.go`             | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/auth/users.go`                           | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/modules/auth/users_test.go`                      | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/queue/maintenance.go`                    | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/queue/order_test.go`                     | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/queue/queue_test.go`                     | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/queue/redact.go`                         | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/queue/runtime.go`                        | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/queue/runtime_test.go`                   | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/queue/schedules_test.go`                 | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/modules/queue/service.go`                        | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/queue/store.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/queue/types.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/modules/queue/workers.go`                        | 现有中文说明复核；空行或密集布局整理   |
| `packages/go-server-kit/modules/queue/workers_test.go`                   | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/bus/redis_test.go`                         | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/cache/cache_test.go`                       | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/database/dsn_test.go`                      | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/database/revision/check_test.go`           | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/lock/lease_test.go`                        | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/queue/queue_test.go`                       | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/redisconn/open_test.go`                    | 测试主题说明                           |
| `packages/go-server-kit/infra/schedule/redis_test.go`                    | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/infra/schedule/scheduler_test.go`                | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/transport/sse/sse_test.go`                       | 测试主题说明；空行或密集布局整理       |
| `packages/go-server-kit/transport/graphql/errors.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/graphql/server.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/graphql/transport.go`                  | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/httperr/error.go`                      | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/httpx/server.go`                       | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/requestmeta/context.go`                | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/spa/handler.go`                        | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/sse/sse.go`                            | 中文契约与职责说明；空行或密集布局整理 |
| `packages/go-server-kit/transport/ws/accept.go`                          | 中文契约与职责说明；空行或密集布局整理 |
| `poc/database/cmd/gen/main.go`                                           | 中文契约与职责说明                     |
| `poc/database/cmd/schema/main.go`                                        | 中文契约与职责说明                     |
| `poc/database/model/model.go`                                            | 中文契约与职责说明                     |
| `poc/database/schema/export.go`                                          | 现有中文说明复核；空行或密集布局整理   |
| `poc/database/schema/export_test.go`                                     | 测试主题说明；空行或密集布局整理       |
| `poc/database/tests/database_test.go`                                    | 测试主题说明；空行或密集布局整理       |
| `poc/delivery/cmd/web/main.go`                                           | 中文契约与职责说明；空行或密集布局整理 |
| `poc/delivery/cmd/worker/main.go`                                        | 中文契约与职责说明；空行或密集布局整理 |
| `poc/delivery/internal/buildinfo/revision.go`                            | 中文契约与职责说明                     |
| `poc/delivery/internal/config/config.go`                                 | 中文契约与职责说明；空行或密集布局整理 |
| `poc/delivery/internal/config/config_test.go`                            | 测试主题说明；空行或密集布局整理       |
| `poc/delivery/internal/schema/check.go`                                  | 中文契约与职责说明；空行或密集布局整理 |
| `poc/delivery/internal/schema/check_test.go`                             | 测试主题说明；空行或密集布局整理       |
| `poc/delivery/process_test.go`                                           | 测试主题说明；空行或密集布局整理       |
| `poc/delivery/webui/embed.go`                                            | 中文契约与职责说明；空行或密集布局整理 |
| `poc/delivery/webui/embed_test.go`                                       | 测试主题说明；空行或密集布局整理       |
| `poc/realtime/bus/json.go`                                               | 现有中文说明复核；空行或密集布局整理   |
| `poc/realtime/bus/redis.go`                                              | 中文契约与职责说明；空行或密集布局整理 |
| `poc/realtime/bus/redis_test.go`                                         | 测试主题说明；空行或密集布局整理       |
| `poc/realtime/cmd/web/main.go`                                           | 中文契约与职责说明；空行或密集布局整理 |
| `poc/realtime/protocol/protocol.go`                                      | 中文契约与职责说明；空行或密集布局整理 |
| `poc/realtime/server/golden_test.go`                                     | 测试主题说明；空行或密集布局整理       |
| `poc/realtime/server/integration_test.go`                                | 测试主题说明；空行或密集布局整理       |
| `poc/realtime/server/lifecycle_test.go`                                  | 测试主题说明；空行或密集布局整理       |
| `poc/realtime/server/runtime.go`                                         | 中文契约与职责说明；空行或密集布局整理 |
| `poc/realtime/server/socket.go`                                          | 中文契约与职责说明；空行或密集布局整理 |
| `poc/realtime/stream/sse.go`                                             | 中文契约与职责说明；空行或密集布局整理 |
| `poc/realtime/stream/sse_test.go`                                        | 测试主题说明；空行或密集布局整理       |
| `poc/web/cmd/web/main.go`                                                | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/graph/admin/admin.resolvers.go`                                 | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/graph/admin/resolver.go`                                        | 中文契约与职责说明                     |
| `poc/web/graph/member/member.resolvers.go`                               | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/graph/member/resolver.go`                                       | 中文契约与职责说明                     |
| `poc/web/graph/model/adapter.go`                                         | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/graph/model/model.go`                                           | 中文契约与职责说明                     |
| `poc/web/graph/scalar/datetime.go`                                       | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/graph/scalar/datetime_test.go`                                  | 测试主题说明；空行或密集布局整理       |
| `poc/web/server/errors.go`                                               | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/server/server.go`                                               | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/server/server_test.go`                                          | 测试主题说明；空行或密集布局整理       |
| `poc/web/server/transport.go`                                            | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/service/request.go`                                             | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/service/shop.go`                                                | 中文契约与职责说明；空行或密集布局整理 |
| `poc/web/service/shop_test.go`                                           | 测试主题说明；空行或密集布局整理       |
| `poc/worker/cmd/worker/main.go`                                          | 中文契约与职责说明；空行或密集布局整理 |
| `poc/worker/core_test.go`                                                | 测试主题说明；空行或密集布局整理       |
| `poc/worker/processes_test.go`                                           | 测试主题说明；空行或密集布局整理       |
| `poc/worker/queue.go`                                                    | 中文契约与职责说明；空行或密集布局整理 |
| `poc/worker/scheduler.go`                                                | 中文契约与职责说明；空行或密集布局整理 |
| `poc/worker/service.go`                                                  | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/cmd/gen/main.go`                           | 中文契约与职责说明                     |
| `projects/multi-database-demo/cmd/schema/main.go`                        | 中文契约与职责说明                     |
| `projects/multi-database-demo/cmd/web/main.go`                           | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/cmd/web/main_test.go`                      | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/cmd/worker/main.go`                        | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/buildinfo/buildinfo.go`           | 中文契约与职责说明                     |
| `projects/multi-database-demo/internal/config/config.go`                 | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/graph/admin/admin.resolvers.go`   | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/graph/admin/queue.resolvers.go`   | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/graph/admin/queue_helpers.go`     | 中文契约与职责说明                     |
| `projects/multi-database-demo/internal/graph/admin/resolver.go`          | 中文契约与职责说明                     |
| `projects/multi-database-demo/internal/graph/admin/sessions.go`          | 中文契约与职责说明                     |
| `projects/multi-database-demo/internal/graph/admin/users.go`             | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/graph/member/member.resolvers.go` | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/graph/member/resolver.go`         | 中文契约与职责说明                     |
| `projects/multi-database-demo/internal/graph/model/adapter.go`           | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/graph/model/model.go`             | 中文契约与职责说明                     |
| `projects/multi-database-demo/internal/graph/scalar/datetime.go`         | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/model/shop.go`                    | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/pages/pages.go`                   | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/protocol/protocol.go`             | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/realtime/auth_session_test.go`    | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/realtime/golden_test.go`          | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/realtime/integration_test.go`     | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/realtime/lifecycle_test.go`       | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/realtime/query_failure_test.go`   | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/realtime/runtime.go`              | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/realtime/socket.go`               | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/schema/export.go`                 | 现有中文说明复核；空行或密集布局整理   |
| `projects/multi-database-demo/internal/service/database.go`              | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/service/list.go`                  | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/service/request.go`               | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/service/shop.go`                  | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/tasks/queue_test_job.go`          | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/tasks/tasks.go`                   | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/web/pages.go`                     | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/web/server.go`                    | 中文契约与职责说明；空行或密集布局整理 |
| `projects/multi-database-demo/internal/config/config_test.go`            | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/graph/scalar/datetime_test.go`    | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/pages/pages_test.go`              | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/schema/export_test.go`            | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/schema/postgres_test.go`          | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/service/database_test.go`         | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/service/list_test.go`             | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/service/shop_test.go`             | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/tasks/queue_test_job_test.go`     | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/tasks/tasks_test.go`              | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/pages_test.go`                | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/queue_test.go`                | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/server_test.go`               | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/session_test.go`              | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/sessions_test.go`             | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/shop_list_test.go`            | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/shop_permissions_test.go`     | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/user_mutations_test.go`       | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/internal/web/users_test.go`                | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/webui/embed.go`                            | 中文契约与职责说明                     |
| `projects/multi-database-demo/webui/embed_test.go`                       | 测试主题说明；空行或密集布局整理       |
| `projects/multi-database-demo/webui/public.go`                           | 现有中文说明复核；空行或密集布局整理   |
| `projects/multi-database-demo/webui/public_test.go`                      | 测试主题说明；空行或密集布局整理       |
| `tools/cmd/format-go/main.go`                                            | 中文契约与职责说明；空行或密集布局整理 |
| `tools/cmd/format-go/main_test.go`                                       | 测试主题说明；空行或密集布局整理       |

## 生成文件

下列文件由生成流程维护，本轮保持内容原样。

| 文件                                                                | 处理方式       |
| ------------------------------------------------------------------- | -------------- |
| `poc/database/query/gen.go`                                         | 字节一致性核对 |
| `poc/database/query/user.gen.go`                                    | 字节一致性核对 |
| `poc/database/query/verification.gen.go`                            | 字节一致性核对 |
| `poc/web/graph/admin/generated.go`                                  | 字节一致性核对 |
| `poc/web/graph/admin/models_gen.go`                                 | 字节一致性核对 |
| `poc/web/graph/member/generated.go`                                 | 字节一致性核对 |
| `poc/web/graph/member/models_gen.go`                                | 字节一致性核对 |
| `projects/multi-database-demo/internal/graph/admin/generated.go`    | 字节一致性核对 |
| `projects/multi-database-demo/internal/graph/admin/models_gen.go`   | 字节一致性核对 |
| `projects/multi-database-demo/internal/graph/member/generated.go`   | 字节一致性核对 |
| `projects/multi-database-demo/internal/graph/member/models_gen.go`  | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/account.gen.go`        | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/auth_bootstrap.gen.go` | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/gen.go`                | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/session.gen.go`        | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/shop.gen.go`           | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/user.gen.go`           | 字节一致性核对 |
| `projects/multi-database-demo/internal/query/verification.gen.go`   | 字节一致性核对 |

## 验证记录

| 项目                    | 结果                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| 203 文件源码对照        | AST、归一化 Token、字面值、编译与工具指令一致；前两批样板的原始基线再次核对通过              |
| 18 个生成文件           | 与整理前逐字节一致                                                                           |
| 导出声明说明            | 手写生产代码的导出类型、常量、变量、函数及具体方法均有文档注释；字段和接口方法按类型说明复核 |
| 项目检查                | `rtk pnpm check` 通过四空格格式、Go vet 和前端类型检查                                       |
| 完整测试入口            | `rtk pnpm test` 通过格式工具、Python 编排脚本、正式 Go 与共享 UI；UI 为 54 项通过            |
| 正式 Go 隔离 Redis 补跑 | 132 个根测试、472 项叶级执行通过；19 个根用例按外部条件跳过                                  |
| Worker POC 进程协调验收 | 21 项流程检查、34 项叶级执行通过；包含双 Worker、真实崩溃、Redis 持久化重启及退出重新消费    |
| 实时 POC 进程协调验收   | 14 项流程检查、82 项叶级执行通过；包含双 Web、Redis 中断、设备 TTL 和存量连接关闭            |
| 其他独立 module         | Database、Web、Delivery POC 及格式工具测试通过；外部条件跳过见下表                           |

正式 Go 补跑使用随机 loopback 端口的独立 Redis，执行结束后清理测试实例。历史 Worker 和实时 POC 通过现有协调脚本启动和回收各自测试进程。直接运行 Worker `go test ./...` 时，外部协调条件缺失会使该套件按设计失败；协调脚本准备依赖后的验收全部通过。

| 条件限制                         | 用例数量 | 说明                                                                      |
| -------------------------------- | -------: | ------------------------------------------------------------------------- |
| 正式 Go 的 MySQL/PostgreSQL 集成 |       15 | 缺少独立测试 DSN，SQLite 与隔离 Redis 用例已执行                          |
| 正式 Go 的外部双 Web 生命周期    |        4 | 缺少该套件的外部进程地址与 PID；历史实时 POC 的独立进程协调验收已单独执行 |
| Database POC 的 MySQL 集成       |        2 | 缺少 `POC_MYSQL_DSN`                                                      |
| Delivery POC 的外部进程协调      |        2 | 缺少该套件的外部 Web 与关闭协调配置                                       |

Docker、race、真实数据库与生产部署沿用各自专项验收边界。本清单记录可读性整理及本次实际验证范围。
