# 公共系统模块

`auth` 提供账号标准四表、邮箱密码、初始化、签名 Cookie／Bearer 会话、共享限流、HTTP 身份与资源权限、用户及会话管理。应用组合公共模型并维护统一 Atlas 迁移历史。

`queue` 提供 Redis 独立执行记录、队列概览、筛选分页、最新失败任务单次手动重试及审计。Web 负责真实账号／权限复核，Worker 接入记录 middleware 和周期恢复／清理。

通用队列与调度基础设施位于 `infra`，应用任务位于 demo 的 `internal/tasks`；代码计划只读监控已接入 `queue.Service.Schedules`，注册时将同一组 `schedule.Definition` 传给 Web／Worker 服务；队列健康和调度操作继续进入 R4 后续批次。
