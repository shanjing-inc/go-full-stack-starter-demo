# TDD 思考指南

> **目标**：把 Acceptance Criteria 转成可执行测试，并留下可复查的 RED/GREEN 证据。

---

## 使用时机

任务改动生产行为、公共契约、GraphQL schema/resolver、UI 交互、queue/runtime 行为、持久化逻辑，或带有可观察结果的部署脚本时，使用本指南。

---

## Step 1：从 AC 派生测试

实现前先建立 AC 映射：

| AC   | 行为                   | 测试层级                          | 文件或命令     | 期望证据             |
| ---- | ---------------------- | --------------------------------- | -------------- | -------------------- |
| AC-1 | 用户可见行为或契约行为 | unit / integration / e2e / manual | 目标文件或命令 | RED 失败、GREEN 通过 |

逐条 AC 回答这些问题：

- 哪个精确行为可以证明该 AC？
- 哪个输入、请求或用户动作会触发该行为？
- 哪个输出、状态变化、响应、日志或持久化记录可以证明结果？
- 哪个边界场景最容易破坏同一个承诺？
- 现有哪个测试文件最接近这个行为？

---

## Step 2：选择测试层级

| 层级        | 适用场景                                                     | 证据                               |
| ----------- | ------------------------------------------------------------ | ---------------------------------- |
| unit        | 纯 helper、parser、loader、request client、错误映射          | 聚焦的 Vitest 失败/通过            |
| integration | 组件交互、带真实 shape 的 GraphQL helper、queue/runtime 协作 | Vitest + 真实依赖或贴近边界的 mock |
| e2e         | 浏览器路由、多步骤 UI 流程、路由、auth 可见页面行为          | Playwright 失败/通过               |
| manual      | 外部服务、生产限定检查、视觉检查、一次性运维验证             | 命令、环境、输入、观察结果         |

选择规则：

- 优先选择能证明 AC 契约的最低测试层级。
- 风险位于 component、API、database、queue、generated type 边界时，增加 integration 覆盖。
- 关键用户流程和路由行为增加 e2e 覆盖。
- 依赖外部系统或生产限定状态的行为使用 manual 验证，并记录足够细节，方便维护者复现。

---

## Step 3：记录 RED

生产代码改动前：

- 运行覆盖新增或更新测试的最小命令。
- 记录命令。
- 记录失败测试名称。
- 记录失败断言或错误摘要。
- 确认失败信号对应 AC 映射里的行为缺口。
- 每条 AC 都要在 RED、GREEN、BASELINE/GUARD 或 MANUAL 证据中出现。
- 已经存在且本任务需要保持的行为，记录为 BASELINE/GUARD 通过信号。

证据格式：

```text
RED:
Command: rtk pnpm test:go
Failure: Example behavior > returns filtered rows
Signal: expected 2 rows, received 3
AC: AC-1 filtered query returns only matching records

BASELINE / GUARD:
Command: rtk pnpm test:go
Pass: Example behavior > keeps default sorting
AC: AC-2 existing default sorting remains unchanged
```

---

## Step 4：达到 GREEN

RED 信号有效后：

- 实现满足映射 AC 的最小行为变化。
- fixtures 和 mocks 对齐现有测试模式。
- 运行 RED 阶段同一条命令。
- 记录通过输出摘要。
- 变更涉及 generated types、schema、route 行为、queue runtime、部署脚本或 shared helper 时，运行更宽的检查命令。

证据格式：

```text
GREEN:
Command: rtk pnpm test:go
Pass: 1 file, 3 tests
Follow-up Gate: rtk pnpm check
```

---

## Step 5：带证据重构

GREEN 后：

- 清理修复过程中出现的重复 setup。
- 调整 helper、变量或测试描述命名。
- 收紧类型和断言，让它们更直接表达 AC。
- 每个有意义的重构步骤后重新运行相关测试。
- 最终 diff 保持在 PRD 和 AC 映射范围内。

---

## 测试质量自检

交付前检查：

- [ ] 每条 AC 映射到至少一个自动化或 manual 验证项。
- [ ] 每条 AC 都出现在 RED、GREEN、BASELINE/GUARD 或 MANUAL 证据中。
- [ ] 每个自动化测试能针对目标行为失败。
- [ ] 测试名称描述用户可见行为或契约行为。
- [ ] 断言检查可观察输出、持久化状态、响应 shape、Go 错误/公开协议错误 或 DOM 状态。
- [ ] mock 表达 AC 关心的依赖边界。
- [ ] fake timers、globals、env stubs、storage 和 module cache 已重置。
- [ ] RED 和 GREEN 输出已记录在任务报告或验证记录中。
- [ ] 更宽的质量门禁匹配本次改动影响范围。

---

## Go 工作区映射

| 改动                         | 主测试                     | 额外检查                                  |
| ---------------------------- | -------------------------- | ----------------------------------------- |
| Go resolver/service/protocol | 同目录 `*_test.go`         | `rtk pnpm generate`、Go vet、应用类型检查 |
| React 公共组件/adapter       | 本包既有源码旁单测         | `rtk pnpm test:ui`、应用类型检查          |
| React 路由/会话交互          | 受影响单测及 Playwright    | 独立服务/浏览器环境                       |
| Queue/runtime                | 包内 Go 测试               | 隔离 Redis/数据库、退出清理证据           |
| HTTP/GraphQL 传输            | Go httptest 与协议 fixture | 状态码、响应形状、权限、脱敏              |
| 发布脚本/模板                | 隔离 Git/导出集成回归      | 格式、语法、导出包入口；真实发布另记录    |
