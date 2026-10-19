# 数据库与迁移

用于模型、查询、连接或迁移变化。入口：应用 share/schema/migrate 命令、应用 scripts 的 URL/迁移工具、Go kit 的 infra/database、应用 backend/internal/model、backend/internal/schema 和 migrations。

- `DB_DSN` 是连接 URL，方言由 mysql、postgres/postgresql、sqlite 协议推导；不增加 `DB_DRIVER` 环境开关。
- `MIGRATION_URL` 可选，缺省、空字符串或纯空白时使用 `DB_DSN`；显式配置时优先使用并校验方言一致。执行迁移的账户需要建表与改表权限，生产环境推荐独立迁移账户。`ATLAS_DEV_URL` 必填且指向同方言、可清空的隔离开发库；清理范围限定在隔离开发库。
- SQLite 默认迁移先按应用规则解码 `DB_DSN` 文件路径，再转为 Atlas 的 `file:` URI；编码空格、中文及百分号路径必须指向同一物理文件。相对路径以命令工作目录为基准，query 原值保留；显式 `MIGRATION_URL` 和内存模式延续现有 Atlas URL 语义。
- ORM/Gen 沿用实体、事务和查询层；筛选、排序、分页在数据库执行，不取全表再前端过滤。
- 三方言迁移/目标 SQL 分目录维护；生成 share/schema 不等于真实库均已验收。
- Web/Worker 启动只读核对 Atlas 登记版本；部署前独立迁移，不由每个副本自行迁移。版本变化核对 `DB_VERSION` 和历史 checksum。
- 每批测试隔离数据库/fixture，不改生产逻辑掩盖污染。

验证：`rtk pnpm share/schema`、隔离库 `rtk pnpm schema:diff -- --name <名称>`、`rtk pnpm migrate`。真实库分别记录 `rtk pnpm verify:mysql`、`rtk pnpm verify:postgresql` 的环境/结果，凭据从证据中脱敏。
