# 协作约定

- 所有对话和文档使用中文。
- Shell 命令统一通过 `rtk` 执行；原始输出使用 `rtk proxy`。
- commit、push 分别取得用户明确授权，提交前核对工作树、暂存范围和验证结果。

## Go 测试固定布局

- Go 包级测试与被测业务源码保持同目录，文件名统一使用 `*_test.go`。
- 同包测试与外部 `包名_test` 测试均可使用，按现有私有／导出接口边界选择。
- 新增测试沿用业务目录；场景增多时在该目录内按功能拆分测试文件。
- 正式 Go 模块保持同目录布局；集中到模块级或仓库级 `tests/` 的结构调整须取得用户明确授权。
- fixture 沿用包内 `testdata/` 或既有共享 fixture 目录；路径调整须同步调用方和回归断言。
- 前端浏览器测试、历史 POC 与工具模块延续既有布局。
- 测试布局、命令和验收边界以工作区根目录的 `docs/go-test-layout.md` 为准。
- 修改测试相关脚本后运行 `rtk pnpm test`、`rtk pnpm check`、`rtk pnpm test:go:coverage`，记录环境依赖跳过项和独立专项验收范围。

## Trellis 项目约定

- 主仓任务在工作区根执行，先读 `.trellis/spec/index.md`；demo 内启动的应用任务用 `projects/multi-database-demo/.trellis`。涉及共享包、工具、发布的任务归主仓，不建两份同一任务。
- 发布保留源码工作区结构，构建命令始终在含 `go.work`、`package.json` 的工作区根目录执行。
- 改代码、目录、命令、接口时同步 spec；复用清单见 `.trellis/spec/guides/reuse-guide.md`。
- 自动提交关闭，commit、push 仍分别明确授权。用户已授权实现时继续规划、实施和验证，不重复询问开始。
- Codex 使用 inline 模式，不更改用户级 hooks 或信任配置。

<!-- TRELLIS:START -->

## Trellis 工作流

本项目使用 Trellis：`.trellis/workflow.md` 定义阶段；`.trellis/spec/` 提供按包/层的规范；`.trellis/tasks/` 保存任务；`.trellis/workspace/` 保存开发者日志。任务和日志不随 demo 发布。

主仓 `.agents/skills/`、`.codex/` 提供平台入口。优先使用可用平台命令；无平台命令时执行 `rtk proxy python3 .trellis/scripts/task.py --help`。独立 demo 使用通用脚本与 AGENTS 入口。

Trellis 初始化或更新后保留本文件的协作约定；运行上下文与已授权用户指令优先。

<!-- TRELLIS:END -->
