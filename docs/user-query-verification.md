# R2 第一批：权限与用户只读查询验收

日期：2026-10-04。工作目录：`/home/dream/wwwroot/go-starter`，开发分支：`develop`。本轮代码保留工作区，提交由用户单次授权。

## 1. 交付范围

- 公共 auth：可配置 owner／admin／member／user 资源动作矩阵、组合角色并集、`Allows`／`Require`／`Permissions`。
- 入口授权：AdminPaths 使用 `dashboard:access:admin`；PathPermissions 支持实际 URL 与 Echo 模板路径；REST／GraphQL／连接入口复用门禁。
- 公共查询：CurrentUser／GetUser／ListUsers；应用 Admin SDL 与 resolver 对齐参考 `getCurrentUser`、`getUser`、`listUsers`。
- 公共 Dashboard：可选用户查询 adapter、只读 UserList、头像组件、四项 URL 筛选、稳定分页、请求取消、错误重试、权限直达保护及移动主题。
- 查询审计：操作者、资源、动作、目标、结果、UTC 时间及 request ID，缺省 slog 输出并支持应用 sink。
- 现有数据库模型、迁移版本、邮箱密码与会话行为保持兼容。手机号继续延期。

用户创建／编辑／删除、角色修改、封禁／解封、密码管理、所有权转移、最后可用 owner 保护及会话列表／撤销／删除留在下一批。

## 2. 自动验收

本批执行 `pnpm generate`、`pnpm format`、`pnpm check`、`pnpm test` 及完整 `pnpm verify`，最终源码全部通过。

| 验收项               | 最终结果                                           |
| -------------------- | -------------------------------------------------- |
| 完整流程检查         | 18 项全部通过，耗时 212.50 秒                      |
| Go 测试              | 365 条通过记录，统计包含父用例与子用例             |
| 公共 Dashboard 单测  | 10 项通过                                          |
| 生产构建浏览器       | 26 项通过，跳过／失败／flaky 均为 0                |
| Vite／Air 开发浏览器 | 26 项通过，跳过／失败／flaky 均为 0                |
| 实时查询超时定向回归 | 连续 30 轮通过，270 条父／子用例通过记录，跳过为 0 |

完整报告：`/home/dream/wwwroot/go-starter/.runtime/project-1uj0mngy/result.json`；同目录的 `browser.json`、`browser-dev.json` 保存双浏览器结果。最近报告入口为 `.runtime/project-latest.json`。定向回归报告：`/home/dream/wwwroot/go-starter/.runtime/r2-query-timeout-4a0pbor_/result.json`，同目录 `repeat.log` 保存逐项结果。以上文件均为本地隔离运行产物。

### 权限与协议

`/home/dream/wwwroot/go-starter/packages/go-server-kit/modules/auth/users_test.go` 覆盖默认矩阵、组合／未知／大小写／子串、空策略、配置深复制、公共门禁、REST 动态路径、GraphQL 路径、WS／SSE 入口权限及会话权限一致性。

`/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/web/users_test.go` 使用真实隔离 SQLite、数据库会话和 Guard 执行 GraphQL：owner／admin／组合管理员允许，member／user／匿名拒绝；自定义只读角色可读列表和当前用户，单用户／店铺与创建动作按资源权限拒绝。覆盖受控输入错误、缺少用户服务、秒级 UTC 时间、nullable 字段、请求标识与审计关联。

`/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/web/server_test.go` 对固定参考 SDL 逐字段比对 Query、UserItem、UserFilters、UserOrderBy 的类型、参数与可空性。

### 查询与审计

公共查询测试在隔离 SQLite 与真实 MySQL 执行同一组断言：整数／字符串全部声明操作符、LIKE／ILIKE、NULL／布尔、空数组、精确组合角色字段、稳定排序、offset／limit、空结果、SQL 注入值、无效排序／长度／数组限制、取消和权限拒绝。

审计检查 success／denied／failed、actor／target／request ID／时间关联。用户查询条件、密码与会话 token 保持在事件载荷之外。GetUser 命中后以实际用户 ID 作为目标。

### 页面

公共组件单测覆盖会话加载门禁、403 和用户表格／四项筛选契约。新增用户列表 mock 浏览器 8 项覆盖分页／字段、组合角色显示、URL 与历史恢复、四项筛选／精确布尔、页大小与空结果、异常 URL、安全默认值、错误重试、过期响应隔离、缺权零请求、移动主题与头像降级。

真实 Dashboard 新增用户导航、筛选、直接刷新和空结果用例，与登录／初始化／店铺／主题／退出既有回归共同执行。

### 失败记录与修复

- 首轮 `.runtime/project-vg8g8n4s/result.json`：真实用户页面的邮箱断言同时匹配顶部账号区和表格；将定位范围限定为用户表格。
- 第二轮 `.runtime/project-_ijs7qsn/result.json`：`TestRealtimeFlow/query-timeout` 复现查询截止与 Redis 心跳错误同时完成时返回 `BUS_UNAVAILABLE`。实时处理统一采用父请求取消、查询截止、实际 Bus 错误的优先级；订阅中断保留原消息。`query_failure_test.go` 覆盖六项错误码／消息场景，隔离 Redis 定向连续 30 轮通过。
- 第三轮 `.runtime/project-vsgksw6q/result.json`：浏览器断言期望单角色 `owner`，隔离验收夹具已设为 `owner,user`；断言按完整组合角色校验，保留页面原字段显示。
- 首次定向尝试 `.runtime/r2-query-timeout-o9hmu7n7/repeat.log` 与全流程 gqlgen 生成同时启动，遇到生成文件短暂缺失造成构建失败；后续定向测试在生成阶段完成后执行。
- 最终 `.runtime/project-1uj0mngy/result.json`：修复后的完整源码通过所有流程及双浏览器验收。

## 3. 人工验收

使用现有开发服务；本轮保持用户 `.env`、开发数据库、账号及运行服务原状。

1. 登录现有 owner／admin，打开 `http://127.0.0.1:5173/admin/users`；检查用户身份、角色、验证／封禁、时间与头像降级。
2. 输入邮箱包含条件，选角色、封禁和邮箱验证；点击“筛选”，检查 URL、返回数据及刷新／后退后条件恢复。角色筛选采用原字段精确匹配，组合角色显示保留原值。
3. 切换每页 10／20／50 条；数据超过一页时检查前后翻页，输入无匹配邮箱检查空态及下一页禁用。
4. 切换深色主题并缩至 390 像素宽，确认筛选换行、表格内部横向滚动和页面宽度。
5. 在独立验收库配置自定义受限角色：赋予 `dashboard:access:admin` 并保持 `user:list` 为空；直达用户页检查 403、菜单隐藏和用户列表零请求。默认 owner／admin 均拥有用户列表权限；默认 member／user 由正式后台会话和 Admin API 的 Guard 拒绝，SPA 跳转登录页。独立配置与测试账号用于权限验收。

## 4. 运行与后续边界

- PathPermissions 的 WS／SSE 测试验证握手路径门禁；正式 Bus 路径继续沿用登录／Origin 策略，专属资源动作由应用显式配置。
- 日志结构化输出与 Audit sink 为本批审计能力；日志采集、访问控制、存储和保留周期由部署配置。写操作事件随后续能力补齐。
- Docker 镜像／容器、race detector、真实旧库快照及生产 TLS／反向代理验收继续登记为 pending。
- 下一批集中完成用户管理事务、owner 保护和会话处置；本轮沿用 develop 与既有迁移版本。

## 5. 开发服务旧实例排查与恢复

2026-10-04，用户列表返回 `Unexpected error.`／`INTERNAL_SERVER_ERROR`。8080 端口实际由 13:25 启动的旧 Web 占用；该进程执行已删除的旧二进制，包含 `not implemented: ListUsers - listUsers` 等生成器占位实现。当前 Air 已构建最新源码，旧监听进程仍接收页面请求。

本次恢复先核对监管器归属和监听进程，再退出已失去终端的旧 Air Web 与旧 Web，触发当前 Air 重建。开发数据库、账号、会话、环境配置和当前 Vite 保持原状。恢复后使用已有有效管理会话，向实际开发服务 `/api/graphql/admin` 请求用户页全部字段，得到 HTTP 200、1 条用户记录、空 GraphQL 错误数组；同库公共 auth 查询也成功。

开发入口新增 Web／SPA 监听地址预检查，端口占用时在前端构建和子进程启动前退出。`scripts/test-dev.py` 覆盖空闲地址、占用提示、原监听保留、默认／IPv6 地址解析、无效／共用端口配置，以及 Web／SPA 占用时构建与启动零调用，并纳入 `pnpm test` 和 `pnpm verify`。

修复后再次执行完整 `pnpm verify`，18 项检查全部通过；具体统计和报告路径见第 2 节。端口保护单测 5 项全部通过，完整验收结束后实际 8080 接口复查继续返回 HTTP 200、1 条记录和空错误数组。实际服务诊断日志保存在 `/home/dream/wwwroot/go-starter/.runtime/list-users-diagnostic-fdaqjkqa/final-recheck.log`，会话令牌仅在内存使用。

验收时刷新 `/admin/users`，确认用户记录与分页、筛选正常。账号与初始化状态沿用现有开发库。

## 6. 侧栏店铺查询次数排查（历史阶段，会话策略已在第 8 节更新）

2026-10-04，Vite 开发服务通过浏览器网络计数复现：侧栏进入店铺页发出 2 次 `listAdminShops`；筛选条件变化也发出 2 次查询。网络计数包含已取消的请求，测试全部使用浏览器 mock，开发账号和数据库保持原状。

- 挂载重复：开发入口保留 React `StrictMode`；店铺页 effect 首轮发起请求后被清理、随后重放，导致浏览器记录两次请求。列表查询延后至微任务执行，发起前检查本轮 AbortSignal，首轮清理可提前取消；参数变化与离开页面继续保留取消及过期响应隔离。
- 筛选／重置／创建后重复：URL 更新与 `revision` 更新各触发一次 effect。现在参数变化由 URL 驱动查询，相同参数的显式操作通过 `revision` 刷新一次。
- 会话请求：`ProtectedDashboard` 在 `location.pathname` 变化时复核会话。侧栏切到店铺页继续执行 1 次 `session` 与 1 次列表查询；同一路径的筛选、重置、刷新和创建后重载沿用当前会话。失效会话继续跳转 `/admin/login`。

新增 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/tests/navigation-requests.spec.ts`，覆盖重复进入店铺、筛选／相同筛选／重置／刷新、失效会话跳转，以及创建后清除筛选与当前页刷新。修复前 3 项测试中 2 项复现重复查询；修复后 4 项全部通过。针对性回归合并既有用户页，12 项全部通过。

网络计数回归使用每轮独立响应名称，等待本轮查询渲染完成后断言，覆盖 React Router transition 的异步提交。首轮全流程回归的开发浏览器曾出现两项统计提前读取；修正等待条件后，生产与开发入口各连续执行 3 轮，合计 24 项通过，跳过／失败／flaky 均为 0。定向报告分别保存在 `/home/dream/wwwroot/go-starter/.runtime/navigation-requests-repeat-production.json` 和 `/home/dream/wwwroot/go-starter/.runtime/navigation-requests-repeat-dev.json`。

修正计数等待条件后，最终完整 `pnpm verify` 通过全部 18 项检查，Go 测试通过记录 365 条；生产构建与 Vite 开发浏览器各 30 项通过，跳过／失败／flaky 均为 0。完整报告保存在 `/home/dream/wwwroot/go-starter/.runtime/project-4xqe7_pl/result.json`，浏览器明细为同目录 `browser.json` 和 `browser-dev.json`。验收结束后确认现有 8080 Web 与 5173 Vite 均继续监听；修改保留在 develop 工作区，等待提交授权。Docker／race 及生产部署边界沿用第 4 节。

## 7. 用户列表查询次数排查（历史阶段，会话策略已在第 8 节更新）

2026-10-04，用户反馈侧栏进入用户列表也出现重复查询。公共用户页位于 `/home/dream/wwwroot/go-starter/packages/shadcnui-dashboard/src/pages/user-list.tsx`；挂载 effect 立即调用 `adapter.getUsers`，StrictMode 清理与重放时各发送一次请求。筛选与重置同时更新 URL 和 `revision`，条件变化时也触发两次查询。

- 用户查询沿用店铺页的微任务调度，发起前检查 AbortSignal；权限门禁、请求取消、旧响应隔离、错误与空列表处理继续保留。
- 参数变化由 URL 驱动查询；相同参数的筛选与重置通过 `revision` 显式刷新一次。
- 侧栏进入用户列表预期为 1 次 `listUsers` 与 1 次 `session`；同一路径的筛选、重置、刷新、分页与页大小切换各查询一次，保持当前会话。

`navigation-requests.spec.ts` 增加用户页网络计数回归，统计包含已取消的请求，响应名称标记每轮查询。覆盖首次与再次侧栏进入、直达用户页、筛选与相同筛选、分页、重置与相同重置、刷新、页大小切换以及刷新后 URL 恢复。接口全部由浏览器 mock，保留开发数据库、账号与会话。修复前新增 2 项用例均复现重复查询，报告为 `/home/dream/wwwroot/go-starter/.runtime/user-navigation-before.json`；修复后用户页与店铺页的针对性浏览器回归 14 项全部通过，报告为 `/home/dream/wwwroot/go-starter/.runtime/user-navigation-after.json`。

本轮 Dashboard 与前端类型检查、Dashboard 单测 10 项、全仓格式检查和 `git diff --check` 通过。完整 `pnpm verify` 全部 18 项检查通过，Go 测试通过记录 365 条；生产构建与 Vite 开发浏览器各 32 项通过，跳过／失败／flaky 均为 0。完整报告为 `/home/dream/wwwroot/go-starter/.runtime/project-poia113k/result.json`，浏览器明细为同目录 `browser.json` 和 `browser-dev.json`。结束后现有 8080 Web 与 5173 Vite 继续监听；修改保留在 develop 工作区，等待提交授权。Docker／race 及生产部署边界沿用第 4 节。

## 8. GraphQL 共享会话与统一认证边界

2026-10-04，后台会话读取迁移至 GraphQL，沿用 Node.js 版布局持有当前用户的方式。应用 `SessionProvider` 作为唯一身份状态源，路由守卫、公共 Dashboard 侧栏与 `UserList` 共享同一会话。首个 operation 为：

```graphql
query getDashboardSession {
    getCurrentUser {
        id
        name
        email
        image
        role
    }
    getCurrentPermissions
}
```

### 行为与兼容

- 身份初次加载一次 GraphQL；侧栏切页身份请求增量为 0，用户与店铺各发出一次业务查询。整页刷新重新建立会话状态，StrictMode 首轮请求通过微任务和 AbortSignal 提前取消。
- Admin SDL 增加 `getCurrentPermissions: [String!]!`；通过 Guard 注入的身份读取公共 `DashboardPermissions`，复用角色权限与应用别名合并逻辑。低权限后台用户可获取自身身份，用户列表仍受 `user:list` 门禁保护。
- `/api/rest/demo/session` 兼容接口保留；登录／退出／初始化沿用原有 HTTP 接口。服务端每次 GraphQL 请求继续执行 Cookie／Bearer 会话解析、权限门禁与 Cookie 更新。
- 统一请求层保留 HTTP 状态与 GraphQL code；401／`UNAUTHORIZED`／`UNAUTHENTICATED` 清理身份并取消后台请求，登录回跳保留 URL 查询参数与 hash。回跳限制为本站 `/admin` 范围，防护外部、协议相对、后台外路径、认证页及双斜杠地址。
- 业务 403 主动复核权限并同步侧栏；身份门禁 403 显示访问错误；`USER_BANNED` 清理后台并显示封禁提示。503 与网络错误显示服务故障，背景复核失败保留已加载身份。
- 窗口恢复焦点时按 60 秒有效期复核，并发复核合并。页面切换保持当前身份；服务端授权持续按每次请求执行。

### 自动验证范围

新增 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/internal/web/session_test.go`，使用隔离 SQLite 与真实 Guard 验证低权限自身身份／权限、兼容 REST 一致性、列表门禁、空／未知／过期会话、封禁及缺失服务；公共 auth 测试增加应用权限别名的去重、排序与空身份处理。

新增 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/tests/session.spec.ts`，浏览器 mock 覆盖首屏去重、共享状态、HTTP／GraphQL 认证失效、非 JSON 401、REST 概览失效、403 菜单同步、封禁、空用户、初始／背景 503、焦点复核合并、取消慢查询、安全登录回跳与退出失败／成功。现有用户与导航测试同步改为 GraphQL 身份，计数包含取消请求。

最终 `pnpm verify` 的 18 项检查全部通过，Go 测试通过记录 368 条；生产构建与 Vite 开发浏览器各 58 项通过，跳过／失败／flaky 均为 0。定向开发浏览器回归 47 项全部通过（会话 26、导航 6、用户 8、店铺 7）。完整报告为 `/home/dream/wwwroot/go-starter/.runtime/project-qjv4ec77/result.json`，浏览器明细为同目录 `browser.json` 与 `browser-dev.json`；定向报告为 `/home/dream/wwwroot/go-starter/.runtime/session-browser-final.json`。

首轮完整回归发现店铺 mock 仍拦截旧 REST session，已将该 fixture 同步至 GraphQL 身份；最终两种入口完整回归通过。验收结束后确认原 5173 Vite 与 8080 Web 继续监听，开发库、账号和环境配置保留；修改位于 develop，保持未提交。Docker／race、真实旧库导入与生产 TLS／反向代理继续沿用第 4 节 pending 边界。

### 手工验收

1. 在 Vite 开发入口登录，打开 `/admin/users`，Network 筛选 `graphql`，整页刷新后确认身份 operation 一次、用户列表一次；身份返回当前用户与权限数组。
2. 清空网络记录，交替点击“店铺列表”“用户列表”；每次只新增对应业务查询，REST session 计数为 0，侧栏身份保持一致。
3. 筛选、分页、刷新和浏览器历史各执行一次；列表各查询一次，身份沿用已有状态。
4. 用隔离会话撤销／到期场景触发业务请求，检查返回登录页；重新登录恢复此前筛选地址。通过低权限账号检查权限提示与菜单同步，通过服务故障场景检查重试与已登录状态保留。
