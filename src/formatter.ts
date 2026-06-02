import { DailyReport, GroupedEvents, SanitizedEvent } from "./types";
import * as fs from "fs";
import * as path from "path";
import { getReportsDir } from "./config";

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

/**
 * Format and print the daily report to terminal.
 */
export function formatTerminal(report: DailyReport): void {
  // Header
  const dateObj = new Date(report.date + "T12:00:00");
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = weekdays[dateObj.getDay()];

  console.log("");
  console.log(`${C.cyan}${C.bold}📋 日报 - ${report.date}（${weekday}）${C.reset}`);
  console.log(`${C.dim}${"─".repeat(50)}${C.reset}`);

  // TL;DR
  console.log(`\n${C.yellow}${C.bold}TL;DR${C.reset}`);
  for (const item of report.tldr) {
    console.log(`  ${C.green}•${C.reset} ${item}`);
  }

  // Git
  if (report.git_section && report.git_section !== "无") {
    console.log(`\n${C.cyan}${C.bold}💻 Git 活动${C.reset}`);
    console.log(`  ${report.git_section.split("\n").join("\n  ")}`);
  }

  // GitHub
  if (report.github_section && report.github_section !== "无") {
    console.log(`\n${C.magenta}${C.bold}🌐 GitHub 活动${C.reset}`);
    console.log(`  ${report.github_section.split("\n").join("\n  ")}`);
  }

  // Claude
  if (report.claude_section && report.claude_section !== "无") {
    console.log(`\n${C.blue}${C.bold}🤖 Claude Code 对话${C.reset}`);
    console.log(`  ${report.claude_section.split("\n").join("\n  ")}`);
  }

  // Codex
  if (report.codex_section && report.codex_section !== "无") {
    console.log(`\n${C.green}${C.bold}🤖 Codex 对话${C.reset}`);
    console.log(`  ${report.codex_section.split("\n").join("\n  ")}`);
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
 * Format the daily report as Markdown.
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
  lines.push("");

  // TL;DR
  lines.push("## TL;DR");
  for (const item of report.tldr) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  // Git
  lines.push("---");
  lines.push("");
  lines.push("## 💻 Git 活动");
  lines.push("");

  if (grouped?.git_events && grouped.git_events.length > 0) {
    // Group by repo
    const byRepo = new Map<string, SanitizedEvent[]>();
    for (const e of grouped.git_events) {
      const name = e.repo.split("/").pop() || e.repo;
      if (!byRepo.has(name)) byRepo.set(name, []);
      byRepo.get(name)!.push(e);
    }
    for (const [repo, commits] of byRepo) {
      lines.push(`### ${repo} (${commits.length} commits)`);
      lines.push("| 提交 | 说明 |");
      lines.push("|------|------|");
      for (const c of commits) {
        const refs = c.related_entities.length > 0
          ? ` → ${c.related_entities.join(", ")}`
          : "";
        lines.push(`| \`${c.entity_id.slice(0, 7)}\` | ${c.summary}${refs} |`);
      }
      lines.push("");
    }
  } else {
    // If no grouped data, use the text section
    lines.push(report.git_section || "无");
    lines.push("");
  }

  // GitHub
  lines.push("---");
  lines.push("");
  lines.push("## 🌐 GitHub 活动");
  lines.push("");
  if (grouped?.github_events && grouped.github_events.length > 0) {
    const byRepo = new Map<string, SanitizedEvent[]>();
    for (const e of grouped.github_events) {
      if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
      byRepo.get(e.repo)!.push(e);
    }
    for (const [repo, evts] of byRepo) {
      lines.push(`- **${repo}**:`);
      for (const e of evts) {
        const state = e.state ? `[${e.state}] ` : "";
        const refs = e.related_entities.length > 0
          ? ` → ${e.related_entities.join(", ")}`
          : "";
        lines.push(`  - ${state}${e.entity_type}: ${e.summary}${refs}`);
      }
    }
    lines.push("");
  } else {
    lines.push(report.github_section || "无");
    lines.push("");
  }

  // Claude
  lines.push("---");
  lines.push("");
  lines.push("## 🤖 Claude Code 对话");
  lines.push("");
  if (grouped?.claude_events && grouped.claude_events.length > 0) {
    for (const e of grouped.claude_events) {
      const repoName = e.repo.split("/").pop() || e.repo;
      const refs = e.related_entities.length > 0
        ? ` (关联 ${e.related_entities.join(", ")})`
        : "";
      lines.push(`- **${repoName}**: ${e.summary}${refs}`);
    }
    lines.push("");
  } else {
    lines.push(report.claude_section || "无");
    lines.push("");
  }

  // Codex
  lines.push("---");
  lines.push("");
  lines.push("## 🤖 Codex 对话");
  lines.push("");
  if (grouped?.codex_events && grouped.codex_events.length > 0) {
    for (const e of grouped.codex_events) {
      const repoName = e.repo.split("/").pop() || e.repo;
      const refs = e.related_entities.length > 0
        ? ` (关联 ${e.related_entities.join(", ")})`
        : "";
      lines.push(`- **${repoName}**: ${e.summary}${refs}`);
    }
    lines.push("");
  } else {
    lines.push(report.codex_section || "无");
    lines.push("");
  }

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

/**
 * Save the Markdown report to file.
 */
export function saveReport(
  markdown: string,
  date: string,
  outputDir: string
): string {
  const dir = outputDir.replace(/^~/, require("os").homedir());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `${date}.md`);
  fs.writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}
