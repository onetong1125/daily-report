#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, saveConfig, getReportsDir, getLogsDir } from "./config";
import { timeBoundary, todayInTimezone } from "./timeboundary";
import { collectGitEvents } from "./collectors/git-collector";
import { collectGitHubEvents } from "./collectors/github-collector";
import { collectClaudeEvents } from "./collectors/claude-collector";
import { collectCodexEvents } from "./collectors/codex-collector";
import { sanitizeEvents } from "./sanitizer";
import { mergeAndDedup } from "./merger";
import { generateReport } from "./generator";
import { formatTerminal, formatMarkdown, saveReport } from "./formatter";
import { runSetup } from "./setup";
import { scheduleOn, scheduleOff, parseTimeExpression, isScheduled } from "./scheduler";
import { DailyReportConfig, SanitizedEvent } from "./types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const program = new Command();
const VERSION = "0.1.0";

program
  .name("daily-report")
  .description("自动日报工具：聚合 Git、GitHub、Claude Code、Codex CLI 的每日活动")
  .version(VERSION);

// ============================================================
// Default command: generate report
// ============================================================
program
  .option("-d, --date <date>", "指定日期 (YYYY-MM-DD)，默认今天")
  .option("--tz <timezone>", "指定时区，覆盖配置文件")
  .option("--dry-run", "只采集和预览数据，不调用 LLM")
  .option("--no-save", "不保存 Markdown 文件")
  .option("-q, --quiet", "只保存文件，不打印到终端")
  .option("--todo <text>", "手动补充明天的行动计划")
  .option("-v, --verbose", "详细日志输出")
  .action(async (options) => {
    const config = loadConfig();
    const tz = options.tz || config.report.timezone;

    if (options.verbose) {
      console.log(`[DEBUG] 配置文件: ~/.daily-report/config.json`);
      console.log(`[DEBUG] 时区: ${tz}`);
      console.log(`[DEBUG] 追踪仓库数: ${config.repos.length}`);
    }

    // 1. Calculate time boundary
    const dateStr = options.date || todayInTimezone(tz);
    const boundary = timeBoundary(dateStr, tz);

    if (options.verbose) {
      console.log(`[DEBUG] 日期: ${boundary.date}`);
      console.log(`[DEBUG] 时间范围: [${boundary.startUtc}, ${boundary.endUtc})`);
    }

    // 2. Collect events from all sources
    console.log("🔍 正在采集数据...\n");

    const allEvents: SanitizedEvent[] = [];

    // Git
    const gitEvents = collectGitEvents(config.repos, boundary);
    if (options.verbose) console.log(`[DEBUG] Git 事件: ${gitEvents.length}`);
    allEvents.push(...gitEvents);

    // GitHub
    const ghEvents = collectGitHubEvents(config.repos, boundary);
    if (options.verbose) console.log(`[DEBUG] GitHub 事件: ${ghEvents.length}`);
    allEvents.push(...ghEvents);

    // Claude
    const claudeEvents = collectClaudeEvents(boundary);
    if (options.verbose) console.log(`[DEBUG] Claude 事件: ${claudeEvents.length}`);
    allEvents.push(...claudeEvents);

    // Codex
    const codexEvents = collectCodexEvents(boundary);
    if (options.verbose) console.log(`[DEBUG] Codex 事件: ${codexEvents.length}`);
    allEvents.push(...codexEvents);

    // 3. Sanitize
    const sanitized = sanitizeEvents(allEvents, config.privacy.allowedFields);
    if (options.verbose) {
      console.log(`[DEBUG] 脱敏后事件: ${sanitized.length} (原始: ${allEvents.length})`);
    }

    // 4. Merge & dedup
    const grouped = mergeAndDedup(sanitized);
    if (options.verbose) {
      console.log(
        `[DEBUG] 去重后: git=${grouped.git_events.length}, github=${grouped.github_events.length}, ` +
        `claude=${grouped.claude_events.length}, codex=${grouped.codex_events.length}`
      );
    }

    // Dry run: just print the collected data
    if (options.dryRun) {
      console.log("\n📋 === Dry Run: 采集到的数据摘要 ===\n");
      console.log(`日期: ${boundary.date}`);
      console.log(`时间范围: [${boundary.startUtc}, ${boundary.endUtc})`);
      console.log(`总事件数: ${sanitized.length}`);
      console.log(`  Git:     ${grouped.git_events.length}`);
      console.log(`  GitHub:  ${grouped.github_events.length}`);
      console.log(`  Claude:  ${grouped.claude_events.length}`);
      console.log(`  Codex:   ${grouped.codex_events.length}`);

      if (grouped.git_events.length > 0) {
        console.log("\n--- Git ---");
        grouped.git_events.forEach((e) =>
          console.log(`  [${e.entity_id.slice(0, 7)}] ${e.summary}`)
        );
      }
      if (grouped.github_events.length > 0) {
        console.log("\n--- GitHub ---");
        grouped.github_events.forEach((e) =>
          console.log(`  [${e.entity_type}] ${e.summary}`)
        );
      }
      if (grouped.claude_events.length > 0) {
        console.log("\n--- Claude ---");
        grouped.claude_events.forEach((e) =>
          console.log(`  ${e.repo}: ${e.summary} (${e.message_count || 0} msgs)`)
        );
      }
      if (grouped.codex_events.length > 0) {
        console.log("\n--- Codex ---");
        grouped.codex_events.forEach((e) =>
          console.log(`  ${e.repo}: ${e.summary} (${e.message_count || 0} msgs)`)
        );
      }
      console.log("\n(没有调用 LLM — dry run 模式)\n");
      return;
    }

    // No activity check
    if (sanitized.length === 0) {
      console.log("☀️  今天没有活动记录，享受休息日吧！\n");
      // Still save an empty report if not --no-save
      if (options.save !== false) {
        const md = `# 📋 日报 - ${boundary.date}\n\n## TL;DR\n- 今天没有活动记录，享受休息日 ☀️\n`;
        const filePath = saveReport(md, boundary.date, getReportsDir(config));
        if (!options.quiet) console.log(`📄 日报已保存: ${filePath}\n`);
      }
      return;
    }

    // 5. Generate report (with LLM)
    if (config.privacy.requireConfirmation && !options.quiet) {
      console.log("即将调用 LLM 生成日报...");
      // In non-interactive mode, just proceed
    }

    console.log("🤖 正在生成日报...");
    const report = await generateReport(grouped, config, boundary.date, options.todo);

    // 6. Output
    if (!options.quiet) {
      formatTerminal(report);
    }

    // Save to file
    if (options.save !== false) {
      const markdown = formatMarkdown(report, grouped);
      const filePath = saveReport(markdown, boundary.date, getReportsDir(config));
      if (!options.quiet) console.log(`📄 日报已保存: ${filePath}\n`);
    }
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
    const { default: inquirer } = await import("inquirer");
    const answer = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "管理追踪仓库:",
        choices: [
          { name: "查看当前仓库列表", value: "list" },
          { name: "添加仓库", value: "add" },
          { name: "删除仓库", value: "remove" },
        ],
      },
    ]);

    if (answer.action === "list") {
      console.log("\n当前追踪仓库:");
      config.repos.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
      console.log("");
    } else if (answer.action === "add") {
      const addAnswer = await inquirer.prompt<{ path: string }>([
        { type: "input", name: "path", message: "仓库路径:" },
      ]);
      const p = addAnswer.path.replace(/^~/, os.homedir());
      if (fs.existsSync(path.join(p, ".git"))) {
        config.repos.push(p);
        saveConfig(config);
        console.log(`✅ 已添加: ${p}`);
      } else {
        console.log(`❌ 不是有效的 Git 仓库: ${p}`);
      }
    } else if (answer.action === "remove") {
      if (config.repos.length === 0) {
        console.log("没有可删除的仓库。");
        return;
      }
      const removeAnswer = await inquirer.prompt<{ repos: string[] }>([
        {
          type: "checkbox",
          name: "repos",
          message: "选择要删除的仓库:",
          choices: config.repos.map((r) => ({ name: r, value: r })),
        },
      ]);
      config.repos = config.repos.filter((r) => !removeAnswer.repos.includes(r));
      saveConfig(config);
      console.log(`✅ 已删除 ${removeAnswer.repos.length} 个仓库`);
    }
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
      { type: "input", name: "time", message: "时间 (HH:mm):", default: "18:00", when: (a: any) => a.enabled },
      { type: "list", name: "freq", message: "频率:", choices: ["每天", "工作日", "周末"], default: "工作日", when: (a: any) => a.enabled },
    ]);
    if (answers.enabled) {
      const freqMap: Record<string, string> = { "每天": "", "工作日": "weekday", "周末": "weekend" };
      config.schedule.cron = parseTimeExpression(`${answers.time} ${freqMap[answers.freq] || ""}`);
    }
    config.schedule.enabled = answers.enabled;
    saveConfig(config);
    console.log("✅ 定时设置已更新");
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
    if (!config.schedule.enabled) {
      config.schedule.enabled = true;
      saveConfig(config);
    }
    scheduleOn(config);
  });

scheduleCmd
  .command("off")
  .description("关闭定时任务")
  .action(() => {
    const config = loadConfig();
    scheduleOff(config);
  });

scheduleCmd
  .command("set <expression>")
  .description("设置定时时间 (cron 或 HH:mm [weekday])")
  .action((expression: string) => {
    const config = loadConfig();
    const cron = parseTimeExpression(expression);
    config.schedule.cron = cron;
    config.schedule.enabled = true;
    saveConfig(config);
    console.log(`✅ 定时已设置为: ${cron}`);
    scheduleOn(config);
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
