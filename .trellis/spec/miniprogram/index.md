# 小程序开发规范

范围：本应用 `miniprogram/`，独立 Taro 4.3.0 / React 18 工程，参考社区电商小程序开发方式。全部直接 `@tarojs/*` 依赖与 `babel-preset-taro` 固定同一版本；升级同步两级锁文件及 CLI／binding 生命周期脚本禁用规则，并重启 watch。使用固定依赖与独立构建；Web SPA、Go 内嵌资源与 Docker 构建沿现有路径。微信 `wx.login` 接入延期，邮箱密码登录复用现有认证、用户及数据库契约。

## 接口与类型

- SDL 仅 `share/schema/common.graphqls` + `share/schema/member.graphqls`；操作集中于 `miniprogram/src/graphql/member/operations.ts`，生成相邻 `generated.ts`。
- 类型生成使用固定 `@graphql-codegen/cli 7.4.6` 与 `@graphql-codegen/typescript-operations 6.1.10`。使用严格 scalar 映射：DateTime 为 string，nullable 字段及可选输入保持 SDL。Codegen 校验／格式化完成后写产物，check 全程只读且 Git-independent；升级后检查实际生成内容与类型契约。
- 端点构建注入，完整 HTTP(S) 地址且限定 `/api/graphql/member`，空配置允许页面启动并在查询时提示。私密凭据保存在服务端。
- Apollo Client 固定 `4.3.4`，使用 BatchHttpLink + Taro.request；每批十项，十五秒超时，no-cache 独立查询，单次操作或五条并发操作展示总耗时和逐项耗时／结果／错误，null 店铺为合法结果。消费 Taro.request 返回的 Promise，避免平台失败和取消产生额外未处理拒绝；取消应清理监听并 abort 平台请求。
- 页面提供加载、空态、错误、重试、重复点击及卸载保护。`pages/index/index` 为启动页，首页依次提供“设计规范、组件示例、批量请求测试”三个入口。`pages/dev/design-system/index` 仅展示规范；`pages/dev/components/index` 按 basic/navigation/form/content/overlay 分类进入基础、导航、表单、内容、弹层示例；`pages/dev/batch-test/index` 保留请求诊断。九个页面都在 app.config 注册并使用 ThemePage 跟随系统主题。入口使用原生 Navigator navigate 保留返回栈，子页使用微信原生导航栏返回上一页，不重复提供返回链接。首页、规范和全部组件示例无需登录或后端。

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
- Taro 4.2.1 开发构建通过组件 re-export 入口自动收集模板时，会遗漏 `button`／`input` 等原生模板。通过 `config/plugins/weapp-components.cjs` 的 `ctx.modifyComponentConfig` 插件 hook 显式纳入 `button`、`input`、`label` 和 `navigator`；CLI 会覆盖根配置同名回调。回归读取真实配置及页面组件导入，校验插件注册并重复调用真实 Taro 模板生成器；完整构建／watch 验证 `base.wxml` 含按钮和输入框模板，开发者工具验证控件可见及事件可用。
- 修改 `config/` 或在 `app.config.ts` 新增路由后重启 `dev:weapp`，加载新的构建配置，再在微信开发者工具重新编译。活跃 watch 与专项构建使用独立产物目录。

Web 与小程序的 React 类型依赖隔离见 [Web 前端规范](../frontend/index.md#react-类型依赖隔离)；两级 workspace 与锁文件保持一致。

## 样式

- `createWeappTerserOptions` 在 Vite config 阶段将 Taro 4.3 默认 Terser `output` 合并到 `format` 后删除旧键，显式 format 优先，保留 ES5／ASCII／注释选项；避免 Vite 7.3 压缩插件同时传入两个别名而失败。真实 Vite/Terser 回归验证 CommonJS 执行、ASCII 与显式覆盖及 sourcemap。
- 小程序 Vite 固定 7.3.7；ESLint 10.13.0 配合 typescript-eslint 8.71.2，Prettier 与全工作区统一为 3.9.10。
- Taro 4.3.0 暂不直接升级 Vite 8：实测 8.3.4 的 Rolldown 不支持原生组件插件读取 `ModuleInfo.ast`，完整生产构建同时出现入口 `loaderMeta` 未初始化错误。独立 Vite 插件回归通过不足以证明整条 Taro 链路兼容，升级须先适配 runner 并通过完整生产／watch 构建。
- Tailwind CSS 固定 4.3.3，与 Web frontend 对齐；主题工具类映射集中在 `src/app.css` 的 `@theme inline`，通过 `source(none)` + `@source "./"` 将扫描限定到源码。
- Taro Vite 仅使用固定 `weapp-tailwindcss 5.6.3` 的 `WeappTailwindcss` 生成链路；显式配置 `tailwindcssBasedir`、绝对 `cssEntries` 和 `cssOptions.rem2rpx`。Node 须满足 `^22.18.0 || >=24.11.0`；升级时同步主仓／应用锁文件并重启 watch，验证真实 Taro 连续增量产物中的工具类、间距变量及根样式引用。基础 reset 沿用小程序插件默认输出，保持现有页面行为。
- 设计规范、组件、亮暗主题和项目覆盖契约统一见 [小程序设计规范](design-system.md)。主题配置集中在 `src/components/theme/project.ts`，通过同一解析结果驱动页面变量及原生导航栏；启用微信 darkmode 与原生主题配置，读取并监听系统主题，页面显示时重新同步。`ThemePage` 为页面根，基础组件以 TDesign 原生控件和项目组合实现，控件默认视觉采用固定版本 TDesign，小程序原生资源与模板兼容集中在构建适配器。
- 旧 `tailwind.config.js` 已移除。样式变更验证配色、工具类、扫描隔离、单位转换和实际完整／watch 产物。 watch 验证当前页面类名、新增样式及主题最终级联值同步；开发缓存可能暂留旧 CSS 规则，生产重建专项验证旧规则及未使用工具类清理。
- 首页提供底部面板调节小/标准/大字号，正文 28/32/36rpx，初次默认标准。字号偏好通过独立本机存储跨页与重启保留，亮暗主题继续跟随系统；大字号的行高与控件适配、异常处理及回归边界见设计规范“用户字号偏好”。
- `createWeappTailwindWatch` 通过 Rollup 的 shouldTransformCachedModule 仅强制重新处理 src/app.css 根样式，避免脚本增量时复用已处理的 Tailwind CSS 缓存。连续重建检查 mt-4、gap-3、--spacing 和新增工具类；不改 Card 间距规则，也不追加第二套样式生成链路。

## 依赖安全

- 两级 workspace 同步精确父版本 overrides、packageExtensions、patchedDependencies 与锁文件；补丁位于应用 `patches` 并随导出交付，详见 [补丁说明](../../../patches/README.md)。不修改安装目录或添加审计忽略项。
- Taro 4.3.0 的模板下载器使用维护中的安全下载／解压实现，Git 使用 execFile 参数数组；XML 压缩替换为异步 html-minifier-terser，全部模板 emit 等待完成。braces 3.0.3 在解析时限制括号／花括号嵌套层数，尚无正式安全版本时如实报告残余审计项。
- `tests/node/dependency-security.test.mjs` 验证真实下载、Git 参数注入、路径穿越、嵌套攻击和四类 XML 输出；升级同时验证独立应用冻结安装、原始审计及真实生产／watch 构建。

## 同步与发布

- 可选 `TARO_APP_WINDOWS_DIST` 必须 Windows 挂载盘下绝对专用 dist，真实路径与源工程隔离。
- rsync 参数数组 + 校验和 + delete，并关闭时间戳保留；内容未变的 app.json、页面 JSON 等不得仅因重建时间变化触发目标文件事件。同步使用 writeBundle 的 post/sequential 钩子，等待其他异步输出处理完成。保留 Windows 私有配置与归属标记。空／仅私有配置目标可初始化，其他非空目标校验归属；归属标记提前落盘支持部分同步失败后的重试。同步失败传播构建错误。
- Taro watch 使用微信开发者工具普通编译，不启用“编译热重载”；project.private.config.json 的 compileHotReLoad 会覆盖共享配置。排查增量后“页面未配置”时，分别核对源／目标路由、私有热重载设置、同步时序和实际模块加载；文件内容正确不代表工具中的运行时配置已刷新。已卡住的模拟器可能需要重新初始化运行环境才能恢复；调试通道导航成功、用户鼠标恢复与后续增量验证分别记录，不把重开恢复当作根因已修复的证据。
- 已获微信开发者工具授权时，代理优先自行调用 `get_simulator_console --project <Windows绝对项目路径> --command "grep -n ."` 获取现场日志，clientName 保持 `codex`；关键词筛选返回空仅表示未命中。先取证再刷新或重启，避免丢失故障期日志。CLI 返回成功不等于窗口或模拟器已真正重建，恢复以运行时和用户鼠标反馈分别确认；同内容同步与关闭热重载后仍有复发记录，见 `miniprogram/docs/watch-reload.md`。
- 实际完整／watch 构建要验证所有产物均写入目标（包括 project.config.json）、内容修改、源文件删除、私有配置保留及错误传播。
- 应用 workspace 含 frontend 与 miniprogram；根／应用脚本纳入两端 Codegen 与测试检查。独立锁文件保持固定扩展依赖及无越界本地链接。
- 发布含小程序源码与本规范，过滤 `.env`、私有配置、归属标记、dist 与 `.swc` 编译缓存。小程序产物独立经微信开发者工具发布。

## 质量门禁

测试使用 `miniprogram/tests/node`（真实 Apollo、模拟 Taro 网络／React hooks、真实 rsync）及 `tests/types`。运行 `pnpm check:weapp`、`pnpm test:weapp`、`pnpm build:weapp`、`pnpm codegen:check`；变更根测试入口执行根 `pnpm test`、`pnpm check`、`pnpm test:go:coverage`。分别报告构建、WSL 挂载盘同步、微信开发者工具、真实后端和真机验收范围。

开发说明与配置示例见 `miniprogram/README.md`。新增命令、接口或同步规则同步此规范及回归。

## TypeScript 分工

`typecheck` 使用独立别名依赖 `typescript7: npm:typescript@7.0.2`，显式执行 `node node_modules/typescript7/bin/tsc --noEmit`，避免两个 TypeScript 版本的 tsc bin 冲突。原 `typescript` 保持 5.9.3，供 typescript-eslint、Taro／TDesign 插件和 Node 测试的旧编译器 API 使用。build:weapp 沿用 typecheck 前置门禁，生产构建仍使用既有 Taro 编译链；升级必须同时验证类型检查、旧 API 回归及真实生产构建，并同步两级锁文件。
