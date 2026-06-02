# Daily Report - 设计文档

> 自动日报工具：聚合本地 Git、GitHub、Claude Code、Codex CLI 的每日活动，生成日报和明日行动建议。

**创建日期**: 2026-06-02
**状态**: 设计中

---

## 1. 项目概述

### 1.1 目标

帮助用户自动生成每日工作报告，解决"忘记今天做了什么、不知道明天从哪开始"的问题。

### 1.2 核心功能

- 读取本地 Git 仓库的今日提交
- 通过 `gh` CLI 读取 GitHub 今日活动
- 读取 Claude Code 今日会话详情
- 读取 Codex CLI 今日会话详情
- 调用 LLM API 自动生成日报摘要和明日行动建议
- 终端打印 + 保存为 Markdown 文件
- 支持手动命令触发和定时自动生成

---

## 2. 架构设计

### 2.1 方案选择

选择**方案 A：独立 CLI 工具**（Node.js / TypeScript），理由：
- 独立运行，不依赖 Claude Code 是否开启
- 适合 cron 定时任务
- 结构清晰，易测试维护

### 2.2 目录结构

**项目源码：**
```
daily-report/                       # 项目根目录
├── src/
│   ├── index.ts                 # CLI 入口，解析参数
│   ├── config.ts                # 读取/管理用户配置
│   ├── setup.ts                 # 交互式配置向导
│   ├── timeboundary.ts          # 时间边界计算（统一 timezone + 半开区间）
│   ├── collectors/
│   │   ├── git-collector.ts     # 扫描本地 Git 仓库的今日提交
│   │   ├── github-collector.ts  # 通过 gh CLI 获取 GitHub 活动
│   │   ├── claude-collector.ts  # 读取 ~/.claude/projects/ 会话详情
│   │   └── codex-collector.ts   # 读取 ~/.codex/sessions/ 会话详情
│   ├── sanitizer.ts             # 校验 SanitizedEvent schema，裁剪非白名单字段
│   ├── merger.ts                # 实体级去重 + 交叉引用
│   ├── generator.ts             # 调用 LLM API 生成日报
│   ├── formatter.ts             # 终端输出 + Markdown 文件
│   └── scheduler.ts             # 定时任务管理
├── package.json
└── tsconfig.json
```

**用户数据目录（`~/.daily-report/`）：**
```
~/.daily-report/
├── config.json                  # 用户配置文件
├── reports/                     # 生成的日报 Markdown 文件
│   └── 2026-06-02.md
└── logs/                        # 定时任务执行日志
```

### 2.3 数据流

```
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │Git Collector│ │GitHub Coll.│ │Claude Coll.│ │Codex Coll.│
        └─────┬────┘ └────┬─────┘ └────┬─────┘ └─────┬────┘
              │           │            │              │
              └───────────┴────────────┴──────────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │   Sanitizer    │  ← 本机脱敏：只保留白名单字段
                     │ (安全章节 4)    │
                     └───────┬────────┘
                             │
                             ▼
                     ┌────────────────┐
                     │    Merger      │  ← 本机去重：实体级归因和交叉引用
                     │ (去重章节 6)    │
                     └───────┬────────┘
                             │
                             ▼
                     ┌────────────────┐
                     │    LLM API     │
                     │  生成日报摘要    │
                     │  + 明日建议     │
                     └───────┬────────┘
                             ▼
                     ┌────────────────┐
                     │ 终端打印 + 文件  │
                     └────────────────┘
```

---

## 3. 配置设计

### 3.1 配置文件（`~/.daily-report/config.json`）

```json
{
  "repos": [
    "/Users/xuyitong/myprojects/project-a",
    "/Users/xuyitong/Research/RL-Nukplex"
  ],
  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "${OPENAI_API_KEY}",
    "model": "gpt-4o"
  },
  "report": {
    "outputDir": "~/.daily-report/reports",
    "printToTerminal": true,
    "timezone": "Asia/Shanghai"
  },
  "privacy": {
    "requireConfirmation": true,
    "maxTokensSent": 4096,
    // allowedFields 对齐 SanitizedEvent schema 的字段名（见 §4.3）
    // 不在列表中的字段在 sanitize 阶段被删除，不会进入 LLM prompt
    "allowedFields": ["source", "repo", "timestamp", "entity_id", "entity_type",
                      "summary", "related_entities", "author", "state", "message_count"]
  },
  "schedule": {
    "enabled": true,
    "cron": "0 18 * * 1-5"
  }
}
```

### 3.2 LLM 配置

- `provider` — 适配器模式，支持 `openai-compatible`、`anthropic` 等
- `baseUrl` — 自由指向任何兼容接口（中转站、自建代理等）
- `apiKey` — 支持 `${ENV_VAR}` 语法从环境变量读取
- `model` — 用户自主指定模型名

### 3.3 交互式配置向导

运行 `daily-report setup` 启动四步向导：

1. **选择追踪仓库** — 自动扫描本地 Git 仓库，用户勾选
2. **配置 AI 模型** — 选择 API 类型、填写地址/Key/模型名
3. **配置定时任务** — 是否启用、时间、频率（工作日/每周/自定义）
4. **确认保存** — 展示配置摘要，确认后写入

辅助命令：
- `daily-report config repos` — 随时增删追踪仓库
- `daily-report config llm` — 修改模型配置
- `daily-report config schedule` — 修改定时设置

---

## 4. 安全与隐私设计

### 4.1 核心原则：原文不出本机，只传摘要和元数据

所有收集器采集的是**用户本地私有数据**（对话记录、代码提交、文件路径等）。绝对不能将原始内容直接外送 LLM。

### 4.2 数据分级

| 级别 | 定义 | 示例 | 处理方式 |
|------|------|------|---------|
| **A - 白名单字段** | 无敏感性的结构化元数据 | 提交 hash、作者名、时间戳、仓库名、会话 ID、PR 编号 | 直接传给 LLM |
| **B - 需摘要字段** | 可能含敏感信息但日报需要其语义 | commit message、PR 标题、对话话题、文件路径 | **本机提取主题/关键词**，只将摘要传给 LLM |
| **C - 禁止外传** | 明文敏感内容 | 代码片段、prompt 全文、API key、数据库连接串、对话 body | **绝对不传 LLM**，只在本地用规则提取所需信号（如活跃度、话题分类） |

### 4.3 统一外传 Schema：SanitizedEvent

所有收集器产出的数据都归一化为 `SanitizedEvent`，sanitizer 强制校验字段，不在白名单中的字段在进入 LLM 前被删除。

```typescript
// 所有收集器输出归一化为这个类型，sanitizer 据此裁剪
type SanitizedEvent = {
  source: "git" | "github" | "claude" | "codex";  // 来源标识
  // --- 通用标识字段 ---
  repo: string;                                     // 关联的仓库路径或 owner/repo
  timestamp: string;                                // ISO 8601 UTC
  // --- 实体 ID（用于去重） ---
  entity_id: string;                                // commit SHA / PR number / session ID 等
  entity_type: "commit" | "pr" | "issue" | "review" | "session";
  // --- 摘要字段（B 级，本机提取后外传） ---
  summary: string;                                  // 一句话摘要（commit subject / PR 标题 / 对话话题）
  // --- 关联信息 ---
  related_entities: string[];                       // 交叉引用：关联的其他 entity_id
  // --- 元数据 ---
  author?: string;                                  // Git 作者 / GitHub 用户
  state?: string;                                   // PR/Issue 状态 (open/merged/closed)
  message_count?: number;                           // 仅对话类：消息条数
};
```

**各收集器的采集 → 映射规则：**

| 收集器 | source | entity_type | entity_id | summary 来源 | ❌ 禁止外传 |
|--------|--------|-------------|-----------|-------------|------------|
| Git | `git` | `commit` | 完整 SHA | commit message subject（本机截断 80 字符） | diff 内容、完整 body |
| GitHub PR | `github` | `pr` | PR number | PR 标题 | PR body、代码 diff |
| GitHub Issue | `github` | `issue` | Issue number | Issue 标题 | Issue body |
| GitHub Review | `github` | `review` | Review ID | "Reviewed: <PR 标题>" | review comment 正文 |
| GitHub Merged PR | `github` | `pr` | PR number | PR 标题，state=`merged` | — |
| Claude | `claude` | `session` | session ID | 本机提取的话题关键词拼接 | 消息全文、tool call、代码 |
| Codex | `codex` | `session` | session ID | 本机提取的话题关键词拼接 | 消息全文、tool call、代码 |

**话题提取规则（Claude / Codex 本机处理）：**
- 不调 LLM，用简单策略：从 user 消息中提取 3-5 个频繁出现的技术关键词（文件名、技术术语）
- 拼接为 `summary` 字段，如 `"讨论了 daily-report 工具的需求、架构设计和安全方案"`
- 原始消息全文留在本机，永不出 `SanitizedEvent`

### 4.4 用户控制

- `daily-report` 生成前展示将要发送给 LLM 的摘要数据，用户确认后再调 API
- 增加 `--dry-run` 参数：只展示收集到的本地数据摘要，不调用 LLM
- 配置中增加 `privacy.maxTokensSent` 限制每次发送给 LLM 的总 token 数
- 配置中增加 `privacy.allowedFields` 白名单，高级用户可以自定义外传字段

### 4.5 数据保留策略

- 原始会话数据（Claude/Codex 的 .jsonl 文件）永不出本机
- 日报文件（Markdown）存在本地 `~/.daily-report/reports/`，用户自行管理
- 不将任何数据上传到云端或第三方服务（LLM API 调用除外，且已脱敏）

---

## 5. 数据采集设计

### 5.1 时间边界定义

所有收集器遵循统一的时间边界规则，整个系统只从一个来源获取时区：

**唯一时区来源**: `config.report.timezone`（默认值由首次 `daily-report setup` 时从本机 `Intl.DateTimeFormat().resolvedOptions().timeZone` 推导并写入配置文件，后续不再读本机时区）。

**日期 → 时间范围的映射规则：**

`--date 2026-06-02`（或不传 `--date`，取执行当天的日期字符串）映射为**半开区间**：

```
config.report.timezone = "Asia/Shanghai"
日期: 2026-06-02
→ [startUtc, endUtc) = [2026-06-01T16:00:00Z, 2026-06-02T16:00:00Z)
```

**为什么用半开区间**：`[start, end)` 是时间范围的标准表示，避免 `23:59:59` 的精度争议（闰秒、亚秒级时间戳），且 `git log --since=A --until=B` 的语义也是 `[A, B)`。

**`--tz` 参数**：临时覆盖时区，不修改配置文件，仅本次执行生效。

**跨午夜处理**：所有收集器内部统一用 UTC 存储中间数据，定时任务不依赖执行环境的 `TZ` 变量，始终读 `config.report.timezone`。

**各数据源的时间边界使用同一组 `[startUtc, endUtc)` 计算值** — Git、GitHub 全都用这一对边界，不各自推算。

### 5.2 Git Collector

- 扫描 `config.repos` 列表中的每个仓库
- 使用 `timeBoundary()` 计算出的 UTC 边界构造 `git log` 命令（`git log --since/--until` 接受 ISO 8601 时间戳，天然支持半开区间 `[A, B)`）：
  ```
  # 示例: timezone="Asia/Shanghai", date="2026-06-02"
  # startUtc="2026-06-01T16:00:00Z", endUtc="2026-06-02T16:00:00Z"
  git log --since="2026-06-01T16:00:00Z" \
          --until="2026-06-02T16:00:00Z" \
          --format="%H|%s|%an|%aI" --all
  ```
- 输出字段：完整 SHA (`%H`)、subject (`%s`)、作者 (`%an`)、ISO 时间 (`%aI`)
- 映射到 `SanitizedEvent {source:"git", entity_type:"commit", entity_id:<SHA>, summary:<subject>, ...}`
- 有提交的仓库纳入日报，无提交的静默跳过
- ❌ 不读 diff、不读完整 commit body

### 5.3 GitHub Collector

**主数据源：按仓库精确查询**

GitHub Events API 有著名限制（最多 300 条、5min-6h 延迟、仅保留 90 天），不适合作为"今日活动"的准确来源。重新设计为：

1. 对 `config.repos` 中每个仓库，从其 `git remote` URL 提取 owner/repo 名（如 `git@github.com:user/repo.git` → `user/repo`），或由用户在配置中手动指定映射
2. 使用 `timeBoundary()` 计算出的 UTC 边界 `[startUtc, endUtc)`，对每个仓库发起以下查询。所有查询使用同一组 `startUtc`/`endUtc`：

```
# 1. 今日创建的 PR
gh search prs --repo owner/repo --created $(today) \
    --json number,title,state,url,createdAt,mergedAt

# 2. 今日合并的 PR (通过搜索 closed+merged，再过滤 mergedAt 在今日范围)
gh search prs --repo owner/repo --merged  \
    --merged-at "$(today)" \
    --json number,title,state,url,mergedAt

# 3. 今日创建或更新的 Issue
gh search issues --repo owner/repo --updated $(today) \
    --json number,title,state,url,updatedAt

# 4. 今日的 Review 活动 — 先获取今日活跃的 PR，再逐个拉 review 列表
gh pr list --repo owner/repo --search "updated:$(today)" --json number
# 对上面拿到的每个 PR number:
gh api "repos/owner/repo/pulls/$num/reviews" --jq '.[] | select(.submitted_at >= "$startUtc")'

# 5. 今日用户自己的 commit（GH 的 commit API 用 author 过滤）
gh api "repos/owner/repo/commits?since=$startUtc&until=$endUtc&author=$(gh api user --jq .login)"
```

3. 查询结果映射到 `SanitizedEvent`，按 entity_type 标注：
   - 新建 PR → `{source:"github", entity_type:"pr", summary:<标题>, state:"open"}`
   - 合并 PR → `{source:"github", entity_type:"pr", summary:<标题>, state:"merged"}`
   - Issue → `{source:"github", entity_type:"issue", summary:<标题>}`
   - Review → `{source:"github", entity_type:"review", summary:"Reviewed: <PR 标题>", related_entities:[<PR number>]}`
4. **Events API 降级为补充信号** — 仅用于发现跨仓库活动（如给别人的 repo 提 PR、star/fork 等），不作为仓库内活动的主数据源
5. 按仓库聚合，提取关键活动摘要

**注意**: GitHub 搜索索引有分钟级延迟。对于傍晚生成的日报，建议用户将定时任务设在 19:00 之后，给索引留出缓冲时间。

### 5.4 Claude Collector

- 读取 `~/.claude/projects/<project>/<sessionId>.jsonl`
- **解析策略**：Claude 的 session 文件无 `session_meta` 类型（那是 Codex 的概念）。采集器逐行扫描文件：
  - 取**第一条同时含 `timestamp` 和 `cwd` 的记录**（通常是 `user` 或 `system` 类型的首条消息）作为 session 起点，提取项目路径和会话日期
  - 文件首条记录可能是 `last-prompt`，不含 `timestamp`/`cwd`，直接跳过
  - 统计 `user` 和 `assistant` 消息的数量
- 按 `timestamp` 判断会话是否落在今日范围内
- 映射到 `SanitizedEvent {source:"claude", entity_type:"session", entity_id:<sessionId 文件名前缀>, ...}`
- **话题提取在本机完成**（简单正则 + 关键词匹配），不调 LLM，只将关键词拼接写入 `summary` 字段
- ❌ 禁止外传：消息正文、tool call 参数和内容、生成的代码

### 5.5 Codex Collector

- 读取 `~/.codex/sessions/<year>/<month>/<day>/` 下的会话文件
- 每个 session 文件的首条 `session_meta` 记录含 `cwd` 和 `timestamp`
- 按日期过滤今日会话
- **仅提取白名单字段**：项目路径、会话 ID、消息数量、活跃时间段
- **话题提取在本机完成**，同 Claude 策略
- ❌ 禁止外传：消息正文、tool call 内容、生成的代码

---

## 6. 数据合并与去重

### 6.1 问题描述

同一个工作活动可能在多个数据源中出现：
- 本地 `git commit` → GitHub Push 事件 → Claude 对话中讨论过这个修改
- GitHub 创建 PR → GitHub Events 中出现 → Codex 中讨论过 PR 内容

如果不做去重，日报会在「Git 活动 / GitHub 活动 / 对话摘要」三个板块中重复描述同一件事。

### 6.2 实体级去重规则

日报的归因策略是**一个活动只出现在一个主板块**，按优先级分配：

| 实体/活动 | 主板块 | 去重依据 | 补充/关联板块 |
|-----------|--------|---------|-------------|
| Git commit | Git 活动 | commit SHA | GitHub 活动（仅标记 "已 Push"），对话中标注 commit SHA |
| GitHub PR（创建/合并） | GitHub 活动 | PR number | 对话中标注 PR number |
| GitHub Issue | GitHub 活动 | Issue number | 对话中标注 Issue number |
| GitHub PR Review | GitHub 活动 | Review ID | — |
| Claude/Codex 会话 | 对应对话板块 | session ID | 若对话中引用了 commit/PR，在 Git/GitHub 板块标注 "💬 讨论过" |

### 6.3 合并处理流程

在采集完成之后、调用 LLM 之前，增加一个 `Merger` 步骤：

```
所有收集器输出
      │
      ▼
┌──────────────┐
│   Merger     │
│ 1. 提取所有  │
│    entity IDs│
│ 2. 按规则分配│
│    主板块     │
│ 3. 建立交叉  │
│    引用      │
└──────┬───────┘
       │
       ▼
  去重后的结构化数据
       │
       ▼
  传给 LLM Generator
```

### 6.4 示例

去重前（原始数据）：
```
Git:     [a1b2c3d] feat(auth): add JWT refresh token
GitHub:  Push event - a1b2c3d to project-a
GitHub:  PR #42 created "JWT refresh token"
Claude:  在 project-a 中讨论了 JWT refresh token 的实现方案
```

去重后（日报输出）：
```
Git 活动:
  project-a (1 commit)
  a1b2c3d feat(auth): add JWT refresh token  → PR #42  💬 讨论过

GitHub 活动:
  project-a: 创建了 PR #42 (JWT refresh token)

Claude 对话:
  project-a: 讨论 JWT refresh token 实现方案 (关联 commit a1b2c3d, PR #42)
```

同一件事不再重复描述，而是通过交叉引用展示完整脉络。

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|---------|
| 某个仓库不存在/无权限 | 跳过该仓库，日报中标注 `⚠️ 无法访问` |
| `gh` CLI 未安装/未认证 | 跳过 GitHub 部分，标注 `⚠️ gh 不可用` |
| 某个收集器完全失败 | 其他收集器继续工作，不阻断整体流程 |
| LLM API 调用失败 | 回退到纯模板生成，不依赖 AI |
| 今日无任何活动 | 友好提示 "今天没有活动记录，享受休息日 ☀️" |

**原则：任何一个数据源挂了，不影响其他数据源，也不影响日报生成。**

---

## 8. CLI 命令设计

```bash
# 生成今天的日报
daily-report

# 生成指定日期的日报
daily-report --date 2026-06-01

# 指定时区
daily-report --tz Asia/Shanghai

# 预览模式：只展示收集和脱敏后的数据，不调用 LLM
daily-report --dry-run

# 只打印到终端，不保存文件
daily-report --no-save

# 只保存文件，不打印
daily-report --quiet

# 手动补充明天的计划
daily-report --todo "完成认证模块测试, 跑 RL 实验"

# 交互式配置向导
daily-report setup

# 配置子命令
daily-report config repos          # 管理追踪仓库
daily-report config llm            # 修改模型配置
daily-report config privacy        # 修改隐私/安全设置
daily-report config schedule       # 修改定时设置
daily-report config show           # 查看当前配置

# 定时任务
daily-report schedule on           # 启用定时
daily-report schedule off          # 关闭定时
daily-report schedule set "18:00 weekday"   # 设置时间（支持 cron 或友好语法）
```

---

## 9. 定时任务设计

### 9.1 设置方式

支持两种语法指定时间：

```bash
daily-report schedule set "0 18 * * 1-5"     # cron 表达式
daily-report schedule set "18:00"            # 每天 18:00
daily-report schedule set "18:00 weekday"    # 仅工作日 18:00
```

### 9.2 底层实现

- **macOS**: 使用 `launchd` 注册定时任务
- **Linux**: 在用户 `crontab` 中添加
- 执行日志写到 `~/.daily-report/logs/`

---

## 10. 日报输出模板

```markdown
# 📋 日报 - 2026年6月2日（周一）

## TL;DR
- 完成了 project-a 的用户认证模块重构
- 修复了 RL-Nukplex 的 2 个训练 bug
- 和 Claude Code 讨论了日报工具的设计方案
- **明天**: 继续用户认证的测试用例 + RL 实验调参

---

## 💻 Git 活动

### project-a (3 commits)
| 提交 | 说明 |
|------|------|
| `a1b2c3d` | feat(auth): add JWT refresh token → PR #42  💬 Claude |
| `e4f5g6h` | refactor(auth): extract middleware |
| `i7j8k9l` | fix(auth): token expiry check |

---

## 🌐 GitHub 活动
- **project-a**: 创建 PR #42 (JWT refresh token) → commit `a1b2c3d`
- **project-a**: 合并 PR #38 (Fix login redirect) 
- **project-a**: Review 了 PR #39、PR #40
- **RL-Nukplex**: 创建 PR #15 (Fix training instability)

---

## 🤖 Claude Code 对话
- **myprojects (日报工具)**: 讨论了日报工具需求和架构 → 关联 PR #42
- **RL-Nukplex**: 分析训练不稳定问题

---

## 🤖 Codex 对话
- **myprojects**: 无今日活动

---

## 📌 明日行动建议
1. **project-a**: 为 JWT refresh token 补充测试用例
2. **RL-Nukplex**: 验证 reward shaping 修复效果，跑一轮实验
3. **日报工具**: 开始实现数据收集器
```

---

## 11. 技术选型

- **语言**: TypeScript
- **运行时**: Node.js
- **CLI 框架**: Commander.js（参数解析）+ Inquirer.js（交互式向导）
- **LLM 调用**: 基于 OpenAI 兼容接口，使用 `fetch` 直接调用
- **定时任务**: macOS launchd / Linux crontab
- **包管理**: npm，全局安装

---

## 12. 未来扩展（不在本阶段）

- 支持更多 Git 平台（GitLab、Gitee）
- 支持更多 AI 工具（Windsurf、Cursor 等）
- 日报趋势分析（周报、月报）
- Web Dashboard 可视化
- 多语言日报（中英文切换）
