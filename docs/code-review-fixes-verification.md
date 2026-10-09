# 2026-10-04 代码审查修复验收

工作目录：`/home/dream/wwwroot/go-starter`；分支：`develop`。本轮在既有迁移改动上修复 F01／F02／F03 及权限风险 R01。工作区保留全部原有改动，commit／push 保持待授权状态。

## 1. 修复范围

### F01：WebSocket 会话生命周期

- Guard 将握手认证关联的数据库复核函数写入 context，Bus WebSocket 在实际发送、处理输入、接收 Bus 消息和空闲刷新周期调用。
- 退出撤销、过期、封禁、用户删除、角色／有效权限变化及数据库读取失败结束连接，设备 presence 随连接清理。
- 复核读取共享数据库，独立数据库连接／独立 Service 的退出撤销可以使已建立连接失效。默认空闲检查周期 500 毫秒，单次复核超时 3 秒；数据库读延迟及复核到发送间的并发窗口纳入生产验收。
- WebSocket 复核保持数据库中的有效期；HTTP 身份查询保留七天滑动续期。SQLite 旧日期文本的有效期按 Go 时间点比较，覆盖带时区的过期值。
- SSE 查询继续沿用 HTTP 请求截止／取消生命周期。已发送帧与已发布回执保持完成状态。

对应代码：

- `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/connection.go`
- `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/http.go`
- `/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/service.go`
- `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/realtime/socket.go`

### F02：邮箱账号等价规则与限流

- IP 桶先执行，保持每分钟 20 次；随后按登录的数据库邮箱匹配规则查询账号。
- 已注册邮箱使用稳定账号 ID 的共享桶，每分钟 5 次。旧 MySQL 大小写／重音等价邮箱使用相同额度，密码校验与旧库匹配能力保留。
- 未知账号使用规范化邮箱桶；Redis 键使用 HMAC 隐藏原始账号与 IP 标识。数据库／Redis 故障进入受控错误边界。

对应回归：`/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/limit_test.go`。

### F03：创建请求与页面生命周期

- 创建请求使用独立 AbortController，店铺页面卸载时取消客户端等待。
- 请求取消后，成功／失败／finally 回调均跳过页面更新与导航，浏览器后退保持用户选择的位置。
- 服务端已经完成的创建保持有效，重新进入店铺列表可以读取服务端最终结果。

对应代码：`/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/src/shops.tsx`；浏览器回归：`/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/tests/shops.spec.ts`。

### R01：店铺读取／创建动作拆分

- `shop:list` 保护列表与详情读取，`shop:create` 保护创建 mutation。
- 默认 owner／admin 显式持有创建动作，既有默认管理能力保持。
- 自定义只读角色保留列表访问；前端创建入口依据 `shop:create` 显示，GraphQL mutation 执行同一写门禁。
- 浏览器导航夹具同步加入创建权限，覆盖创建后的列表查询去重。

对应代码：`/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/permissions.go` 与 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/graph/admin/admin.resolvers.go`。

## 2. 自动验证

隔离运行目录：`/home/dream/wwwroot/go-starter/.runtime/review-fixes-20261004`。MySQL 使用本轮新 datadir 与测试库；Redis 使用随机端口、独立进程及空数据；浏览器使用正式 SQLite migrations、新数据库、新 Web 与 Vite 服务。开发数据库、真实账号与用户环境文件保持原状，测试进程在 finally 中关闭。

| 项目                                  | 结果                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| 正式 Go 模块测试                      | 391 条父／子用例通过记录；19 个含测试包通过；4 个外部进程用例跳过 |
| Go vet                                | 通过                                                              |
| Dashboard／应用类型检查               | 两项通过                                                          |
| 公共 UI 单测                          | 10 项通过                                                         |
| 浏览器全量回归                        | 61 项通过；失败／跳过／flaky 均为 0                               |
| Python 开发／格式／工程／验收脚本单测 | 见本轮最终 checks.json                                            |
| 四空格 formatter 单测／vet            | 见本轮最终 checks.json                                            |
| 全仓格式与 diff 检查                  | 见本轮最终 checks.json                                            |

回归重点：

1. 两类 WebSocket × 退出／封禁／过期／角色变更 × 空闲／消息发送；失效设备 presence 清理。
2. 设备回执使用有效协议格式，退出后 result／error 均被拦截。
3. 公共复核覆盖用户删除、有效权限变化、数据库故障、带时区过期与 HTTP 续期保留。
4. 真实 MySQL／Redis 中同账号五次登录成功，第六次原邮箱以及后续重音别名均返回 429；未知账号与 IP 桶另有回归。
5. 创建请求等待期间浏览器后退，请求取消事件可见，迟到成功／失败均保持系统概览；只读角色隐藏创建入口。
6. GraphQL 只读角色可查询列表、创建返回 FORBIDDEN；默认 admin／owner 创建成功。

执行记录：

- `/home/dream/wwwroot/go-starter/.runtime/review-fixes-20261004/checks.json`
- `/home/dream/wwwroot/go-starter/.runtime/review-fixes-20261004/go-tests.log`
- `/home/dream/wwwroot/go-starter/.runtime/review-fixes-20261004/browser-suite-final.json`
- `/home/dream/wwwroot/go-starter/.runtime/review-fixes-20261004/browser-suite-production.json`
- `/home/dream/wwwroot/go-starter/.runtime/review-fixes-20261004/changed-from-review.json`

首轮浏览器回归暴露导航测试夹具仅声明旧读取权限，已同步新增 `shop:create` 后全量重跑。首轮格式检查记录新增回执夹具的格式差异，后续按项目 formatter 统一。

## 3. 人工验收

使用独立验收账号和测试库，保持开发与生产真实数据原状。

1. 管理员登录后打开店铺列表，创建唯一标识的新店铺，检查成功提示、第一页与筛选清理、一次列表刷新。
2. 浏览器开发者工具延迟 createShop 响应，提交后后退到系统概览；释放响应后检查 URL 保持概览。重新进入列表确认服务端实际创建结果。
3. 在独立配置中增加 `shop_reader` 角色，赋予 `dashboard:access:admin` 与 `shop:list`；确认列表可读、创建入口隐藏、直接调用 createShop 返回 FORBIDDEN。
4. 使用已登录账号分别建立广播和设备 WebSocket，然后退出；检查连接结束、广播／指令停止、设备 presence 清理。封禁、到期和角色变更用独立测试数据重复此项。
5. 独立 MySQL 账号使用普通邮箱和数据库等价的重音别名登录；同账号一分钟内第六次请求返回 429，等待限流窗口结束后按新窗口计数。

## 4. 验证边界

- 四个外部进程专项：`TestExternalWebProcesses`、`TestExternalRedisStop`、`TestExternalCrashTTL`、`TestExternalShutdown` 保留 pending；本轮跨实例会话撤销验证使用同进程内的独立数据库连接／Service。
- 本机 C 编译器与 Docker 命令缺失，race detector 与容器验证保持 pending；生产 TLS／代理、跨域 Cookie、真实旧库导入、多进程故障及高连接数／高消息速率容量专项继续验收。
- 本轮默认权限新增独立写动作属于已授权的安全改进；自定义角色需显式配置 `shop:create` 才能创建店铺。
