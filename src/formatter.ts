import { DailyReport, GroupedEvents, SanitizedEvent } from "./types";
import * as fs from "fs";
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
  lines.push("");

  // TL;DR
  lines.push("## TL;DR");
  for (const item of report.tldr) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  // Projects
  if (report.projects.length > 0 && grouped) {
    // Build a lookup for detailed events per project
    const knownProjects = new Set<string>();
    for (const e of grouped.git_events) knownProjects.add(projectName(e.repo));
    for (const e of grouped.github_events) knownProjects.add(projectName(e.repo));

    for (const proj of report.projects) {
      lines.push("---");
      lines.push("");
      lines.push(`## 📁 ${proj.project}`);
      lines.push("");

      // LLM summary
      lines.push(proj.summary);
      lines.push("");

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

      // Claude conversations for this project
      const clEvents: SanitizedEvent[] = [];
      for (const e of grouped.claude_events) {
        const name = projectName(e.repo);
        if (name === proj.project || knownProjects.has(name) === false) {
          // Only include if exact match (will be handled by classify logic)
          if (name === proj.project) clEvents.push(e);
        }
      }
      if (clEvents.length > 0) {
        lines.push("### Claude Code 对话");
        for (const e of clEvents) {
          lines.push(`- ${e.summary}`);
        }
        lines.push("");
      }

      // Codex conversations for this project
      const cxEvents = grouped.codex_events.filter(
        (e) => projectName(e.repo) === proj.project
      );
      if (cxEvents.length > 0) {
        lines.push("### Codex 对话");
        for (const e of cxEvents) {
          lines.push(`- ${e.summary}`);
        }
        lines.push("");
      }
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
