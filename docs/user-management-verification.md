# 用户管理写操作验收记录

日期：2026-10-05。工作目录：`/home/dream/wwwroot/go-starter`；分支：`develop`；基线提交：`8381e1a23a1b69a58cb6c1b9e04bad54cb9f756c`。本批为 R2 第二批，全部改动保留在工作区，提交按用户单次授权执行。

## 1. 交付范围与兼容契约

- 创建邮箱用户并设置初始密码，编辑名称／角色，封禁／解封，撤销用户全部会话。
- 公共 auth Service、Admin GraphQL 和公共 Dashboard 同步接入，数据库迁移版本保持 `202610040001`。
- `createUser(set)` 与 `updateUser(set, where)` 沿用参考输入及数组返回；`revokeUserSessions(userId: ID!)` 为登记的 Go 扩展。输入字段保持白名单，用户 ID 使用正整数且上限为 2147483647。
- 新密码按 8–128 UTF-8 字节校验，沿用 NFKC 规范化及 scrypt 散列。User 和 credential Account 同事务创建，重复邮箱返回受控业务错误。
- 名称、角色、封禁字段分别要求 `user:update`、`user:set-role`、`user:ban`；创建要求 `user:create`，创建非 user 角色额外要求 `user:set-role`；撤销会话要求 `session:revoke`。目标角色与账号权限受操作者授权范围约束。
- owner 管理要求操作者拥有完整 owner 角色及 `system:owner`。直接分配 owner、自身角色变化、有效自封禁受服务端保护。最后可用 owner 按完整 owner 角色和有效封禁状态判断；凭据可用性专项归后续账号治理。
- 更新必须包含有效筛选，单次最多 100 个用户；任一目标授权失败或会话撤销失败时，整批事务回滚。省略封禁原因／到期保留原值，显式 null 清空，解封同时清空原因与到期。
- 实际角色变化、封禁及已封禁账号到期调整，同事务撤销目标全部会话；名称编辑保留会话。会话撤销重复执行保持幂等。
- 管理事务与登录会话写入共享初始化锁表的单例写锁，事务内复核最新账号及权限。登录在锁外完成密码派生，在锁内复核封禁状态与 credential hash，覆盖凭据读取至会话写入之间的竞态。
- 管理审计记录动作、数字目标 ID、结果和 request ID，敏感表单字段与凭据保持脱敏。审计存储及保留周期由部署配置。
- Dashboard 入口结合权限与可选适配器能力；错误保留在操作弹窗，关闭／卸载时取消等待并隔离迟到响应。其他用户管理成功后只刷新一次列表，共享身份查询增量为 0；自身操作刷新身份，撤销自身会话后回到登录页。

后续批次：删除用户、完整密码管理、所有权转移、会话列表。手机号登录继续延期。

## 2. 隔离自动验证

最终整体验收：`rtk proxy pnpm verify`，结果入口为 `/home/dream/wwwroot/go-starter/.runtime/project-wzu6x95t/result.json`；完整命令日志为 `/home/dream/wwwroot/go-starter/.runtime/password-length-20261005/verify.log`。本轮新建 MySQL datadir、数据库、Redis 进程与随机端口；SQLite 启动门禁使用新数据库文件，浏览器使用本轮新服务。开发数据库、环境文件及既有服务保持原状。

| 项目                         | 最终结果                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| 完整流程检查                 | 18 项通过，耗时 367.01 秒                                                       |
| Go 测试记录                  | 431 条父／子用例通过记录：正式工程 421 条、格式工具 6 条、独立外部进程专项 4 条 |
| MySQL／SQLite                | MySQL 8.0.46，双数据库正式 Atlas 迁移／登记及 MySQL 结构一致性通过              |
| Go vet、可重复生成、静态构建 | 通过                                                                            |
| Dashboard／应用类型检查      | 通过                                                                            |
| 公共 UI 单测                 | 11 项通过                                                                       |
| Python 脚本单测              | 17 项通过：开发监管 5、格式 4、工程 2、验收脚本 6                               |
| 内嵌构建 SPA 浏览器          | 72 项通过；失败／跳过／flaky 均为 0                                             |
| Vite 开发浏览器              | 72 项通过；失败／跳过／flaky 均为 0                                             |
| 公共 Dashboard HMR           | 通过，页面保持当前生命周期                                                      |
| Web／Worker 开发监管         | 共享源码双入口重建、优雅退出和进程组清理通过                                    |

Go 全量单测阶段依环境跳过 4 个外部进程用例；整体验收随后使用真实独立进程逐项通过 `TestExternalWebProcesses`、`TestExternalCrashTTL`、`TestExternalShutdown`、`TestExternalRedisStop`。

重点回归：

1. 真实 MySQL 并发创建同邮箱只有一次成功；User／Account 创建、用户更新与会话撤销失败均有事务回滚断言。
2. 跨 Service 角色变更撤销会话，登录与封禁竞态按写锁排序，两个 owner 并发互相封禁只有一项成功。
3. GraphQL 字段权限、未知输入字段、批量筛选、组合角色、显式 null 与省略语义、受控错误及审计脱敏。
4. 两类 WebSocket 分别覆盖管理撤销／封禁／角色变化，失效连接结束且设备 presence 清理。
5. 真实浏览器创建后登录、名称编辑保留会话、角色调整失效、封禁拒绝登录、解封后登录和全量撤销。
6. 弹窗错误保留表单、操作取消／卸载、移动布局、角色与 owner 门禁、日期本地输入到 UTC 转换以及请求次数。

证据目录及文件：

- `/home/dream/wwwroot/go-starter/.runtime/project-wzu6x95t/result.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-wzu6x95t/正式工程全部单测与真实MySQLRedis集成.log`
- `/home/dream/wwwroot/go-starter/.runtime/project-wzu6x95t/browser.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-wzu6x95t/browser-dev.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-wzu6x95t/公共Dashboard源码HMR.log`

首轮检查发现并修复：空 NOT IN 的有效条件计数；日期输入可访问名称包含帮助文本；登录页 mock 缺少 install-status；验收脚本清理的邮箱限流桶与正式 account ID 桶发生偏差；MySQL 大小写不敏感预筛选后的 owner 判断。最终验证覆盖以上修复，正式登录限流保持每账号每分钟 5 次、每 IP 每分钟 20 次。

## 3. 人工验收

使用独立测试账号及测试环境，管理员登录后访问 `/admin/users`。

1. 点击“创建用户”，填写名称、邮箱、8–128 UTF-8 字节初始密码。用新账号在独立浏览器登录；重复创建同邮箱检查业务错误。创建 member 默认拥有 Member 权限，admin 默认拥有管理后台权限。
2. 打开目标行末尾的三点操作菜单，选择“编辑”。编辑名称，检查目标已登录会话继续有效；修改目标角色，检查已有会话失效并可按新权限重新登录。
3. 在三点操作菜单选择“封禁”，填写原因与未来到期时间，检查已有会话失效、重新登录显示封禁错误。解封后检查原因／到期清空及登录恢复。
4. 在三点操作菜单选择“撤销会话”，检查目标已有设备退出、操作者身份保持。撤销自身会话，检查页面跳到登录页。
5. 使用 admin 查看 owner 行，检查管理入口权限；检查自身角色修改／封禁入口。通过直接 GraphQL 调用复核服务端拒绝越权。
6. 打开 Network：管理其他用户成功后出现一次 mutation 和一次 `listUsers`，共享身份查询增量为 0。延迟请求并关闭弹窗或切页，检查迟到响应保持当前页面；重新进入列表核对已完成的服务端写入。

详细接口和参考契约见 `/home/dream/wwwroot/go-starter/docs/migration-compatibility-matrix.md`；应用步骤见 `/home/dream/wwwroot/go-starter/projects/multi-database-demo/README.md`。

## 4. 环境验收边界

- 内嵌 SPA 浏览器使用构建产物及 development HTTP 配置；合法 production Web／Worker 启动与 HTTP Origin 拒绝已通过，真实 TLS／反向代理／Cookie 域及跨域部署继续专项验收。
- Docker 镜像构建及容器运行保持待验收。当前 Go 工具链使用 `CGO_ENABLED=0`，race detector 依赖 C 编译器环境，保持待验收。
- 真实旧库导入、生产发布、长期故障演练及高并发容量继续验收；本轮全部数据来自隔离测试库。
- 管理与登录共享单例写锁，需结合真实流量评估锁等待及登录吞吐。默认 WebSocket 500ms 身份复核的数据库负载与连接容量进入压测清单。

## 5. 密码下限调整（2026-10-05）

按用户确认，初始化和创建用户统一调整为 **8–128 UTF-8 字节**。服务端散列、初始化 REST 门禁、创建用户 GraphQL，以及安装页和用户创建弹窗的校验与提示同步调整。旧账号登录保持独立 512 字节上限，NFKC、scrypt 参数及限流继续沿用。

边界回归覆盖 7／8／128／129 字节、汉字与 ASCII 混合输入、emoji，以及八字节密码的初始化／创建／登录闭环。真实浏览器创建用户使用八字节密码；前端初始化与创建弹窗覆盖七字节拒绝和八字节混合密码通过。

密码范围调整后的完整 `pnpm verify` 已通过：18 项流程检查、431 条 Go 父／子用例通过记录，内嵌 SPA 与 Vite 开发浏览器各 72 项通过。日志：`/home/dream/wwwroot/go-starter/.runtime/password-length-20261005/verify.log`。

## 6. 用户列表样式对齐（2026-10-05）

参考源码：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/dashboard/client/pages/user-list.tsx` 与同目录 `../ui/dialog.tsx`。

对齐范围：

1. 页面区块间距 `gap-6`、标题上边距、描述间距、当前页记录数及桌面／移动端工具栏；创建用户位于刷新前。
2. 保留四项筛选、带边框表格、头像与姓名／邮箱的双行排版和独立分页区；姓名为空时使用邮箱生成头像缩写。
3. 用户角色徽标按参考配色展示：admin 靛蓝、member 天蓝、user／owner／组合角色中性色；组合角色保留完整值。
4. 行操作使用 32px 三点入口、176px 右对齐下拉菜单，按权限展示编辑、封禁／解封及撤销会话。
5. 公共 Dialog 对齐参考弹窗位置、标题、边距、圆角、错误面板和响应式按钮布局；创建弹窗桌面最大宽度 448px，短屏使用视口高度上限与内部滚动。

中文文案与既有管理功能保留；字段权限、owner／自身保护、请求取消、身份缓存、URL 筛选与分页语义保持。菜单展开／关闭和弹窗取消产生零次追加数据请求。删除用户、完整密码管理及所有权转移继续按迁移批次推进。

样式验收包括 1920×1080 桌面浅／深色、390×844 移动页面和 320×480 短屏弹窗。截图等待主题颜色过渡完成，并关闭截图动画。隔离浏览器通过临时 Fontconfig 使用本机中文字体，应用字体配置保持原状。

本轮 `pnpm verify` 全部 18 项检查通过，公共 Dashboard 单测 18 项通过，内嵌 SPA 与 Vite 开发浏览器各 74 项通过，失败／跳过／flaky 均为 0。专项用户查询／管理 Mock 回归 21 项通过，样式／键盘／短屏专项复核 2 项通过。真实 MySQL、Redis、双 Web、独立 Worker、管理链路与请求次数回归通过；原 POC 与参考仓库保持原样。

证据：

- `/home/dream/wwwroot/go-starter/.runtime/project-fik2sh3a/result.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-fik2sh3a/browser.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-fik2sh3a/browser-dev.json`
- `/home/dream/wwwroot/go-starter/.runtime/user-list-style-20261005/browser-mock.json`
- `/home/dream/wwwroot/go-starter/.runtime/user-list-style-20261005/browser-style.json`
- `/home/dream/wwwroot/go-starter/.runtime/user-list-style-20261005/users-desktop-light.png`
- `/home/dream/wwwroot/go-starter/.runtime/user-list-style-20261005/users-desktop-dark.png`
- `/home/dream/wwwroot/go-starter/.runtime/user-list-style-20261005/users-mobile-light.png`
- `/home/dream/wwwroot/go-starter/.runtime/user-list-style-20261005/users-mobile-dialog.png`

人工验收：刷新 `/admin/users`，检查创建／刷新顺序、角色徽标、每行末尾三点菜单、浅／深色切换和窄屏弹窗；菜单展开与取消弹窗时检查 Network 请求数保持。代码保留在 `develop`，本轮改动保持未提交。生产 TLS／反向代理、Docker、race、真实旧库导入及容量边界继续按第 4 节验收。

## 7. 右上角字号对齐（2026-10-05）

参考源码：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/dashboard/client/components/font-size-selector.tsx`、`src/dashboard/shared/font-size.ts` 与 `src/dashboard/client/app.tsx` 顶栏工具区。

对齐字形图标、ghost／icon 按钮、当前字号提示、右对齐 `w-40` 菜单、单选指示器、字号名称与像素提示，以及与主题按钮的 `gap-2` 间距。展开菜单时收起 Tooltip，保持菜单内容完整可见。选项为紧凑 16px／标准 17px／舒展 18px，默认标准；旧版 14px 自动迁移为紧凑，已有 16px／18px 设置保留。偏好沿用应用独立 localStorage 键及数字型 Hook API。

根字号调整为标准 17px 后，rem 尺寸同步缩放：用户列表标题为 25.5px，行操作按钮为 34px，行菜单为 187px；对应 Tailwind token 保持 `text-2xl`、`size-8`、`w-44`。第 6 节像素值记录此前 16px 下的验收结果。

手工验收步骤：

1. 进入后台，检查右上角字形图标与主题按钮；悬停显示“字号：当前选项”，展开后显示“字号大小”和三档单选菜单。
2. 依次选择紧凑／标准／舒展，检查页面字号立即变化、当前项指示及按钮提示同步；刷新后保留字号和主题。
3. 使用 Tab 聚焦字号按钮、方向键展开并选择、Enter 确认、Escape 关闭，检查焦点回到入口。
4. 在桌面及 390px 移动视口，检查浅色／深色菜单、右对齐和视口边界；Network 中展开、选择、关闭菜单追加请求为零。
5. 将 `multi-database-demo:font-size` 设置为 `14` 或异常值后刷新，分别恢复紧凑 16px／标准 17px。浏览器存储受限时，当前页面可切换，刷新回到标准。

自动化覆盖选项定义、存储恢复与迁移、应用键隔离、存储受限、桌面／移动浅深色、菜单键盘及焦点、刷新保存和零追加请求；真实 API 浏览器用例同步使用新单选菜单。

本轮完整 `pnpm verify` 全部 18 项检查通过，公共 Dashboard 单测 30 项通过，内嵌 SPA 与 Vite 开发浏览器各 82 项通过，失败／跳过／flaky 均为 0。字号专项 Mock 浏览器 8 项通过；覆盖用户列表 17px 布局与原有管理回归。全仓格式和 diff 检查通过，改动保留在 develop 工作区。

证据：

- `/home/dream/wwwroot/go-starter/.runtime/project-f0dh80u4/result.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-f0dh80u4/browser.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-f0dh80u4/browser-dev.json`
- `/home/dream/wwwroot/go-starter/.runtime/font-size-20261005/browser-font-final.json`
- `/home/dream/wwwroot/go-starter/.runtime/font-size-20261005/font-final-results`（桌面／移动浅深色截图）

第 4 节生产环境与专项验收边界继续适用。

## 8. 侧栏折叠与标题对齐（2026-10-05）

参考源码：`/home/dream/wwwroot/astro-full-stack-starter/packages/astro-full-stack-starter/src/dashboard/client/components/nav-user.tsx`、`components/app-sidebar.tsx`、`ui/breadcrumb.tsx` 和 `app.tsx` 顶栏。

底部用户区改为头像菜单，展开时展示名称／邮箱，手动折叠与中屏自动收窄时保留头像。菜单展示当前账号及真实退出动作，保留退出等待锁定、失败提示和重试；服务端接口、会话缓存和权限过滤沿用现有实现。工作空间图标使用 `size-4`；移动抽屉使用中文可访问标题和描述。

顶栏对齐 `h-14`、`gap-2`、折叠按钮 `-ml-1`、竖分隔线及面包屑。应用名链接通过 SPA 返回系统概览，当前页面标题随导航变化；移动端显示当前页面标题。标准 17px 字号下顶栏高 59.5px、展开侧栏宽 272px、折叠侧栏宽 51px；舒展 18px 下顶栏高 63px。移动抽屉遵循公共 Sheet 的视口宽度上限，在 390px 视口为 292.5px。

手工验收步骤：

1. 刷新 `/admin/users`，检查顶部“Multi Database Demo / 用户列表”、折叠按钮与分隔线，以及左下角头像／名称／邮箱。
2. 点击折叠按钮、侧栏边轨，使用 Ctrl／Command+B；检查图标栏、导航高亮和底部头像，打开头像菜单查看账号信息并退出。
3. 切换系统概览／用户列表／店铺列表，检查标题同步；点击面包屑应用名回首页。Network 中折叠和菜单交互追加请求为零，切页继续复用身份，仅加载当前页面业务数据。
4. 检查 1920／1280／1100／1024／390px 视口、浅色／深色和 18px 字号；移动抽屉点击导航后关闭，菜单支持键盘和 Escape 焦点恢复。
5. 在隔离环境模拟退出 503，检查账号和页面保留，展开头像菜单可查看错误并重试；延迟退出响应期间再次打开菜单，检查“正在退出…”动作锁定。

自动化包含页面标题解析 7 项单测与侧栏专项 10 项浏览器用例，并更新真实 API 及会话回归的退出入口。公共 Dashboard HMR 验证使用面包屑应用名作为更新锚点，检查源码热更新、窗口状态保留及源码恢复。本轮完整 `pnpm verify` 的 18 项检查全部通过，记录 431 条 Go 父／子测试通过结果，公共 Dashboard 单测 37 项通过。内嵌 SPA 与 Vite 开发模式浏览器各 92 项通过，失败／跳过／flaky 均为 0；侧栏／字号／会话专项 Mock 浏览器 44 项通过。公共 Dashboard 源码 HMR 保留窗口状态，测试结束后源码恢复。全仓格式与 diff 检查通过，改动保留在 develop 工作区。

证据：

- `/home/dream/wwwroot/go-starter/.runtime/project-dsgcsbc7/result.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-dsgcsbc7/browser.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-dsgcsbc7/browser-dev.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-dsgcsbc7/公共Dashboard源码HMR.log`
- `/home/dream/wwwroot/go-starter/.runtime/sidebar-20261005/browser-final.json`
- `/home/dream/wwwroot/go-starter/.runtime/sidebar-20261005/final-results`（展开／折叠、桌面／移动浅深色截图）

第 4 节生产环境与专项验收边界继续适用。

### 8.1 折叠按钮后的竖线修复（2026-10-05）

浏览器复现顶栏分隔线宽度为 `0px`。Radix 输出 `data-orientation="vertical"`，公共组件原有 `data-vertical` 样式选择器匹配失败。分隔线统一使用 `data-[orientation=horizontal]`／`data-[orientation=vertical]`，顶栏竖线恢复为 1px 宽、1rem 高（标准字号下 17px），沿用主题边框色及现有间距；横向分隔线同步恢复方向匹配。

追加 3 项分隔线单测，并在 1920／1280／1100／1024／390px 浏览器用例中检查竖线宽高、方向属性及浅深色颜色。公共 UI 单测 40 项、侧栏 Mock 浏览器 10 项全部通过，类型检查及生产前端构建通过；本次验证覆盖公共组件与前端，完整 Go／MySQL／Redis 验收记录沿用上一轮。

复现及修复后报告：`/home/dream/wwwroot/go-starter/.runtime/header-divider-20261005/before.json`、`/home/dream/wwwroot/go-starter/.runtime/header-divider-20261005/after.json`。截图位于同目录 `after-results`。

## 9. 用户管理弹窗焦点恢复（2026-10-05）

修复全面审查的 R01（P2）。创建入口移入 Dialog 根节点，使用 `DialogTrigger asChild`；创建弹窗通过 Escape、取消、右上角关闭或成功提交关闭后，焦点返回创建按钮。

行操作保存菜单按钮引用，并在 `onCloseAutoFocus` 中恢复焦点。成功提交触发用户列表清空与重建时，页面将待恢复用户 ID 绑定到该轮查询：完成后聚焦对应行的菜单按钮；目标行消失或列表读取失败时，聚焦创建入口，创建权限缺失时聚焦刷新入口。加载期间两个入口均不可用时，以用户列表标题作为临时焦点落点。查询取消或页面卸载后，该轮加载的焦点请求随生命周期结束。加载期间用户主动聚焦筛选输入等其他控件时，继续保留该控件焦点。

追加 24 项浏览器回归：创建入口的三种关闭方式；编辑、封禁、解封、撤销会话的三种关闭方式；创建及四种行操作成功后刷新列表；目标行消失时创建／刷新回退；列表读取失败；加载期间筛选输入焦点保留。现有自身会话撤销与迟到回调测试继续覆盖身份跳转、切页和请求取消。

手工验收：

1. 在 `/admin/users` 使用 Tab 聚焦创建入口，按 Enter 打开；分别使用 Escape、取消及右上角关闭，检查焦点返回创建按钮，再按 Tab 到刷新按钮。
2. 使用键盘打开用户行菜单，选择编辑、封禁、解封或撤销会话；关闭后检查焦点返回该行菜单按钮。
3. 提交成功后检查列表刷新及焦点返回对应入口；在筛选结果导致目标行消失时检查创建／刷新入口回退。
4. 延迟列表响应，关闭后主动选择邮箱筛选输入；响应完成后检查输入焦点保留。

本节修复位于 `develop` 工作区，提交与推送保持等待用户明确授权。第 4 节生产环境与专项验收边界继续适用。

### 9.1 本轮验证结果与边界

- `pnpm check` 通过：Go 静态检查、生产前端构建、全仓库四空格格式检查及两处 TypeScript 类型检查。
- 用户管理浏览器共 37 项（本次新增 24 项）：生产构建与隔离 Vite 开发模式各 37 项通过，失败、跳过及 flaky 均为 0。两轮运行使用独立端口和测试输出目录。
- 原审查的 8 个焦点复现场景全部通过；关闭后焦点返回创建入口或当前行菜单按钮，页面 JavaScript 异常为 0。
- 完整 `pnpm verify` 第二轮已通过 16 个流程检查：Go 431 条父／子用例通过记录、公共 Dashboard 单测 43 项、内嵌 SPA 浏览器 118 项，以及真实 MySQL／Redis、跨实例、外部故障和 Web／Worker 独立退出检查。
- 完整验收第二轮在开发模式全套浏览器测试达到 240 秒超时，`result.json` 状态为 `failed`。该阶段浏览器 JSON 尚未生成；开发模式完整套件、后续公共 UI HMR 与开发进程统一退出验收保持待验证。隔离 Vite 的 37 项专项结果覆盖本次用户管理修复。
- 完整验收第一轮遇到真实用户角色修改的 MySQL 读取超时；第二轮该场景通过。该事件保留为运行环境证据，本次修复范围维持前端焦点恢复。
- 临时验收服务按运行脚本清理；既有开发服务保留。`git diff --check` 通过，暂存区为空，提交与推送继续等待用户明确授权。

验证证据：

- `/home/dream/wwwroot/go-starter/.runtime/focus-fix-20261005/check-final.log`
- `/home/dream/wwwroot/go-starter/.runtime/focus-fix-20261005/browser.json`
- `/home/dream/wwwroot/go-starter/.runtime/focus-fix-20261005/browser-vite.json`
- `/home/dream/wwwroot/go-starter/.runtime/focus-fix-20261005/browser-edges.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-6ipgnomg/result.json`
- `/home/dream/wwwroot/go-starter/.runtime/project-6ipgnomg/browser.json`
- `/home/dream/wwwroot/go-starter/.runtime/focus-fix-20261005/verify-retry.log`
- `/home/dream/wwwroot/go-starter/.runtime/project-j5rzfxtm/Web-A.log`

第 4 节 Docker、race、真实旧库导入／备份回滚及生产配置验收边界继续适用。
