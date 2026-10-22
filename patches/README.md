# 工作区依赖安全补丁

主仓和独立应用的 `pnpm-workspace.yaml` 同时维护版本约束、`packageExtensions` 和 `patchedDependencies`，锁文件必须一起更新。补丁随应用源码交付；不要修改安装目录或在安装后运行临时替换脚本。

补丁统一放在应用根 `patches/`，属于 pnpm 工作区的安装输入。目前修复的依赖来自 Taro 4.3.0；pnpm 即使只安装 Web 也会读取这些文件。Docker Web 构建阶段只复制根元数据、`patches/`、`frontend/` 和 `share/`，`.dockerignore` 排除小程序目录，后端阶段的 `COPY .` 也不带入小程序；公共包升级生成锁文件的临时目录也复制 `patches/`。只移动补丁路径不会改变补丁内容或锁文件中的摘要。

- `download-git-repo@3.0.2.patch`：保留 Taro 使用的 callback、仓库来源解析、指定 revision、ZIP 解压及 strip 语义。移除未维护的 download/git-clone 依赖，使用 `@xhmikosr/downloader 16.3.1` 的安全解压链；将旧 HTTP／解压选项分别映射到 got/decompress。Git 克隆与 checkout 使用 execFile 参数数组，拒绝 URL／revision 的选项注入，不运行 shell。
- `@tarojs__vite-runner@4.3.0.patch`：以 `html-minifier-terser 7.2.0` 替代无安全版本的 html-minifier；压缩函数变成异步后，页面、base、递归组件、custom-wrapper 的 emit 全部等待压缩完成。页面循环改为顺序 for-of，保留原输出顺序。
- `braces@3.0.3.patch`：在解析花括号和括号时限制 AST 最大栈层数为 256，在递归 compile/expand/stringify 之前拒绝过深输入；普通模式和转义语义保持原样。关联 GHSA-vfj7-8cjw-p6xm；截至 2026-10-20，npm 尚未发布审计建议的 3.0.4，审计仍按 3.0.3 报告此项。没有设置审计忽略项。

其他精确父版本 override 修复 esbuild、adm-zip、glob、Swiper、静态文件服务、Terser 序列化及版本查询依赖链。它们只作用于已验证的 Taro 4.3.0 依赖；升级 Taro 后逐项核对上游实现并移除不再需要的约束，不能直接沿用到新版本。

回归入口：`pnpm --filter multi-database-demo-miniprogram test`，其中 `tests/node/dependency-security.test.mjs` 覆盖真实本地 ZIP 下载及路径穿越、指定分支克隆和命令注入、嵌套攻击、真实 Taro emit 异步压缩。验收同时执行两级冻结安装、两级 `pnpm audit`、两端 Codegen、Web 生产构建、小程序生产与 watch 增量构建；微信原生编译和真机继续作为独立环境专项。

移除补丁前先升级到上游已修复版本，再运行上述回归及原始审计；不能仅删除补丁或屏蔽对应 GHSA。

嵌套攻击对照验证：未打补丁的 3.0.3 在 4,999 层花括号的 compile 调用中触发 `RangeError: Maximum call stack size exceeded`；补丁版本对同一输入在 parse 阶段抛出明确的 `SyntaxError`，compile／expand 入口均有回归断言。
