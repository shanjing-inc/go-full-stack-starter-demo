# 小程序设计规范

## 当前方案与入口

当前采用 `tdesign-miniprogram 1.17.0` 作为默认组件方案。新增或调整 UI 时先核对固定小程序发布包，优先使用官方组件与公开属性，仅保留必要的 Taro 适配、项目主题及页面组合。原样式基线提交 `1940fdf` 作为历史参考。组件沿用官方形态、高度与色阶；用户体验后要求协调文字，页面与控件共用四档字号，通过公开主题变量统一，不覆盖内部选择器。

- 项目唯一主题入口：`miniprogram/src/components/theme/project.ts`。
- 业务语义颜色与页面尺寸：同目录 `tokens.ts`、`resolve.ts`。
- 官方变量适配：同目录 `tdesign.ts`；系统状态与原生导航继续由 `store.ts`、`native.ts` 管理。
- 页面组合：`src/components/ui/`，Button/Input/Tag/EmptyState 分别使用官方 Button/Input/Tag/Empty；新增 Switch、CheckboxGroup、RadioGroup、Textarea、Cell/CellGroup、Divider、Tabs/TabPanel、TabBar/TabBarItem。Card 保持页面布局职责；Title/Text/Paragraph 复用官方文字。
- 原生组件与模板适配：`config/plugins/tdesign.mjs`，构建前从固定依赖准备 `src/native/tdesign/`；生成资源不提交、不手改。
- 索引首页为启动页，按“设计规范、组件示例、批量请求测试”排序。规范页与示例分离，分类页沿用原生返回。

### 后续复用与收敛

固定版本的 Title/Text/Paragraph 已注册原生模板和 JSX 类型，统一从 `ui/typography` 导入。旧 FormField、专用 Context、Input 关联分支及对应测试已移除；普通输入继续使用 Input 自带 label/tips。当前页面没有组合字段和统一校验需求，Form/FormItem 尚未注册，后续有需求时按固定版本接入。

Title 默认 h4 对应页面标题，h5 对应区域标题，通过实例样式映射项目 font-title/font-section；其余官方 level 保留。Text/Paragraph 的 size 支持 body/caption，默认 body。三个组件使用外层 View 承载 className，内部原生文字节点默认 margin=0，避免内联复位覆盖 mt-2/mt-3 等布局类；保留 Card 四边留白及标题说明间隔。Title/Paragraph 外层默认块布局；Text 的 ui-typography-text 默认 inline，定义在 Tailwind components 层，允许 utilities 层的 block 等类覆盖。默认字号使用项目变量，不更改 Dialog 等控件消费的全局官方字体变量。实例 style（对象或字符串）及 customStyle 仍作用于内部原生文字，可按官方顺序覆盖默认值；外层 className 管理布局。Text 的 theme 使用官方主文字、次文字及状态色；品牌链接显式使用 primary 语义颜色，不能把 theme=primary 当作品牌色。官方 content 优先于默认插槽；省略、复制及文字装饰能力透传，1.17.0 展开和收起都触发 onExpand，读取 detail.expanded，复制读取 onCopy 的 detail.text。回归需结合页面容器和真实生成 CSS 检查间距及 display 的层叠顺序，不能只检查原生 props。

小程序发布包没有 Card；现有 Card 仅承担页面分组，保留精简组合。EmptyState 已复用 Empty，保留必要的标题／说明／操作组合。项目状态标签由原 Badge 更名为 Tag（`ui/tag`、`TagProps`），不保留旧导出；数量徽标继续使用官方 Badge，例如 TabBarItem.badgeProps。
复用清单及依据见 `miniprogram/docs/tdesign-evaluation.md`。项目包装优先透传官方属性与事件；事件归一、受控默认值、只读修复和系统主题衔接属于适配职责，不复制官方控件的视觉与状态实现。

### 页面职责

| 页面         | 路径                                    | 内容                                                       |
| ------------ | --------------------------------------- | ---------------------------------------------------------- |
| 设计规范     | `pages/dev/design-system/index`         | 配色、文字层级、间距、圆角、边框及卡片留白，不混入交互示例 |
| 组件示例索引 | `pages/dev/components/index`            | 按用途导航至五个分类页                                     |
| 基础组件     | `pages/dev/components/basic/index`      | Button、Tag、Divider                                       |
| 导航组件     | `pages/dev/components/navigation/index` | Tabs/TabPanel、TabBar/TabBarItem                           |
| 表单组件     | `pages/dev/components/form/index`       | Input、Switch、CheckboxGroup、RadioGroup、Textarea         |
| 内容展示     | `pages/dev/components/content/index`    | Card、Cell/CellGroup、EmptyState                           |
| 弹层与选择   | `pages/dev/components/overlay/index`    | Dialog、Popup、Picker/PickerItem                           |

示例状态由各分类页本地管理；列表说明不依赖表单页状态，空态操作与弹窗确认在所属页面展示反馈。所有入口使用 Navigator navigate，不增加跨页状态或返回首页链接。规范及示例均无需登录或后端。

## 官方样式与项目接口

示例展示的样式是选用范围，不是组件能力上限。导航页保留 Card 分组，分别展示 Tabs 的 line、tag 两种样式，各自管理 value；未来使用 card、指示线模式、间距、滑动或吸顶时，直接传官方属性。新示例沿用组件入口，不复制组件实现或增加按页面命名的变体。

| 组件                                                               | 可扩展的外观与兼容规则                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabs/TabPanel                                                      | theme 支持 line/card/tag；底部指示线、spaceEvenly、split、swipeable、sticky 等沿官方，stickyProps 使用普通 offsetTop/zIndex 属性                                                                                              |
| Button                                                             | 既有 variant 保留业务语义；官方 theme 与 appearance 分别覆盖默认主题和原生 variant 映射，支持 base/outline/dashed/text；shape、icon、ghost、loadingProps 直接透传；size 兼容 sm/default/lg 和官方尺寸；fullWidth 优先于 block |
| Tag                                                                | 既有 variant 保留状态语义；theme 与 appearance 可分别覆盖颜色主题与 light/dark/outline/light-outline 外观；支持 shape、size、icon、closable/maxWidth；onClose 与 onClick 都归一为项目触摸事件                                 |
| Input                                                              | 保留密码、聚焦及 onInput/onConfirm 接口，开放官方 label/layout/align、前后图标、readonly、tips、clearable 和 status；invalid=true 时优先使用 error；受控清除由 onClear 回填 value，官方 clear 不自动发 change                 |
| EmptyState                                                         | 保留 title/description/action 组合；开放 image/icon、className/style/customStyle；未配置图像时默认 inbox，传 image 时不额外设置默认 icon                                                                                      |
| Switch、CheckboxGroup、RadioGroup、Textarea、Cell、Divider、TabBar | 继续基于官方属性派生类型并透传；保持原有禁用、只读保护及父子结构。弹层页面直接使用已注册的原生组件                                                                                                                            |

输入项统一使用官方 Input 自带的 label/tips：常规短标签使用默认横向布局，店铺查询等长标签使用 layout=vertical；纵向内边距、禁用色及提示状态沿用官方。横向留白统一由 Card／页面容器提供，仅在 Input 外壳内通过公开变量将横向 padding 和底部分割线左缩进归零，使字段名称与容器标题对齐，不在页面根注入默认的 Input 间距变量；覆盖 input-height 时仍保持此规则，项目显式 tdesign 变量覆盖继续优先。错误由 invalid 或 status 配合 tips 展示，错误提示优先于说明，必填项在标签中保留 \*。示例与批量请求页使用同一规则。店铺查询的 placeholder 使用“可输入数字 ID 或店铺标识”，避免重复 label；正常状态不显示 tips，仅在错误时显示错误信息。基础输入框的名称示例同样只通过 placeholder 提供输入引导，移除常态 tips，保留错误示例的 tips。旧 FormField、专用 Context 和 Input 关联分支已移除；点击 Input 外壳仍可请求 focus。

例如 `<Button theme="primary" appearance="dashed" shape="round" icon="add">新增</Button>`、`<Tag variant="success" appearance="outline">已完成</Tag>`。项目语义 variant 与官方外观采用独立字段，避免改变既有调用的含义。

新增外观先核对固定发布包的属性和事件，再检查 JSX 类型、包装透传、模板注册与默认值、亮暗主题、页面示例。官方属性名自动从 props.js 注册，事件仍需显式登记；嵌套配置需解包微信 property 描述对象，不能只靠类型断言跳过。函数属性、命名插槽及新原生能力需要单独验证 Taro 到微信的传递，类型可用不代表所有官方能力均已验收。

## 默认视觉与布局

首页“字号设置”为独立单行 Cell，显式设置 `bordered={false}` 隐藏底部分割线。

输入框分组仅在相邻字段间保留分割线，末项或独立输入框显式设置 `borderless`：包括表单示例的“基础输入框”“输入框外观”、账号登录的密码及店铺查询。仅含一项的只读 CheckboxGroup 同样设置 `borderless`；多项选择组保留官方分割线，组级开关会同时隐藏所有选项的分割线。

列表 Cell 的横向留白同样由外层容器负责，仅在 Cell 根节点将 `--td-cell-horizontal-padding` 默认为 `0`；底部分割线的默认左缩进沿官方回退到该变量，保持与列表内容对齐。保留纵向内边距、图标与文字间距及右侧箭头间距，项目显式主题变量与实例 style/customStyle 仍可覆盖。Card 四边内边距及页面卡片之间的间距独立管理，不通过清零公共 spacer 变量解决对齐问题。Tabs 标签、按钮、Tag、居中空态及独立弹层的内部留白保持各自用途。

默认品牌为官方蓝色：亮色 `#0052d9`、暗色 `#4582e6`；页面背景为 `#f3f3f3` / `#181818`，容器为 `#ffffff` / `#242424`。官方组件使用发布包内的颜色与透明度，页面语义 token 提供对应的实色参考。

| 范围                           | 当前默认值与职责                                               |
| ------------------------------ | -------------------------------------------------------------- |
| 页面标题 / 区域标题            | 40 / 36rpx，500 字重                                           |
| 页面正文 / 辅助说明            | 32 / 28rpx，400 字重                                           |
| 页面左右留白 / Card 四边内边距 | 32 / 32rpx                                                     |
| 页面基础圆角                   | 12rpx                                                          |
| Button 小 / 中 / 大            | 官方 64 / 80 / 96rpx；组件默认中号                             |
| Button 文字                    | 统一 32rpx、500 字重；各尺寸保留官方行框                       |
| Input                          | 内容与 placeholder 统一 32rpx / 48rpx，纵向 padding 默认 32rpx |
| Tag / Empty / Dialog / Picker  | 标签 28rpx，弹层标题 36rpx、正文与选项 32rpx；保留状态色与形态 |

页面使用 Title(h4/h5)、Text/Paragraph(body/caption) 四档；标准字号为页面标题 40、区域/空态/弹层标题 36、正文/字段/按钮/输入/选项 32、辅助/默认标签 28rpx。标题与按钮使用 500 字重；Picker、Tabs、TabBar 选中项保留官方 600 字重作为选择反馈。带图标的 TabBar 文字通过 `--td-font-body-extraSmall` 映射到 caption，标准为 28rpx / 32rpx。小与标准字号保留官方行框，按钮通过高度区分尺寸；大字号适配见下一节。Text/Paragraph 行高为 1.5，页面/区域标题行高分别为 1.3/1.4，随字号同步放大。纵向操作使用父 `View` 的 `flex flex-col gap-3`，外部间距由父容器负责。Card 四边内边距一致，设计示例卡片上方间距为 32rpx。

不通过旧的 `.ui-button--default`、`.ui-input-placeholder` 或伪元素重置覆盖官方外观。需要调整官方控件时优先使用公开 CSS Variables；Tailwind 负责页面布局。

官方品牌和状态配色保持默认，因此不再承诺所有官方按钮与状态标签均达到 4.5:1；页面正文仍检查对比度。项目品牌覆盖需要检查正常、按下、禁用、浅背景及文字配对，不能只看默认态。

## 用户字号偏好

首页三个功能入口下方提供“字号设置”单元格，`components/font-size-settings.tsx` 复用 Popup、横向 RadioGroup 和文字预览，不增加路由。仅提供小/标准/大，初次默认标准；选择立即生效，遮罩、关闭按钮及“完成”只关闭面板，不撤销已选字号。

`theme/font-size.ts` 定义三档。`resolveTheme(mode, overrides, fontSize)` 在项目 metrics 覆盖后，对四档文字分别应用 -4/0/+4rpx 偏移；正文对应 28/32/36rpx。页面留白、卡片内边距、圆角和图标大小保持原值，业务显式字体样式与官方变量仍可覆盖。

`theme/font-size-store.ts` 使用独立的 `go-starter:ui-font-size` 本机存储键，仅接受 small/standard/large；不绑定账号或后端，不跟随微信系统字号。缺失、非法或读取失败均使用标准。写入失败仍更新当前会话字号，面板显示失败提示及“重试保存”，不能宣称已保存成功。`useTheme` 分别订阅亮暗主题和字号，返回最新解析结果，使已经挂载的页面与之后打开的页面一致；切换亮暗主题或返回前台不重置字号。

大字号的官方 body/mark/title 及 Cell 说明行高增加 6rpx，extra-small/小/中/大按钮和 TabBar 高度同步增加 6rpx；Radio 图标对齐行高及 Checkbox 标题行高同步调整。Input、Textarea 和 Cell 随文字行高自然增高；Input 纵向标签与 Checkbox 标签模式通过 `--td-font-size-base` 跟随正文。公开 `tdesign` 变量最后覆盖这些默认适配。标准与小字号不主动改写官方控件高度。

回归见 `tests/node/font-size.test.cjs`：面板开关及即时选择、九个页面与两种主题同步、重新启动恢复、非法偏好、存储异常与重试、订阅清理及项目覆盖优先级。微信原生弹层触摸、不同屏宽、长文本与真机裁切仍需设备验收。

## 配色与项目覆盖

业务颜色继续使用 background/foreground、heading、card/card-foreground、primary/primary-foreground、secondary、muted、accent、border/input/ring、success、warning、destructive 等语义。背景与前景成对使用；成功提示使用 Tag，不将配对文字单独放到 Card 上。

```ts
export const projectTheme: ThemeOverrides = {
    colors: {
        light: { primary: "#166534", "primary-foreground": "#ffffff" },
        dark: { primary: "#86efac", "primary-foreground": "#052e16" },
    },
    metrics: { radius: 24 },
    tdesign: {
        light: { "--td-brand-color-active": "#14532d" },
    },
};
```

`colors` 采用六位十六进制。通过官方 body/mark/title 字体变量与 Picker 选项变量同步项目文字角色，控件高度仅在项目显式覆盖或大字号时调整；显式业务颜色覆盖映射到对应公开变量，品牌同时推导按下、禁用和浅背景状态。推导仅为基础混色，项目可在 `tdesign.light/dark` 用公开 `--td-*` 变量覆盖，后者优先。精细状态色以项目确认结果为准。

success 的语义是提示背景，success-foreground 是配对文字；适配 Tag 的 `--td-tag-success-light-color` 和 `--td-tag-success-color`，不直接把浅背景当作官方成功强调色。Warning 同理。输入光标显式读取当前项目 primary，避免官方固定默认蓝色在改品牌后残留。

覆盖 secondary 时，同时映射次要按钮正常态的背景与 `--td-button-light-border-color`，使普通边框及 `::after` 与背景一致；显式 `tdesign` 边框变量仍最后生效。未覆盖 secondary 时保留官方默认。

`metrics` 中 font-body/font-caption/font-section 同时映射对应官方字体变量；Title 的 h4/h5 使用 font-title/font-section，Text/Paragraph 使用 font-body/font-caption；按钮高度映射官方对应变量，radius 映射 default/extraLarge 圆角。Input 高度覆盖通过纵向 padding 调整，内部最小文字高度仍遵循官方 48rpx，不承诺任意小高度或自定义字号下的精确总高。需要调整官方字体、Tag 圆角等请使用 `tdesign` 公开变量。

只覆盖 `tdesign` 变量不会反向修改业务语义颜色或原生导航。项目需要整站改品牌时优先改 `colors`，再细调官方变量；不要在页面散落覆盖内部类。

## 系统主题与原生外观

所有页面由 `ThemePage` 包住，主题变量在该根节点下发。亮暗模式只跟随微信系统，不提供手动切换或亮暗偏好存储；用户字号另行管理。首次读取 `getAppBaseInfo().theme`，不支持时回退 `getSystemInfoSync().theme`；首个订阅注册一次 `onThemeChange`，最后订阅退出后清理；页面显示时重新读取。

`app.config.ts` 启用 darkmode，themeLocation 引用 `components/theme/native.json`；启动默认背景与 TD 页面背景一致。运行时 `setNavigationBarColor`、`setBackgroundColor` 使用项目解析结果；亮色黑字，暗色白字。原生同步串行收敛到最新模式，捕获异常，下一次显示重试。

- 首次无有效主题：默认亮色；之后读取失败：保留最近有效值。
- 重复/非法事件：不通知、不污染状态；监听失败：页面显示仍刷新。
- 历史 `go-starter:ui-theme` 偏好不参与判断；认证存储保持原有隔离。
- 官方主题包含 light/dark 媒体查询，由构建适配器逐字输出为 `tdesign-theme.wxss` 并在最终 `app.wxss` 引入，保持它与 Tailwind 的扫描入口分开。不能通过 `app.tsx` 的平行 CSS 导入合并到 app-origin，当前插件 watch 会从单一入口重建样式并丢失平行主题。
- 当前示例 Popup 本身没有 root-portal，主题在原页面继承；以后引入 root-portal/custom-tab-bar 时需单独提供 `.page` 和项目变量，不假设 ThemePage 的局部覆盖可跨根继承。

## 组件与事件契约

| 组件       | 项目接口与原生适配                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button     | default/secondary/outline/ghost/destructive 映射 TD theme/variant；sm/default/lg 映射 small/medium/large；fullWidth 映射 block；tap 适配业务 onClick；disabled/loading 双重拦截 |
| Input      | change 适配 onInput，enter 适配 onConfirm，password 映射 type=password；保留 value、focus、键盘配置与平台事件；invalid 映射 status=error                                        |
| Card       | 项目容器，支持标题、说明、children 与 View 属性                                                                                                                                 |
| Tag        | TD Tag 的 default/primary/success/warning/danger + light；状态内容仍用文字表达                                                                                                  |
| EmptyState | TD Empty，description/action 通过 Taro Slot 组合标题、说明及操作                                                                                                                |

新增常用组件同样从 `src/components/ui/` 导入，属性由固定官方定义解包，事件使用小程序 event.detail：

| 组件                | 事件与状态                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Switch              | value + onChange(detail.value)，支持 customValue；disabled/loading 拦截业务变化                                                                                                                  |
| CheckboxGroup       | options + 数组 value；onChange(detail.value) 回传多选；disabled/readonly 拦截变化，max 与单项禁用由官方实现                                                                                      |
| RadioGroup          | options + 单值 value；allowUncheck 取消可回传 null，业务应处理；disabled/readonly 拦截变化                                                                                                       |
| Textarea            | 官方 label、受控 value、maxlength/maxcharacter、indicator、autosize；change/enter/focus/blur/line-change/keyboardheightchange 保持官方事件，disabled/readonly 拦截输入变化；光标跟随项目 primary |
| Cell / CellGroup    | title/description/note、箭头、click 反馈与官方 url/jumpType；组使用默认 slot，单元格命名 slot 沿用官方定义                                                                                       |
| Divider             | content、align、dashed、横向/纵向布局                                                                                                                                                            |
| Tabs / TabPanel     | 直接保留原生父子节点；value 支持字符串与数字，change/click 从 detail 读取 value/label；disabled、lazy 和内容插槽沿官方行为                                                                       |
| TabBar / TabBarItem | 直接保留原生父子节点；change 从 detail.value 回填；图标、徽标、url/linkType 沿官方属性，badgeProps 使用扁平徽标配置                                                                              |

Tabs/TabPanel 与 TabBar/TabBarItem 包装不增加 View，原生 relations 负责关联。Tabs 面板保留交互内容；lazy 在首次激活后保留内容，禁用项不触发 change，click 仍沿官方行为。TabBar 默认 fixed=true、placeholder=false、safeAreaInsetBottom=true；导航示例显式设 fixed=false、safeAreaInsetBottom=false，在卡片内展示，不设置 url，不注册 app.tabBar 或 custom-tab-bar。正式固定底栏需另验内容占位、安全区及跨根主题。类型映射需将 TabBarItem 的 badgeProps 中的微信 property 定义解包为普通属性，不直接暴露官方嵌套描述对象。自动化执行官方 relations 回调只证明方法行为，微信实际关联、布局及触摸需设备验收。

Checkbox/Radio 使用官方 options 内部生成子项，避免 Taro 外层渲染影响原生组关系；当前不额外包装单个 Checkbox/Radio。CheckboxGroup、RadioGroup、Textarea 在自身根节点分别设置公开的 `--td-checkbox-vertical-padding`、`--td-radio-vertical-padding`、`--td-textarea-padding`，默认 `32rpx 0`：横向留白由 Card／页面容器提供，保留官方上下内边距与图标文字间距，不向页面根注入这些默认值。项目显式主题变量覆盖优先于默认值，实例 style（字符串或对象）和 customStyle 继续透传并可覆盖主题值。Textarea 使用官方内置 label 与显式 focus，不依赖字段级聚焦 Context。Cell 说明及右侧 note 复用 caption，其他文字沿用前述四档映射。示例页的选项与通知状态为本地演示数据，不访问后端或修改系统主题。

TD 1.17.0 的组 readonly 不能只靠回调拦截：CheckboxGroup 未向子项传递组状态，RadioGroup 对稳定 options 引用的只读切换不会重新计算子项。两个包装统一使用 `useReadonlyOptions`，只读时派生逐项 readonly，解除时触发官方 options observer，恢复原始单项状态；兼容字符串、数值和对象选项及 keys 别名，不修改调用方数据。依赖未变时保持派生数组引用稳定。回归执行固定发布包的原生方法及生命周期，受控/非受控均不得改变内部值或发出变化事件；真实触摸另行验收。

CheckboxGroup 的组级 disabled 优先于单项 `disabled: false`。TD 1.17.0 的官方模板会让显式单项状态覆盖组禁用，因此包装在禁用时为对象选项派生 `disabled: true`；字符串和数值选项继续由官方模板继承组状态。解除禁用后恢复原始单项 disabled/readonly，不修改调用方 options，也不重建原生组或重置非受控选择。派生数组按 options、readonly、keys 和 disabled 稳定缓存。回归需对真实官方 WXML 的 disabled/readonly 属性求值并执行子项点击，确认受控与非受控组禁用时均不发 change、内部值保持原样，解除后恢复选择；仅断言包装回调被拦截不足以证明禁用有效。

TD 1.17.0 的 CheckboxGroup 在 options 为空时直接返回，不清除旧 checkboxOptions。包装仅在非空/空选项边界通过 key 重建原生组，覆盖 [] 与 undefined；普通非空 options 更新复用实例，不重置非受控选择。原生 JSX 类型组合 React Attributes 以支持 key；它由 React 消费，不作为 TD 模板属性注册。清空不额外发出 change；重新填充后受控 value 由调用方保留，非受控按 defaultValue 重新初始化。回归执行官方 options observer、生命周期及子项点击，确认旧项消失、重填后可选，不修改官方私有 data 或仅隐藏旧项。

Input 的完整外壳和字段名称显式请求 focus，失焦清理以允许再次聚焦，disabled 阻止请求，已聚焦时不重复触发。微信 Label for 对 input 的支持不可依赖；Taro 4.2.1 的 ariaLabel 也不作为微信无障碍名称绑定证据。可见标签、点击聚焦与平台无障碍语义分别验收。

官方原生事件名称大小写必须准确，例如 getuserinfo、getphonenumber、keyboardheightchange、visible-change。不能把所有原生事件名机械替换为 React 驼峰事件。平台属性支持以当前固定官方版本为准，不承诺其他小程序平台能力。

Button 的实时手机号与服务动态分别使用 getrealtimephonenumber、createliveactivity；包装与模板名单必须同步。官方 Button/Tag 将原始 tap 整体放在自定义事件 detail，项目 onClick 通过共用适配恢复 detail 坐标及 touches/changedTouches，事件控制方法调用原事件。Input 的 defaultValue 只初始化一次，value 优先，空字符串有效；不假设 TD Input 原生支持 defaultValue。

SuperComponent 动态补充的 aria 属性不在组件 props.js，必须在模板名单单独登记。模板传递与官方 WXML 消费、真实读屏分别验收，不能仅凭 JSX 类型可用就宣称无障碍已完成。自定义 destructive 时同步危险按钮的按下、禁用和 Tag 浅底；tdesign 显式变量仍最后覆盖，未定制时保留官方状态色。

页面保留登录、退出、查询互斥、防重复、错误重试和卸载保护；不改 session、Apollo、GraphQL 或服务端。

## 构建适配契约

当前使用 Taro 4.3.0 Vite；以下适配最初针对 4.2.1 验证，统一在 `config/plugins/tdesign.mjs` 处理，不手改 node_modules。升级后以真实完整／连续增量产物和官方模板回归验证兼容性，不能仅凭上游修复说明移除适配：

1. app usingComponents 使用源码内的实际相对路径；别名虽被写回配置，组件收集仍使用转换前的路径。
2. 构建前复制固定包 miniprogram_dist 到被 Git/Prettier/ESLint/tsc/Tailwind 排除的 `src/native/tdesign/`；锁文件与依赖恢复后重启构建即可生成。
3. 动态 src 暂以非相对占位保护，generateBundle 逐字恢复原表达式；最终 WXML 不得残留占位 URL，WXS/Include/Import 的静态依赖必须齐全。
4. 原生入口导入的假 scss 改为 CSS，直接展开官方 WXSS import 并登记 watch 文件，避免 Taro 旧 Sass importer 与当前 Vite 的不兼容。
5. 从发布包 props.js 读取属性名，显式注册模板绑定，避免 JSX spread 属性遗漏；事件名单由适配器明确维护。

    `wx://form-field` 行为注入的 name 可能不在 props.js；Input、Textarea、Switch、CheckboxGroup、RadioGroup 显式注册 name 并补空字符串默认值。Input 回归贯穿包装与真实模板求值；绑定存在不等于真实 Form 提交已验收。

    生成的 base.wxml 同步使用 props.js 的显式默认值；没有显式默认值时按微信属性类型补默认值。Taro 直接绑定缺失字段会使微信收到 null，产生 openType 等类型警告，并覆盖官方控件默认行为。仅在字段为 undefined 时补值，保留显式空字符串、false、0，以及官方非受控状态的 null；类型为 null 的属性不强行转成字符串。SuperComponent 的 aria/customStyle 同步处理；style 的特殊分支绕过默认值配置，TD 属性集合通过 buildThirdPartyAttr 的局部适配生成 `style="{{i.st||''}}"`，缺省和 null 清空都传空字符串，保留非空样式；不影响其他第三方或原生组件，不在最终 WXML 上正则替换。通过 modifyViteConfig 调用 Taro 模板的 mergeThirdPartyComponents，使用官方 WXS 的 xs.b 判定 undefined，空对象使用 xs.d()，不在 generateBundle 二次改写宿主模板。官方原生 WXML 保持逐字一致。默认值回归需执行真实 WXS 与最终模板表达式，不能只断言属性名存在。

    属性默认值中的字符串由 TypeScript AST 输出为单引号，内部双引号转义；禁止通过 &quot; 等 HTML 实体嵌入字符串定界符。后续 Tailwind 处理 hover-class/placeholder-class 时会解码实体，可能提前闭合外层双引号并导致页面显示模板碎片。回归必须经过真实 Tailwind WXML 转换再检查属性边界和求值；不得在断言前手动解码实体掩盖缺陷。完整及增量实际产物都验证相同规则。WXML 不支持三元表达式中的空对象字面量，禁止生成 `i.prop===undefined?{}:i.prop`；Node 能求值不代表微信能编译，必须额外使用微信原生 WXML 编译器验证最终产物。

6. 官方主题在 writeBundle 的 pre 阶段独立输出并接入 app.wxss，早于后续 writeBundle 的 Windows 同步；完整与增量构建都验证主题资源及引用，避免 Tailwind 单入口重建丢失主题。
7. 发布包部分 ES 模块引用 tslib、dayjs，但未声明运行时依赖；本项目显式固定 tslib 2.8.1、dayjs 1.11.23。
8. Taro 的原生组件 `isGenerated` 标记跨 watch 轮次保留，且 native-support 在首次 buildEnd 后清空上下文。适配器在 modifyViteConfig 接入同一个 Taro 原生组件生成器，每轮 buildStart 重置已收集 TDesign 组件的 isGenerated 并生成独立 JS 入口及模板；Taro 后续调用沿用该标记，避免再次发出同名 JS。为失效重载的原生入口保留 JS/CSS 导入。否则旧组件 JS 仍存在、公共 chunk 却已移除对应导出，会使启动页白屏。验证必须覆盖连续增量重建后的模块加载与官方组件注册，不能只检查文件存在或两目录同步一致。
9. Title/Text/Paragraph 的官方 WXSS 内容相同，Vite 会去重；Taro 随后将同一资产反复重命名，只保留最后一个组件的 WXSS。generateBundle 的 post 阶段依据各原生入口的 viteMetadata.importedCss 为缺失的同名 WXSS 发出独立资产，沿用已处理的官方样式，不复制或覆写内部规则。真实完整构建与连续增量回归必须检查三个组件各自的 WXSS 和次文字色等规则；仅检查 JS/WXML 存在不够。

`src/native/tdesign/` 是可重新生成的构建输入；升级 TD 版本时清除该缓存并重建，检查本适配器是否仍需要。同轮构建的官方公共模板/WXS 按输出路径和字节内容去重，复用首次发出的资源引用；内容不同则构建失败，下一轮清空记录。去重仅作用于 TDesign，不过滤 Rollup 警告。回归需确认首次及连续 watch 无覆盖警告，并逐字比对最终模板与公共 WXS，不能用提示消失代替完整性检查。

## 验证与回滚

- Node：主题覆盖与系统状态、组件 tap/change/enter、焦点/禁用、业务认证/查询回归；示例弹层与选择器状态。
- 布局专项：完整构建及连续代码／CSS 增量后，检查实际 app-origin.wxss 中的 mt-4、gap-3 和 --spacing 定义，以及 Windows 目标中的一致性。仅检查主题变量或独立生成器通过，不能代替实际产物中的卡片间距检查。
- 构建适配：官方 WXML 逐字往返、真实 Taro 模板属性/事件、CSS 展开与 watch 依赖；完整产物静态依赖检查。设置 WEAPP_WXML_COMPILER 运行真实微信编译器回归，可用 WEAPP_WXML_FIXTURE_ROOT 指定编译器可访问的临时目录；未配置时该专项显式跳过。完整及增量实际 WXML/WXS 还需整包原生编译。
- 小程序测试统一在 tests/node，类型契约在 tests/types；运行应用 test:weapp/check:weapp、开发/生产构建与 watch；测试工具变化追加主仓 test/check/test:go:coverage。
- 真实微信开发者工具：页面显示、点击、受控输入、对话框、弹层、PickerItem 关系、系统亮暗；iOS/Android 真机另验键盘、安全区与大字体。Node/构建结果不能代替这些验收。
- 回滚基线 `1940fdf`：只恢复本轮变更路径并移除本轮新增文件，保留后续无关改动；恢复两级锁文件后冻结安装，清理生成的 src/native/tdesign，再重新构建及同步。不要直接硬重置整个工作树。
