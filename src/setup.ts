import inquirer from "inquirer";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DailyReportConfig } from "./types";
import { loadConfig, saveConfig } from "./config";
import { getScheduleTimeInputError, parseTimeExpression, scheduleOn } from "./scheduler";

/**
 * Scan for Git repositories under common parent directories.
 */
function scanGitRepos(): string[] {
  const homeDir = os.homedir();
  const found: string[] = [];
  const seen = new Set<string>();

  try {
    // Scan home directory up to 4 levels deep for .git directories.
    // Filter out hidden/system directories to keep the list manageable.
    const result = execSync(
      `find "${homeDir}" -maxdepth 4 -name ".git" -type d 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, stdio: "pipe" }
    ).trim();

    for (const gitDir of result.split("\n")) {
      if (!gitDir) continue;
      const repoPath = path.dirname(gitDir);

      // Skip hidden/system directories at any path segment
      const segments = repoPath.split(path.sep);
      if (segments.some((seg) => seg.startsWith("."))) continue;

      // Skip well-known system/library paths
      if (repoPath.startsWith("/System/") || repoPath.startsWith("/Library/")) continue;

      if (!seen.has(repoPath)) {
        seen.add(repoPath);
        found.push(repoPath);
      }
    }
  } catch {
    // skip if find fails
  }

  return found.sort();
}

/**
 * Interactive setup wizard (spec §3.3).
 */
export async function runSetup(): Promise<void> {
  console.log("\n📋 欢迎使用日报工具！让我们完成初始化...\n");

  const existingConfig = loadConfig();

  // Step 1: Repos
  console.log("▸ 步骤 1/4: 配置追踪仓库\n");
  const foundRepos = scanGitRepos();

  const repoAnswer = await inquirer.prompt<{ repos: string[] }>([
    {
      type: "checkbox",
      name: "repos",
      message: "请选择要追踪的 Git 仓库（空格选中，回车确认）:",
      choices: [
        ...foundRepos.map((r) => ({
          name: r.replace(os.homedir(), "~"),
          value: r,
          checked: existingConfig.repos.includes(r),
        })),
        new inquirer.Separator(),
        { name: "手动输入路径", value: "__custom__" },
      ],
      pageSize: 15,
      loop: false,
    },
  ]);

  let repos = repoAnswer.repos.filter((r) => r !== "__custom__");

  if (repoAnswer.repos.includes("__custom__")) {
    const customAnswer = await inquirer.prompt<{ path: string }>([
      {
        type: "input",
        name: "path",
        message: "请输入仓库路径（多个用逗号分隔）:",
        validate: (input: string) => input.trim().length > 0 || "路径不能为空",
      },
    ]);
    const customRepos = customAnswer.path
      .split(",")
      .map((p) => p.trim().replace(/^~/, os.homedir()))
      .filter((p) => p.length > 0);
    repos = [...repos, ...customRepos];
  }

  // Step 2: LLM Config
  console.log("\n▸ 步骤 2/4: 配置 AI 模型\n");

  const llmAnswer = await inquirer.prompt<{
    provider: string;
    baseUrl: string;
    model: string;
    apiKey: string;
  }>([
    {
      type: "list",
      name: "provider",
      message: "请选择 API 类型:",
      choices: [
        { name: "OPENAI 模式（/chat/completions 端点）", value: "openai-compatible" },
        { name: "ANTHROPIC 模式（/v1/messages 端点）", value: "anthropic" },
      ],
      default: existingConfig.llm.provider,
    },
    {
      type: "input",
      name: "baseUrl",
      message: "API 地址:",
      default: (answers: any) => {
        if (existingConfig.llm.baseUrl) return existingConfig.llm.baseUrl;
        return answers.provider === "anthropic"
          ? "https://api.anthropic.com"
          : "https://api.openai.com/v1";
      },
    },
    {
      type: "input",
      name: "model",
      message: "模型名称:",
      default: (answers: any) => {
        if (existingConfig.llm.model) return existingConfig.llm.model;
        return answers.provider === "anthropic"
          ? "claude-sonnet-4-6"
          : "gpt-4o";
      },
    },
    {
      type: "password",
      name: "apiKey",
      message: "API Key（支持 ${ENV_VAR} 引用环境变量）:",
      mask: "*",
      default: existingConfig.llm.apiKey || "${OPENAI_API_KEY}",
    },
  ]);

  // Step 3: Schedule
  console.log("\n▸ 步骤 3/4: 配置定时任务\n");

  const scheduleAnswer = await inquirer.prompt<{
    enabled: boolean;
    time: string;
    frequency: string;
  }>([
    {
      type: "confirm",
      name: "enabled",
      message: "是否启用定时自动生成日报？",
      default: existingConfig.schedule.enabled,
    },
    {
      type: "input",
      name: "time",
      message: "什么时间生成？(HH:mm):",
      default: "18:00",
      when: (answers) => answers.enabled,
      validate: (input: string) => getScheduleTimeInputError(input) ?? true,
    },
    {
      type: "list",
      name: "frequency",
      message: "哪些天？",
      choices: [
        { name: "每天", value: "*" },
        { name: "工作日", value: "weekday" },
        { name: "周末", value: "weekend" },
        { name: "周一至周五", value: "weekday" },
      ],
      default: "weekday",
      when: (answers) => answers.enabled,
    },
  ]);

  let cronExpr = "0 18 * * 1-5";
  if (scheduleAnswer.enabled) {
    try {
      cronExpr = parseTimeExpression(`${scheduleAnswer.time} ${scheduleAnswer.frequency}`);
    } catch (err: any) {
      console.error(`❌ 无效的定时设置: ${err.message}`);
      console.error("请重新运行 daily-report setup，并输入 HH:mm 格式的时间，例如 21:00。");
      process.exitCode = 1;
      return;
    }
  }

  // Step 4: Review and save
  console.log("\n▸ 步骤 4/4: 确认配置\n");

  console.log("┌─ 配置摘要 ──────────────────────────┐");
  console.log(`│ 追踪仓库: ${repos.length} 个`);
  repos.slice(0, 5).forEach((r) => {
    const short = r.replace(os.homedir(), "~");
    console.log(`│   - ${short.length > 35 ? "..." + short.slice(-32) : short}`);
  });
  if (repos.length > 5) console.log(`│   ... 还有 ${repos.length - 5} 个`);
  console.log(`│ LLM: ${llmAnswer.model} @ ${llmAnswer.baseUrl}`);
  console.log(`│ 定时: ${scheduleAnswer.enabled ? `${scheduleAnswer.time} (${scheduleAnswer.frequency})` : "关闭"}`);
  console.log(`│ 日报保存到: ~/.daily-report/reports/`);
  console.log("└──────────────────────────────────────┘");

  const confirmAnswer = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: "是否保存配置？",
      default: true,
    },
  ]);

  if (!confirmAnswer.confirm) {
    console.log("❌ 已取消配置。");
    return;
  }

  // Build and save config
  const config: DailyReportConfig = {
    repos,
    llm: {
      provider: llmAnswer.provider,
      baseUrl: llmAnswer.baseUrl,
      apiKey: llmAnswer.apiKey,
      model: llmAnswer.model,
    },
    report: {
      outputDir: "~/.daily-report/reports",
      printToTerminal: true,
      timezone: existingConfig.report.timezone || "Asia/Shanghai",
    },
    privacy: existingConfig.privacy,
    schedule: {
      enabled: scheduleAnswer.enabled,
      cron: cronExpr,
    },
  };

  saveConfig(config);

  // Activate scheduling if enabled (setup wizard was missing this step)
  if (config.schedule.enabled) {
    if (!scheduleOn(config)) {
      process.exitCode = 1;
      return;
    }
    console.log(`\n⏰ 定时任务已注册: ${config.schedule.cron}`);
  }

  console.log("\n✅ 配置已保存到 ~/.daily-report/config.json");
  console.log("🎉 现在可以运行 daily-report 生成第一份日报！\n");
}
