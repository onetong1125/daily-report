import { GroupedEvents, DailyReport, DailyReportConfig, SanitizedEvent, ProjectSummary } from "./types";
import { getResolvedApiKey } from "./config";

/**
 * Extract a short project name from a repo path.
 *   /Users/.../Research/RL-Nukplex → RL-Nukplex
 *   onetong1125/RL-Nukplex          → RL-Nukplex
 */
function projectName(event: SanitizedEvent): string {
  const repo = event.repo;
  // GitHub format: owner/repo
  if (repo.includes("/") && !repo.startsWith("/") && !repo.includes(":")) {
    return repo.split("/").pop() || repo;
  }
  // Local path: /path/to/project
  return repo.split("/").filter(Boolean).pop() || repo;
}

/**
 * Find the project a user message is likely about.
 * Claude/Codex sessions record `cwd` not the specific repo, so a session in
 * `/Users/.../myprojects` may be about `daily-report` (a subdirectory).
 * We match against known project names derived from Git events.
 */
function classifyEvent(
  event: SanitizedEvent,
  knownProjects: Set<string>
): string | null {
  const name = projectName(event);
  if (knownProjects.has(name)) return name;
  return null;
}

/**
 * Build a prompt from grouped SanitizedEvent data.
 * Groups events by project, with unaffiliated AI conversations in "其他 AI 对话".
 */
export function buildPrompt(
  grouped: GroupedEvents,
  date: string,
  manualTodo?: string
): string {
  const sections: string[] = [];

  sections.push("你是一个工作日报助手。请根据以下今日活动数据，生成一份简洁、有信息量的中文日报。");
  sections.push(`日期: ${date}`);
  sections.push("");
  sections.push("重要提示：对话摘录是从用户与 AI 助手的对话中截取的关键消息片段，请从中提取实际的工作主题和进展，不要只是复述原文。");
  sections.push("");

  // Determine known project names from Git + GitHub events
  const knownProjects = new Set<string>();
  for (const e of grouped.git_events) knownProjects.add(projectName(e));
  for (const e of grouped.github_events) knownProjects.add(projectName(e));

  // Group events: project → { git, github, claude, codex }
  const projectMap = new Map<string, {
    git: SanitizedEvent[];
    github: SanitizedEvent[];
    claude: SanitizedEvent[];
    codex: SanitizedEvent[];
  }>();
  const otherAI: SanitizedEvent[] = [];

  function ensureProject(name: string) {
    if (!projectMap.has(name)) {
      projectMap.set(name, { git: [], github: [], claude: [], codex: [] });
    }
    return projectMap.get(name)!;
  }

  for (const e of grouped.git_events) {
    ensureProject(projectName(e)).git.push(e);
  }
  for (const e of grouped.github_events) {
    ensureProject(projectName(e)).github.push(e);
  }
  for (const e of grouped.claude_events) {
    const proj = classifyEvent(e, knownProjects);
    if (proj) ensureProject(proj).claude.push(e);
    else otherAI.push(e);
  }
  for (const e of grouped.codex_events) {
    const proj = classifyEvent(e, knownProjects);
    if (proj) ensureProject(proj).codex.push(e);
    else otherAI.push(e);
  }

  // Build per-project sections
  for (const [proj, events] of projectMap) {
    sections.push(`## 项目: ${proj}`);
    sections.push("");

    if (events.git.length > 0) {
      sections.push("### Git 提交");
      for (const e of events.git) {
        sections.push(`- [${e.entity_id.slice(0, 7)}] ${e.summary} (作者: ${e.author || "unknown"})`);
      }
      sections.push("");
    }

    if (events.github.length > 0) {
      sections.push("### GitHub 活动");
      for (const e of events.github) {
        const stateLabel = e.state ? ` [${e.state}]` : "";
        sections.push(`- ${e.entity_type}${stateLabel}: ${e.summary}`);
      }
      sections.push("");
    }

    if (events.claude.length > 0) {
      sections.push("### Claude Code 对话摘录");
      for (const e of events.claude) {
        sections.push(`- ${e.summary} (${e.message_count || 0} 条消息)`);
      }
      sections.push("");
    }

    if (events.codex.length > 0) {
      sections.push("### Codex 对话摘录");
      for (const e of events.codex) {
        sections.push(`- ${e.summary} (${e.message_count || 0} 条消息)`);
      }
      sections.push("");
    }
  }

  // Other AI conversations
  if (otherAI.length > 0) {
    sections.push("## 其他 AI 对话（不绑定特定项目）");
    for (const e of otherAI) {
      const label = e.source === "claude" ? "Claude" : "Codex";
      sections.push(`- [${label}] ${projectName(e)}: ${e.summary} (${e.message_count || 0} 条消息)`);
    }
    sections.push("");
  }

  if (manualTodo) {
    sections.push(`用户手动补充的明日计划: ${manualTodo}`);
    sections.push("");
  }

  sections.push("");
  sections.push("请输出以下格式的日报：");
  sections.push("---");
  sections.push("TL;DR:");
  sections.push("- (今天做的最重要的 2-4 件事，以项目为维度)");
  sections.push("");
  sections.push("PROJECTS:");
  sections.push("### <项目名>");
  sections.push("<综合总结该项目的 Git 提交、GitHub 活动、AI 对话等内容，一句或两句话>");
  sections.push("");
  sections.push("### <项目名>");
  sections.push("<综合总结>");
  sections.push("");
  sections.push("OTHER_AI:");
  sections.push("<不绑定特定项目的 AI 对话话题总结，并提出一些后续发展 idea>");
  sections.push("");
  sections.push("TOMORROW:");
  sections.push("- (基于今天未完成工作的具体明日建议，不要写「继续今天的工作」这种空话)");
  sections.push("---");

  return sections.join("\n");
}

/**
 * Parse LLM response into DailyReport structure (project-oriented format).
 */
export function parseResponse(text: string, date: string): DailyReport {
  const report: DailyReport = {
    date,
    tldr: [],
    projects: [],
    other_ai: "",
    tomorrow_suggestions: [],
  };

  // Parse TL;DR
  const tldrMatch = text.match(/TL;DR:?\n([\s\S]*?)(?=\nPROJECTS:|\nOTHER_AI:|\nTOMORROW:|$)/i);
  if (tldrMatch) {
    report.tldr = tldrMatch[1]
      .split("\n")
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 0);
  }

  // Parse PROJECTS section: split by ### headings
  const projectsMatch = text.match(/PROJECTS:?\n([\s\S]*?)(?=\nOTHER_AI:|\nTOMORROW:|$)/i);
  if (projectsMatch) {
    const projectsText = projectsMatch[1];
    // Split by ### headings
    const blocks = projectsText.split(/\n(?=###\s)/);
    for (const block of blocks) {
      const headingMatch = block.match(/^###\s+(.+?)\n([\s\S]*)/);
      if (headingMatch) {
        report.projects.push({
          project: headingMatch[1].trim(),
          summary: headingMatch[2].trim(),
        });
      }
    }
  }

  // Parse OTHER_AI
  const otherMatch = text.match(/OTHER_AI:?\n([\s\S]*?)(?=\nTOMORROW:|$)/i);
  if (otherMatch) {
    report.other_ai = otherMatch[1].trim();
  }

  // Parse TOMORROW
  const tomorrowMatch = text.match(/TOMORROW:?\n([\s\S]*?)$/i);
  if (tomorrowMatch) {
    report.tomorrow_suggestions = tomorrowMatch[1]
      .split("\n")
      .map((l) => l.replace(/^(\d+\.\s*|[-*]\s*)/, "").trim())
      .filter((l) => l.length > 0);
  }

  return report;
}

/**
 * Template-based fallback when LLM API fails.
 * Groups events by project.
 */
export function templateReport(
  grouped: GroupedEvents,
  date: string,
  manualTodo?: string
): DailyReport {
  const tldr: string[] = [];
  const projects: ProjectSummary[] = [];
  const tomorrow: string[] = [];
  const otherAIParts: string[] = [];

  // Determine known project names
  const knownProjects = new Set<string>();
  for (const e of grouped.git_events) knownProjects.add(projectName(e));
  for (const e of grouped.github_events) knownProjects.add(projectName(e));

  // Group by project
  const projectMap = new Map<string, {
    git: SanitizedEvent[];
    github: SanitizedEvent[];
    claude: SanitizedEvent[];
    codex: SanitizedEvent[];
  }>();

  function ensure(name: string) {
    if (!projectMap.has(name)) {
      projectMap.set(name, { git: [], github: [], claude: [], codex: [] });
    }
    return projectMap.get(name)!;
  }

  for (const e of grouped.git_events) ensure(projectName(e)).git.push(e);
  for (const e of grouped.github_events) ensure(projectName(e)).github.push(e);
  for (const e of grouped.claude_events) {
    const proj = classifyEvent(e, knownProjects);
    if (proj) ensure(proj).claude.push(e);
    else otherAIParts.push(`[Claude] ${projectName(e)}: ${e.summary}`);
  }
  for (const e of grouped.codex_events) {
    const proj = classifyEvent(e, knownProjects);
    if (proj) ensure(proj).codex.push(e);
    else otherAIParts.push(`[Codex] ${projectName(e)}: ${e.summary}`);
  }

  // Build project summaries
  for (const [proj, events] of projectMap) {
    const parts: string[] = [];
    if (events.git.length > 0) {
      const commits = events.git.map((c) => c.summary).join("; ");
      parts.push(`Git: ${commits}`);
    }
    if (events.github.length > 0) {
      parts.push(`GitHub: ${events.github.map((e) => `[${e.entity_type}] ${e.summary}`).join("; ")}`);
    }
    if (events.claude.length > 0) {
      parts.push(`Claude Code 协作`);
    }
    if (events.codex.length > 0) {
      parts.push(`Codex 协作`);
    }

    const summary = parts.join("。");
    projects.push({ project: proj, summary });

    tldr.push(`${proj}: ${summary}`);
  }

  const otherAI = otherAIParts.length > 0 ? otherAIParts.join("\n") : "无";

  // Tomorrow suggestions
  const wipCommits = grouped.git_events.filter((e) =>
    e.summary.toLowerCase().includes("wip") ||
    e.summary.startsWith("fix") ||
    e.summary.startsWith("feat")
  );
  if (wipCommits.length > 0) {
    tomorrow.push(`继续完成: ${wipCommits.map((c) => c.summary).slice(0, 2).join("、")}`);
  }
  const openPRs = grouped.github_events.filter((e) => e.entity_type === "pr" && e.state === "open");
  if (openPRs.length > 0) {
    tomorrow.push(`跟踪 PR: ${openPRs.map((p) => `#${p.entity_id}`).join("、")}`);
  }
  if (manualTodo) {
    tomorrow.push(manualTodo);
  }
  if (tomorrow.length === 0) {
    tomorrow.push("回顾今天的提交和对话，整理待办事项");
  }

  if (tldr.length === 0) {
    tldr.push("今天没有活动记录，享受休息日 ☀️");
  }

  return {
    date,
    tldr,
    projects,
    other_ai: otherAI,
    tomorrow_suggestions: tomorrow,
  };
}

// ============================================================
// LLM Retry Support
// ============================================================

/**
 * 判断 LLM 调用错误是否应该重试。
 * 重试：网络错误、5xx、429、超时、非标准错误
 * 不重试：其他 4xx、空内容、JSON 解析失败
 */
export function shouldRetry(err: unknown): boolean {
  // 非 Error 实例 → 未知异常，保守重试
  if (!(err instanceof Error)) {
    return true;
  }

  const msg = err.message;

  // 网络错误（fetch 底层异常，如 DNS/连接拒绝）
  if (err.name === "TypeError") {
    return true;
  }

  // AbortError / 超时
  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return true;
  }

  // 自构造错误的分类：通过消息模式匹配
  // HTTP 5xx
  if (msg.includes("API 返回 5")) {
    return true;
  }

  // HTTP 429
  if (msg.includes("API 返回 429")) {
    return true;
  }

  // 其他 4xx（400, 401, 403...）不重试
  if (msg.includes("API 返回 4")) {
    return false;
  }

  // 空内容
  if (msg.includes("API 返回空内容")) {
    return false;
  }

  // JSON 解析失败及其他 → 不重试
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带指数退避的重试执行器。
 * 每次重试前等待 baseDelayMs * 2^(attempt-1)，上限 30s。
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`✅ LLM API 第 ${attempt}/${maxRetries} 次重试成功`);
      }
      return result;
    } catch (err: unknown) {
      lastError = err;

      if (!shouldRetry(err) || attempt === maxRetries) {
        break;
      }

      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 30000);
      const delaySec = (delayMs / 1000).toFixed(0);

      const reason = getErrorReason(err);
      console.warn(
        `⚠️  LLM API 调用失败 (${reason})，${delaySec}s 后第 ${attempt}/${maxRetries} 次重试...`
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * 从错误中提取可读的原因描述
 */
function getErrorReason(err: unknown): string {
  if (!(err instanceof Error)) {
    return "未知错误";
  }

  const msg = err.message;

  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return "超时";
  }
  if (err.name === "TypeError") {
    return "网络错误";
  }

  // 提取 HTTP 状态码
  const httpMatch = msg.match(/API 返回 (\d+)/);
  if (httpMatch) {
    return `HTTP ${httpMatch[1]}`;
  }

  return err.message.slice(0, 50);
}

/**
 * 判断 LLM 调用错误是否应该重试。
 * 重试：网络错误、5xx、429、超时、非标准错误
 * 不重试：其他 4xx、空内容、JSON 解析失败
 */
export function shouldRetry(err: unknown): boolean {
  // 非 Error 实例 → 未知异常，保守重试
  if (!(err instanceof Error)) {
    return true;
  }

  const msg = err.message;

  // 网络错误（fetch 底层异常，如 DNS/连接拒绝）
  // fetch 抛出的 TypeError 通常消息包含 "fetch" 或 "network"
  if (err.name === "TypeError") {
    return true;
  }

  // AbortError / 超时
  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return true;
  }

  // 自构造错误的分类：通过消息模式匹配
  // HTTP 5xx
  if (msg.includes("API 返回 5")) {
    return true;
  }

  // HTTP 429
  if (msg.includes("API 返回 429")) {
    return true;
  }

  // 其他 4xx（400, 401, 403...）不重试
  if (msg.includes("API 返回 4")) {
    return false;
  }

  // 空内容
  if (msg.includes("API 返回空内容")) {
    return false;
  }

  // JSON 解析失败及其他 → 不重试
  return false;
}

/**
 * Generate daily report by calling the configured LLM API.
 * Supports OpenAI-compatible and Anthropic APIs.
 * Retries with exponential backoff on transient failures.
 * Falls back to template if all retries fail.
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
  const systemPrompt = "你是一个专业的工作日报助手。请用简洁、有条理的中文回复。";
  const maxTokens = Math.min(config.privacy.maxTokensSent, 2048);
  const isAnthropic = config.llm.provider === "anthropic";
  const maxRetries = config.llm.maxRetries ?? 5;
  const retryBaseDelayMs = config.llm.retryBaseDelayMs ?? 1000;
  const timeoutMs = config.llm.requestTimeoutMs ?? 30000;

  const url = isAnthropic
    ? `${config.llm.baseUrl.replace(/\/$/, "")}/v1/messages`
    : `${config.llm.baseUrl.replace(/\/$/, "")}/chat/completions`;

  const callLLM = async (): Promise<string> => {
    let body: string;
    let headers: Record<string, string>;

    if (isAnthropic) {
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({
        model: config.llm.model,
        max_tokens: maxTokens,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          { role: "user", content: prompt },
        ],
      });
    } else {
      headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model: config.llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`API 返回 ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await response.json();

    // Parse response: Anthropic vs OpenAI-compatible format
    let content: string;
    if (isAnthropic) {
      content = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
    } else {
      content = data.choices?.[0]?.message?.content || "";
    }

    if (!content) {
      throw new Error("API 返回空内容");
    }

    return content;
  };

  try {
    const content = await retryWithBackoff(callLLM, maxRetries, retryBaseDelayMs);
    return parseResponse(content, date);
  } catch (err: any) {
    console.warn(`❌ LLM API 已重试 ${maxRetries}/${maxRetries} 次，全部失败，回退到模板生成`);
    console.warn(`   最后错误: ${err?.message || err}`);
    return templateReport(grouped, date, manualTodo);
  }
}
