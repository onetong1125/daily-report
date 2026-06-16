# 📋 Daily Report

自动日报工具：聚合本地 Git、GitHub、Claude Code、Codex CLI 的每日活动，调用 LLM 生成日报和明日行动建议。

## 解决的问题

常常忘记今天做了什么、明天要从哪开始？`daily-report` 自动从你的工作痕迹中生成日报，帮你回顾一天、规划明天。

## 数据来源

| 来源 | 采集内容 |
|------|---------|
| **本地 Git** | 今日提交记录（commit SHA、message、作者） |
| **GitHub** | 今日 PR（创建/合并）、Issue、Review 活动 |
| **Claude Code** | 今日会话的话题摘要和活跃度 |
| **Codex CLI** | 今日会话的话题摘要和活跃度 |

## 安装

```bash
npm install -g daily-report
```

或本地开发：

```bash
git clone <repo-url>
cd daily-report
npm install
npm run release     # 编译 + 安装到全局
```

## 前置依赖

| 依赖 | 用途 | 必需？ |
|------|------|--------|
| `git` | 读取本地提交 | 是 |
| [`gh` CLI](https://cli.github.com/) | 读取 GitHub 活动 | 否（跳过 GitHub 部分） |
| LLM API Key | 生成 AI 摘要 | 否（回退到模板模式） |

## 快速开始

```bash
# 1. 交互式配置向导
daily-report setup

# 2. 生成今天的日报
daily-report

# 3. 预览采集到的数据（不调用 LLM）
daily-report --dry-run
```

## 命令参考

### 生成日报

```bash
daily-report                          # 生成今天的日报
daily-report --date 2026-06-01       # 指定日期
daily-report --tz Asia/Shanghai      # 指定时区
daily-report --dry-run               # 只采集数据，不调 LLM
daily-report --no-save               # 不保存 Markdown 文件
daily-report --quiet                 # 只保存文件，不打印
daily-report --todo "完成测试,提 PR"  # 手动补充明日计划
daily-report --verbose               # 详细日志
daily-report --max-retries 3         # LLM 调用最大重试次数，默认 5
```

### 配置管理

```bash
daily-report setup                   # 交互式配置向导
daily-report config show             # 查看当前配置
daily-report config repos            # 管理追踪仓库
daily-report config llm              # 修改 LLM 配置
daily-report config privacy          # 修改隐私设置
daily-report config schedule         # 修改定时设置
```

### 定时任务

```bash
daily-report schedule set "18:00 weekday"  # 工作日 18:00 自动生成
daily-report schedule set "0 18 * * 1-5"   # cron 表达式
daily-report schedule on                   # 启用定时
daily-report schedule off                  # 关闭定时
daily-report schedule status               # 查看状态
```

## 配置文件

配置保存在 `~/.daily-report/config.json`：

```json
{
  "repos": [
    "/path/to/your/project"
  ],
  "llm": {
    "provider": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "${OPENAI_API_KEY}",
    "model": "gpt-4o",
    "maxRetries": 5,
    "retryBaseDelayMs": 1000,
    "requestTimeoutMs": 30000
  },
  "report": {
    "outputDir": "~/.daily-report/reports",
    "printToTerminal": true,
    "timezone": "Asia/Shanghai"
  },
  "privacy": {
    "requireConfirmation": true,
    "maxTokensSent": 4096
  },
  "schedule": {
    "enabled": true,
    "cron": "0 18 * * 1-5"
  }
}
```

- `apiKey` 支持 `${ENV_VAR}` 语法从环境变量读取，避免密钥写入配置文件
- `baseUrl` 支持任意 OpenAI 兼容接口（含第三方中转站）
- `maxRetries` LLM 调用失败后的最大重试次数（指数退避：1s → 2s → 4s → 8s → 16s，上限 30s）
- `requestTimeoutMs` 单次 LLM 请求超时，默认 30s

## 安全与隐私

本工具访问的是你的本地私有数据（对话记录、代码提交、文件路径等），安全设计遵循以下原则：

- **原文不出本机**：代码片段、prompt 全文、对话 body 等敏感内容绝不传给 LLM
- **只传元数据和摘要**：LLM 收到的只有 commit SHA、PR 编号、话题关键词等白名单字段
- **可预览**：`--dry-run` 先看再决定是否调 LLM；`privacy.requireConfirmation` 开启后每次调 API 前需确认
- **白名单可控**：`privacy.allowedFields` 可自定义外传字段

详见 [设计文档 §4 安全与隐私设计](docs/superpowers/specs/2026-06-02-daily-report-design.md#4-安全与隐私设计)。

## 日报示例

```markdown
# 📋 日报 - 2026年6月2日（周二）

## TL;DR
- 在 project-a 中完成了 JWT refresh token 功能
- 修复了 RL-Nukplex 的 2 个训练 bug
- 与 Claude Code 讨论了日报工具的设计
- 明天: 补充测试用例、跑 RL 实验验证

## 💻 Git 活动
### project-a (3 commits)
| 提交 | 说明 |
|------|------|
| a1b2c3d | feat(auth): add JWT refresh token → PR #42 💬 Claude |

## 🌐 GitHub 活动
- project-a: 创建 PR #42、Review PR #39
- RL-Nukplex: 创建 PR #15 (Fix training instability)

## 🤖 Claude Code 对话
- myprojects: 讨论了日报工具需求和架构设计

## 📌 明日行动建议
1. project-a: 为 JWT refresh token 补充测试用例
2. RL-Nukplex: 验证 reward shaping 修复效果
```

## 技术栈

- **语言**：TypeScript
- **运行时**：Node.js ≥ 18
- **CLI 框架**：Commander.js + Inquirer.js
- **定时任务**：macOS launchd / Linux crontab

## 开发

```bash
git clone <repo-url>
cd daily-report
npm install

# 日常开发
npm run dev -- --dry-run    # tsx 实时执行源码，版本号实时读取 package.json
npm run build               # 编译 TypeScript → dist/
daily-report --version      # 查看全局命令版本（冻结在上次 release 时）

# 版本发布：将当前代码编译打包，安装为全局独立副本
npm run release             # = build + pack + install -g
```

### 版本机制

- `npm run dev` 运行时从项目 `package.json` 实时读取版本号，改动立刻生效。
- `daily-report` 全局命令读取的是发布时冻结的副本，与项目 `package.json` 脱钩。
- `npm run release` 将当前版本编译打包安装到全局，之后改 `package.json` 不影响全局命令。
- 发布前将本次更改记录到 [CHANGELOG.md](CHANGELOG.md)，并把 `Unreleased` 内容移动到对应版本号下。

## 许可证

MIT
