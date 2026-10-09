# R2 会话管理验收

## 1. 范围与实现

范围补充（2026-10-06）：用户账号管理仅支持禁用／启用，账号及关联业务数据持续保留；后台与 API 禁止删除用户，用户删除列为范围外。禁用复用已实现的封禁与会话撤销能力。

本轮在 `/home/dream/wwwroot/go-starter` 的 `develop` 推进 R2 第三批：有效会话列表、单会话撤销、当前会话识别及公共后台入口。密码修改／重置延后至 R6 最终收尾，所有权转移、手机号能力保留后续批次；数据库结构和既有迁移版本保持原状。

主要实现：

- 公共认证：`packages/go-server-kit/modules/auth/sessions.go`；Guard 为受保护请求绑定当前会话 ID。
- 应用 GraphQL：`projects/multi-database-demo/schema/admin.graphqls`、`internal/graph/admin/admin.resolvers.go` 和生成代码。
- 公共后台：`packages/shadcnui-dashboard/src/pages/user-sessions.tsx`、用户行操作及可选 adapter；应用接入位于 `projects/multi-database-demo/frontend/src/adapter.ts`。

## 2. 契约与安全门槛

1. 列表要求 `session:list`，单撤销要求 `session:revoke`。服务重新读取操作者角色与封禁状态，检查目标完整权限范围；owner 用户继续由有 owner 身份及 `system:owner` 权限的操作者管理。
2. 列表显式查询安全投影，输出 ID、IP、User-Agent、创建／更新／到期时间和当前会话标识。认证 token 留在服务端；审计记录固定动作与目标 ID。
3. MySQL 执行有效期筛选、创建时间／ID 倒序与 limit／offset。SQLite 快速测试按解析后的 Go 时间筛选及排序，兼容带偏移的驱动格式与旧 RFC3339 字符串。SQLite 路径需要读取目标用户全部安全投影，容量验收以 MySQL 为准。
4. 单撤销与用户管理、登录会话写入共用事务锁，按用户 ID 和会话 ID 联合删除，重复调用成功；其他用户与同用户其他会话保持有效。后续 HTTP／长连接复核感知失效；已完成的请求及帧沿用既有协议。
5. 弹窗支持分页、刷新、二次确认、当前会话提示、错误重试和键盘焦点恢复。当前会话撤销触发应用身份刷新；关闭／切页取消请求并忽略迟到回调。

## 3. 自动验证

`pnpm verify` 全量通过：18 个阶段检查，耗时 488.16 秒。全部 Go 阶段合计 437 条父／子测试记录通过。

已完成专项验证：

- 会话及原会话相关 Go 测试、GraphQL 会话 API 与 SDL 对照通过。
- 开发模式新增 9 项浏览器回归通过，覆盖权限、owner 入口保护、分页、末页回退、当前会话退出、错误重试、焦点恢复及迟到查询／写入回调取消。
- `pnpm check` 通过：全仓四空格格式、Go vet、前端类型检查。
- 生产前端构建通过；公共 Dashboard 单测 43/43 通过。
- 正式 Go 工程测试：427 条父／子测试通过，跳过 0 条，包含真实 MySQL 会话管理及 Redis 集成；格式工具另有 6 条，外部进程专项另有 4 条。
- 内嵌生产 SPA 浏览器回归 127/127 通过，跳过／失败／flaky 均为 0，耗时约 92 秒。
- Vite／Air 开发模式浏览器回归 127/127 通过，跳过／失败／flaky 均为 0，耗时约 225 秒。
- MySQL 8.0 与 SQLite 正式 Atlas 迁移、重复迁移、结构一致性、受限数据库账户启动、双 Web／Worker、跨实例 WS／SSE、readiness 故障、进程崩溃／Redis 停止及优雅退出检查通过。
- 公共 Go 源码触发 Web／Worker 重建、公共 Dashboard HMR（页面保持原实例）及宿主机进程组统一清理通过。原 POC 与参考仓库状态保持原样；原有开发 Vite 进程保留，本轮专项 Vite 已停止。

已修复首轮发现：SQLite 直接字符串比较带时区时间造成过期记录误入；SQLite 日期函数无法完整解析当前驱动的 time.String 存储。最终采用 Go 时间比较，并加入 RFC3339／偏移时间排序回归。浏览器专项同时修复撤销后 Radix 将焦点落在弹窗容器时的刷新入口恢复。

本地证据（均为忽略的运行产物）：

- 全量报告：`/home/dream/wwwroot/go-starter/.runtime/project-t03owwdy/result.json`。
- 双模式浏览器报告：同目录 `browser.json`、`browser-dev.json`。
- 专项测试、检查、构建日志及布局截图：`/home/dream/wwwroot/go-starter/.runtime/session-management/`。

桌面（1440×1000）与移动端（390×844）已保存会话弹窗截图；移动端页面宽度与视口同为 390px，弹窗宽 356px，宽表在内部横向滚动。当前无头浏览器缺少中文字体，截图仅用于容器布局复核；中文字体显示保留人工浏览器验收。

## 4. 人工验收步骤

1. 使用 owner／admin 登录 `/admin/users`，在可管理用户的行菜单选择“查看会话”，检查 IP、设备、创建／到期时间及分页。
2. 为同一账号建立两次独立登录；撤销其中一条，检查对应登录失效及另一条继续访问。
3. 查看当前账号会话，确认当前会话标识；确认撤销后检查返回登录页。
4. 使用只有 `user:list`／`session:list` 的自定义读取角色查看授权范围内用户，确认只读入口与服务端撤销权限门禁。
5. 键盘关闭弹窗，检查焦点返回行菜单；在查询或撤销等待期间关闭弹窗，检查迟到响应保持原页面状态。

## 5. 验收边界

本轮 Docker 镜像、race detector、真实旧库导入／备份回滚、生产 TLS／反向代理／Secure Cookie、生产审计存储及容量验收保持独立验证关口。上一批 Docker 验收记录继续保留原提交范围。本轮提交与推送等待用户明确授权。
