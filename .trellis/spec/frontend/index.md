# 示例 React SPA

用于 frontend 路由、菜单、请求和后台接入。先读 `frontend/src/main.tsx`、`frontend/src/app/app.tsx`（路由装配）、`frontend/src/app/dashboard-adapter.ts`、`frontend/src/lib/request.ts`；这些路径相对应用目录 projects/multi-database-demo。

- Router 挂载 `/admin/`，复用 @shanjing/shadcnui-dashboard；业务 adapter/菜单留在应用。
- request.ts 使用 Apollo Client 执行后台全部 GraphQL 请求，公开演示页继续沿用现有传输；统一同源 credentials: include、错误与取消，GraphQL 为 `/api/graphql/admin`。操作集中在 graphql/admin，adapter 显式使用生成的结果/变量类型，输入/空值与 SDL 一致。
- 首页系统概览通过 Admin `getDashboardOverview` 读取店铺总数、后端栈与模式；adapter 保留 `getSystemData("overview", signal)` 契约，并校验返回结构。
- 沿用 ApiError/响应校验，处理会话未就绪、无权限、失败、取消；服务端同时鉴权。
- 路由/Vite base 变化同时核对 Go SPA 深链、公开资源和 `backend/internal/web` 内嵌资源；先 Vite 后 Go，不手改 dist。
- 偏好沿用 go-mysql-demo 等现有 key，目录重命名不重置用户数据。

Vite、Codegen 和请求回归由 `frontend/package.json` 的 `test` 执行；主仓与独立应用的 `pnpm test` 在前端构建后调用该入口，配置测试失败立即终止后续检查。

根目录验证：`rtk pnpm --filter multi-database-demo-dashboard typecheck`、`rtk pnpm build:frontend`；交互变化补 `rtk pnpm test:browser`（浏览器/独立运行环境）。

公共组件见 [公共前端](shared-dashboard.md)，接口见 [GraphQL](../backend/graphql-guidelines.md)，完整门禁见后端 quality-guidelines。

## 生产构建分包

- 登录、初始化与完整后台同步加载。`app.tsx` 静态导入 `dashboard-layout.tsx` 的默认导出，组合会话 Provider、布局和全部后台业务；用户页直接复用公共 `UserList`，队列路由静态组合。
- 登录、后台路由与后台内部切页复用同一静态依赖闭包，导航新增 JS 请求为零；登录回跳、权限与旧队列深链沿用现有行为。运行时渲染异常由 `main.tsx` 的 Sentry ErrorBoundary 提供兜底。
- `lib/request.ts` 维护请求错误订阅，`observability.ts` 直接订阅。认证及业务统一通过 Apollo 请求后台 GraphQL。
- `vite.config.js` 使用 Vite 8.3.4 默认自动分包，保留 admin 与 public 两个独立入口；后台模块静态导入。`build.chunkSizeWarningLimit: 1000` 为 minify 后、gzip 前的单文件告警阈值。
- JS 请求按入口静态依赖闭包去重计数，CSS/字体另计。登录和后台各最多 2 个 JS、闭包总量 1,000,000 字节；全部构建 JS 最多 3 个，每个 minify JS 最多 1,000,000 字节。
- Zod 等跨入口共享依赖由自动分包处理；公开页闭包保持后台框架、GraphQL、监控与应用模块隔离，最多 2 个 JS、总量 120,000 字节。静态 chunk 图保持无环，manifest 资源引用全部可解析。
- `tests/node/vite.config.test.mjs` 使用 `write: false` 真实构建，覆盖源码与安装包导出模式、静态后台闭包、零异步入口、体积及资源完整性。`tests/chunk-loading.spec.ts` 通过 `TEST_PRODUCTION_CHUNKS=1` 验证生产产物登录跳转、匿名回跳、后台切页零新增 JS；预览服务器设置 `preview.proxy: {}`。
- 变更后先构建前端，再验证 Go 内嵌资源与生产产物浏览器行为。独立 registry 安装、真实后端与线上传输压缩分别验收。

## 源码目录与职责

- `frontend/src` 根目录保留 `main.tsx`、`public.ts` 和 `vite-env.d.ts`；两条入口路径同时关联 HTML、Vite 与 Go manifest，移动入口需跨层同步。
- `app/` 维护应用装配：`app.tsx` 组合顶层路由和后台同步入口，`dashboard-layout.tsx` 默认导出组合会话 Provider 与布局，`navigation.ts` 定义菜单，`dashboard-layout.tsx` 维护后台壳层、访问控制、业务路由及旧队列地址重定向，`dashboard-adapter.ts` 接入公共 Dashboard 契约。
- `features/` 按业务归类页面和专属逻辑：`auth/` 包含登录/安装及会话，`overview/` 包含系统概览，`shops/` 包含店铺页面及输入校验，`queues/` 组合队列子路由；用户页由布局直接复用公共组件；页面命名采用 `*-page.tsx`，Provider 采用 `*-provider.tsx`。
- `lib/` 放统一请求、监控等基础能力，依赖保持在基础层；`graphql/admin/` 保留端点隔离的操作文档及生成类型，生成物只通过 Codegen 更新。
- `styles/global.css` 由两条入口共享，Tailwind 的 `@source` 路径相对样式文件解析；目录移动同步公共 Dashboard 与 Go 模板扫描路径。
- 前端测试继续集中在 `frontend/tests`，按 `unit/node/types` 分类；源码移动同步测试导入，应用 HMR 验收修改 `frontend/src/app/dashboard-layout.tsx` 并检查窗口标记保持。

## GraphQL 操作类型生成

- Admin 的操作与共享片段集中在应用 `frontend/src/graphql/admin/operations.ts`；`generated.ts` 由 Codegen 生成并随源码提交。
- `frontend/codegen.mjs` 直接读取 `share/schema/common.graphqls`、`share/schema/admin.graphqls`、`share/schema/queue.graphqls`，与 `backend/gqlgen-admin.yml` 对齐。Member 增加调用时使用独立文档、配置和产物，保持端点隔离。
- 使用 `typescript-operations` v6 生成操作结果、变量及所需输入类型；调用 `graphql<TResult, TVariables>` 时显式关联类型。运行时使用 Apollo Client，保留 Cookie、取消和 ApiError 边界。
- 含片段的操作先声明独立静态模板，再在导出常量中拼接片段；运行时文档与生成类型的完整性由测试同时校验。
- DateTime 输入/输出为 `string`，JSON 为 `unknown`；未知 scalar 触发失败。响应字段保留 SDL 空值语义，输入保留可选语义；公共 DashboardAdapter 类型独立维护。
- `rtk pnpm codegen` 更新产物；`rtk pnpm codegen:check` 在内存重新生成并逐字比较，检查过程只读，支持未提交变更和无 Git 的独立应用。
- 前端 `build`、`typecheck` 先执行同步检查；主仓 `rtk pnpm multi-database-demo:generate` 在 Go 与 SQL 生成后更新前端类型。独立应用可直接使用自己的 `rtk pnpm codegen`；全生成链路随应用 scripts 源码交付。
- 前端 `test` 同时验证 Vite、生成/只读检查、运行时操作完整性及请求行为；类型契约用 `tests/types/graphql/admin/type-contract.test.ts` 的编译错误断言校验；用户对象与 ID 字段的空值契约分别断言，ID 通过 `NonNullable` 用户直接访问，避免可选链引入的 `undefined` 掩盖字段类型漂移。
- Docker 前端构建阶段复制根依赖元数据、应用根 `patches/`、`frontend/` 和含 SDL 的 `share/`；pnpm 安装会读取全局补丁，仅执行 Web 构建，小程序源码和构建不参与该阶段。生成与检查只依赖源码和 npm 工具链。

## GraphQL 查询请求合并

- `lib/request.ts` 使用 Apollo Client v4；`BatchHttpLink` 在 1 ms 窗口合并普通 query，最多 10 条，`batchKey` 按实际 AST 打印与变量的 UTF-8 字节数保留 1 MiB 正文分组限制，与 Go 兼容传输层对齐。Apollo 负责队列、分发与退订；fetch 兼容桥将单条数组转为对象，多条保持操作数组。
- `gql` 与操作 AST 识别 query/mutation，支持前置注释和片段；mutation 与 `identity=true` 的身份查询走独立 `HttpLink`。读写依赖通过业务调用方 `await mutation` 保证；普通 query 使用 Apollo 窗口调度。现有 `graphql<TResult, TVariables>(query, variables, signal?, identity?)` 与 Codegen 契约保留。
- 所有操作使用 `no-cache`，关闭 query 去重，使刷新始终读取服务端数据，并保留相同查询的独立生命周期。变量在调用时序列化快照；发送前取消退订移除操作，在途取消只影响该逻辑查询，整批退订中止共享 HTTP；全局退出取消排队与在途操作。
- 批内 GraphQL 错误、缺失数据和非法成员按操作处理；批响应形状或数量异常整批失败。Apollo 错误统一映射为 ApiError，认证错误优先；共享 HTTP 错误的认证事件按物理请求通知一次，请求从 pending 移除后再通知，保留全局取消触发前的原始错误；监控按逻辑操作通知。
- 沿用同源 Cookie、`cache: no-store` 与身份权限错误局部处理。服务端顺序执行各操作，数据库访问沿用各 resolver/service 行为。
- Node 回归 `tests/node/request-batch.test.mjs` 加载真实 Apollo 运行时，覆盖分批、文档识别、刷新、相同查询独立取消、响应、认证和监控；浏览器 `tests/graphql-batch.spec.ts` 从 Vite 加载真实模块，用浏览器 fetch 与隔离 mock 验证数组传输和取消隔离。

## 前端工具与监控契约

- Web 的 Tailwind 与 @tailwindcss/vite 固定 4.3.3，小程序 Tailwind 使用同一版本；Prettier 全工作区统一 3.9.10。
- ESLint 10.13.0 配合 typescript-eslint 8.71.2，使用 flat config、typescript-eslint recommended、Hooks 的 rules-of-hooks/exhaustive-deps 和 jsx-a11y recommended，零 warning 门禁。Input/Button/SelectTrigger 等组件映射到原生元素；角色选择使用自身 aria-label 与普通容器。no-explicit-any 保留现有显式泛型/动态边界，类型正确性由严格 TypeScript 与 Codegen 负责。
- 两级 workspace 的 peerDependencyRules.allowedVersions 仅为固定 eslint-plugin-jsx-a11y 6.10.2 允许 ESLint 10；升级插件时重新核对。`tests/node/eslint.test.mjs` 在独立进程中加载应用与公共 Dashboard 的真实配置，验证合法 JSX 通过、图片说明／标签关联及条件 Hook 违规仍被拦截；独立应用缺少公共源码时只验应用配置。
- `typecheck` 先执行 lint；测试统一位于 frontend/tests。Vitest 仅收集 tests/unit 下的 `*.test.ts/tsx`，tests/types 中的编译契约由 tsc 校验；TypeScript 与 ESLint 同时覆盖 src、unit、types 和 tests/setup.ts。DOM 测试按文件启用 jsdom，setup 加载 jest-dom 并在每例结束 cleanup；Node 回归由 `node --test tests/node/*.test.mjs` 单独执行，Playwright 仅匹配 `tests/**/*.spec.ts`；独立 HMR 验收脚本位于 tests/verify-hmr.mjs，由共享验收工具调用。
- 店铺创建输入在提交请求前通过 Zod 校验，归整空白并按 Unicode 字符验证 1–255 长度；沿用服务器权威校验及操作生成类型。
- SPA 监控默认关闭，`VITE_SENTRY_*` 为构建时公开配置；事件使用白名单脱敏，关闭 PII/面包屑/Replay/追踪/会话。请求错误订阅者的异常保持隔离，取消与可预期 ApiError 静默，内部错误与非法响应可采集。React ErrorBoundary 提供中文降级页面，未捕获/可恢复错误由根入口接入。

## 依赖安装与类型解析诊断

- pnpm minimumReleaseAge 固定 10080 分钟（7 天）；仅自维护 @shanjing/shadcnui-dashboard 按包名豁免。主仓与独立应用同步配置，发布／升级保留包级豁免，第三方包不得沿用临时版本豁免。
- 主仓开发在工作区根执行 `rtk proxy env CI=true pnpm install --frozen-lockfile`，独立应用在自己的根目录安装；离线安装须已有缓存，可追加 `--offline`。
- 第三方 React 组件声明出现 TS2607、TS2786、TS2769 时，先以 TypeScript `--traceResolution` 核对声明文件中的 react 解析路径，并检查 pnpm 安装目录与 hoisted @types/react 的实际文件。2026-10-12 的 Sentry.ErrorBoundary 异常由原锁文件完整安装恢复；业务源码、依赖版本与锁文件保持原值。
- 修复后分别验证主仓前端类型检查、独立应用原锁文件全新安装和真实监控回归；共享脚本验收继续运行主仓 test/check/test:go:coverage/build。缓存复用、独立候选快照、正式固定提交发布验收分别记录。

## 前端环境文件

`frontend/.env.example` 保存 `SPA_PORT` 与公开 `VITE_*`；Vite 使用自身目录作为 envDir，按 mode 加载 `.env*`，进程变量优先。配置求值通过 `loadEnv` 读取 `SPA_PORT`、`WEB_ORIGIN`；这两个开发服务变量保持配置侧使用。根开发启动器通过应用安装的 Vite `loadEnv` 同步读取 development 端口，前端环境文件支持行尾注释、`export`、多行值与变量展开，由后端 `WEB_ADDR` 派生代理地址并覆盖前端文件中的 `WEB_ORIGIN`。单独启动前端时提供代理地址，缺省为 `http://127.0.0.1:8080`。前端子进程仅继承筛选后的工具环境、公开配置和代理信息。公开变量的文件加载交给 Vite，mode 配置保持原生优先级。

## Bus 页面局部交互

- 匿名访问时广播和设备连接按钮可点击，点击打开匹配主题的原生 `<dialog>` 登录引导弹窗，同时更新对应状态栏；弹窗提供“取消”和“去登录”，登录地址携带 `returnTo=/test/bus`，支持 Esc 关闭、焦点限制及关闭后恢复触发按钮焦点，不使用 `alert`，不创建 WebSocket；发布输入、发布按钮、设备回执模式和查询表单保持禁用，服务端继续鉴权。
- `features/bus/{bus-page,protocol,query-stream}.ts` 维护 `/test/bus` 的原生 DOM 增强、载荷校验及 POST SSE 增量读取；应用仍保持 Go SSR 公开页与 `/admin/*` React SPA 的入口边界。
- SSE 支持 UTF-8 跨块、CR/LF/CRLF、多行 data 与注释心跳，事件大小上限 64 KiB；每次查询独立校验 requestId/responseKey、序号与总数，重复结果去重，终止需要匹配 done。提前 EOF、非法载荷、HTTP 错误和客户端等待超时落到当前记录，终止路径取消读取器并释放锁。
- 浏览器设备等待 `bus.query.ready` 后展示就绪，成功模式返回 1–3 条回执，每条等待 200–700 毫秒以匹配后端 5 秒窗口；另有错误、超时模式。模拟器与页面查询并发上限各 8，广播/设备日志各 30 条，查询历史 20 条；断开和 pagehide 清理计时器、WebSocket 与请求，单笔取消保持其他查询独立。
- Zod 文本校验显式使用 JavaScript `string.length` 对齐后端 UTF-16 码元；服务器和用户内容使用 textContent，Tab 支持方向键/Home/End。无 JavaScript 时两条链路说明均可读。
- `tests/unit/bus-page.test.ts` 通过 Vite raw 导入真实 Go 模板；`bus-query-stream.test.ts` 覆盖流与协议边界。`tests/bus.spec.ts` 覆盖匿名 SSR、真实广播、并发回执、错误、取消、超时与登录回跳；跨实例验收使用 `BUS_PEER_ORIGIN`。
- Bus 视觉以 Astro starter 的 `/test/bus` 为参考：下划线 Tab、单行广播输入、左右两列卡片、卡片内设备／查询记录，以及三步广播／四步查询的 Topic 说明；移动端单列。Inter Variable 字体以 Bus 专属字体别名加载，颜色／圆角复用现有主题，其他公开页和管理后台保持既有字体。清空按钮与独立空状态随记录更新；设备清空只移除显示记录，查询清空同时取消本页查询。
- 浏览器视觉回归覆盖桌面／移动端与明暗主题；提供 `BUS_REFERENCE_URL` 时，对照 Astro 原页面正文与主题 CSS 的静态渲染，检查关键节点的尺寸、颜色、边框、圆角、内边距和字体属性。该验收范围为参考源码静态渲染，完整 Astro 应用运行验收另行记录。

## React 类型依赖隔离

Web 使用 React 19，小程序使用 React 18。两级 pnpm workspace 为固定 `@sentry/react@11.8.0` 补齐可选 `@types/react` peer，按消费端声明选择类型；两份锁文件记录 Web 的 React 19 类型上下文。回归见主仓 `scripts/test-project.py` 与 Web `tests/unit/observability.test.ts` 的 ErrorBoundary 类型检查和运行时测试。

## Dashboard 源码模式与依赖安装

- 主仓开发以 `DASHBOARD_SOURCE=1` 直接解析 `packages/shadcnui-dashboard/src` 的 JS 与 CSS；Vite 前置转换将全局样式中公共包的源码扫描路径切换到同一目录，覆盖已安装发布包的场景。
- 独立应用使用包导出与 `dist` 样式扫描；源码别名及样式转换仅在源码模式启用。
- 主仓与独立应用的 `verifyDepsBeforeRun` 固定为 `warn`，脚本执行提示依赖状态。主仓安装在仓库根执行；独立应用安装在导出应用根执行。嵌套 workspace 的脚本检查保持现有依赖链接。
- 回归由 `frontend/tests/node/vite.config.test.mjs` 与 `pnpm-workspace.test.mjs` 验证源码／发布包模式、CSS 扫描以及依赖过期时脚本执行的只读边界。

## 后台认证 GraphQL

- 安装状态、初始化、登录与退出分别使用 `getInstallStatus`、`initializeAdmin`、`signInWithEmail`、`signOut`；操作集中在 `graphql/admin/operations.ts`，结果和变量使用生成类型。初始化成功后显式登录，服务端通过签名 HttpOnly Cookie 建立会话。
- 认证操作使用 `identity=true` 的独立 HTTP 请求；业务请求继续沿用批量查询、错误事件、取消与权限语义。后台源码中的认证和业务调用统一经过 `/api/graphql/admin`；公开 Bus/Queue 演示页的 REST/SSE/WebSocket 保持各自传输边界。
- 数量与体积预算集中在 Node 构建测试；浏览器根据 manifest 静态依赖闭包核对实际请求、增量与复用。匿名直接访问后台深链会先加载完整后台闭包进行会话检查，再跳转登录；直接访问登录页加载相同的后台静态闭包。

依赖安全维护：Codegen CLI 与小程序统一为 7.4.6，Vitest 使用 5.0.5；传递依赖补丁由两级 workspace 配置统一维护，原始审计结果与补丁缓解状态分别报告。

Vitest 5.0.5 沿用默认 clearMocks，模块 mock 放在顶层，异步断言必须 await。Web 的 @vitejs/plugin-react 固定 6.1.2，react() 使用 Vite 8 内置 Oxc 转换 JSX 与 React Refresh；当前不配置 Babel 或 React Compiler。工具升级需验证源码／包导出构建、分包预算与开发热更新；Taro 小程序单独维护兼容范围。

Node 工具链固定 v26.12.0；Web、公共 Dashboard 与小程序显式声明开发依赖 @types/node 26.6.5，两级锁文件随类型依赖同步。Node 升级需验证 Web／小程序构建、Codegen、Node 回归与组件测试。

Web 的 React／React DOM 固定 19.3.1、React Router 固定 8.4.0，对应 React 类型固定 19.3.0；Sentry 固定 11.8.0，workspace 可选 React 类型 peer 扩展跟随固定版本。typescript-operations 固定 6.1.10，与小程序一致。升级后核对 Codegen、严格类型检查、构建和测试，新增第三方锁定版本仍须满足 7 天策略；小程序保留 React 18／Babel 7／Vite 7 基线。

## TypeScript 类型检查与编译器 API

Web、公共 Dashboard 和小程序的纯类型检查固定使用 TypeScript 7.0.2，通过开发依赖 `typescript7: npm:typescript@7.0.2` 独立安装。检查命令显式调用 `node node_modules/typescript7/bin/tsc --noEmit`，避免与旧版 TypeScript 的 `tsc` 可执行文件冲突；Web 生产构建的前置类型检查使用同一入口。

Web／公共 Dashboard 的 `typescript` 保持 `npm:@typescript/typescript6@6.0.2`，小程序保持 5.9.3，供 typescript-eslint、Node 测试加载器及 Taro／TDesign 编译器 API 使用。TypeScript 7 不提供旧版 transpileModule／createSourceFile API，不将其作为这些工具的 typescript peer。公共 Dashboard 的 JS 和声明生成继续由 build.mjs 显式调用 tsc6，类型检查入口与产物生成入口分别维护。

变更同步两级锁文件，仍遵守 7 天发布时间策略；验收主仓与独立应用的类型检查、旧 API 回归和真实小程序生产构建。历史采集记录中的 tsc／tsc6 命令保留原始执行事实。
