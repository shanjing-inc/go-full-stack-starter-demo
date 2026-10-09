# 队列管理验证记录

当前 Worker 信息见文末“Worker 进程信息补齐”；页面与计划任务兼容记录分别保留对应章节。首批及导航补齐章节保留各自源码快照和历史验收结果。

## 首批范围

本批交付公共 `modules/queue`、共享 `QueuePage` 和示例应用组装，覆盖队列概览、执行记录列表／详情、最新失败任务单次手动重试。继续沿用 Node.js 参考的 Redis 历史存储方向，原任务生命周期由 Asynq 管理。

首批 Admin GraphQL 操作为：

- `getQueueDashboard`
- `getQueueExecutionRecord(recordId, statusHint)`
- `listQueueExecutionRecords(status, limit, offset, orderBy, orderDirection, queueName, jobName, from, to)`
- `updateQueueExecutionRecord(set: {recordId, statusHint})`

页面入口为 `/admin/queue`。排序支持 `sortAt`／`createdAt` 与 `desc`，按记录创建时间和 ID 倒序；时间以 Unix 毫秒传输。

## 首批已验证边界

- 真正执行与人工安排共享原任务 ID，执行记录使用独立 UUID 和递增序号。
- 自动重试逐次记录；人工安排每次只执行一次，失败后再次归档。
- 12 个并发重试请求只有一次有效安排，状态冲突和失败安排均保留审计。
- 最新记录／原任务归档状态双重复核；历史记录可跳转最新记录；原任务清理后历史继续可查，重试禁用并提示原因。
- 记录与审计默认保留 30 天，配置范围 1–365 天，未结束任务链持续保留。
- Redis 多条件交集、时间范围、同时间 ID 倒序、服务端 20／50／100 条分页和过期索引清理。
- 真实账号、封禁状态、会话和 `queue:read`／`queue:retry` 权限复核；只读账号可查询，重试同时要求两项权限。
- 参数、结果、选项、操作信息、错误与堆栈在服务端递归脱敏；内部原快照继续保留。
- Worker 中断、人工安排失败回滚、安排审计恢复，以及超出一批维护数量后的轮转推进。维护补记人工执行中断后，真正恢复执行继续保留单次标记，业务失败后直接归档。
- 记录建立失败时业务处理保持未开始，原任务经 SkipRetry 归档；Redis 读取故障以 SERVICE_UNAVAILABLE 反馈。
- 页面筛选／分页／详情保留 URL；重试 busy 防重复、失败提示持续可见、读取错误支持刷新恢复、详情关闭后焦点恢复及移动端横向宽度约束。

## 首批实现验收证据

| 命令                                                                   | 验证内容                                                          | 状态                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `rtk pnpm generate`                                                    | 正式 gqlgen、Gen、目标 SQL 生成                                   | 通过；业务 SQL／迁移保持既有版本                      |
| `rtk pnpm build:frontend`                                              | 公共 Dashboard 构建、前端类型检查与生产 SPA                       | 通过                                                  |
| `rtk pnpm check`                                                       | 格式、Go vet、前端类型检查                                        | 通过                                                  |
| `rtk proxy env REDIS_TEST_URL=redis://127.0.0.1:16479/0 rtk pnpm test` | 脚本回归、全部 Go 包、公共 UI 单测                                | 通过；公共队列 8 项、共享 UI 44 项                    |
| 队列目标 Go 测试                                                       | 公共记录／重试／恢复与 GraphQL 真实 Redis 集成                    | 通过                                                  |
| `playwright test tests/queue.spec.ts`                                  | 队列 mock 浏览器功能与交互                                        | 9 项通过                                              |
| `rtk pnpm verify --skip-dev`                                           | 独立源码快照、真实 MySQL／Redis／双 Web／Worker 与内嵌 SPA 浏览器 | 通过；17 项检查、450 条 Go 测试记录、136 项浏览器测试 |

目标测试使用本轮独立 Redis 地址 `redis://127.0.0.1:16479/0`，所有数据使用随机 namespace，测试后清理自身键。本轮 Redis 关闭 RDB／AOF，测试用途与生产持久化策略分别验收。

最终源码快照报告目录：`/home/dream/wwwroot/go-starter/.runtime/project-m203yqy6/`。

- `result.json`：整体状态 `passed`；17 项检查通过，宿主机开发／HMR 1 项按 `--skip-dev` 跳过；450 条 Go 测试通过记录含子测试，整个隔离验收耗时 276.51 秒。
- `browser.json`：136 项通过，跳过／失败／重跑均为 0；覆盖真实 Go API、队列执行记录深链及 9 项队列 mock 浏览器场景。
- 隔离验收包含真实 MySQL／Redis／双 Web／独立 Worker、可重复生成、正式迁移及结构一致性、生产配置来源校验、跨实例协议、故障恢复和优雅退出。
- 工作区最终检查日志：`/tmp/go-starter-queue-check-release.log`；完整单测日志：`/tmp/go-starter-queue-test-final.log`；隔离验收日志：`/tmp/go-starter-queue-verify-release.log`。
- 验收快照与最终工作区的本批业务源码、测试及生成物内容一致；后续更新仅涉及计划及验证文档。

此前联调快照 `project-c48e0ug3`、`project-p7c5qqq3`、`project-qgp57k20` 保留为修复过程证据。`project-uzz4uuy5` 为主动中断快照，隔离脚本已执行资源清理。并行验证期间既有 `TestRealtimeFlow/query-timeout` 曾出现 `BUS_UNAVAILABLE`／`QUERY_TIMEOUT` 差异，完整复测和最终隔离验收通过；过程日志保留于 `/tmp/go-starter-queue-test-concurrent.log`。

## 联调修复

1. Redis Lua 多条件分页参数拼装，修复交集索引筛选。
2. 概览空队列先读取现存队列清单，再查询对应 Asynq 统计。
3. 公开 CONFLICT 业务错误，GraphQL 保留状态冲突原因，HTTP 对应 409。
4. 失败提示分离于刷新中的详情错误状态，保留重试反馈。
5. 页面网格列使用可收缩宽度，表格横向滚动限制在容器内。
6. 独立维护复核索引轮转，长期排队任务继续保留检查机会。
7. 人工安排进程中断后通过 Worker 开始执行和周期维护确认审计；状态读取故障时保留预留等待复核。
8. 补充引号内多词凭据、Cookie／Authorization header、URL 用户密码与嵌套 JSON 字符串脱敏。
9. 分页 SSR 测试断言可观察的分页范围、按钮状态与无障碍标签；100 条选项由真实浏览器验证。
10. 真实队列浏览器场景复用现有管理员会话，正式登录限流保持原有策略。
11. 真实浏览器 API 查询携带同源 Origin，并显式断言 HTTP 状态与 GraphQL 错误，覆盖正式来源校验。
12. 保存执行中断标记，维护补记中断后继续保留人工单次执行边界；真实 Asynq 回归验证恢复后业务失败只有一次调用并归档。

## 后续与验收边界

- 健康详情、Worker presence、调度管理、后台手动清理入口留 R4 后续批次。兼容概览中的绑定／并发／内存字段保持空值，Worker 列表为空，相关能力标记 false。
- R6 基于真实任务量、记录大小及失败率评估 Redis 容量、压缩、TTL／索引治理和持久化历史候选方案。
- 原始快照含内部敏感内容，部署需限制 Redis 访问权限并定义持久化／备份策略；外部查询使用安全投影。
- Asynq 至少一次语义与进程／网络故障边界仍要求业务幂等；记录恢复提供可追溯证据。
- `--skip-dev` 跳过宿主机开发浏览器／HMR 完整编排。本轮 Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie 和容量压力验证保持待验收。
- 当前修改保留在本地工作区，提交与推送各自等待授权。

## 导航与独立路由补齐（2026-10-06）

### 本次范围

- “队列管理”分组按 Node.js 顺序展示控制台、最近任务、运行中任务、已完成任务、失败任务、等待任务；队列计划随后续调度管理补齐。
- `/admin/queues` 展示概览，`/admin/queues/jobs/:status` 展示对应记录列表，`/admin/queues/jobs/:status/:recordId` 支持详情直接访问和刷新。
- recent 复用 all 汇总各状态，waiting 使用待执行状态索引。延迟记录通过最近任务的 `?status=delayed` 筛选访问。
- 详情路径继承对应列表的面包屑与菜单活跃状态；关闭详情保留筛选及分页，返回原行焦点，深链访问时聚焦页面标题。
- 重试进入新执行记录的状态路径，历史关联和只读权限继续保留。旧 `/admin/queue` 查询参数链接兼容迁移。
- 控制台与列表分别读取各自数据，后端与 GraphQL 契约沿用首批实现。

### 本次验证

首批实现验收证据保持原始快照，本次导航补齐验证单独记录。

- 共享 UI 单测：51 项通过，包含队列详情标题、活跃状态及权限匹配。
- 队列 mock 浏览器：22 项通过，覆盖独立路由、状态筛选、详情刷新、重试保留条件、旧链接迁移、前进／后退、键盘焦点和移动导航。
- `rtk pnpm check`、`rtk pnpm test:ui` 与 `rtk git diff --check` 通过。
- `rtk pnpm verify --skip-dev`：整体 passed，17 项检查通过；450 条 Go 测试通过记录含子测试；149 项浏览器测试通过，失败／重跑／跳过均为 0，耗时 306.96 秒。
- 最终源码快照：`/home/dream/wwwroot/go-starter/.runtime/project-a7gayri1/`，报告为 `result.json` 和 `browser.json`。
- 工作区 39 个非文档改动文件逐字节与最终验收快照一致；验收结束后仅更新验证文档。
- 日志：`/tmp/go-starter-queue-navigation-check.log`、`/tmp/go-starter-queue-navigation-ui.log`、`/tmp/go-starter-queue-navigation-browser.json`、`/tmp/go-starter-queue-navigation-verify-final.log`。
- 联调快照 `project-azbk0rry`、`project-i2kfg2va` 在源码定稿过程中主动中断，隔离脚本完成资源清理；最终验收以上述 `project-a7gayri1` 为准。
- `--skip-dev` 跳过宿主机开发／HMR 完整编排；Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie 及容量专项保持待验收。

## 页面与排序兼容对齐（2026-10-06）

### 本次范围

- 列表 `orderBy=updatedAt`、`orderDirection=desc` 与 Node.js 调用一致；支持 `sortAt`／`createdAt` 和升序／降序。最近活动时间按结束→开始→入队回退，同时间按 ID 保持稳定方向。
- `recent` 汇总所有状态，`all` 保留兼容；`isRecentPage` 各分页一致。`waiting` 合并 waiting／delayed，带队列、类型、时间范围和分页时保持完整交集。
- 历史持久化创建时间，新增创建索引。旧记录分批回填活动时间，WATCH 保护执行／清理并发；游标比较后推进，首次列表接续全部剩余批次再分页。回填保留任务链清理分数，重复处理幂等。
- 详情使用独立页面，参数／结果／选项／堆栈／操作信息分栏；详情路由只读取单条记录。返回来源列表保留条件，恢复原任务链接焦点；深链返回聚焦列表标题。人工重试 replace 到新详情，来源列表继续保留。
- 列表任务名称链接、recent 状态列、入队／结束／耗时和任务 ID／执行序号与参考结构对齐。控制台提供四张概览卡、Worker 进程表、队列负载表和 24 小时执行次数。
- 默认历史保留期和新入队成功原任务保留期改为 7 天；显式配置覆盖和既有原任务选项继续生效，当前真实环境文件与测试数据保持原值。

### 平台差异与后续范围

- 平台行为：Asynq pending／scheduled／retry／archived 映射为待执行／延迟／等待自动重试／最终失败；`maxRetry` 为首次执行后的最大重试次数，任务选项沿用 Asynq。
- 并发与进程：Go 当前为进程共享并发池、权重 6／3／1；Node.js 参考按队列配置并发，进程内存指标通过 PM2 提供。
- 已确认人工重试规则：每次安排一次执行，独立创建执行记录，沿用原任务 ID 与参数。
- 本轮历史范围：Worker 在线／进程指标、健康和队列计划当时待后续接入。当前 Worker 与计划任务能力见文末的后续交付记录。
- 保留治理：Node.js 原任务成功／失败默认按 7 天和数量上限 50 清理；Go 新入队成功原任务默认 7 天，归档原任务与数量清理沿用 Asynq。对应优化保持 R6 收尾待办。
- 上述平台差异与后续范围统一保留在本文档，队列页面展示业务信息。

### 本次验证

此前批次的成功数量对应各自历史快照，本次页面与排序兼容对齐单独记录如下。

- 目标 Go 测试通过，覆盖公共队列排序／等待合并／旧索引回填及并发首次查询、成功原任务保留选项、配置默认值与 GraphQL 排序参数。
- 共享 UI 单测：51 项通过；队列 mock 浏览器：24 项通过，覆盖独立详情、详情专用读取、跨状态重试返回来源分页与筛选、键盘焦点及移动导航。
- `rtk pnpm check`、`rtk pnpm test:ui`、`rtk pnpm format` 与 `rtk git diff --check` 通过。
- `rtk pnpm verify --skip-dev`：整体 `passed`，17 项检查通过；460 条 Go 测试通过记录含子测试，其中正式工程全部单测与真实 MySQL／Redis 集成阶段为 450 条；151 项浏览器测试通过，失败／重跑／跳过均为 0，耗时 383.44 秒。
- 最终隔离源码快照：`/home/dream/wwwroot/go-starter/.runtime/project-4xkkh7yy/`，报告为 `result.json` 和 `browser.json`。覆盖可重复代码生成、正式迁移与结构一致性、真实 MySQL／Redis／双 Web／Worker、内嵌 SPA、跨实例协议、故障恢复及优雅退出。
- 验收完成时，本批 42 个非文档改动文件逐字节与最终验收快照一致。随后工作区出现同期公开页面／测试任务开发改动，涉及 Web／Worker 入口、页面路由、前端与开发脚本；本轮完整验收结论限定为隔离快照内源码，当前合并工作区的整体验收另行记录。统一格式入口曾同步调整 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/frontend/src/public.ts` 排版，其他同期功能改动保持各自开发流程。
- 原有示例执行记录只读复核 6／6 存在；真实环境配置与用户已有服务保持原值。临时 mock 浏览器服务已关闭。
- 日志：`/tmp/queue-align-target-go.log`、`/tmp/queue-align-check.log`、`/tmp/queue-align-ui.log`、`/tmp/queue-align-browser.log`、`/tmp/queue-align-browser.json`、`/tmp/queue-align-verify.log`。
- `--skip-dev` 跳过宿主机开发／HMR 完整编排；本轮 Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie 及容量压力专项保持待验收。
- 修改保留在本地工作区，提交与推送各自等待授权。

## 计划任务监控（2026-10-06）

### 本次范围

- 队列菜单末尾增加“计划任务”，路由 `/admin/queues/schedules`，沿用 Node.js 的代码注册、只读监控范围。
- `getQueueSchedules` 接入公共队列服务和 `QueueSchedulesPage`。展示注册数量、在线调度器数量、Leader、计划名、Cron、时区、任务类型、队列、启用状态、下次执行、最近调度和派发结果；页面支持独立读取、刷新、加载／错误恢复、空态与移动端表格滚动。
- 计划读取要求 `queue:read`，菜单与服务端分别校验；`queue:retry` 继续控制人工重试。
- Leader 和 follower 都上报心跳，正常退出清理自身心跳，心跳键与索引自动过期。展示实例 ID 由配置实例名和租约 token 摘要组成，支持同一配置实例名下的多个进程；租约 token 和内部派发错误保留在服务端。
- `demo-tick` 每分钟派发 `demo:effect`，时区 `Asia/Shanghai`，默认停用；页面显示停用状态，下次执行为空。未来执行槽为空的 Cron 定义也保持空时间。
- 派发状态为 `idle`／`dispatched`／`dispatch_failed`，表示入队观测。最近活动时间沿用 Node.js 的成功派发时间优先、尝试时间回退规则，业务执行结果继续在执行记录页查看。
- 本批历史范围：当时已接入调度器心跳；后续 Worker 信息交付见文末。健康详情、调度启停／人工触发 UI 与后台清理入口保持后续范围。

### 平台参数与展示差异

| 项目                              | Node.js 参考版当前默认值／行为             | Go 当前默认值／行为                                                | 分类                             |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | -------------------------------- |
| 调度检查／Leader 租约／心跳有效期 | 30 秒／45 秒／120 秒                       | 250 毫秒／3 秒／10 秒                                              | 运行时参数差异，沿用各自调度设施 |
| 时间与执行槽                      | 宿主机时间，按分钟槽匹配 Cron              | Redis TIME；支持 5／6 字段 Cron 与 `@every`，周期按 UTC epoch 对齐 | 调度引擎差异                     |
| 启用来源                          | 代码 `enabledByDefault`                    | Redis 共享状态优先，缺省采用代码默认值                             | 既有 Go 共享启停规则             |
| 停用计划下次执行                  | 按代码 Cron 预估时间                       | 显式展示停用，下次执行为空                                         | 展示增强，体现 Go 共享启停状态   |
| 时区与启用列                      | 查询包含时区，表格主要展示 Cron 与派发状态 | 表格增加时区和启用状态                                             | 展示增强                         |

参数参考：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/queue/config.ts`；调度与展示参考：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/queue/core/scheduler.ts`、`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/queue/dashboard/bullmq.ts`。

### 本次验证

- 目标 Go 测试通过：代码定义校验／复制、Cron 时区与周期相位、默认停用／默认启用、有效和过期心跳、相同配置实例名下的主备进程、正常退出清理、接管、成功／失败派发、历史状态回退、未来槽空值、公共错误脱敏与 GraphQL 查看权限。
- 共享 UI 单测 51 项通过；队列 mock 浏览器 28 项通过，其中新增计划页深链／刷新、定义与主备状态、错误恢复／空态、权限拒绝／零查询、移动端宽度用例。
- `rtk pnpm generate`、`rtk pnpm check`、`rtk pnpm format`、`rtk pnpm test:ui` 与 `rtk git diff --check` 已通过。并行浏览器阶段曾造成 `go vet` 扫描临时测试输出目录冲突，顺序重跑检查通过。
- 本批隔离快照：`/home/dream/wwwroot/go-starter/.runtime/project-1fq4avo1/`，报告为 `result.json` 和 `browser.json`；耗时 333.94 秒。整体状态为 `failed`，11 项阶段检查已通过，470 条 Go 测试通过记录含子测试，其中正式工程全部单测与真实 MySQL／Redis 集成为 463 条。
- 真实内嵌 SPA 浏览器阶段：159 项通过、1 项失败，重跑／跳过均为 0。计划页全部用例和真实 Go API／Worker 的计划定义、停用状态、在线调度器心跳、Leader 与深链刷新联调均通过。
- 唯一失败来自同期公开 SSR 的 `public.spec.ts`“真实登录返回 SSR、三队列投递和失败任务人工重试”：登录页实际显示“请求频繁，请稍后重试”，5 秒内保持 `/admin/login?returnTo=%2Ftest%2Fqueue`。失败材料保存在隔离工作区 `projects/multi-database-demo/frontend/test-results/public-真实登录返回-SSR、三队列投递和失败任务人工重试/`。公开队列登录用例的合成账号／本机 IP 限流预算需单独处理；现有认证限流参数保持原值。
- 本轮 68 个非文档改动文件逐字节与最终隔离源码快照一致；验证结束后仅补充验证文档。当前结论按阶段和功能范围分别记录，整体验收保留失败状态。
- 早期快照 `project-7802h2oa` 在调度字段兼容复核阶段主动终止，记录保留，资源由脚本清理。最终快照在浏览器失败后完成临时服务清理，独立 mock Vite 5317 已关闭，用户已有服务与真实环境配置保持原值。
- 日志：`/tmp/queue-schedules-generate.log`、`/tmp/queue-schedules-go-final.log`、`/tmp/queue-schedules-check-final.log`、`/tmp/queue-schedules-ui-final.log`、`/tmp/queue-schedules-browser-final.log`、`/tmp/queue-schedules-browser-final.json`、`/tmp/queue-schedules-verify-final.log`。
- `--skip-dev` 跳过宿主机开发／HMR 完整编排；Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie 及容量压力专项保持待验收。
- 修改保留在本地工作区，提交与推送各自等待授权。

## Worker 进程信息补齐（2026-10-06）

### 交付范围

- 控制台按 namespace 展示一个 `shared` 进程组，包含三个监听队列、实际在线进程数、每实例共享并发、RSS 合计和在线状态。进程离线后继续保留配置行。
- 队列负载补齐进程名称／进程组、监听状态及原生 Server 消费者数量；概览在线数按宿主与 PID 去重，避免三个队列重复累计同一进程。
- `supportsWorkerPresence` 由 Inspector 是否支持 `Servers()` 决定；旧适配器继续显示待接入。原生状态 `active` 计为消费者，`stopped`／`closed` 排除；所有监听队列归属当前 namespace，隔离共享 Redis 的其他项目。
- Worker 每 3 秒采样自身 Linux `VmRSS`，以原生 Server ID 摘要关联，TTL 10 秒；绑定本宿主／PID／本次启动，正常取消清理。任一在线进程缺少有效采样时全组内存为空；Redis 读取故障保持服务不可用的安全错误。
- `queue:read` 门禁沿用现有 GraphQL 链路，Server ID、宿主、PID 和活动任务参数保留在服务端。

### Node.js／Go 平台差异

| 项目     | Node.js 参考版                  | Go 实现                                                            |
| -------- | ------------------------------- | ------------------------------------------------------------------ |
| 进程组织 | PM2 按进程定义管理队列与副本    | 一个 namespace 的共享进程组，每实例消费 critical／default／low     |
| 并发     | 各队列配置并发                  | 每实例共享并发池；权重 6／3／1，进程表展示共享并发                 |
| 在线来源 | BullMQ Worker 名称／队列客户端  | Asynq 原生 Server 心跳；5 秒更新，原生记录 TTL 10 秒，正常退出清理 |
| 配置数量 | PM2 定义中的 `instances`        | 外部部署管理；GraphQL `instances` 可空，界面显示“部署管理”         |
| 内存上限 | PM2 的 `maxMemory`              | 外部部署管理；字段为空时界面显示“部署管理”                         |
| 实际内存 | PM2 `monit.memory` 按进程名汇总 | 每 3 秒采样 Linux RSS，跨在线进程合计，完整采样有效期 10 秒        |
| 其他平台 | PM2 提供宿主指标                | 当前 RSS 采样支持 Linux；其他环境内存显示“—”                       |

`instances` 放宽为可空字段，新增可空 `concurrency`。Node.js 适配器可继续传原有配置数量；Go 将未知部署副本数表达为空值。Go `GOMEMLIMIT` 的软内存目标单独保留其运行时口径。

### 验证结果

- `pnpm generate`、`pnpm check`、`pnpm format`、`pnpm test:ui` 通过；Dashboard 单测为 51 项。目标 Go 测试使用真实 Redis 随机 namespace，覆盖 `infra/queue`、`modules/queue` 和 `internal/web` 的 `TestQueueGraphQLPermissions`，均通过。
- 队列 mock 浏览器测试 31 项通过，新增覆盖 Worker 在线数量、共享并发、RSS、部署管理字段、缺失采样和离线配置行。首次运行遇到浏览器依赖 `libnspr4.so` 缺失，补齐本机 `.tools/browser/usr/lib/x86_64-linux-gnu` 的 `LD_LIBRARY_PATH` 后重跑通过；前次环境失败日志保留。
- 整体验收命令：`pnpm verify --skip-dev`。最终隔离快照：`/home/dream/wwwroot/go-starter/.runtime/project-tgrtkk4f/`，报告为 `result.json` 和 `browser.json`；耗时 339.38 秒，整体状态为 `failed`。11 项阶段检查通过，486 条 Go 测试通过记录含子测试，其中正式工程全部单测与真实 MySQL／Redis 集成为 479 条。
- 真实内嵌 SPA 浏览器阶段：162 项通过、1 项失败，跳过与 flaky 均为 0。`dashboard.spec.ts` 的真实 Go API 用例通过，包含 Worker 原生在线信息、共享并发、完整 RSS 采样、部署字段、页面展示与刷新断言；计划任务相关用例也通过。
- 唯一失败为同期公开 SSR 的 `public.spec.ts`“真实登录返回 SSR、三队列投递和失败任务人工重试”：本批错误上下文再次确认登录页显示“请求频繁，请稍后重试”，5 秒内保持 `/admin/login?returnTo=%2Ftest%2Fqueue`。失败材料位于隔离工作区 `projects/multi-database-demo/frontend/test-results/public-真实登录返回-SSR、三队列投递和失败任务人工重试/`；公开队列登录用例的合成账号／本机 IP 限流预算需单独处理，认证限流参数保持原值。
- 全部 72 个非文档改动文件逐字节与最终隔离源码快照一致；验收完成后仅补充文档。完整验收结论保留失败状态，Worker 功能按目标测试及真实集成证据记录通过。
- 临时资源清理已核实：隔离 Web、Worker、Redis 和 MySQL 日志记录退出，`/proc` 检查未发现该快照残留进程，独立 mock Vite 5318 监听已关闭。验收报告当前提供 `status` 与测试记录，清理状态依据进程和日志单独核实。
- 本机原有环境的只读检查识别到 4 个在线 Worker，其中 1 个新版本实例有内存采样、3 个旧实例缺少采样；完整 RSS 合计因此显示“—”。该结果属于检查时点状态，全部在线实例运行本批版本后可获得完整采样。用户已有 Web／Worker、共享 Redis 与真实 `.env` 保持原样。
- 日志：`/tmp/queue-workers-generate.log`、`/tmp/queue-workers-format-final.log`、`/tmp/queue-workers-check-final.log`、`/tmp/queue-workers-ui.log`、`/tmp/queue-workers-go-final.log`、`/tmp/queue-workers-browser-final.log`、`/tmp/queue-workers-browser-final.json`、`/tmp/queue-workers-verify.log`。
- `--skip-dev` 跳过宿主机开发／HMR 完整编排；Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie 和容量压力专项保持待验收。
- 修改保留在本地工作区，提交与推送各自等待授权。

## 全面审查修复（2026-10-06）

- 每次执行开始前，通过 Asynq 原生 `ResultWriter` 清空复用任务的结果。结束时采集本次结果，前次结果保留在独立快照中；结果初始化失败时跳过业务处理并归档原任务。新增真实 Redis／Asynq 回归覆盖人工与自动重试的空结果、失败、异常、新 JSON、相同 JSON 和文本结果。
- Worker 指标全部读取完成后，再使用 Redis TIME 校验样本时效。读取期间发布的新样本可参与 RSS 合计，过期和远未来样本继续过滤；同宿主／PID 的多个 Server 从合法候选中选择最新样本。新增受控发布／读取交错回归，并覆盖同进程未来样本与合法样本并存。
- 公开 SSR 真实登录使用验收脚本创建的独立管理员账号，内嵌 SPA 和 Vite 开发阶段通过环境变量接收凭据，正式限流参数保持原值。账号创建与失败中止新增 Python 回归。
- 公共队列 README 同步已交付的 Worker 指标与计划任务只读监控范围。健康详情、计划任务管理操作、手动清理和容量治理继续沿用收尾计划。

### 定向回归

修复前新增用例稳定复现结果继承与合法采样被过滤；修复后队列基础设施、调度、执行记录、应用任务和 Web 五包共 137 条父／子测试记录通过，0 跳过。验收脚本 Python 回归 10 项通过。定向日志位于 `/tmp/go-queue-fix-veujdu2q/`，包含 `red-go.log`、`green-go.log`、`red-python.log` 和 `green-python.log`。

### 修复后完整默认编排

- `rtk pnpm verify` 使用隔离源码快照 `/home/dream/wwwroot/go-starter/.runtime/project-jf01ludm/workspace`，耗时 659.02 秒；整体状态为 `failed`，16 项阶段检查通过。
- Go 测试共 500 条通过记录（含子测试），其中正式工程全部单测与真实 MySQL／Redis 集成阶段为 490 条；失败和跳过均为 0。公共 Dashboard 单测 52／52，验收脚本单测 10／10。
- 内嵌 SPA 完整浏览器 164／164 通过，失败、重跑和跳过均为 0；原公开 SSR 真实登录、投递和人工重试用例通过。
- 开发监管日志已记录并行实例独立退出、共享 Go 源码重载、真实编译失败后恢复、公共 Go 包触发两个角色重建。随后开发完整浏览器阶段触发 240 秒超时，最终 JSON 报告未生成；该阶段及后续公共 Dashboard HMR 保持未完成验收状态。
- 默认编排报告：`/home/dream/wwwroot/go-starter/.runtime/project-jf01ludm/result.json`；内嵌浏览器报告：同目录 `browser.json`；日志：`/tmp/go-queue-fix-veujdu2q/verify.log`。

### 修复后补跑验收与交付边界

- `rtk pnpm verify --skip-dev` 整体 `passed`，耗时 365.15 秒；17 项检查通过，宿主机开发／HMR 一项按参数跳过。
- 共 500 条 Go 测试通过记录（含子测试），其中正式工程全部单测与真实 MySQL／Redis 集成阶段为 490 条；失败／跳过均为 0。公共 Dashboard 单测 52／52，验收脚本单测 10／10。
- 内嵌 SPA 完整浏览器 164／164，失败／重跑／跳过均为 0；公开 SSR 五个用例全部通过，包含原失败的真实登录、三队列投递与人工重试。
- 补跑隔离快照与报告目录：`/home/dream/wwwroot/go-starter/.runtime/project-em1fful0`；结果为 `result.json` 与 `browser.json`，日志为 `/tmp/go-queue-fix-veujdu2q/verify-skip-dev.log`。两个验收快照的非文档改动文件均与交付源码逐字节一致。
- 本轮修复影响 10 个文件，其他已有修改保持原样；两次验收的临时服务已退出，定向 Redis 已清理。全仓格式检查及 `git diff --check` 通过。
- 完整默认开发浏览器编排超时保持待处理；Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie 与容量专项保持待验收。
- 修改保留在本地工作区，提交与推送各自等待授权。

## 队列页面说明区块精简（2026-10-06）

- 统一移除控制台、五类任务列表、执行详情和计划任务页的重复平台说明区块，删除共享说明组件及引用；保留队列业务信息、Worker 指标说明与权限／重试逻辑。平台差异与后续范围统一保留在文档中，README 已同步调整。
- 浏览器回归补充各页面说明区块为空的断言；公共 Dashboard 与 demo 前端类型检查通过，公共 UI 单测 52／52，隔离源码快照的队列浏览器 32／32，失败／重跑／跳过均为 0。
- 首轮浏览器运行期间发生同期 Worker 内存列顺序调整，当轮 31 项通过、1 项列顺序断言失败；最终回归冻结源码并通过全部 32 项，保留同期列顺序调整。随后同期开发追加成功状态标签测试，该项由对应开发验收覆盖。
- 验证目录：`/tmp/go-queue-notes-lw4zs_u1`，最终报告 `browser-final.json`，日志 `browser-final.log`。验证后的三个队列页面源码与隔离快照逐字节一致，说明区块移除断言保留在当前测试中；临时 Vite 已退出。
