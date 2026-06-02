import { GroupedEvents, DailyReport, DailyReportConfig } from "./types";
import { getResolvedApiKey } from "./config";

/**
 * Build a prompt from grouped SanitizedEvent data.
 * Only includes allowed, sanitized fields — per privacy design §4.
 */
function buildPrompt(
  grouped: GroupedEvents,
  date: string,
  manualTodo?: string
): string {
  const sections: string[] = [];

  sections.push(`你是一个日报助手。请根据以下今日活动数据生成一份中文日报。`);
  sections.push(`日期: ${date}`);
  sections.push("");

  // Git section
  if (grouped.git_events.length > 0) {
    sections.push("## Git 提交活动");
    for (const e of grouped.git_events) {
      const refs = e.related_entities.length > 0 ? ` (关联: ${e.related_entities.join(", ")})` : "";
      sections.push(`- [${e.entity_id.slice(0, 7)}] ${e.summary} (作者: ${e.author || "unknown"})${refs}`);
    }
    sections.push("");
  } else {
    sections.push("## Git 提交活动: 无");
    sections.push("");
  }

  // GitHub section
  if (grouped.github_events.length > 0) {
    sections.push("## GitHub 活动");
    for (const e of grouped.github_events) {
      const stateLabel = e.state ? ` [${e.state}]` : "";
      const refs = e.related_entities.length > 0 ? ` (关联: ${e.related_entities.join(", ")})` : "";
      sections.push(`- ${e.entity_type}${stateLabel}: ${e.summary}${refs}`);
    }
    sections.push("");
  } else {
    sections.push("## GitHub 活动: 无");
    sections.push("");
  }

  // Claude section
  if (grouped.claude_events.length > 0) {
    sections.push("## Claude Code 对话");
    for (const e of grouped.claude_events) {
      sections.push(`- ${e.repo}: ${e.summary} (${e.message_count || 0} 条消息)`);
    }
    sections.push("");
  } else {
    sections.push("## Claude Code 对话: 无");
    sections.push("");
  }

  // Codex section
  if (grouped.codex_events.length > 0) {
    sections.push("## Codex 对话");
    for (const e of grouped.codex_events) {
      sections.push(`- ${e.repo}: ${e.summary} (${e.message_count || 0} 条消息)`);
    }
    sections.push("");
  } else {
    sections.push("## Codex 对话: 无");
    sections.push("");
  }

  if (manualTodo) {
    sections.push(`用户手动补充的明日计划: ${manualTodo}`);
  }

  sections.push("");
  sections.push("请输出以下格式的日报（严格遵守）：");
  sections.push("---");
  sections.push("TL;DR:");
  sections.push("- 要点1");
  sections.push("- 要点2");
  sections.push("");
  sections.push("GIT_SECTION:");
  sections.push("(Git 活动的一段话总结)");
  sections.push("");
  sections.push("GITHUB_SECTION:");
  sections.push("(GitHub 活动的一段话总结)");
  sections.push("");
  sections.push("CLAUDE_SECTION:");
  sections.push("(Claude Code 对话的一段话总结)");
  sections.push("");
  sections.push("CODEX_SECTION:");
  sections.push("(Codex 对话的一段话总结)");
  sections.push("");
  sections.push("TOMORROW:");
  sections.push("- 建议1");
  sections.push("- 建议2");
  sections.push("---");

  return sections.join("\n");
}

/**
 * Parse LLM response into DailyReport structure.
 */
function parseResponse(text: string, date: string): DailyReport {
  const report: DailyReport = {
    date,
    tldr: [],
    git_section: "",
    github_section: "",
    claude_section: "",
    codex_section: "",
    tomorrow_suggestions: [],
  };

  // Parse TL;DR
  const tldrMatch = text.match(/TL;DR:?\n([\s\S]*?)(?=\n\w+_SECTION:|\nGIT_SECTION:|$)/i);
  if (tldrMatch) {
    report.tldr = tldrMatch[1]
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 0);
  }

  // Parse GIT_SECTION
  const gitMatch = text.match(/GIT_SECTION:?\n([\s\S]*?)(?=\n\w+_SECTION:|\nTOMORROW:|$)/i);
  if (gitMatch) {
    report.git_section = gitMatch[1].trim();
  }

  // Parse GITHUB_SECTION
  const ghMatch = text.match(/GITHUB_SECTION:?\n([\s\S]*?)(?=\n\w+_SECTION:|\nTOMORROW:|$)/i);
  if (ghMatch) {
    report.github_section = ghMatch[1].trim();
  }

  // Parse CLAUDE_SECTION
  const claudeMatch = text.match(/CLAUDE_SECTION:?\n([\s\S]*?)(?=\n\w+_SECTION:|\nTOMORROW:|$)/i);
  if (claudeMatch) {
    report.claude_section = claudeMatch[1].trim();
  }

  // Parse CODEX_SECTION
  const codexMatch = text.match(/CODEX_SECTION:?\n([\s\S]*?)(?=\n\w+_SECTION:|\nTOMORROW:|$)/i);
  if (codexMatch) {
    report.codex_section = codexMatch[1].trim();
  }

  // Parse TOMORROW
  const tomorrowMatch = text.match(/TOMORROW:?\n([\s\S]*?)$/i);
  if (tomorrowMatch) {
    report.tomorrow_suggestions = tomorrowMatch[1]
      .split("\n")
      .map((l) => l.replace(/^[-*\d.]\s*/, "").trim())
      .filter((l) => l.length > 0);
  }

  return report;
}

/**
 * Template-based fallback when LLM API fails.
 */
function templateReport(
  grouped: GroupedEvents,
  date: string,
  manualTodo?: string
): DailyReport {
  const tldr: string[] = [];
  const tomorrow: string[] = [];

  if (grouped.git_events.length > 0) {
    const repos = [...new Set(grouped.git_events.map((e) => e.repo.split("/").pop()))];
    tldr.push(`在 ${repos.join("、")} 中提交了 ${grouped.git_events.length} 个 commit`);
    tomorrow.push("继续今天的开发工作");
  }
  if (grouped.github_events.length > 0) {
    const prs = grouped.github_events.filter((e) => e.entity_type === "pr");
    if (prs.length > 0) tldr.push(`GitHub 上有 ${prs.length} 个 PR 活动`);
  }
  if (grouped.claude_events.length > 0) {
    tldr.push(`与 Claude Code 有 ${grouped.claude_events.length} 个对话`);
  }
  if (grouped.codex_events.length > 0) {
    tldr.push(`与 Codex 有 ${grouped.codex_events.length} 个对话`);
  }
  if (manualTodo) {
    tomorrow.push(manualTodo);
  }

  if (tldr.length === 0) {
    tldr.push("今天没有活动记录，享受休息日 ☀️");
  }

  return {
    date,
    tldr,
    git_section: grouped.git_events.map((e) => `- ${e.summary}`).join("\n") || "无",
    github_section: grouped.github_events.map((e) => `- [${e.entity_type}] ${e.summary}`).join("\n") || "无",
    claude_section: grouped.claude_events.map((e) => `- ${e.repo}: ${e.summary}`).join("\n") || "无",
    codex_section: grouped.codex_events.map((e) => `- ${e.repo}: ${e.summary}`).join("\n") || "无",
    tomorrow_suggestions: tomorrow,
  };
}

/**
 * Generate daily report by calling the configured LLM API.
 * Falls back to template if API call fails.
 */
export async function generateReport(
  grouped: GroupedEvents,
  config: DailyReportConfig,
  date: string,
  manualTodo?: string
): Promise<DailyReport> {
  const apiKey = getResolvedApiKey(config);

  if (!apiKey) {
    console.warn("⚠️  未配置 API Key，使用模板生成日报");
    return templateReport(grouped, date, manualTodo);
  }

  const prompt = buildPrompt(grouped, date, manualTodo);
  const url = `${config.llm.baseUrl}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [
          { role: "system", content: "你是一个专业的工作日报助手。请用简洁、有条理的中文回复。" },
          { role: "user", content: prompt },
        ],
        max_tokens: Math.min(config.privacy.maxTokensSent, 2048),
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`API 返回 ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    if (!content) {
      throw new Error("API 返回空内容");
    }

    return parseResponse(content, date);
  } catch (err: any) {
    console.warn(`⚠️  LLM API 调用失败: ${err.message}`);
    console.warn("   回退到模板生成");
    return templateReport(grouped, date, manualTodo);
  }
}
