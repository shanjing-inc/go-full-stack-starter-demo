# 公开 SSR 首批迁移与验收

日期：2026-10-06。目录：`/home/dream/wwwroot/go-starter`，分支：`develop`。本批迁移首页和队列测试页，保留工作区已有队列管理改动，提交与推送仍按用户单次授权执行。

## 迁移范围

| 入口                        | 本批行为                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/`                         | Echo + `html/template` 输出完整 HTML、title、description、队列测试与后台入口；浏览器增强主题和本地持久化计数器 |
| `/test/queue`               | 公开测试介绍，登录后按权限服务端读取最近 20 条 `demo:queue-test` 执行记录；刷新读取最新状态                    |
| `/api/rest/demo/queue-test` | POST JSON 投递单队列或全部队列任务，逐项返回任务 ID／失败提示                                                  |
| `/public/theme.js`          | 样式加载前恢复公开页主题；浏览器存储受限时安全回退                                                             |
| `/admin/*`                  | 继续使用现有 React SPA，登录成功允许精确返回 `/test/queue`                                                     |

公共 auth 增加页面身份校验入口，共用签名 Cookie／Bearer、来源、会话有效期和封禁检查。记录读取要求 `dashboard:access:admin` + `queue:read`；投递再要求 `queue:retry`。匿名、过期和封禁账号仅显示公开介绍，缺少权限的有效账号返回 HTML 403；服务故障返回脱敏提示。

GET／HEAD 页面始终保持只读。投递载荷限制 4 KB，校验队列、模式、多余字段与尾随 JSON；Cookie 写请求检查精确 Origin。SSR 页面使用 `no-store`，模板自动转义用户名、任务 ID 和错误文本；浏览器结果通过 `textContent` 写入。

队列覆盖 critical／default／low，权重 6／3／1，Worker 共用并发池。模式覆盖 success、fail-once、always-fail。失败任务首次执行后进入失败列表，后台人工 Retry 沿用现有实现；fail-once 的 Redis 首次失败标记保留 1 小时，在该窗口内重试成功，always-fail 重试后继续失败。本批沿用数据库迁移版本 `202610040001`。

## 资源与开发行为

Vite 一次构建公开脚本与后台两个入口，通过 manifest 共享 Tailwind CSS。SSR 引用实际 hashed `/admin/assets/*` 资源，公开脚本约 4.41 KB，包含主题、计数器和队列投递交互。Go 将模板、主题脚本、manifest 和构建资源嵌入 Web 二进制。

Vite 开发入口 `/`、`/test/queue`、`/public/*`、`/admin/assets/*` 代理到 Go。模板和主题脚本纳入开发源码指纹，页面测试文件继续保持独立。后台 SPA 使用 Vite HMR；公开 `public.ts`／CSS 采用该次开发运行的私有构建产物，修改后重启 `pnpm dev`。新增 Tailwind utility 后同样重建资源。

## 首批迁移验证结果（队列页对齐前快照）

| 验证               | 结果与边界                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `rtk pnpm build`   | 最新构建通过：前端多入口、类型检查及 Web／Worker 静态二进制                                                                       |
| 全 Go 包回归       | 本轮较早源码快照：331 条通过记录、0 失败、82 条跳过记录；包含父／子用例。最新 SSR 定向 Go 回归另列                                |
| SSR 定向 Go 回归   | 最新 `internal/pages`、`internal/web`、`internal/tasks`、`webui`、`modules/auth` 五包通过                                         |
| `go vet`           | 本轮较早源码快照：上述两个正式 Go 模块通过                                                                                        |
| 隔离 Redis 集成    | `internal/tasks`、`modules/queue`、`infra/queue` 三包通过；真实 Worker、三队列消费、首次失败、人工重试、执行序号与 retryOf 链覆盖 |
| 公开页浏览器       | 最新 Go 内嵌入口 5／5、Vite 代理入口 5／5，含移动端表格内部滚动及行高断言                                                         |
| 后台队列浏览器回归 | 最新 28／28，覆盖列表、权限、人工重试与同步新增的计划任务；较早快照 24／24                                                        |
| 既有真实后台烟测   | 最新 1／1，覆盖 Go API、店铺唯一约束、队列记录与详情深链                                                                          |
| 公共 UI 单测       | 本轮较早源码快照：51／51                                                                                                          |
| 前端类型检查       | 本轮较早独立检查及最新构建中，公共 Dashboard 与 demo 前端通过                                                                     |
| 开发监管测试       | `test-dev.py` 5／5，`test-dev-reload.py` 15／15                                                                                   |

公开页浏览器验证涵盖关闭 JavaScript 后仍有完整正文、已登录账号的执行记录直接存在于 HTML、登录返回公开 SSR、三队列 POST 投递、两种失败任务人工重试、计数器和主题持久化、受限存储安全回退、390 px 移动端宽度及运行时异常检查。记录落库与 Asynq 最终归档之间存在异步窗口；人工重试验收等待详情 `canRetry=true` 后执行操作。

浏览器使用已有 `.tools/browser/usr/lib/x86_64-linux-gnu` 共享库，通过 `LD_LIBRARY_PATH` 加载；截图核对使用隔离 fontconfig 配置及本机中文字体。验收使用独立随机端口 Redis、正式迁移的临时 SQLite、独立 Web／Worker／Vite，结束后只清理该次验收拥有的进程。

此前隔离验收 `/home/dream/wwwroot/go-starter/.runtime/ssr-acceptance-a507adf8` 曾出现两项计划任务测试失败：新增菜单导致旧数量断言失效，以及侧栏与面包屑匹配产生 strict mode violation。同步更新后的相关测试已在最新完整编排通过，本批保持队列调度实现与相关测试的原有改动。

首批迁移快照的公开 SSR、后台队列和真实后台烟测均通过。移动端执行记录表为错误列保留最小宽度，浏览器回归验证表格内部横向滚动及每行高度最多 160 px，桌面与移动端截图已核对。

较早全 Go 回归日志：`/home/dream/wwwroot/go-starter/.runtime/ssr-go-tests.jsonl`。最新定向 Go 回归日志：`/home/dream/wwwroot/go-starter/.runtime/ssr-go-targeted-final.log`。最新构建与浏览器日志分别为 `/home/dream/wwwroot/go-starter/.runtime/ssr-build-final.log`、`/home/dream/wwwroot/go-starter/.runtime/ssr-browser-final.log`。

首批迁移隔离验收目录：`/home/dream/wwwroot/go-starter/.runtime/ssr-acceptance-231393e4`，包含公开 Go／Vite、后台队列、真实后台烟测四份浏览器 JSON 报告、进程日志及桌面／移动端截图；入口文件为 `/home/dream/wwwroot/go-starter/.runtime/ssr-acceptance-latest`。较早完整通过目录：`/home/dream/wwwroot/go-starter/.runtime/ssr-acceptance-04205213`，保留四份浏览器报告用于历史对照。

## 验证边界

- 最新全仓 `pnpm format:check` 通过，日志：`/home/dream/wwwroot/go-starter/.runtime/ssr-format-check.log`；`git diff --check` 通过。
- 82 条跳过记录包含真实 MySQL、Redis、外部进程等依赖测试；本批另行补跑上述三个队列 Redis 包。MySQL SSR 登录／读取、完整双浏览器编排和真实旧库本轮保留待验收状态。
- Docker、race detector、生产 TLS／代理／Secure Cookie、容量与持续运行属于后续环境验收范围。
- 其余参考公开测试页、公开脚本 HMR、SEO 专项审计继续作为后续范围。

重新启动 `pnpm dev` 后，开发公开首页为 `http://127.0.0.1:5173/`，队列测试为 `http://127.0.0.1:5173/test/queue`；Go 直接入口使用默认 8080 端口。队列投递需要 Worker 和 Redis 在线，并使用具备上述权限的账号。

## 审查修复：真实登录账号隔离（2026-10-06）

此前完整浏览器编排中，`dashboard.spec.ts` 的多个真实登录与公开 SSR 登录共用 `owner@example.com`，会共同消耗账号每分钟 5 次额度；失败材料中的登录页面显示“请求频繁，请稍后重试”。

`pnpm verify` 现在通过正式 `createUser` 管理 API 创建随机邮箱、随机密码的独立 `admin` 账号，将凭据通过 `SSR_TEST_EMAIL`／`SSR_TEST_PASSWORD` 传给内嵌 SPA 和 Vite 开发浏览器阶段。该账号具备 SSR 读取、投递和人工重试所需权限。两个阶段继续执行真实 UI 登录与回跳，正式账号／IP 限流参数维持 5／20 次每分钟。

独立执行 `pnpm test:browser` 时，需要配置上述两项环境变量，使用专用测试管理员。公开 SSR 用例会在启动时校验凭据配置；验收脚本的独立账号创建与失败中止有 Python 回归测试覆盖。

### 修复后的真实完整浏览器验证

`rtk pnpm verify` 的内嵌 SPA 阶段 164／164 通过，覆盖独立 SSR 管理员真实登录回跳、三队列投递与人工重试。正式 Go／MySQL／Redis 集成阶段 490 条测试通过（含子测试），失败和跳过均为 0。

完整默认编排在开发浏览器阶段触发 240 秒超时，整体报告状态为 `failed`；开发浏览器最终报告及后续公共 Dashboard HMR 保持待验收。报告目录：`/home/dream/wwwroot/go-starter/.runtime/project-jf01ludm`，其中 `result.json` 记录完整边界，`browser.json` 记录通过的内嵌浏览器结果。

补跑 `rtk pnpm verify --skip-dev` 整体 `passed`：17 项检查通过，500 条 Go 测试通过记录（含子测试），内嵌 SPA 浏览器 164／164；公开 SSR 五个用例全部通过，失败、重跑和跳过均为 0。报告目录：`/home/dream/wwwroot/go-starter/.runtime/project-em1fful0`，日志：`/tmp/go-queue-fix-veujdu2q/verify-skip-dev.log`。宿主机开发／HMR 按参数跳过，完整默认编排的超时记录保留独立状态。

两次验收的非文档改动文件与当时交付源码逐字节一致；后续队列页对齐采用下节列出的独立验收快照。临时服务已退出。Docker、race、真实旧库导入／回滚、生产 TLS／代理／Secure Cookie、容量与持续运行专项保持待验收。

## 队列页与 Node.js 版对齐（2026-10-06）

参考正在运行的 `http://127.0.0.1:4321/test/queue`，以及 `/home/dream/wwwroot/astro-full-stack-starter/projects/deno-mysql-demo/src/pages/test/queue.astro`。本节验收发生在前述完整编排之后，覆盖更新后的队列页。

- 布局：独立页面、返回首页、右上角图标主题切换；critical／default／low 三张队列卡片，桌面 1024 px 起三列。
- 操作：每张卡片保留“触发成功任务”“失败一次（可 Retry）”“持续失败”三个按钮，统一成功按钮颜色，并保留各队列标签颜色。
- 请求结果：最近动作、中文模式、毫秒请求时间、按队列着色的结果卡片及 job id／queue／mode；“刷新执行状态”使用绿色链接。
- 执行记录：恢复 `queue / job id / mode / status / attempt / requestedAt / processedAt / error` 表头，waiting／delayed 显示为 queued、active 显示为 processing；attempt 使用记录的 Attempts。任务 ID 和错误列保留最小宽度，移动端表格内部横向滚动。
- Go 对应文案：Asynq、`pnpm dev` 启动 Worker、实际 Go 队列配置路径以及后台队列管理入口。介绍长度会影响换行。
- 写入与权限：保留 POST JSON、登录、队列读取／重试权限和 Origin 校验。GET／HEAD 持续只读。匿名卡片按钮禁用，登录入口放在请求结果卡片内。

### 当前对齐快照验证

| 验证             | 结果                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `rtk pnpm build` | 前端类型检查、多入口资源及 Web／Worker 静态二进制通过；公开 JS 4.41 KB          |
| 定向 Go 回归     | 最终模板的 `internal/pages`、`internal/web`、`internal/tasks`、`webui` 四包通过 |
| Go 内嵌公开页    | 6／6 通过                                                                       |
| Vite 代理公开页  | 6／6 通过                                                                       |
| 后台队列页面回归 | 34／34 通过                                                                     |
| 额外真实后台烟测 | 0／1；Worker 进程区域“部署管理”单元格断言预期 2、实际 0，完整隔离编排状态为失败 |

公开页用例覆盖原版布局、主题图标、真实三队列投递、失败一次／持续失败及人工重试、表头、移动端宽度与行高，以及 API 错误文本安全渲染和按钮状态恢复。桌面与移动端截图已核对。上述后台 Worker 字段断言保持独立记录，相关实现和测试由现有后台工作范围处理。

当前隔离验收目录：`/home/dream/wwwroot/go-starter/.runtime/ssr-acceptance-5a1e2f57`；包含四份浏览器 JSON、服务日志和 `screenshots`。参考截图目录：`/home/dream/wwwroot/go-starter/.runtime/queue-page-reference`。本次使用独立端口 Redis、正式迁移的临时 SQLite 和隔离 Web／Worker／Vite；拥有的进程已清理。

构建日志：`/home/dream/wwwroot/go-starter/.runtime/queue-page-alignment-build.log`；浏览器日志：`/home/dream/wwwroot/go-starter/.runtime/queue-page-alignment-browser.log`；最终定向 Go 日志：`/home/dream/wwwroot/go-starter/.runtime/queue-page-alignment-go-final.log`。格式日志：`/home/dream/wwwroot/go-starter/.runtime/queue-page-alignment-format.log`。

当前对齐快照的完整 MySQL 双入口编排、Docker、race 和生产边界保持待验收。更新公开脚本与样式后，重启 `rtk pnpm dev`，通过 `http://127.0.0.1:5173/test/queue` 查看；Go 直接入口默认使用 8080。

## 实际开发入口资源同步修复（2026-10-06）

用户反馈桌面队列卡片竖排及主题图标错乱后，在正在运行的 5173／8080 入口复现。当前监管器第 7 代 Web 使用新模板，同时嵌入启动时生成的旧私有资源：`style-CD8G4Qkp.css` 缺少 `lg:grid-cols-3` 规则，`public-BDqsx6a2.js` 使用文字主题按钮逻辑，会覆盖图标内容。1280 px 浏览器断言得到三张卡片处于三个纵向位置，复现结果保存在 `/home/dream/wwwroot/go-starter/.runtime/queue-live-before-browser.json`。

本次重新构建现有运行目录的私有前端资源，经暂存目录替换到 `.runtime/dev-vnfitzd3/frontend-dist`；原资源保留在 `frontend-dist-before-queue-fix`。现有监管器自动切换至第 8 代 Web／Worker，使用 `style-C8JAXsgO.css` 与 `public-CZ9QlwXd.js`。监管代码与业务数据保持原状。

增强公开页浏览器断言：1280／1024 px 下卡片同一行且横向分离；900 px 以下按原版响应式布局纵向排列；主题按钮尺寸为 36×36 px，每次切换仅显示一个 16×16 px SVG，按钮持续保留图标内容。5173、8080 两个实际入口的五项公开浏览器用例各 5／5 通过，本次执行范围为匿名正文、布局、主题、存储和移动端；真实登录／投递继续沿用上节隔离验证记录。

构建日志：`/home/dream/wwwroot/go-starter/.runtime/queue-live-assets-build.log`。浏览器报告：`/home/dream/wwwroot/go-starter/.runtime/queue-live-fixed-5173-browser.json`、`/home/dream/wwwroot/go-starter/.runtime/queue-live-fixed-8080-browser.json`；截图位于对应的 `queue-live-fixed-5173-screenshots`、`queue-live-fixed-8080-screenshots` 目录。开发监管现有回归 15／15 通过，日志：`/home/dream/wwwroot/go-starter/.runtime/queue-live-dev-reload-tests.log`。

当前服务已完成资源同步，刷新页面即可查看。后续修改 `public.ts`、CSS 或模板新增 utility 后，按照现有开发约定重启 `rtk pnpm dev`，同步构建公开页私有资源。
