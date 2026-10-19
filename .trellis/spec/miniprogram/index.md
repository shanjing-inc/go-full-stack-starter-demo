# 小程序开发规范

范围：本应用 `miniprogram/`，独立 Taro 4.2.1 / React 18 工程，参考社区电商小程序开发方式。使用固定依赖与独立构建；Web SPA、Go 内嵌资源与 Docker 构建沿现有路径。微信 `wx.login` 接入延期，邮箱密码登录复用现有认证、用户及数据库契约。

## 接口与类型

- SDL 仅 `share/schema/common.graphqls` + `share/schema/member.graphqls`；操作集中于 `miniprogram/src/graphql/member/operations.ts`，生成相邻 `generated.ts`。
- 使用严格 scalar 映射：DateTime 为 string，nullable 字段及可选输入保持 SDL。Codegen 校验／格式化完成后写产物，check 全程只读且 Git-independent。
- 端点构建注入，完整 HTTP(S) 地址且限定 `/api/graphql/member`，空配置允许页面启动并在查询时提示。私密凭据保存在服务端。
- Apollo BatchHttpLink + Taro.request；每批十项，十五秒超时，no-cache 独立查询，单次操作或五条并发操作展示总耗时和逐项耗时／结果／错误，null 店铺为合法结果。消费 Taro.request 返回的 Promise，避免平台失败和取消产生额外未处理拒绝；取消应清理监听并 abort 平台请求。
- 页面提供加载、空态、错误、重试、重复点击及卸载保护。开发与生产 app.json 均仅注册 `pages/dev/batch-test/index`，该批量测试页为唯一启动页；页面源码仅保留此目录。

## 登录与会话

- 批量测试页保留同页邮箱密码登录／退出区域；调用 Member GraphQL `signInWithEmail(input: MemberSignInInput!) { token }` 与 `signOut`。认证操作与类型统一放入 Member operations／generated；原生请求使用 POST、无 Cookie，Bearer token 沿用现有存储与会话模型。
- `src/auth/session.ts` 统一输入／响应校验、15 秒超时及脱敏网络错误。token 存储键为 `go-starter:member-auth:<后端 origin>`，按协议／主机／端口隔离，读取异常或无效值视为空会话；密码只在表单内存中，登录成功后清空。
- fetch 只向已配置的 Member 端点携带 Bearer token。HTTP 401 或 GraphQL `errors[].extensions.code=UNAUTHORIZED`（单条／batch）清除发出该请求的对应 token 并提示重新登录；403 保留会话；旧响应保留后续登录的新 token。保持 10ms 合并窗口和每批十项，页面单次／五条并发模式与逐项诊断保持原样。
- 本地缺少 token 时页面提示先登录；已保存 token 在业务请求时由服务端验证。登录、退出、店铺查询共享互斥锁并禁用控件，保留重复点击、错误重试及卸载后的状态更新保护。
- 退出成功或 401 清理本地 token，网络／服务错误保留会话供重试。回归覆盖同源 URL／Bearer、token 校验及存储隔离、真实 Apollo 批量鉴权与 401／403、UI 登录／查询／退出及卸载；真实账号／微信开发者工具另作专项验收。

## 微信模块作用域

- 微信开发者工具为 CommonJS 模块注入 `print`、`URL`、`Node` 等参数；第三方依赖的顶层同名 `const`／`class` 会触发声明冲突，造成 `app.js` 加载失败及页面白屏。
- 构建统一注册 `createWeappModuleScope`，使用 Rollup `banner`／`footer` 将整个 CommonJS chunk 放入独立函数作用域；开发未压缩、生产压缩和 watch 共用此规则，保留 `require`、`exports` 及 sourcemap。
- 回归使用真实 Vite 产物，在含微信注入参数的模块包装中加载，校验语法、执行结果、导出及 sourcemap。普通 Node require 和模拟 React hooks 的通过信号之外，专项验收需在真实开发者工具确认页面挂载。
- Taro 4.2.1 开发构建通过组件 re-export 入口自动收集模板时，会遗漏 `button`／`input`。通过 `config/plugins/weapp-components.cjs` 的 `ctx.modifyComponentConfig` 插件 hook 显式纳入这两个原生组件；CLI 会覆盖根配置同名回调。回归读取真实配置及页面组件导入，校验插件注册并重复调用真实 Taro 模板生成器；完整构建／watch 验证 `base.wxml` 含按钮和输入框模板，开发者工具验证控件可见及事件可用。
- 修改 `config/` 后重启 `dev:weapp`，加载新的构建配置，再在微信开发者工具重新编译。活跃 watch 与专项构建使用独立产物目录。

Web 与小程序的 React 类型依赖隔离见 [Web 前端规范](../frontend/index.md#react-类型依赖隔离)；两级 workspace 与锁文件保持一致。

## 样式

- Tailwind CSS 固定 4.2.2，与 Web frontend 对齐；主题配置集中在 `src/app.css` 的 `@theme`，通过 `source(none)` + `@source "./"` 将扫描限定到源码。
- Taro Vite 仅使用 `WeappTailwindcss` 生成链路；显式配置 `tailwindcssBasedir`、绝对 `cssEntries` 和 `cssOptions.rem2rpx`。基础 reset 沿用小程序插件默认输出，保持现有页面行为。
- 登录／退出按钮与两个请求按钮共享 `weapp-action-button` class，背景使用独立 `action` 蓝色主题（`#2563eb`）与 `bg-action`，保持白色文字；成功结果文字沿用 `primary` 绿色。统一高度 `96rpx`、宽度 `100%`、零内边距与 `border-box`，使用 flex 水平／垂直居中文字。使用 `.weapp-action-button::after` 重置微信原生边框。Taro 会把标签选择器 `button::after` 转换为 `.h5-button::after`；原生按钮仅携带页面 class，因此此类重置采用显式 class。回归串联真实 v4 生成器、Taro 默认 PostCSS 标签转换与页面渲染 class，验证三个按钮均命中规则并保留高度及居中样式；开发和生产完整产物单独验收。
- 旧 `tailwind.config.js` 已移除。样式变更验证配色、工具类、扫描隔离、单位转换和实际完整／watch 产物。 watch 验证当前页面类名、新增样式及主题最终级联值同步；开发缓存可能暂留旧 CSS 规则，生产重建专项验证旧规则及未使用工具类清理。

## 同步与发布

- 可选 `TARO_APP_WINDOWS_DIST` 必须 Windows 挂载盘下绝对专用 dist，真实路径与源工程隔离。
- rsync 参数数组 + 校验和 + delete；保留 Windows 私有配置与归属标记。空／仅私有配置目标可初始化，其他非空目标校验归属；归属标记提前落盘支持部分同步失败后的重试。同步失败传播构建错误。
- 实际完整／watch 构建要验证所有产物均写入目标（包括 project.config.json）、内容修改、源文件删除、私有配置保留及错误传播。
- 应用 workspace 含 frontend 与 miniprogram；根／应用脚本纳入两端 Codegen 与测试检查。独立锁文件保持固定扩展依赖及无越界本地链接。
- 发布含小程序源码与本规范，过滤 `.env`、私有配置、归属标记、dist 与 `.swc` 编译缓存。小程序产物独立经微信开发者工具发布。

## 质量门禁

测试使用 `miniprogram/tests/node`（真实 Apollo、模拟 Taro 网络／React hooks、真实 rsync）及 `tests/types`。运行 `pnpm check:weapp`、`pnpm test:weapp`、`pnpm build:weapp`、`pnpm codegen:check`；变更根测试入口执行根 `pnpm test`、`pnpm check`、`pnpm test:go:coverage`。分别报告构建、WSL 挂载盘同步、微信开发者工具、真实后端和真机验收范围。

开发说明与配置示例见 `miniprogram/README.md`。新增命令、接口或同步规则同步此规范及回归。
