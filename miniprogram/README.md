# 微信小程序开发模块

Taro 4.2.1 + React 18 + Vite + Tailwind CSS 4.2.2 + weapp-tailwindcss，独立于 Web SPA 构建。仅保留 `batch-test` 页面，通过 Member GraphQL 查询店铺，支持单次请求与五条并发请求，显示总耗时和每项耗时、结果、错误。同页提供邮箱密码登录与退出，微信 `wx.login` 接入延期；认证、用户模型与数据库沿用现有应用。

## 配置与启动

在主仓根或独立应用根完成 `pnpm install --frozen-lockfile`，复制本包 `.env.example` 为 `.env`：

```dotenv
TARO_APP_GRAPHQL_ENDPOINT=http://127.0.0.1:8080/api/graphql/member
# TARO_APP_ID=自己的小程序 AppID
# TARO_APP_WINDOWS_DIST=/mnt/c/weapp/multi-database-demo/dist
```

地址在构建时注入；修改 `.env` 后重启构建。空地址可启动页面，查询时显示配置指引。地址需要完整 HTTP(S) Member 端点。`.env` 和 `project.private.config.json` 属于本地配置；AppSecret 始终属于服务端配置。工程内 `touristappid` 是游客占位，真实预览使用自己的 AppID。

在主仓根或独立应用根执行：

```sh
rtk pnpm dev  # Vite HMR + Go Web + Go Worker 开发服务
rtk pnpm dev:weapp            # 在另一个终端启动小程序 watch
rtk pnpm build:weapp          # 类型检查及生产小程序构建
rtk pnpm check:weapp          # ESLint + Codegen 只读检查 + TypeScript
rtk pnpm test:weapp           # Node 请求、页面、Codegen、真实 rsync 回归
rtk pnpm codegen              # 更新 Admin 与 Member 操作类型
rtk pnpm codegen:check        # 只读检查两套操作类型
```

WSL 构建源位于本包 `dist/`。直接开发时，微信开发者工具导入本包工程；Windows 同步时，导入 Windows 专用 `dist/`（对应 `C:\weapp\multi-database-demo\dist`），其 `project.config.json` 的 `miniprogramRoot` 为 `./`。

## WSL → Windows 同步

设置 `TARO_APP_WINDOWS_DIST` 后，每次完整／watch 增量构建执行 rsync。Windows 目标需要 `/mnt/盘符/项目目录/dist` 形式的绝对专用目录，支持空格路径，源工程与目标保持隔离。WSL 安装 `rsync` 后启用同步。

同步采用校验和镜像，删除目标中已移除的构建文件，保留 Windows 的 `project.private.config.json`。首次目标应为空，也可仅含私有配置；`.weapp-sync-owner.json` 记录源产物归属，支持失败重试并阻止其他工程占用。归属标记与目标真实路径均受校验。构建侧私有配置保持在本地；发布导出会过滤真实环境配置、私有配置、归属标记、构建产物及 `.swc` 编译缓存。

同步失败会中断本次构建并给出目录权限／rsync 指引。完成构建后，核对 Windows 中 `app.json`、`project.config.json` 和页面文件，再在微信开发者工具编译。开发与生产均只有 `pages/dev/batch-test/index` 路由，该页面同时作为启动页。

## 端点与微信环境

默认使用 Go 服务的 8080 端口。Windows 开发者工具需要能访问该地址；WSL 网络模式及防火墙影响访问路径。真机的 `127.0.0.1` 指向手机自身，真机联调使用可达的局域网地址或 HTTPS 测试域名。

工程保持合法域名校验开启。本地 HTTP 调试按开发者工具的本地调试设置配置，真实预览／生产使用已配置合法请求域名的 HTTPS 服务。该包使用现有邮箱密码认证接口与 Member 店铺查询；微信 `wx.login` 接入留待后续实现。

## 邮箱密码登录

批量测试页提供邮箱、密码、登录状态及退出按钮。使用当前 demo 已有的邮箱账号登录，成功后输入店铺 ID 或 slug，再发送单次或五条并发请求。

- 登录与退出统一调用 Member GraphQL 的 `signInWithEmail`／`signOut` mutation；无 Cookie 的原生客户端从登录响应获取 Bearer token。
- `src/auth/session.ts` 仅保存服务端返回的有效 token，键名为 `go-starter:member-auth:<后端 origin>`，按协议／主机／端口隔离环境。密码仅存在表单内存中，登录成功后清空。
- `taro-fetch.ts` 仅向配置的 Member 端点注入 `Authorization: Bearer <token>`。五条并发查询仍合并为一次 HTTP 请求；HTTP HTTP 401 或 GraphQL UNAUTHORIZED 清除对应 token、恢复登录表单并提示重新登录，HTTP 403 保留会话。旧请求的 401 仅清理自身会话。
- 登录、退出与店铺请求共用互斥保护，支持错误后重试及页面卸载保护；本地缺少 token 时提示先登录。退出成功或服务端返回 401 后清理本地 token；网络或服务端错误保留 token 供重试。
- 本地 token 表示已保存会话，服务端在每次业务请求时验证会话有效性。更新端点后重新构建；微信开发者工具中的登录状态与 Web 浏览器会话分别保存。

## Tailwind CSS v4

主题与扫描配置集中在 `src/app.css`：`@theme` 定义 primary 配色，`source(none)` 配合 `@source "./"` 将类名扫描限定到源码目录。Taro 构建只注册 `WeappTailwindcss`，显式声明 CSS 入口和小程序工程根，通过 `cssOptions.rem2rpx` 转换单位；基础 reset 沿用插件的小程序默认输出。旧 `tailwind.config.js` 配置已移除。

登录／退出按钮与两个请求按钮使用共享 `weapp-action-button` class，背景使用独立 `action` 蓝色主题（`#2563eb`）与 `bg-action`，保持白色文字；成功结果文字沿用 `primary` 绿色。统一高度 `96rpx`（375px 宽屏幕上约 48px），宽度铺满卡片内容区，使用 flex 水平／垂直居中文字。通过 `.weapp-action-button::after` 清除微信原生按钮边框。Taro 将 `button::after` 标签选择器转换为 `.h5-button::after`，原生按钮携带页面 class，重置规则使用显式 class 保持匹配。Node 回归串联真实 v4 生成器与 Taro 标签转换，校验页面三个按钮均命中规则，并保留高度和居中样式。

升级样式依赖时，复验主题工具类、扫描隔离、rpx 转换、生产路由和 CSS／TSX watch 增量同步。 watch 增量构建可能暂留旧 CSS 规则，页面使用当前类名，主题修改按最终级联值验收；生产重建按当前源码清理旧规则及未使用工具类，Windows 同步始终镜像实际构建产物。

## 微信模块启动与白屏排查

构建通过 `createWeappModuleScope` 为每个 CommonJS chunk 增加独立函数作用域。微信开发者工具的模块包装会注入 `print`、`URL`、`Node` 等参数；此隔离用于保护 GraphQL／Apollo 等依赖的同名顶层声明，保持开发、生产及 watch 启动一致。

Taro 4.2.1 在开发构建中通过组件 re-export 入口收集模板时，会遗漏按钮和输入框。`config/plugins/weapp-components.cjs` 通过 Taro 插件的 `ctx.modifyComponentConfig` 显式保留对应模板；CLI 使用插件 hook 分发，根配置中的同名回调会被覆盖。实际视图需同时确认登录区域、输入框和两个请求按钮可见，console 中出现 `Template ... not found` 时核对 `base.wxml` 的组件模板。

修改 `config/` 后重启 `rtk pnpm dev:weapp`，等待构建及 Windows 同步完成，再在开发者工具点击“编译”。启动白屏时采集运行时首个错误与当前路由，重点核对 `Identifier 'print' has already been declared`、`app.js` 加载失败和页面注册状态。

## 类型与测试边界

Member SDL 边界为应用 `share/schema/common.graphqls` + `share/schema/member.graphqls`，操作源为 `src/graphql/member/operations.ts`，产物为相邻 `generated.ts`。DateTime 为 string，可空响应及可选筛选按 SDL 保留。修改 SDL 或操作后运行 Codegen，产物与源码一起交付；检查在内存中生成并比较文件，保持只读且独立于 Git。

Apollo 批量传输每批最多十条，使用 Taro.request 适配，超时十五秒。店铺查询使用 no-cache，独立保序；批量测试每项展示各自错误。页面含加载、错误、空态、重复点击和卸载保护。

`tests/node` 覆盖邮箱密码登录／退出、会话存储隔离与过期、真实 Apollo 链配合模拟 Taro 网络与 React hooks、只读 Codegen 和真实 rsync、v4 样式生成与扫描隔离、真实 Vite 产物的微信模块包装加载；`tests/types` 覆盖生成类型契约。Taro 构建、Windows 挂载盘同步和 watch 增量验收独立执行。微信开发者工具显示效果、真实后端数据库请求和真机网络仍需对应环境专项验收。

当前固定栈的 Taro/Vite peer 声明仍有版本提示；完整构建和实际 watch 增量同步作为专项门禁。依赖升级时同时复验 CSS 转换、路由裁剪、平台网络和增量构建。
