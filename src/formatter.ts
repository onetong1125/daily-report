import { DailyReport, GroupedEvents, SanitizedEvent } from "./types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ANSI color codes for terminal output
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

export const TEMPLATE_FALLBACK_MARKER = "<!-- daily-report:generation=template -->";

function fallbackNotice(report: DailyReport): string | null {
  if (report.generation?.source !== "template") return null;
  return report.generation.fallbackReason || "LLM 调用失败，已回退到模板生成";
}

function generationMarker(report: DailyReport): string {
  const source = report.generation?.source || "llm";
  return `<!-- daily-report:generation=${source} -->`;
}

/**
 * Format and print the daily report to terminal (project-oriented).
 */
export function formatTerminal(report: DailyReport): void {
  const dateObj = new Date(report.date + "T12:00:00");
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = weekdays[dateObj.getDay()];

  console.log("");
  console.log(`${C.cyan}${C.bold}📋 日报 - ${report.date}（${weekday}）${C.reset}`);
  console.log(`${C.dim}${"─".repeat(50)}${C.reset}`);

  const notice = fallbackNotice(report);
  if (notice) {
    console.log(`\n${C.yellow}${C.bold}⚠️  模板日报${C.reset}`);
    console.log(`  ${notice}`);
  }

  // TL;DR
  console.log(`\n${C.yellow}${C.bold}TL;DR${C.reset}`);
  for (const item of report.tldr) {
    console.log(`  ${C.green}•${C.reset} ${item}`);
  }

  // Projects
  for (const proj of report.projects) {
    console.log(`\n${C.cyan}${C.bold}📁 ${proj.project}${C.reset}`);
    console.log(`  ${proj.summary}`);
  }

  // Other AI
  if (report.other_ai && report.other_ai !== "无") {
    console.log(`\n${C.blue}${C.bold}💬 其他 AI 对话${C.reset}`);
    console.log(`  ${report.other_ai.split("\n").join("\n  ")}`);
  }

  // Tomorrow
  if (report.tomorrow_suggestions.length > 0) {
    console.log(`\n${C.yellow}${C.bold}📌 明日行动建议${C.reset}`);
    report.tomorrow_suggestions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s}`);
    });
  }

  console.log(`\n${C.dim}${"─".repeat(50)}${C.reset}\n`);
}

/**
 * Extract a short project name from a repo path.
 */
function projectName(repo: string): string {
  if (repo.includes("/") && !repo.startsWith("/") && !repo.includes(":")) {
    return repo.split("/").pop() || repo;
  }
  return repo.split("/").filter(Boolean).pop() || repo;
}

/**
 * Format the daily report as Markdown (project-oriented).
 */
export function formatMarkdown(
  report: DailyReport,
  grouped?: GroupedEvents
): string {
  const lines: string[] = [];
  const dateObj = new Date(report.date + "T12:00:00");
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = weekdays[dateObj.getDay()];

  lines.push(`# 📋 日报 - ${report.date}（${weekday}）`);
  lines.push(generationMarker(report));
  lines.push("");

  const notice = fallbackNotice(report);
  if (notice) {
    lines.push("> ⚠️ **模板日报**：LLM 未成功生成正文，本日报由本地模板回退生成，内容可能不完整。");
    lines.push(`> 原因：${notice}`);
    lines.push("");
  }

  // TL;DR
  lines.push("## TL;DR");
  for (const item of report.tldr) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  // Projects
  if (report.projects.length > 0) {
    // Build a lookup for detailed events per project
    const knownProjects = new Set<string>();
    if (grouped) {
      for (const e of grouped.git_events) knownProjects.add(projectName(e.repo));
      for (const e of grouped.github_events) knownProjects.add(projectName(e.repo));
    }

    for (const proj of report.projects) {
      lines.push("---");
      lines.push("");
      lines.push(`## 📁 ${proj.project}`);
      lines.push("");

      // LLM summary
      lines.push(proj.summary);
      lines.push("");

      if (!grouped) continue;

      // Detailed git commits
      const gitEvents = grouped.git_events.filter(
        (e) => projectName(e.repo) === proj.project
      );
      if (gitEvents.length > 0) {
        lines.push("### Git 提交");
        lines.push("| 提交 | 说明 |");
        lines.push("|------|------|");
        for (const c of gitEvents) {
          lines.push(`| \`${c.entity_id.slice(0, 7)}\` | ${c.summary} |`);
        }
        lines.push("");
      }

      // Detailed GitHub activity
      const ghEvents = grouped.github_events.filter(
        (e) => projectName(e.repo) === proj.project
      );
      if (ghEvents.length > 0) {
        lines.push("### GitHub 活动");
        for (const e of ghEvents) {
          const state = e.state ? `[${e.state}] ` : "";
          lines.push(`- ${state}${e.entity_type}: ${e.summary}`);
        }
        lines.push("");
      }

      // AI conversations are already summarized by the LLM in the project
      // summary and OTHER_AI sections; do not append raw collector excerpts.
    }
  }

  // Other AI
  lines.push("---");
  lines.push("");
  lines.push("## 💬 其他 AI 对话");
  lines.push("");
  lines.push(report.other_ai || "无");
  lines.push("");

  // Tomorrow
  lines.push("---");
  lines.push("");
  lines.push("## 📌 明日行动建议");
  lines.push("");
  report.tomorrow_suggestions.forEach((s, i) => {
    lines.push(`${i + 1}. ${s}`);
  });
  lines.push("");

  return lines.join("\n");
}

function resolveOutputDir(outputDir: string): string {
  return outputDir.replace(/^~/, os.homedir());
}

export function getReportFilePath(date: string, outputDir: string): string {
  return path.join(resolveOutputDir(outputDir), `${date}.md`);
}

export function isTemplateFallbackMarkdown(markdown: string): boolean {
  return markdown.includes(TEMPLATE_FALLBACK_MARKER);
}

export function shouldSkipFallbackOverwrite(date: string, outputDir: string): boolean {
  const filePath = getReportFilePath(date, outputDir);
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, "utf-8");
  return !isTemplateFallbackMarkdown(existing);
}

/**
 * Save the Markdown report to file.
 */
export function saveReport(
  markdown: string,
  date: string,
  outputDir: string
): string {
  const dir = resolveOutputDir(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = getReportFilePath(date, outputDir);
  fs.writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}
