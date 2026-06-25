import { loadConfig, getReportsDir, getConfigPath } from "./config";
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
import { createPhaseTimer, createRunMetadata, formatKeyValueLine, PhaseTimer } from "./observability";
import { SanitizedEvent } from "./types";
import * as fs from "fs";
import * as path from "path";

export interface GenerateReportOptions {
  date?: string;
  tz?: string;
  dryRun?: boolean;
  maxRetries?: string;
  save?: boolean;
  quiet?: boolean;
  todo?: string;
  verbose?: boolean;
  scheduled?: boolean;
}

export interface RunLogContext {
  version: string;
  timezone: string;
  reportDate: string;
  outputDir: string;
  repoCount: number;
}

function abbreviateHome(filePath: string): string {
  return filePath.replace(/^\/Users\/[^/]+/, "~");
}

export function getVersion(): string {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8")
    ).version;
  } catch {
    return "unknown";
  }
}

export function logRunHeader(context: RunLogContext): void {
  const metadata = createRunMetadata({
    version: context.version,
    timezone: context.timezone,
    reportDate: context.reportDate,
    configPath: abbreviateHome(getConfigPath()),
    outputDir: abbreviateHome(context.outputDir),
    repoCount: context.repoCount,
  });

  console.log(formatKeyValueLine("run", {
    run_id: metadata.run_id,
    version: metadata.version,
    node: metadata.node,
    platform: metadata.platform,
    arch: metadata.arch,
    timezone: metadata.timezone,
    report_date: metadata.report_date,
    config_path: metadata.config_path,
    output_dir: metadata.output_dir,
    repos: metadata.repos,
  }));
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
  const outputDir = getReportsDir(config);
  const emitPhases = Boolean(options.verbose || options.scheduled);
  const startPhase = (name: string): PhaseTimer | undefined =>
    emitPhases ? createPhaseTimer(name) : undefined;

  if (options.verbose) {
    console.log(`[DEBUG] 日期: ${boundary.date}`);
    console.log(`[DEBUG] 时间范围: [${boundary.startUtc}, ${boundary.endUtc})`);
  }

  if (options.verbose) {
    logRunHeader({
      version: getVersion(),
      timezone: tz,
      reportDate: boundary.date,
      outputDir,
      repoCount: config.repos.length,
    });
  }

  console.log("🔍 正在采集数据...\n");

  const allEvents: SanitizedEvent[] = [];

  const gitPhase = startPhase("collect:git");
  const gitEvents = collectGitEvents(config.repos, boundary);
  gitPhase?.finish({ repos: config.repos.length, events: gitEvents.length });
  if (options.verbose) console.log(`[DEBUG] Git 事件: ${gitEvents.length}`);
  allEvents.push(...gitEvents);

  const githubPhase = startPhase("collect:github");
  const ghEvents = collectGitHubEvents(config.repos, boundary);
  githubPhase?.finish({ repos: config.repos.length, events: ghEvents.length });
  if (options.verbose) console.log(`[DEBUG] GitHub 事件: ${ghEvents.length}`);
  allEvents.push(...ghEvents);

  const claudePhase = startPhase("collect:claude");
  const claudeEvents = collectClaudeEvents(boundary);
  claudePhase?.finish({ events: claudeEvents.length });
  if (options.verbose) console.log(`[DEBUG] Claude 事件: ${claudeEvents.length}`);
  allEvents.push(...claudeEvents);

  const codexPhase = startPhase("collect:codex");
  const codexEvents = collectCodexEvents(boundary);
  codexPhase?.finish({ events: codexEvents.length });
  if (options.verbose) console.log(`[DEBUG] Codex 事件: ${codexEvents.length}`);
  allEvents.push(...codexEvents);

  const sanitizePhase = startPhase("sanitize");
  const sanitized = sanitizeEvents(allEvents, config.privacy.allowedFields);
  sanitizePhase?.finish({ input: allEvents.length, output: sanitized.length });
  if (options.verbose) {
    console.log(`[DEBUG] 脱敏后事件: ${sanitized.length} (原始: ${allEvents.length})`);
  }

  const mergePhase = startPhase("merge");
  const grouped = mergeAndDedup(sanitized);
  mergePhase?.finish({
    git: grouped.git_events.length,
    github: grouped.github_events.length,
    claude: grouped.claude_events.length,
    codex: grouped.codex_events.length,
  });
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
      const savePhase = startPhase("save");
      const filePath = saveReport(md, boundary.date, outputDir);
      savePhase?.finish({ path: filePath });
      if (shouldPrintSavedReportPath(options)) console.log(`📄 日报已保存: ${filePath}\n`);
    }
    return;
  }

  if (shouldPrintLlmNotice(config)) {
    console.log("即将调用 LLM 生成日报...");
  }

  console.log("🤖 正在生成日报...");
  const generatePhase = startPhase("generate");
  const report = await generateReport(grouped, config, boundary.date, options.todo);
  generatePhase?.finish({ source: report.generation?.source ?? "llm" });

  if (shouldPrintReportBody(config, options)) {
    formatTerminal(report);
  }

  if (options.save !== false) {
    const markdown = formatMarkdown(report, grouped);
    if (report.generation?.source === "template" && shouldSkipFallbackOverwrite(boundary.date, outputDir)) {
      const filePath = getReportFilePath(boundary.date, outputDir);
      if (shouldPrintSavedReportPath(options)) {
        console.log(`⚠️  LLM 生成失败，已保留已有成功日报: ${filePath}\n`);
      }
      return;
    }

    const savePhase = startPhase("save");
    const filePath = saveReport(markdown, boundary.date, outputDir);
    savePhase?.finish({ path: filePath });
    if (shouldPrintSavedReportPath(options)) console.log(`📄 日报已保存: ${filePath}\n`);
  }
}
