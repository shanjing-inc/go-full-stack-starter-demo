# Trellis Task 文档写作指南

> 目标：让 Trellis task 文档默认中文、短句、清楚可执行。

---

## 适用范围

以下文件默认遵守本指南：

- `{task}/prd.md`
- `{task}/design.md`
- `{task}/implement.md`
- `{task}/task.json` 中的 `title`、`description`、`notes`
- `implement.jsonl` 和 `check.jsonl` 中的 `reason`

---

## 基本规则

- 中文优先：标题、目标、需求、验收标准、执行步骤默认使用中文。
- 保留必要英文：命令、路径、文件名、类型名、API 名、错误码、框架名保持原文。
- 兼容模板字段：`Goal`、`Requirements`、`Acceptance Criteria` 等固定标题可以保留，字段正文使用中文。
- 短句表达：一句只说一个动作或一个判断。
- 直接说明结果：先写要达成什么，再写范围和约束。
- 少写模板腔：删除空泛背景、泛泛风险、重复说明和大段套话。
- 可验证：Acceptance Criteria 必须能通过命令、页面、接口、日志或文件 diff 核对。

---

## 字段写法

### 标题

用中文动宾短语，控制在 20 个字以内。

```md
优化队列 recent 筛选
补充任务文档写作规范
修复 GraphQL 分页参数
```

### Goal

用 1 段话说明“做什么、为什么、影响哪里”。

```md
通过 spec 固化 Trellis task 文档写作规则，让后续 `prd.md`、`design.md` 和 `implement.md` 默认中文、短句、清楚易读。
```

### Requirements

每条只写一个需求，使用可执行动词。

```md
- 新增 task 文档写作 guide。
- 将 guide 加入 frontend 最小 Trellis context。
- 提供晦涩写法到简洁中文的改写示例。
```

### Acceptance Criteria

每条只表达一个可验证结果。

```md
- [ ] AC-1: `.trellis/spec/guides/task-writing-guide.md` 存在，并包含中文优先规则。
- [ ] AC-2: `.trellis/spec/frontend/index.md` 引用 task writing guide。
```

### Implementation Steps

使用动作清单，按执行顺序写。

```md
- [ ] 新增 task writing guide。
- [ ] 更新 guides index。
- [ ] 更新 frontend 最小 context。
- [ ] 运行 `git diff --check`。
```

---

## 改写示例

### 示例 1：标题

晦涩写法：

```md
Add comprehensive documentation standards for Trellis task artifacts
```

简洁中文：

```md
补充 Trellis 任务写作规范
```

### 示例 2：描述

晦涩写法：

```md
This task aims to establish a more comprehensive and maintainable convention for future task artifacts so that all generated planning documents can be easier for reviewers and implementers to consume.
```

简洁中文：

```md
通过 spec 固化任务文档写作规则，让后续规划和交接更容易读。
```

### 示例 3：验收标准

晦涩写法：

```md
- [ ] The documentation update should provide enough clarity for future agents to understand how they are expected to produce task-related artifacts.
```

简洁中文：

```md
- [ ] AC-1: 新 guide 说明 task 文档默认使用中文和短句。
```

### 示例 4：执行步骤

晦涩写法：

```md
- [ ] Perform the necessary documentation updates across relevant Trellis specification surfaces to ensure that the new writing guidance is discoverable.
```

简洁中文：

```md
- [ ] 更新 guides index 和 frontend 最小 context。
```

---

## 自检清单

提交或交付前检查：

- [ ] 标题是中文短语。
- [ ] Goal 只有一段，直接说明目标和范围。
- [ ] Requirements 每条只表达一个需求。
- [ ] Acceptance Criteria 每条都能验证。
- [ ] 执行步骤使用短句动作清单。
- [ ] 英文只用于必要技术名词、命令、路径和 API 名。
- [ ] 删除了空泛背景、重复说明和模板腔。
