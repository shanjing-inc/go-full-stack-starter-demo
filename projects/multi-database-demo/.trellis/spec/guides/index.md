# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Guides

项目复用和发布前读 [Go Trellis 复用清单](./reuse-guide.md)。Shell 搜索优先 `rtk proxy rg`，不要照搬其他项目的路径或业务 API。

| Guide                                                         | Purpose                                  | When to Use                                                 |
| ------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)   | Identify patterns and reduce duplication | When you notice repeated patterns                           |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers    | Features spanning multiple layers                           |
| [TDD Thinking Guide](./tdd-thinking-guide.md)                 | 从 AC 派生测试并记录 RED/GREEN 证据      | 生产行为、公共契约、UI、GraphQL、queue/runtime、部署行为    |
| [Trellis Task 文档写作指南](./task-writing-guide.md)          | 让 task 文档默认中文、短句、清楚可执行   | 创建或维护 `prd.md`、`design.md`、`implement.md`、task 描述 |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches 3+ layers (API, Service, Component, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config**
- [ ] **You're creating a new utility/helper function** ← Search first!

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### 何时思考 TDD 证据

- [ ] 正在改动生产行为
- [ ] Acceptance Criterion 描述了可观察行为
- [ ] 正在改动 GraphQL schema/resolver/helper
- [ ] 正在改动 UI 交互、路由、状态、queue/runtime 行为、持久化或部署行为
- [ ] 外部依赖或生产限定依赖需要 manual 验证证据

→ 阅读 [TDD Thinking Guide](./tdd-thinking-guide.md)

### 何时检查 task 文档写法

- [ ] 正在创建或维护 Trellis task
- [ ] task 标题、描述或 AC 出现大段英文
- [ ] `prd.md`、`design.md` 或 `implement.md` 读起来晦涩
- [ ] `implement.jsonl` 或 `check.jsonl` 的 reason 过长

→ 阅读 [Trellis Task 文档写作指南](./task-writing-guide.md)

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
