# 微信小程序开发模块

Taro 4.3.0 + React 18 + Vite 7.3.7 + Tailwind CSS 4.3.3 + weapp-tailwindcss 5.6.2，独立于 Web SPA 构建。以索引首页 `pages/index/index` 为启动页，依次提供设计规范 `design-system`、组件示例 `components`、批量请求测试 `batch-test` 三个入口。批量请求测试通过 Member GraphQL 查询店铺，支持单次请求与五条并发请求，显示总耗时和每项耗时、结果、错误。同页提供邮箱密码登录与退出，微信 `wx.login` 接入延期；认证、用户模型与数据库沿用现有应用。

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

同步在其他异步输出处理完成后执行，采用校验和镜像并关闭时间戳保留：内容未变的 `app.json`、页面 JSON 等不会因重建时间变化触发目标文件事件，内容变化及文件删除仍正常同步。保留 Windows 的 `project.private.config.json`。首次目标应为空，也可仅含私有配置；`.weapp-sync-owner.json` 记录源产物归属，支持失败重试并阻止其他工程占用。归属标记与目标真实路径均受校验。构建侧私有配置保持在本地；发布导出会过滤真实环境配置、私有配置、归属标记、构建产物及 `.swc` 编译缓存。

Taro watch 配合开发者工具的普通编译，关闭“编译热重载”。共享 `project.config.json` 已设置 `compileHotReLoad: false`，但本地 `project.private.config.json` 的同名设置会优先覆盖；Windows 目标的私有配置由开发者工具维护，同步不会擅自改写。若增量后出现“页面未配置在 app.json 中”而源／目标都已有该路由，先核对目标私有设置并关闭热重载，待构建同步结束后编译，再验证导航和点击。已卡住的运行时可能无法通过普通编译恢复，需要重新初始化运行环境或重新打开项目；恢复后须另验一次增量更新，不能仅凭重开有效判定根因。排查证据见 [增量更新排查记录](docs/watch-reload.md)。

同步失败会中断本次构建并给出目录权限／rsync 指引。完成构建后，核对 Windows 中 `app.json`、`project.config.json` 和页面文件，再在微信开发者工具编译。开发与生产注册九个页面：首页、设计规范、组件索引、五个组件分类及批量请求测试。导航使用原生 navigate 保留返回栈，子页使用微信原生导航栏返回上一页，页面内不重复提供返回链接。首页、设计规范及全部组件示例无需登录或后端即可浏览。新增路由后重启 watch，再在微信开发者工具重新编译。

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

主题映射与扫描配置集中在 `src/app.css`：`@theme inline` 将语义颜色映射到页面根变量，`source(none)` 配合 `@source "./"` 限定源码扫描。Taro 4.3 的旧 Terser `output` 由 `createWeappTerserOptions` 在 Vite 配置阶段归一为 `format`，兼容 Vite 7.3 的生产压缩，保留现有压缩选项。Taro 构建沿用 `WeappTailwindcss`、CSS 入口和 `cssOptions.rem2rpx`。

## 设计规范与亮暗主题

设计规范页集中展示语义配色、四档文字及布局尺度。组件示例通过 `pages/dev/components/index` 分类浏览：

| 分类       | 路径                          | 内容                                   |
| ---------- | ----------------------------- | -------------------------------------- |
| 基础组件   | `components/basic/index`      | 按钮、状态标签、分割线                 |
| 导航组件   | `components/navigation/index` | 带内容选项卡、图标标签栏               |
| 表单组件   | `components/form/index`       | 字段、输入、开关、单选、多选、多行输入 |
| 内容展示   | `components/content/index`    | 卡片、列表、空态                       |
| 弹层与选择 | `components/overlay/index`    | 对话框、底部弹层、选择器               |

表中路径均位于 `pages/dev/`。各分类页独立管理演示状态，操作反馈在当前页展示，不跨页共享表单设置。

示例样式不限制组件能力。Tabs 现展示 `theme="line"` 和 `theme="tag"` 两种，可继续使用 `theme="card"`、指示线、滑动、吸顶等官方配置。Button/Tag 保留业务 `variant`，用 `theme` 和 `appearance` 分别配置官方主题、外观，例如 `<Button appearance="dashed" shape="round" icon="add">新增</Button>`；其余官方尺寸、图标等通过类型化属性使用。Input 支持纵向标签、图标、状态及清除按钮，受控输入的 `onClear` 需回填空字符串；EmptyState 支持替换 icon/image。状态标签入口已统一为 `ui/tag` 的 Tag/TagProps；数量徽标仍沿官方 Badge。详细优先级和后续扩展检查见设计规范“官方样式与项目接口”。

导航组件从 `src/components/ui/tabs` 导入 Tabs/TabPanel，从 `src/components/ui/tab-bar` 导入 TabBar/TabBarItem。父子节点保持直接嵌套，change 事件通过 `event.detail.value` 回填；Tabs 示例包含内容操作、禁用项与 lazy 面板，TabBar 示例包含图标、徽标和栏目切换。官方固定定位及安全区默认保留，页内示例显式关闭 fixed 与 safeAreaInsetBottom，不改变现有页面导航。品牌与亮暗沿项目主题，图标文字使用 caption 字号。真实微信父子关联、触摸与固定底栏安全区仍需设备验收。

当前采用 TDesign 作为默认组件方案，继续通过项目组件入口使用并锁定版本；新增 UI 优先复用官方能力，仅保留必要适配和页面组合。现有组件复用清单、后续收敛顺序、适配成本和设备验收边界见 [TDesign 探索结论](docs/tdesign-evaluation.md)。

完整规则见 [小程序设计规范](../.trellis/spec/miniprogram/design-system.md)。项目只需修改 `src/components/theme/project.ts` 即可覆盖两种模式的品牌色、背景、文字和公共尺寸，组件与原生导航栏使用同一份配置。例如：

```ts
export const projectTheme: ThemeOverrides = {
    colors: {
        light: { primary: "#166534", "primary-foreground": "#ffffff" },
        dark: { primary: "#86efac", "primary-foreground": "#052e16" },
    },
    metrics: { radius: 24 },
};
```

当前采用 TDesign 小程序 1.17.0 的默认视觉。Button、Input、Tag、Empty 使用官方原生实现，Card 保持项目组合，输入项的标签与提示采用官方内置布局；示例页还提供 Dialog、Popup 和 Picker。第二批常用组件包含 Switch、CheckboxGroup、RadioGroup、Textarea、Cell/CellGroup 和 Divider，可从 src/components/ui 导入；示例支持受控回填、单项禁用、只读、字数计数和列表点击反馈。页面与控件统一为 40/36/32/28rpx 四档：标题、区域/弹层标题、正文/表单/按钮、辅助/标签，作为初次默认的标准字号。标题和按钮统一 500 字重；标准档保留官方控件行框与尺寸，标准按钮 80rpx。页面、Card 和 EmptyState 的文字统一从 `ui/typography` 导入 Title/Text/Paragraph。Title 默认 h4（页面）和 h5（区域）；Text/Paragraph 使用 size=body/caption。根节点默认 margin=0，间距由父容器负责；字号从项目 metrics 映射，实例 style/customStyle 保留覆盖能力。官方 content、ellipsis、装饰及复制能力直接透传；展开/收起统一读取 onExpand 的 detail.expanded。

首页三个功能入口下方提供“字号设置”，打开底部面板可选择小/标准/大并查看预览，正文分别为 28/32/36rpx。选择立即应用到全部页面，关闭面板保留选择，本机重启后恢复；无需登录，不做账号同步或跟随微信系统字号。四档文字在项目配置基础上分别减 4、不变、加 4rpx，页面留白不变，大字号增加官方文字行高及按钮/标签栏高度。偏好键为 `go-starter:ui-font-size`，非法或不可读值降级为标准；保存失败仍在本次运行中生效，面板提供失败提示及重试按钮。

主题仍只跟随微信系统：首次读取、监听系统变化、页面显示刷新，异常安全降级；原生导航和窗口背景读取同一项目配置。`components/theme/` 仍是唯一主题目录，`project.ts` 的 colors 覆盖会映射到官方公开变量；需要精细调整时，可在同一配置的 `tdesign.light/dark` 下覆盖 `--td-*`。仅覆盖官方变量不会反向改变业务语义颜色或导航。

纵向按钮组由父容器 `flex flex-col gap-3` 提供 24rpx 间距。Input 将官方 change/enter 事件适配为现有 onInput/onConfirm，保留密码、键盘与显式焦点；输入项使用官方 label/tips 绘制标签、说明和错误：短标签默认横排，长标签使用 layout=vertical，保留底部分割线与官方纵向内边距，横向留白由外层容器提供，字段名称及分割线左侧与容器内容对齐；必填标签保留 \*。旧 FormField 及其聚焦 Context 已移除，Input 外壳继续支持点击聚焦。成功提示使用配对颜色的官方 Tag。新组件同样跟随系统主题与四档文字；Textarea 使用官方内置 label，光标跟随项目品牌，独立使用显式 focus。RadioGroup 开启 allowUncheck 时回调值可能为 null；CheckboxGroup 的回调值为数组，均通过 event.detail.value 读取。

选择组 readonly 会通过派生 options 同步到原生子项，支持同一 options 引用下动态开启和解除，保留 keys 别名与单项只读/禁用，不修改调用方数据。表单组件的 name 在模板适配层显式登记，Input 可将字段名传给原生表单行为；真实 Form 提交仍需微信验收。自定义 secondary 时，次要按钮正常态背景和边框同步，仍可通过 tdesign 显式覆盖边框。

构建配置从固定依赖生成 `src/native/tdesign/`，处理当前 Taro/Vite 的原生路径、动态 src、WXSS 和 spread 模板属性问题；该目录不提交、不手改。发布包引用的 tslib/dayjs 已显式固定。升级组件库时清理生成目录再重建，并复验开发、生产、watch、Windows 同步和真实微信交互。原样式保存在提交 `1940fdf`；恢复时只针对本轮路径，恢复锁文件并重新安装、构建，详见设计规范的回滚约定。

官方状态色保留默认，不再宣称所有官方状态文字均达到 4.5:1；项目改配色后需单独检查可读性。开发者工具与真机对键盘、安全区、长文本、大字体及系统主题分别验收。

## 微信模块启动与白屏排查

TD 原生组件还需防止 watch 重建后公共导出丢失：Taro 的原生入口生成状态跨轮保留，可能使旧组件 JS 继续引用已被重算移除的 common/taro 导出。`tdesign.mjs` 每轮通过同一个 Taro 生成器保留原生入口及其 JS/CSS 导入，复用生成标记避免重复 JS；同名公共模板/WXS 仅在内容一致时复用输出，不一致则构建失败。回归覆盖首次及连续重建无覆盖警告、资源内容一致和真实组件注册。遇到仅增量更新后白屏，应检查公共导出与引用，不只检查文件存在或 Windows 同步成功。

出现 `property "openType" ... expected <String> but get null` 等警告时，核对 base.wxml 是否保留官方属性默认值。适配器从固定发布包 props.js 读取默认值，为未传字段补值，保留有效的 false、0 和非受控 null；修复通过 Taro 的 mergeThirdPartyComponents 与 WXS 默认值机制完成，空对象使用 xs.d()；不再二次改写 base.wxml，避免生成微信不接受的空对象三元表达式。style 绕过 Taro 默认值分支，因此在 TD 属性生成处单独把缺省及 null 清空规范为空字符串，保留已有内联样式。Node 求值和 Tailwind 转换通过不能替代微信编译。设置 WEAPP_WXML_COMPILER 为微信原生 wcc 可执行文件路径后运行 `rtk pnpm test:weapp`，可用 WEAPP_WXML_FIXTURE_ROOT 指定编译器可访问的临时根目录；未配置编译器时该专项显式跳过。完整与增量的实际 WXML/WXS 也需原生编译验收。修改此构建适配后需要重启 watch 并重新编译，单纯刷新页面不会重新加载构建配置。

构建通过 `createWeappModuleScope` 为每个 CommonJS chunk 增加独立函数作用域。微信开发者工具的模块包装会注入 `print`、`URL`、`Node` 等参数；此隔离用于保护 GraphQL／Apollo 等依赖的同名顶层声明，保持开发、生产及 watch 启动一致。

Taro 4.2.1 在开发构建中通过组件 re-export 入口收集模板时，会遗漏按钮和输入框等原生模板。`config/plugins/weapp-components.cjs` 通过 Taro 插件的 `ctx.modifyComponentConfig` 显式保留 button、input、label 和 navigator 模板；CLI 使用插件 hook 分发，根配置中的同名回调会被覆盖。实际视图需同时确认登录区域、输入框和两个请求按钮可见，console 中出现 `Template ... not found` 时核对 `base.wxml` 的组件模板。

修改 `config/` 或在 `app.config.ts` 新增路由后重启 `rtk pnpm dev:weapp`，等待构建及 Windows 同步完成，再在开发者工具点击“编译”。启动白屏时采集运行时首个错误与当前路由，重点核对 `Identifier 'print' has already been declared`、`app.js` 加载失败和页面注册状态。

## 类型与测试边界

Member SDL 边界为应用 `share/schema/common.graphqls` + `share/schema/member.graphqls`，操作源为 `src/graphql/member/operations.ts`，产物为相邻 `generated.ts`。DateTime 为 string，可空响应及可选筛选按 SDL 保留。修改 SDL 或操作后运行 Codegen，产物与源码一起交付；检查在内存中生成并比较文件，保持只读且独立于 Git。

Apollo 批量传输每批最多十条，使用 Taro.request 适配，超时十五秒。店铺查询使用 no-cache，独立保序；批量测试每项展示各自错误。页面含加载、错误、空态、重复点击和卸载保护。

`tests/node` 覆盖邮箱密码登录／退出、会话存储隔离与过期、真实 Apollo 链配合模拟 Taro 网络与 React hooks、只读 Codegen 和真实 rsync、v4 样式生成与扫描隔离、真实 Vite 产物的微信模块包装加载；`tests/types` 覆盖生成类型契约。Taro 构建、Windows 挂载盘同步和 watch 增量验收独立执行。微信开发者工具显示效果、真实后端数据库请求和真机网络仍需对应环境专项验收。

当前固定栈的 Taro/Vite peer 声明仍有版本提示；完整构建和实际 watch 增量同步作为专项门禁。依赖升级时同时复验 CSS 转换、路由裁剪、平台网络和增量构建。

主题与组件回归包含配色对比度、系统主题读取/监听及降级、跨页与快速切换、原生能力和类型契约。系统暗色启动的原生背景过渡、键盘、安全区、大字体以及 iOS/Android 显示需开发者工具和真机分别验收。

Taro 传递依赖的安全版本约束和本地补丁统一见 [依赖补丁说明](../patches/README.md)。两级工作区同步维护；`braces` 无安全正式版本时使用有攻击回归的本地深度限制，原始审计告警保留。
