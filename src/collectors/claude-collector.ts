import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SanitizedEvent, TimeBoundary } from "../types";

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

/**
 * Simple keyword/topic extraction from user messages.
 * Does NOT call any LLM — uses regex and keyword frequency.
 * Returns a summary string like "讨论了 daily-report 工具的需求、架构设计和安全方案"
 */
function extractTopics(messages: string[]): string {
  if (messages.length === 0) return "无对话内容";

  const allText = messages.join(" ");

  // Match meaningful CJK words (2+ chars) and English tech terms
  const cjkWords = allText.match(/[一-鿿]{2,4}/g) || [];
  const techTerms = allText.match(/\b(AI|LLM|API|CLI|UI|SQL|PR|Issue|commit|Git|GitHub|Claude|Codex|TypeScript|Python|Node\.js|React|Vue|Docker|K8s|RL|PPO|DQN|训练|推理|部署|测试|调试|修复|设计|重构|优化|日报|report|config|setup|安全|隐私|privacy|schedule)\b/gi) || [];

  // Count word frequencies
  const wordFreq = new Map<string, number>();
  for (const w of cjkWords) {
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
  }
  for (const t of techTerms) {
    wordFreq.set(t, (wordFreq.get(t) || 0) + 3); // tech terms have higher weight
  }

  // Extract specific filenames
  const fileMatches = allText.match(/\b[\w/-]+\.(ts|py|js|rs|go|java|md|json|yaml|toml)\b/gi) || [];
  for (const f of fileMatches.slice(0, 5)) {
    const basename = f.split("/").pop() || f;
    wordFreq.set(basename, (wordFreq.get(basename) || 0) + 5);
  }

  // Filter stop words and sort by frequency
  const stopWords = new Set(["的", "了", "是", "我", "在", "有", "和", "不", "这", "你", "他", "也", "都", "要", "会", "就", "能", "对", "去", "很", "到", "说", "想", "看", "让", "给", "被", "把", "用", "做", "为", "可以", "什么", "怎么", "这个", "那个", "一个", "没有", "已经", "还是", "就是", "如果", "因为", "所以", "但是", "然后", "现在", "需要", "应该", "知道", "觉得", "问题", "我们", "他们", "自己", "还是", "不是", "比较", "出来", "起来", "时候", "可能"]);
  const topTopics = [...wordFreq.entries()]
    .filter(([w]) => !stopWords.has(w) && w.length > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  if (topTopics.length === 0) {
    const totalChars = allText.length;
    if (totalChars > 1000) return "有大量技术对话";
    if (totalChars > 200) return "有简短对话";
    return "几乎无对话内容";
  }

  return `讨论了 ${topTopics.join("、")}`;
}

/**
 * Parse a Claude session JSONL file.
 * Returns session info or null if the file can't be parsed / isn't in today's range.
 */
function parseClaudeSession(
  filePath: string,
  boundary: TimeBoundary
): SanitizedEvent | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length === 0) return null;

    let projectPath = "";
    let firstTimestamp = "";
    let userMessages: string[] = [];
    let assistantCount = 0;
    let userCount = 0;

    for (const line of lines) {
      try {
        const record = JSON.parse(line);

        // Skip non-message records (like "last-prompt")
        if (record.type === "last-prompt" || record.type === "summary") continue;

        // Capture cwd from the first record that has it
        if (!projectPath && record.cwd) {
          projectPath = record.cwd;
        }

        // Capture timestamp from the first record that has it
        if (!firstTimestamp && record.timestamp) {
          firstTimestamp = record.timestamp;
        }

        // Count user messages
        if (record.type === "user") {
          userCount++;
          // Extract display text from user messages
          if (record.message) {
            try {
              const msg = typeof record.message === "string"
                ? JSON.parse(record.message)
                : record.message;
              if (msg.content && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === "text" && block.text) {
                    userMessages.push(block.text);
                  }
                }
              }
            } catch {
              // message might be a plain string
              userMessages.push(String(record.message));
            }
          }
        }

        if (record.type === "assistant") {
          assistantCount++;
        }
      } catch {
        // skip unparseable lines
      }
    }

    if (!firstTimestamp || !projectPath) return null;

    // Check if session is relevant to today using TWO signals:
    // 1. The first record's timestamp falls within today's range (new session)
    // 2. The file was modified today (ongoing session from a previous day)
    const ts = new Date(firstTimestamp).toISOString();
    const sessionStartedToday = ts >= boundary.startUtc && ts < boundary.endUtc;

    let modifiedToday = false;
    try {
      const stat = fs.statSync(filePath);
      const mtime = stat.mtime.toISOString();
      modifiedToday = mtime >= boundary.startUtc && mtime < boundary.endUtc;
    } catch {}

    if (!sessionStartedToday && !modifiedToday) return null;

    const sessionId = path.basename(filePath, ".jsonl");
    const topicSummary = extractTopics(userMessages);

    return {
      source: "claude",
      repo: projectPath,
      timestamp: ts,
      entity_id: sessionId,
      entity_type: "session",
      summary: topicSummary,
      related_entities: [],
      message_count: userCount + assistantCount,
    };
  } catch {
    return null;
  }
}

/**
 * Collect today's Claude Code sessions from ~/.claude/projects/
 */
export function collectClaudeEvents(boundary: TimeBoundary): SanitizedEvent[] {
  const events: SanitizedEvent[] = [];

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.warn("⚠️  Claude 项目目录不存在，跳过 Claude 数据采集");
    return events;
  }

  try {
    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, dir.name);
      const files = fs.readdirSync(projectDir, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
        const filePath = path.join(projectDir, file.name);
        const event = parseClaudeSession(filePath, boundary);
        if (event) {
          events.push(event);
        }
      }
    }
  } catch (err: any) {
    console.warn(`⚠️  读取 Claude 会话数据失败: ${err.message}`);
  }

  return events;
}
