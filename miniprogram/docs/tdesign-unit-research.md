# TDesign 原生样式 px → rpx 调研

日期：2026-10-19。基于当前工作区的 Taro 4.2.1、TDesign Miniprogram 1.17.0、`designWidth: 750` 和 `deviceRatio[750]: 1`。本文记录调查结果与候选方案，尚未修改正式构建配置。

## 结论

当前接入链路确实改变了官方原生组件的单位语义：TDesign 发布的 WXSS 已经混合使用 `rpx` 与固定 `px`；适配插件将它作为 CSS 交给 Taro 后，默认 pxtransform 又把其中的固定 `px` 转成了 `rpx`。例如 Radio 的 `3px` 边框变成 `3rpx`，Textarea 的 `20px` 最小高度变成 `20rpx`。

这与此前开发者工具的预览模糊分开判断。用户已验证预览缩放恢复 100% 后正常，98% / 80% 时可见模糊，真机正常；此次发现的单位变化不能据此认定为该现象的原因。

建议仅在 pxtransform 中按源文件路径排除 `src/native/tdesign/`，保留官方已经编译好的单位。业务样式继续沿用 Taro 的 px 转换，原生样式继续通过现有适配管线完成资源处理。该方案已通过两组隔离生产构建、产物比较和微信 WCSC 样式编译；真机视觉效果仍需专项验收。

## 单位如何发生变化

当前处理链路：

```text
tdesign-miniprogram/miniprogram_dist/**/*.wxss
  → prepareTDesign 生成 src/native/tdesign/**
  → createTDesignCompatibility 展开 WXSS 的 @import
  → 虚拟入口 .css?tdesign-native-style
  → Taro / Vite PostCSS，执行 postcss-pxtransform
  → dist/native/tdesign/**/*.wxss
```

代码依据：

- [config/index.ts](../config/index.ts) 启用了 `mini.postcss.pxtransform`，尚无原生样式排除项。
- [config/plugins/tdesign.mjs](../config/plugins/tdesign.mjs) 的 `createTDesignCompatibility` 将原生样式引入 CSS 管线，并展开原生 WXSS 的导入；这里不是简单复制最终组件 WXSS。
- 安装版本的 `@tarojs/vite-runner/dist/postcss/postcss.mini.js` 注入 `designWidth`、`deviceRatio`，使用 `postcss-pxtransform@4.2.1`。
- 安装版本的 `postcss-pxtransform/index.js` 默认转换小写 `px`，已有 `rpx` 不变；`exclude` 函数接收 `result.opts.from`，返回真值时跳过该文件。Taro 的 `IPxTransformOption` 类型也明确支持该回调。

在当前 750 配置下，转换后的数字相同，例如 `3px → 3rpx`，但实际显示长度并不相同。业务设计稿的 `px` 与供应商原生样式中的固定 `px` 在这里进入了同一处理规则。

全局主题是另一条路径：`tdesign-theme.wxss` 在 `writeBundle` 阶段直接复制自官方主题，未经过 pxtransform。它的固定像素阴影和圆角保持原样。因此必须分别判断组件声明、主题变量及变量的备用值。

## 官方单位是有意保留的

核对了发布包及其对应的官方源码，固定版本 tag 为 `tdesign-miniprogram@1.17.0`，对应提交 `aafed4f9568bf8c8f9fd9e88480316da47ee57cc`。

| 官方源码                                                                                                                                                                | 固定单位                     | 相关处理                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------- |
| [radio.less 第 88 行](https://github.com/Tencent/tdesign-miniprogram/blob/aafed4f9568bf8c8f9fd9e88480316da47ee57cc/packages/components/radio/radio.less#L88)            | 圆形图标伪元素 `border: 3px` | 同一伪元素再 `scale(0.5)` |
| [radio.less 第 227 行](https://github.com/Tencent/tdesign-miniprogram/blob/aafed4f9568bf8c8f9fd9e88480316da47ee57cc/packages/components/radio/radio.less#L227)          | 分隔线 `height: 1px`         | 再 `scaleY(0.5)`          |
| [checkbox.less 第 205 行](https://github.com/Tencent/tdesign-miniprogram/blob/aafed4f9568bf8c8f9fd9e88480316da47ee57cc/packages/components/checkbox/checkbox.less#L205) | 分隔线 `height: 1px`         | 再 `scaleY(0.5)`          |
| [textarea.less 第 59 行](https://github.com/Tencent/tdesign-miniprogram/blob/aafed4f9568bf8c8f9fd9e88480316da47ee57cc/packages/components/textarea/textarea.less#L59)   | `min-height: 20px`           | 静态最小高度              |

这些不是项目引入时误写的单位。官方原生发布产物已保留这些 `px`，也同时包含大量 `rpx`。再次把全部固定像素视为设计稿单位处理，会偏离该版本的官方行为。

[Taro 官方尺寸文档](https://docs.taro.zone/docs/size) 说明了默认 px 转换及通过 `Px` / `PX` 跳过转换的写法；JS 内联样式不经过同样的编译期字符串替换。本文统计的是 WXSS 声明，不能扩大解释为组件全部运行时尺寸。

## 影响范围

使用 PostCSS AST 提取声明，识别独立的 `px` 单位，避免把 `rpx` 当作匹配结果。

| 统计范围                                        | 结果                            |
| ----------------------------------------------- | ------------------------------- |
| 官方发布包全部 WXSS                             | 123 个文件                      |
| 官方全包中包含固定 px 的文件 / 声明             | 48 个文件 / 141 条声明          |
| 当前应用实际输出的原生组件 WXSS                 | 30 个文件                       |
| 上述组件的官方源样式中包含固定 px 的文件 / 声明 | 16 个文件 / 33 条声明           |
| 当前配置与排除方案的完整构建差异                | 16 个 WXSS 文件 / 60 条输出声明 |

33 与 60 的口径不同：后处理会在变量声明前生成静态备用声明等重复输出。一条官方声明可能对应两条输出声明。官方全包统计还包括当前应用未接入的组件和公共主题，不能把 141 条全部算成当前页面的视觉变化。

当前 16 个组件文件的源声明清单：

| 组件       | 含 px 的源声明数 | 涉及规则                                   |
| ---------- | ---------------: | ------------------------------------------ |
| Badge      |                1 | 气泡形态最后一角的 `1px` 圆角              |
| Cell       |                1 | 默认 `1px` 底部边框                        |
| CellGroup  |                2 | 顶部、底部 `1px` 边框                      |
| Checkbox   |                1 | `1px` 分隔线                               |
| Dialog     |                2 | 文本按钮伪元素的顶部、左侧 `1px` 边框      |
| Input      |                1 | `1px` 底线                                 |
| Paragraph  |                3 | code、kbd 边框及 kbd 阴影                  |
| Radio      |                2 | 圆形图标的 `3px` 边框、`1px` 分隔线        |
| Switch     |                1 | 圆点阴影备用值                             |
| TabBar     |                3 | `1px` 边框、大圆角和阴影备用值             |
| TabBarItem |                5 | `1px` 边框、分隔线、两个大圆角及阴影备用值 |
| Tabs       |                1 | `1px` 分隔线                               |
| Tag        |                3 | round、mark 形态的大圆角备用值             |
| Text       |                3 | code、kbd 边框及 kbd 阴影                  |
| Textarea   |                1 | `20px` 静态最小高度                        |
| Title      |                3 | code、kbd 边框及 kbd 阴影                  |

需要区分实际生效条件：

- Radio 圆形图标、各类分隔线的固定尺寸直接改变。Checkbox 此处改变的是分隔线，不能据此声称其整个勾选图标变小。
- Switch、TabBar、TabBarItem 的阴影以及 `--td-radius-round` 大圆角优先读取全局主题变量。正常主题提供这些变量时，转换后的备用值不生效；巨大圆角的数值变化也不必然改变胶囊外观。
- Badge 气泡形态、Typography 的 code/kbd 样式只在使用对应能力时生效。
- Textarea 的 autosize 对象可通过 WXS 生成内联 min/max-height，覆盖静态规则。不能只依据静态 `20px → 20rpx` 断言当前所有文本框高度都减半。
- 多数字号、控件宽高、间距原本就是 `rpx`，此次不会重复转换，也不存在整个组件统一缩小一半的结论。

## 显示尺寸如何变化

设小程序窗口宽度为 `W` 个 CSS px，则 `1rpx ≈ W / 750 CSS px`。这里的 CSS px 是逻辑显示单位，不等同于设备物理像素。

| 规则                             | 官方值，CSS px | 当前产物，W=375 | 当前产物，W=390 | 当前产物，W=414 |
| -------------------------------- | -------------: | --------------: | --------------: | --------------: |
| Radio：`3px` 边框再缩放 0.5      |            1.5 |            0.75 |            0.78 |           0.828 |
| 分隔线：`1px` 再缩放 0.5         |            0.5 |            0.25 |            0.26 |           0.276 |
| Textarea：静态 `min-height:20px` |             20 |              10 |            10.4 |           11.04 |

缩放会叠加到边框或分隔线厚度上。设备 DPR、像素取整、渲染内核以及开发者工具预览缩放还会影响最终栅格化效果；上表能证明单位语义发生变化，不能单凭这些数值推断模糊现象或真机可见程度。

## 候选方案

建议在现有 `mini.postcss.pxtransform` 中添加以下配置，其余配置保持现有组合方式：

```ts
pxtransform: {
    enable: true,
    config: {
        exclude: (file: string) => /[\\/]src[\\/]native[\\/]tdesign[\\/]/.test(file ?? ""),
    },
},
```

匹配的是当前虚拟 CSS 入口的源路径，兼容 `/` 与 `\` 路径分隔符，保留查询串也不影响匹配。不能只排除 `node_modules/tdesign-miniprogram`，因为样式进入 PostCSS 时已经位于 `src/native/tdesign/`。这里只跳过 pxtransform，不绕开 Vite 原生资源处理、样式去重补齐或主题接入。

| 方案                               | 判断                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 按原生 TDesign 源路径排除          | 边界与供应商产物一致，保留其 px/rpx 混合语义；当前版本完整构建验证通过                                  |
| 全局关闭 pxtransform               | 会改变业务 CSS 的设计稿单位契约，范围过大                                                               |
| 全局 `onePxTransform: false`       | 独立转换器实验确认可保留 `1px`，仍把 Radio `3px`、Textarea `20px` 转换；并会改变业务 1px 的行为，不完整 |
| 调整 designWidth / deviceRatio     | 会同时影响业务尺寸；无法用一套比例同时表达官方固定 px 和响应式 rpx                                      |
| selectorBlackList 排除 `.t-`       | 依赖选择器命名，可能遗漏公共选择器或变量定义；也可能误排除业务自定义规则                                |
| 修改官方文件为 `Px` / 添加忽略注释 | 能绕过转换，但侵入供应商源码，升级和重新生成时还需维护；当前已有明确源路径边界                          |
| 构建结束再将 `rpx` 换回 `px`       | 无法可靠区分官方原有 rpx 与由 px 转换的 rpx，会破坏正确规则                                             |

## 隔离验证结果

所有实验均在根目录忽略的 `.runtime/tdesign-unit-research/` 下进行。两个快照使用同一份最新源码和固定依赖；baseline 保持当前配置，exclude 仅添加上述排除项。关闭 Windows 输出同步，正式应用的 dist 和正在运行的 watch 未由实验重建。

### 独立转换器与生产构建

- 用实际安装的 `postcss-pxtransform@4.2.1` 验证默认转换、`onePxTransform:false`、原生路径排除与业务路径继续转换。
- 两组均执行真实 `taro build --type weapp`，`NODE_ENV=production`，退出码均为 0。
- 候选快照运行 `tsc --noEmit` 通过，路径排除函数与当前 Taro 配置类型兼容。
- 两组均输出 177 个文件，文件集合一致。16 个原生 WXSS 中的 60 条声明恢复官方固定单位，未发现额外文件差异，除下述公共 JS chunk 的生成差异。
- 两组 `app-origin.wxss` 逐字相同，包括页面样式和 Tailwind 产物。额外研究探针验证业务 `10px → 10rpx`、`1px → 1rpx`，既有 `12rpx` 不变。
- `tdesign-theme.wxss` 与官方文件逐字相同。
- `common.js` 存在 Button、EmptyState 和原生 tap helper 三个函数的生成顺序、压缩名差异。通过 TypeScript AST 按角色归一这三个名字，仅对可提升且名称唯一的函数声明排序，其余语句保持原顺序后，两组一致。其余 JS 文件逐字相同；不宣称所有 JS 字节一致。

### 微信样式编译

使用本机微信开发者工具的 `wcsc.exe`，分别将两组完整输出中的 33 个 WXSS 输入编译：

| 输入     | 退出码 | 编译输出字节数 | stderr |
| -------- | -----: | -------------: | ------ |
| baseline |      0 |         351229 | 空     |
| exclude  |      0 |         349981 | 空     |

这是 WCSC 样式编译验证，不是 WCC 模板编译，也不是截图或真机视觉验证。

### Watch 与验证边界

候选配置在隔离 watch 中验证了首次构建和脚本变更触发的增量：Radio 保留 `3px`、Checkbox 分隔线保留 `1px`、Textarea 保留静态 `20px`，业务探针继续转换，主题仍与官方一致。

连续实验另有一项需要单独记录：修改 `src/app.css` 后，没有观察到预期的下一轮 Taro 构建完成事件，首次等待 90 秒超时。复跑时 CSS 单独变更等待 15 秒仍未触发，随后修改脚本成功触发第三轮构建；新增业务 `height:7px` 正确输出为 `7rpx`，上述原生固定 px 和主题断言继续通过。因此共完成首次加两轮增量的单位断言，但不能算作 CSS 独立触发增量通过，也尚不足以归因于候选 exclude。独立 CSS 监听仍属于未通过的验证项。

现有 [tests/node/tdesign-watch.test.mjs](../tests/node/tdesign-watch.test.mjs) 使用真实 Vite 和 Taro 原生生成器，但 fixture 未配置实际 pxtransform。它能覆盖资源存在、模板和连续重建保留，不能保护这次发现的单位语义。正式实施时应增加真实转换管线下的固定单位和业务单位对照断言。

研究中间记录位于 `.runtime/tdesign-unit-research/`：`audit.json`、`comparison.json`、`native-style-results.json`、`watch-results.json`、两组构建日志及 watch 日志。这些是本地研究产物，不随仓库提交；本文保留固定版本、配置、统计口径和验收边界。

## 正式实施时的验收范围

本轮仅形成研究报告，尚未修改正式配置或测试。若实施候选方案，需要同步小程序设计系统规范，并完成以下验收：

1. 给真实转换链路增加单位回归：Radio `3px`、分隔线 `1px`、Textarea `20px` 保留；业务 px 继续转换，rpx 不变；同时核对完整与连续 watch 产物。
2. 排查并验证单独修改业务 CSS 的监听行为，不能用脚本触发重建代替该项结论。
3. 正式 watch 需重新启动以加载配置，重新检查 Windows 同步产物；本次隔离实验不替代该步骤。
4. 在开发者工具 100% 预览和真机，比较 Radio 未选中边框、Input/Checkbox/列表分隔线及 Textarea 静态与 autosize 模式；覆盖亮暗主题及不同屏宽。
5. 保留对全局主题阴影、圆角和 Typography 特定形态的检查，区分规则恢复与实际可见变化。

本轮未改测试脚本、正式业务代码或依赖，未重新运行全仓重型门禁；既有门禁结果不作为候选配置已正式落地的证据。
