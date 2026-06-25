#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, saveConfig } from "./config";
import { runSetup, selectTrackedRepos } from "./setup";
import { scheduleOn, scheduleOff, parseTimeExpression, isScheduled, SCHEDULE_EXPRESSION_HELP, getScheduleTimeInputError } from "./scheduler";
import { applyScheduleConfig } from "./schedule-config";
import { generateDailyReport, getVersion } from "./report-runner";
import { runWithScheduledLogs } from "./scheduled-logs";
import { runDoctor } from "./doctor";
import { printLatestLogSummary, printLogList, printLogTail } from "./logs-command";

function printScheduleExpressionHelp(): void {
  console.error(SCHEDULE_EXPRESSION_HELP);
}

const program = new Command();

program
  .name("daily-report")
  .description("自动日报工具：聚合 Git、GitHub、Claude Code、Codex CLI 的每日活动")
  .version(getVersion());

// ============================================================
// Default command: generate report
// ============================================================
program
  .option("-d, --date <date>", "指定日期 (YYYY-MM-DD)，默认今天")
  .option("--tz <timezone>", "指定时区，覆盖配置文件")
  .option("--dry-run", "只采集和预览数据，不调用 LLM")
  .option("--max-retries <number>", "LLM 调用最大重试次数，默认 5")
  .option("--no-save", "不保存 Markdown 文件")
  .option("-q, --quiet", "不打印日报正文，仅显示进度和保存路径")
  .option("--todo <text>", "手动补充明天的行动计划")
  .option("-v, --verbose", "详细日志输出")
  .action(async (options) => {
    await generateDailyReport(options);
  });

program
  .command("run-scheduled", { hidden: true })
  .description("内部命令：按日期写入定时任务日志后生成日报")
  .action(async () => {
    const config = loadConfig();
    await runWithScheduledLogs(config, () => generateDailyReport({ quiet: true, scheduled: true }));
  });

// ============================================================
// setup command
// ============================================================
program
  .command("setup")
  .description("交互式配置向导")
  .action(async () => {
    await runSetup();
  });

// ============================================================
// config commands
// ============================================================
const configCmd = program
  .command("config")
  .description("管理配置");

configCmd
  .command("show")
  .description("查看当前配置")
  .action(() => {
    const config = loadConfig();
    // Hide API key
    const display = {
      ...config,
      llm: { ...config.llm, apiKey: "********" },
    };
    console.log(JSON.stringify(display, null, 2));
  });

configCmd
  .command("repos")
  .description("管理追踪仓库")
  .action(async () => {
    const config = loadConfig();
    config.repos = await selectTrackedRepos(config.repos);
    saveConfig(config);
    console.log(`✅ 追踪仓库已更新: ${config.repos.length} 个`);
  });

configCmd
  .command("llm")
  .description("修改 LLM 配置")
  .action(async () => {
    const config = loadConfig();
    const { default: inquirer } = await import("inquirer");
    const answers = await inquirer.prompt([
      { type: "input", name: "baseUrl", message: "API 地址:", default: config.llm.baseUrl },
      { type: "input", name: "model", message: "模型:", default: config.llm.model },
      { type: "password", name: "apiKey", message: "API Key:", mask: "*", default: config.llm.apiKey },
    ]);
    config.llm = { ...config.llm, ...answers };
    saveConfig(config);
    console.log("✅ LLM 配置已更新");
  });

configCmd
  .command("privacy")
  .description("修改隐私设置")
  .action(async () => {
    const config = loadConfig();
    const { default: inquirer } = await import("inquirer");
    const answers = await inquirer.prompt([
      { type: "confirm", name: "requireConfirmation", message: "调用 LLM 前确认？", default: config.privacy.requireConfirmation },
      { type: "number", name: "maxTokensSent", message: "最大发送 token 数:", default: config.privacy.maxTokensSent },
    ]);
    config.privacy = { ...config.privacy, ...answers };
    saveConfig(config);
    console.log("✅ 隐私设置已更新");
  });

configCmd
  .command("schedule")
  .description("修改定时设置")
  .action(async () => {
    const config = loadConfig();
    const { default: inquirer } = await import("inquirer");
    const answers = await inquirer.prompt([
      { type: "confirm", name: "enabled", message: "启用定时任务？", default: config.schedule.enabled },
      {
        type: "input",
        name: "time",
        message: "时间 (HH:mm):",
        default: "18:00",
        when: (a: any) => a.enabled,
        validate: (input: string) => getScheduleTimeInputError(input) ?? true,
      },
      { type: "list", name: "freq", message: "频率:", choices: ["每天", "工作日", "周末"], default: "工作日", when: (a: any) => a.enabled },
    ]);
    const nextSchedule = { ...config.schedule, enabled: answers.enabled };
    if (answers.enabled) {
      const freqMap: Record<string, string> = { "每天": "", "工作日": "weekday", "周末": "weekend" };
      try {
        nextSchedule.cron = parseTimeExpression(`${answers.time} ${freqMap[answers.freq] || ""}`);
      } catch (err: any) {
        console.error(`❌ 无效的定时设置: ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }
    if (!applyScheduleConfig(config, nextSchedule)) {
      process.exitCode = 1;
      return;
    }
    console.log("✅ 定时设置已更新并已同步到系统调度");
  });

program
  .command("doctor")
  .description("检查配置、采集源、定时任务和最近日志")
  .action(() => {
    runDoctor();
  });

const logsCmd = program
  .command("logs")
  .description("查看定时任务日志");

logsCmd
  .command("list")
  .description("列出按日期保存的定时任务日志")
  .action(() => {
    printLogList();
  });

logsCmd
  .command("latest")
  .description("显示最近一次定时任务日志路径")
  .action(() => {
    printLatestLogSummary();
  });

logsCmd
  .command("tail")
  .description("打印最近一次定时任务日志尾部")
  .option("-n, --lines <number>", "打印行数，默认 80")
  .option("--stream <stream>", "stdout 或 stderr，默认 stdout", "stdout")
  .action((options) => {
    if (options.stream !== "stdout" && options.stream !== "stderr") {
      console.error("❌ --stream 只支持 stdout 或 stderr");
      process.exitCode = 1;
      return;
    }
    printLogTail(options);
  });

// ============================================================
// schedule commands
// ============================================================
const scheduleCmd = program
  .command("schedule")
  .description("管理定时任务");

scheduleCmd
  .command("on")
  .description("启用定时任务")
  .action(() => {
    const config = loadConfig();
    config.schedule.enabled = true;
    if (!scheduleOn(config)) {
      process.exitCode = 1;
    }
  });

scheduleCmd
  .command("off")
  .description("关闭定时任务")
  .action(() => {
    const config = loadConfig();
    scheduleOff(config);
  });

scheduleCmd
  .command("set <expression...>")
  .description("设置定时时间 (cron 或 HH:mm [weekday])")
  .action((expressionParts: string[]) => {
    const config = loadConfig();
    const previousSchedule = { ...config.schedule };
    const expression = expressionParts.join(" ");
    let cron: string;
    try {
      cron = parseTimeExpression(expression);
    } catch (err: any) {
      console.error(`❌ 无效的定时表达式: ${err.message}`);
      printScheduleExpressionHelp();
      process.exitCode = 1;
      return;
    }

    config.schedule.cron = cron;
    config.schedule.enabled = true;
    if (scheduleOn(config)) {
      console.log(`✅ 定时已设置为: ${cron}`);
    } else {
      config.schedule = previousSchedule;
      saveConfig(config);
      process.exitCode = 1;
    }
  });

scheduleCmd
  .command("status")
  .description("查看定时任务状态")
  .action(() => {
    const config = loadConfig();
    console.log(`定时任务: ${config.schedule.enabled ? "✅ 已启用" : "❌ 已关闭"}`);
    console.log(`时间: ${config.schedule.cron}`);
    if (isScheduled()) {
      console.log("系统调度: ✅ 已注册");
    } else {
      console.log("系统调度: ⚠️  未注册（运行 daily-report schedule on 启用）");
    }
  });

// ============================================================
// Parse
// ============================================================
program.parse(process.argv);
