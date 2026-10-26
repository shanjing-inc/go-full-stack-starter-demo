# 数据库与迁移

用于模型、查询、连接或迁移变化。入口：应用 share/schema/migrate 命令、应用 scripts 的 URL/迁移工具、Go kit 的 infra/database、应用 backend/internal/model、backend/internal/schema 和 migrations。

- `DB_DSN` 是连接 URL，方言由 mysql、postgres/postgresql、sqlite 协议推导；不增加 `DB_DRIVER` 环境开关。
- PostgreSQL URL 的 query 中 `+` 与 `%20` 表示空格、`%2B` 表示加号，只解码一次；userinfo 的 `+` 保持字面量，密码中的未编码 `@` 按最后一个分隔符识别。Go kit 在交给 pgx 前解析后重编码 query 键值（含值内未转义的 `=`），空格编码为 `%20`；重复参数按旧驱动与 Atlas 的规则保留首值，首值为空也不取后续值，重复 `sslmode` 不得静默改变 TLS。`ParseDSN` 与直接 `Open` 保持相同语义；原生键值 DSN 沿用驱动语义。Atlas 默认／显式迁移 URL 与开发库 URL 保持相同含义，开发库只移除 `search_path`。升级 kit 或 pgx 时同时核对运行时与迁移入口，保留已有配置含义。
- 应用当前固定正式 kit `v1.2.1`，包含 URL 归一化修复，pgx 使用 `v5.11.0`；工作区联调与 `GOWORK=off` 固定依赖验收分别执行。后续升级仍需核对配置含义、真实模块来源及新增／升级传递依赖的官方发布时间。
- `MIGRATION_URL` 可选，缺省、空字符串或纯空白时使用 `DB_DSN`；显式配置时优先使用并校验方言一致。执行迁移的账户需要建表与改表权限，生产环境推荐独立迁移账户。`ATLAS_DEV_URL` 必填且指向同方言、可清空的隔离开发库；清理范围限定在隔离开发库。
- SQLite 默认迁移先按应用规则解码 `DB_DSN` 文件路径，再转为 Atlas 的 `file:` URI；编码空格、中文及百分号路径必须指向同一物理文件。相对路径以命令工作目录为基准，query 原值保留；显式 `MIGRATION_URL` 和内存模式延续现有 Atlas URL 语义。
- ORM/Gen 沿用实体、事务和查询层；筛选、排序、分页在数据库执行，不取全表再前端过滤。
- 三方言迁移/目标 SQL 分目录维护；生成 share/schema 不等于真实库均已验收。
- Web/Worker 启动只读核对 Atlas 登记版本；部署前独立迁移，不由每个副本自行迁移。版本变化同步应用 `internal/databasegate.DatabaseVersion`，核对三方言最新迁移和历史 checksum；不再配置 `DB_VERSION`。
- 每批测试隔离数据库/fixture，不改生产逻辑掩盖污染。

验证：`rtk pnpm share/schema`、隔离库 `rtk pnpm schema:diff -- --name <名称>`、`rtk pnpm migrate`。真实库分别记录 `rtk pnpm verify:mysql`、`rtk pnpm verify:postgresql` 的环境/结果，凭据从证据中脱敏。

## 场景：数据库时间存储

### 1. 范围与触发

修改数据库连接、业务时间字段、DateTime 标量、默认值或时间迁移时遵守本节；队列执行记录与 heartbeat 保留毫秒语义。

### 2. 接口与数据库定义

- 公共入口为 `database.ParseDSN(raw)`、`database.Open(ctx, driver, dsn)`；模型继续使用 `time.Time` / `*time.Time`。
- MySQL 使用秒级 `DATETIME`；PostgreSQL 目标 SQL 使用 `timestamptz(0)`；SQLite 保留 `datetime` 声明供驱动识别，实际值为 INTEGER epoch seconds。
- 应用期望版本由 `internal/databasegate.DatabaseVersion` 固定为 `202610210001`，与三方言最新迁移一致。Web/Worker 启动前由 Atlas 执行迁移，历史迁移与 checksum 不改写。
- 启动和 readiness 的版本行为见下方“数据库版本自动检测”；旧环境文件中的 `DB_VERSION` 被忽略，执行迁移后直接重启。

### 3. 契约

- MySQL `loc` 是唯一时区来源，缺省 UTC；连接工厂为每条物理连接派生 session `time_zone`：UTC 对应 `'+00:00'`，其他 IANA 名称对应同名时区。显式 `time_zone` 的键名按大小写不敏感识别，原生 DSN 中的 `@@time_zone`、`@@session.time_zone`、`@@local.time_zone` 及 `SESSION`／`LOCAL` 写法（含标识符反引号和空白）也归一识别，与 loc 一致的值合并为唯一小写键，任何冲突值均返回脱敏配置错误；不依赖进程 `TZ`。
- 固定 `'+08:00'` 与 `Asia/Shanghai` 并非完整历史规则等价；旧显式 offset 配置改为只保留 `loc`。MySQL 命名时区要求预先加载时区表。
- 公共 `Open` 同时覆盖原生 DSN 调用；MySQL 参数编码截断到秒。PostgreSQL 未指定 session timezone 时默认 UTC，允许显式时区；键名按大小写不敏感识别并归一为唯一 `timezone`，同值合并，不同值连接前返回脱敏配置错误，保留其他 RuntimeParams；持久化使用绝对时间。
- SQLite 驱动固定 `_time_integer_format=unix`、`_inttotime=1`，时间参数必须传 `time.Time`，禁止业务 SQL 直接写入日期字符串。数据库默认值使用 `(unixepoch())`。整数比较、排序和分页全部在 SQL 执行，会话列表不再有读取全部候选的方言分支。
- 公共认证 API 的到期时间输入也会归一为秒级 UTC，保留调用方原值。GORM 自动时间为秒级 UTC；GraphQL DateTime 输入带明确 offset 或 Z，进入业务前归一为秒级 UTC，输出保持秒级 UTC；前端按用户时区展示。
- SQLite 增量迁移统一旧 RFC3339、Go time.String、已有整数秒及无时区日期（YYYY-MM-DD）、分钟（空格或 T 分隔）和秒级时间字符串，日期／分钟格式也兼容旧驱动支持的 `Z` 后缀；小时允许旧驱动可读的单数字形式，先补零再校验；数字 offset 后的末尾 `Z` 按旧驱动语义移除，保留 offset 对应的绝对时间；小数秒兼容旧驱动的点或逗号分隔符，仅归一秒后且紧接数字的逗号，仍严格校验完整值；无时区旧值按 UTC 解释，带 offset 的值保留绝对时间，保留 NULL、自增序列、索引和外键。转换前严格校验墙上时间的年月日、闰年及时分秒范围，拒绝 SQLite 自动归一化非法日期或 24 点时间；不能确定旧无时区值语义时先离线核对再迁移。
- MySQL 迁移不调整历史 DATETIME 字面值；旧北京时间库继续设置 `loc=Asia%2FShanghai`。不要统一减八小时。PostgreSQL 迁移以 `date_trunc('second', column)` 截断旧值并保留 instant。
- 应用当前固定的正式 kit `v1.2.1` 已包含此连接契约。开发验证可使用源码：主仓使用工作区，独立应用通过 `STARTER_KIT_SOURCE` 或 `.starter.local.json` 选择源码，检查、测试、生成和构建共用来源。后续公共包升级仍需候选包验收并更新固定依赖，与应用迁移一同交付；源码联调不能替代固定依赖验收。

### 4. 校验与错误

| 条件                                              | 结果                                                |
| ------------------------------------------------- | --------------------------------------------------- |
| loc 缺省                                          | 驱动与 session 均使用 UTC                           |
| time_zone 与 loc 冲突，或 URL 重复时区参数        | 启动前返回脱敏配置错误                              |
| loc=Local                                         | 拒绝依赖宿主时区                                    |
| MySQL 缺少命名时区表，错误码 1298                 | 明确提示加载 loc 所需的 MySQL 时区表                |
| SQLite 配置其他整数精度、字符串格式或禁用整数解码 | 返回脱敏配置错误                                    |
| SQLite 历史非空时间无法解析                       | CHECK 约束中止迁移，回滚后保留原值，禁止转换为 NULL |
| GraphQL 输入没有时区                              | 拒绝输入                                            |

### 5. 正常、基准与风险案例

- 基准：MySQL URL 不含 loc，驱动使用 UTC，session 为 `+00:00`。
- 正常：历史北京时间值 `2026-10-21 12:00:00` 配合 `loc=Asia%2FShanghai`，API 输出 `2026-10-21T04:00:00Z`。
- 风险：直接把旧北京时间 DATETIME 的 loc 改成 UTC，会错误解释历史数据；只在接口输出调用 `.UTC()` 无法修复。

### 6. 必要测试

- `infra/database/mysql_time_test.go`：MySQL 原生 DSN 时区键大小写及 session/local 别名归一、等价 UTC 写法合并、混合别名冲突脱敏及其他参数保留。
- `infra/database/postgres_time_test.go`：PostgreSQL URL／原生 DSN 时区键大小写归一、同值合并、冲突脱敏及其他参数保留。
- `infra/database/time_test.go`：时区派生与冲突脱敏、SQLite 实际 integer 存储、不同 offset 等值查询及 SQL 排序；隔离 `MYSQL_TEST_DSN` 覆盖两条物理连接、UTC/上海、旧字面值、新写入、默认值和 ON UPDATE。
- `modules/auth/sessions_test.go`：SQLite 使用 time.Time fixture，验证过期过滤与绝对时间排序／分页；旧字符串只进入迁移 fixture。
- `backend/internal/schema/time_test.go`：旧库升级、亚秒截断、默认 integer、NULL、删除后的高水位自增序列、外键完整性，日期／分钟及 Z 后缀、旧驱动各格式的单数字小时、数字 offset 后的 Z、点／逗号小数秒（带时区、无时区与负纪元），样本须先经实际驱动的旧 TEXT 解码验证再迁移、合法闰日，以及非法小数、日历日期和时分秒回滚。
- `backend/internal/schema/postgres_test.go` 与 DateTime scalar 测试：目标列精度、数据库默认值和输入输出秒级 UTC；隔离真实 PostgreSQL 验证跨时区 instant。

### 7. 错误与正确用法

错误：向 SQLite 时间列直接传 `now.Format(time.RFC3339Nano)`，或者查询后在 Go 中重新筛选、排序和分页。

正确：向所有方言传 `time.Time`，复用连接工厂编码，并通过 `WHERE expires_at > ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?` 执行数据库分页。

## 场景：数据库版本自动检测

### 1. 范围与触发

Web、Worker 启动和 readiness 需要判断数据库是否适配当前应用，避免已迁移后仍被旧环境变量拦截。

### 2. 签名

应用 `internal/databasegate.Open(ctx, driver, dsn) (*Gate, error)`、`Gate.Check(ctx) error` 和 `Gate.Close() error`。`DatabaseVersion` 随代码交付，三方言最新迁移必须与其一致；公共 `revision.Gate` API 保持兼容。

### 3. 契约

只读查询 `atlas_schema_revisions`；复用公共 Gate 对全部记录的 type、applied/total 和 error 的校验。完整版本必须精确匹配应用要求。`DB_DSN` 决定实际连接，忽略所有历史 `DB_VERSION` 值，不新增环境开关。迁移由独立命令执行，启动不写库。仅版本不匹配时额外读取最新版本以生成诊断；异常版本内容不回显。

### 4. 校验与错误矩阵

| 数据库状态                 | 结果                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- |
| 完整且版本相同             | 启动成功；readiness 继续检查依赖                                                       |
| 版本落后或登记为空         | 保持 `errors.Is(err, revision.ErrVersion)`，提示应用要求及迁移命令；落后时显示实际版本 |
| 版本超前                   | 保持 ErrVersion，显示实际版本和应用要求，提示匹配应用版本及核对 DB_DSN，不提示继续迁移 |
| 任意记录未完成或含 error   | 保持 ErrIncomplete，提示检查并完成迁移                                                 |
| 缺表                       | 保持 ErrUnavailable，说明 atlas_schema_revisions、迁移及 DB_DSN                        |
| 连接、权限、取消或字段异常 | 保持 ErrUnavailable，不回显驱动错误与连接信息                                          |

### 5. 正常、基准与拒绝场景

正常：执行 `pnpm migrate` 后直接重启；旧 `.env` 留有 `DB_VERSION=202610040001` 也能启动。基准：未设置 DB_VERSION 的已迁移库正常启动。拒绝：修改环境变量无法绕过真实版本落后、超前或历史失败记录。

### 6. 验证要求

`internal/config/config_test.go` 验证旧、空、超前及非法 DB_VERSION 均不影响配置加载。`internal/databasegate/gate_test.go` 使用只读 SQLite 覆盖匹配、落后、超前、空记录、未完成、历史失败、缺表、脱敏、数据库字节不变、readiness 变更与取消，并核对三方言最新迁移。主仓 verify 和 Docker 验收通过修改隔离测试库的迁移登记模拟落后，finally 恢复，不再通过环境变量模拟版本错误。真实 MySQL/PostgreSQL/Docker 属于独立专项验收。

开发监管器为含 `pnpm migrate` 的迁移错误及缺表提示生成可复制命令，复用实际应用目录和后端配置的 `--env-file` 绝对路径，参数由 `shlex.join` 引用；版本超前不生成迁移命令。回归沿用 `scripts/test-dev-reload.py`。

### 7. 错误与正确用法

错误：迁移后要求修改 `.env` 的 DB_VERSION，或由启动进程执行迁移。正确：新增迁移时同步 DatabaseVersion；部署独立迁移，启动只读核验，使用同一后端配置执行 `pnpm migrate` 后直接重启。
