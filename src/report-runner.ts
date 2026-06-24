import { loadConfig, getReportsDir } from "./config";
import { timeBoundary, todayInTimezone } from "./timeboundary";
import { collectGitEvents } from "./collectors/git-collector";
import { collectGitHubEvents } from "./collectors/github-collector";
import { collectClaudeEvents } from "./collectors/claude-collector";
import { collectCodexEvents } from "./collectors/codex-collector";
import { sanitizeEvents } from "./sanitizer";
import { mergeAndDedup } from "./merger";
import { generateReport } from "./generator";
import { formatTerminal, formatMarkdown, getReportFilePath, saveReport, shouldSkipFallbackOverwrite } from "./formatter";
import { shouldPrintLlmNotice, shouldPrintReportBody, shouldPrintSavedReportPath } from "./cli-output";
import { SanitizedEvent } from "./types";

export interface GenerateReportOptions {
  date?: string;
  tz?: string;
  dryRun?: boolean;
  maxRetries?: string;
  save?: boolean;
  quiet?: boolean;
  todo?: string;
  verbose?: boolean;
}

export async function generateDailyReport(options: GenerateReportOptions = {}): Promise<void> {
  const config = loadConfig();

  if (options.maxRetries !== undefined) {
    const maxRetries = parseInt(options.maxRetries, 10);
    if (isNaN(maxRetries) || maxRetries < 0) {
      console.warn(`⚠️  无效的 --max-retries 值: ${options.maxRetries}，使用默认值`);
    } else {
      config.llm.maxRetries = maxRetries;
    }
  }

  const tz = options.tz || config.report.timezone;

  if (options.verbose) {
    console.log(`[DEBUG] 配置文件: ~/.daily-report/config.json`);
    console.log(`[DEBUG] 时区: ${tz}`);
    console.log(`[DEBUG] 追踪仓库数: ${config.repos.length}`);
  }

  const dateStr = options.date || todayInTimezone(tz);
  const boundary = timeBoundary(dateStr, tz);

  if (options.verbose) {
    console.log(`[DEBUG] 日期: ${boundary.date}`);
    console.log(`[DEBUG] 时间范围: [${boundary.startUtc}, ${boundary.endUtc})`);
  }

  console.log("🔍 正在采集数据...\n");

  const allEvents: SanitizedEvent[] = [];

  const gitEvents = collectGitEvents(config.repos, boundary);
  if (options.verbose) console.log(`[DEBUG] Git 事件: ${gitEvents.length}`);
  allEvents.push(...gitEvents);

  const ghEvents = collectGitHubEvents(config.repos, boundary);
  if (options.verbose) console.log(`[DEBUG] GitHub 事件: ${ghEvents.length}`);
  allEvents.push(...ghEvents);

  const claudeEvents = collectClaudeEvents(boundary);
  if (options.verbose) console.log(`[DEBUG] Claude 事件: ${claudeEvents.length}`);
  allEvents.push(...claudeEvents);

  const codexEvents = collectCodexEvents(boundary);
  if (options.verbose) console.log(`[DEBUG] Codex 事件: ${codexEvents.length}`);
  allEvents.push(...codexEvents);

  const sanitized = sanitizeEvents(allEvents, config.privacy.allowedFields);
  if (options.verbose) {
    console.log(`[DEBUG] 脱敏后事件: ${sanitized.length} (原始: ${allEvents.length})`);
  }

  const grouped = mergeAndDedup(sanitized);
  if (options.verbose) {
    console.log(
      `[DEBUG] 去重后: git=${grouped.git_events.length}, github=${grouped.github_events.length}, ` +
      `claude=${grouped.claude_events.length}, codex=${grouped.codex_events.length}`
    );
  }

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

  if (sanitized.length === 0) {
    console.log("☀️  今天没有活动记录，享受休息日吧！\n");
    if (options.save !== false) {
      const md = `# 📋 日报 - ${boundary.date}\n\n## TL;DR\n- 今天没有活动记录，享受休息日 ☀️\n`;
      const filePath = saveReport(md, boundary.date, getReportsDir(config));
      if (shouldPrintSavedReportPath(options)) console.log(`📄 日报已保存: ${filePath}\n`);
    }
    return;
  }

  if (shouldPrintLlmNotice(config)) {
    console.log("即将调用 LLM 生成日报...");
  }

  console.log("🤖 正在生成日报...");
  const report = await generateReport(grouped, config, boundary.date, options.todo);

  if (shouldPrintReportBody(config, options)) {
    formatTerminal(report);
  }

  if (options.save !== false) {
    const outputDir = getReportsDir(config);
    const markdown = formatMarkdown(report, grouped);
    if (report.generation?.source === "template" && shouldSkipFallbackOverwrite(boundary.date, outputDir)) {
      const filePath = getReportFilePath(boundary.date, outputDir);
      if (shouldPrintSavedReportPath(options)) {
        console.log(`⚠️  LLM 生成失败，已保留已有成功日报: ${filePath}\n`);
      }
      return;
    }

    const filePath = saveReport(markdown, boundary.date, outputDir);
    if (shouldPrintSavedReportPath(options)) console.log(`📄 日报已保存: ${filePath}\n`);
  }
}
