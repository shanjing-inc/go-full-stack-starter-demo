# 数据库与迁移

用于模型、查询、连接或迁移变化。入口：应用 schema/migrate 命令、固定 devtools 的 URL/迁移工具、Go kit 的 infra/database、应用 internal/model、internal/schema 和 migrations。

- `DB_DSN` 是连接 URL，方言由 mysql、postgres/postgresql、sqlite 协议推导；不增加 `DB_DRIVER` 环境开关。
- `MIGRATION_URL` 使用独立迁移账户，`ATLAS_DEV_URL` 指向可清空的隔离开发库，均与 DB_DSN 方言一致。禁止清理业务库。
- ORM/Gen 沿用实体、事务和查询层；筛选、排序、分页在数据库执行，不取全表再前端过滤。
- 三方言迁移/目标 SQL 分目录维护；生成 schema 不等于真实库均已验收。
- Web/Worker 启动只读核对 Atlas 登记版本；部署前独立迁移，不由每个副本自行迁移。版本变化核对 `DB_VERSION` 和历史 checksum。
- 每批测试隔离数据库/fixture，不改生产逻辑掩盖污染。

验证：`rtk pnpm schema`、隔离库 `rtk pnpm schema:diff -- --name <名称>`、`rtk pnpm migrate`。真实库分别记录 `rtk pnpm verify:mysql`、`rtk pnpm verify:postgresql` 的环境/结果，凭据从证据中脱敏。
