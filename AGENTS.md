<!-- PROJECT:START -->

# Multi Database Demo 协作约定

- 对话与项目文档用中文；Shell 通过 rtk，原始输出用 rtk proxy。
- 本目录是独立应用发布根，布局为 app-layout-v2：Go 模块在 backend，共享协议在 share/schema，容器配置在 docker；构建/生成/迁移/开发/测试在本目录执行，使用自己的 package.json/lockfile/toolchain，Go 使用 GOWORK=off。
- 主仓 demo 通过 STARTER_TOOL_MODE=auto/source/package 选择工具，auto 核实主仓归属后读取本地源码，独立应用和正式验收使用固定包；tools:info 查看实际来源。Go kit、Dashboard 和 devtools 固定真实可获取版本与完整性；禁止复制主仓 packages/tools/poc 或添加相邻目录 replace。
- 本 `.trellis` 管应用任务；共享包、工具、发布回工作区根使用根 Trellis，同一任务不建两份。
- 先读 `.trellis/spec/index.md` 和相关 backend/frontend、reuse-guide；代码/目录/命令/接口变化同步 spec。
- Go 测试同目录 \*\_test.go；前端测试统一放在 frontend/tests，按 unit/node/types 分类，浏览器测试使用 tests/\*.spec.ts；fixture 隔离，生成物不手改。
- commit、push 分别明确授权，自动提交关闭；用户已授权实现时继续规划、实现和验证，不重复询问开始。
- .env/运行环境保存 DB/Redis/认证密钥，不入规范/版本库；权限同时在 Go 服务执行。

<!-- PROJECT:END -->

<!-- TRELLIS:START -->

## Trellis 入口

`.trellis/workflow.md` 为工作流，`.trellis/spec` 为规范，`.trellis/scripts` 为通用脚本。首次使用后创建 tasks/workspace，发布不携带上游任务/日志/身份。

从本目录执行 `rtk proxy python3 .trellis/scripts/get_context.py --mode packages`、`rtk proxy python3 .trellis/scripts/task.py current --source`。需要日志时执行 `rtk proxy python3 .trellis/scripts/init_developer.py <姓名>`，不继承上游身份。

有平台命令时优先使用；无平台命令可用通用脚本。运行上下文和已授权用户指令优先。

<!-- TRELLIS:END -->
