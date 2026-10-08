# 队列执行记录与后台管理

公共模块组装于 Web 与 Worker，共用 Redis、Asynq Inspector 和队列 namespace。应用任务仍由 `internal/tasks` 定义。

## 首批能力

- Worker 进程：原生 Asynq 在线实例按 namespace 隔离，展示共享进程组／并发、各队列消费者与在线进程 RSS 合计；部署配置数量、硬内存上限保持部署管理口径。
- 队列概览：critical／default／low 当前待执行、执行中、延迟、自动重试、最终失败数量，以及独立的最近 24 小时成功／失败执行次数。
- 执行历史：每次自动执行与人工执行保留独立 ID、任务 ID、递增序号、前次记录、参数／结果、开始／结束时间和耗时。
- 手动重试：复用仍存在的原任务 ID、类型和参数；最新失败记录与原任务 archived 状态同时满足时开放；每次人工安排只执行一次。
- Redis 原子预留防重复安排；安排成功、状态冲突、安排失败保留操作人和结果审计。Worker 开始执行与周期维护都能复核中断的安排。维护补记人工执行中断后，恢复执行继续保留单次边界。
- 服务端对参数、结果、选项、操作信息、错误和堆栈做递归安全投影。敏感键、已知凭据、Bearer／JWT／私钥及 Cookie header 被遮蔽。

## 接入

使用 `queue.New(redisClient, inspector, infraConfig, retention)` 创建服务，并将服务设置为 `infra/queue.Config.Observer`。`infra/queue.Enqueue` 入队后建立 waiting／delayed 记录；Worker middleware 建立 active 记录后，通过原生 `ResultWriter` 清空原任务结果，再采集本次执行结果；上一执行结果保留在独立历史快照中。结果初始化失败时归档原任务并记录本次失败，业务处理保持待执行。应用 Worker 在退出可等待的 goroutine 内运行 `service.Maintain(ctx)`。

Web 负责提交前的真实账号与权限复核：读取需要 `queue:read`，重试需要 `queue:read` 和 `queue:retry`。公共服务负责当前任务状态、最新记录与并发预留校验。

`List` 使用 Redis 索引与服务端分页，默认 `updatedAt`／`desc`，按最近活动时间及 ID 倒序。活动时间依次取结束、开始、入队时间，与 Node.js 参考保持一致。支持 `updatedAt`／`sortAt`／`createdAt` 和 `asc`／`desc`；`createdAt` 保留记录创建时间，时间范围作用于选定排序字段。

状态 `recent` 汇总各状态，`all` 保留旧调用兼容；`waiting` 合并 waiting 与 delayed 记录，`delayed` 支持单独筛选。支持逻辑队列、任务类型精确匹配、Unix 毫秒范围，分页为 20／50／100 条。`isRecentPage` 由查询状态判断，各分页保持一致。

## 存储与维护

独立前缀为 `<namespace>:queue-records:v1:`。记录快照、任务链、序号、筛选／结束时间索引和重试审计共用该前缀，Asynq 原任务沿用原生生命周期。

默认保留 7 天，示例项目通过 `QUEUE_RECORD_RETENTION_DAYS` 配置 1–365 天。每分钟按任务链清理过期历史与审计；排队、执行、自动重试任务链继续保留。原任务已经清理时，窗口内历史继续可查，详情展示重试禁用原因。维护每轮检查最多 100 条候选，通过独立复核索引轮转持续推进。

首版历史索引通过 namespace 内持久化游标分批回填：保留原创建时间，将主排序更新为最近活动时间，并建立独立 `created:all` 索引。WATCH 串行化记录回填与任务执行／清理，游标通过比较后推进。Worker 维护按批处理，首次列表查询接续完成剩余批次后分页；迁移期间的首次查询成本随剩余历史量增长。任务链清理分数与审计内容保持原值，重复回填幂等。

`infra/queue.Enqueue` 成功原任务默认保留 7 天，调用方可通过 Asynq option 显式覆盖；既有原任务保持入队时的配置。归档原任务沿用 Asynq 清理规则，参考 Node.js 的原任务数量上限 50 尚待收尾容量治理补齐。

原始参数／结果／错误保留在 Redis 内部快照中，外部查询统一经过脱敏。部署需限制 Redis 访问权限、配置持久化和备份；Redis 历史随其持久化策略恢复。精确业务副作用仍遵循 Asynq 至少一次语义，由应用实现幂等。

记录建立故障时，Worker 在业务执行前返回 SkipRetry，原任务归档供恢复后显式处理。入队后的记录观察失败保留原入队结果，由 Worker 补建记录。结果保存失败由维护流程基于原任务状态复核；原任务与结果同时丢失时保留“执行结果待业务核对”说明。

## 后续批次

Worker 在线信息、共享进程组／并发、Linux RSS 采样和代码定义的计划任务只读监控已接入。健康详情、计划任务管理操作、后台手动清理入口留后续批次。Redis 实际容量、压缩、TTL／索引治理及持久化历史候选方案归 R6 收尾。

## 验证

```sh
rtk proxy env REDIS_TEST_URL=redis://127.0.0.1:6379/0 rtk pnpm test
rtk pnpm verify --skip-dev
```

测试使用随机 namespace 清理自身数据。验收结果见 `/home/dream/wwwroot/go-starter/docs/queue-management-verification.md`。

## Worker 在线信息与内存

Inspector 实现 `infra/queue.ServerInspector` 时，`Dashboard` 开启 `supportsWorkerPresence`，沿用 Asynq 原生心跳。消费进程必须监听当前 namespace 的注册队列；同时监听其他部署队列的 Server 保持隔离。`active` 为正在接收任务的状态，`stopped`／`closed` 退出消费者统计。在线进程按宿主与 PID 去重，各队列消费者统计原生 Server 数量。

应用在 `NewServer` 前记录启动时间，随后运行 `infra/queue.ObserveProcess`。采样只绑定本宿主、本 PID、本次启动的 Server ID，每 3 秒发布 Linux `VmRSS`（近似常驻内存），TTL 10 秒。进程取消时清理采样；异常退出依靠 TTL 清理。其他平台或采样缺失时 `memoryBytes` 为空；全组内存要求所有在线进程都有有效采样。

`workerProcesses.instances` 使用可空字段表达外部部署副本数，`maxMemory` 空字符串表达部署硬上限未接入。`concurrency` 是新增可空字段：在线实例配置一致时展示实际值，配置混合时为空，离线回退当前配置；队列行并发为空，界面明确显示共享池。Go `GOMEMLIMIT` 属于运行时软目标，硬内存上限由容器／服务管理器管理。
