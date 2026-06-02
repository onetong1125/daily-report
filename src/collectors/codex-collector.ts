import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SanitizedEvent, TimeBoundary } from "../types";

const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

/**
 * Simple keyword/topic extraction (same strategy as Claude collector).
 * Does NOT call any LLM.
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
    wordFreq.set(t, (wordFreq.get(t) || 0) + 3);
  }

  // Extract specific filenames
  const fileMatches = allText.match(/\b[\w/-]+\.(ts|py|js|rs|go|java|md|json|yaml|toml)\b/gi) || [];
  for (const f of fileMatches.slice(0, 5)) {
    const basename = f.split("/").pop() || f;
    wordFreq.set(basename, (wordFreq.get(basename) || 0) + 5);
  }

  // Filter stop words
  const stopWords = new Set(["的", "了", "是", "我", "在", "有", "和", "不", "这", "你", "他", "也", "都", "要", "会", "就", "能", "对", "去", "很", "到", "说", "想", "看", "让", "给", "被", "把", "用", "做", "为", "可以", "什么", "怎么", "这个", "那个", "一个", "没有", "已经", "还是", "就是", "如果", "因为", "所以", "但是", "然后", "现在", "需要", "应该", "知道", "觉得", "问题", "我们", "他们", "自己", "不是", "比较", "出来", "起来", "时候", "可能"]);
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
 * Parse a Codex session JSONL file.
 * Codex stores message data in the `payload` field as a nested JSON object.
 * Record types: session_meta, response_item (user/assistant messages), event_msg, turn_context
 */
function parseCodexSession(
  filePath: string,
  boundary: TimeBoundary
): SanitizedEvent | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length === 0) return null;

    let projectPath = "";
    let firstTimestamp = "";
    let sessionId = "";
    const userMessages: string[] = [];
    let userCount = 0;
    let assistantCount = 0;

    for (const line of lines) {
      try {
        const record = JSON.parse(line);

        // session_meta: extract cwd and id from payload object
        if (record.type === "session_meta") {
          firstTimestamp = record.timestamp || firstTimestamp;
          const payload = record.payload;
          if (payload && typeof payload === "object") {
            if (payload.cwd && !projectPath) projectPath = payload.cwd;
            if (payload.id && !sessionId) sessionId = payload.id;
          }
        }

        // response_item: contains actual messages (role + content array)
        if (record.type === "response_item") {
          firstTimestamp = record.timestamp || firstTimestamp;
          const payload = record.payload;
          if (payload && typeof payload === "object") {
            const role = payload.role;
            const content = payload.content;

            if (role === "user") {
              userCount++;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block && typeof block === "object" && block.text) {
                    userMessages.push(String(block.text));
                  }
                }
              }
            } else if (role === "assistant") {
              assistantCount++;
            }
          }
        }

        // event_msg: turn lifecycle events, capture timestamp only
        if (record.type === "event_msg") {
          if (!firstTimestamp) firstTimestamp = record.timestamp;
        }
      } catch {
        // skip unparseable lines
      }
    }

    if (!firstTimestamp) return null;

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

    // Deduce session ID from filename if not found in metadata
    if (!sessionId) {
      sessionId = path.basename(filePath, ".jsonl").replace("rollout-", "");
    }

    const topicSummary = extractTopics(userMessages);

    return {
      source: "codex",
      repo: projectPath || "unknown",
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
 * Collect today's Codex CLI sessions from ~/.codex/sessions/
 * Codex sessions are organized by year/month/day.
 */
export function collectCodexEvents(boundary: TimeBoundary): SanitizedEvent[] {
  const events: SanitizedEvent[] = [];

  if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
    console.warn("⚠️  Codex 会话目录不存在，跳过 Codex 数据采集");
    return events;
  }

  try {
    // Parse boundary date to get year/month/day for directory lookup
    const targetDate = new Date(boundary.startUtc);
    // But boundary is in UTC, we need to look in the local directory structure
    // Codex stores by local date, so check a few days around the target
    const date = new Date(boundary.date + "T12:00:00");
    const year = date.getFullYear().toString();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const dayDir = path.join(CODEX_SESSIONS_DIR, year, month, day);

    if (!fs.existsSync(dayDir)) return events;

    const files = fs.readdirSync(dayDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const filePath = path.join(dayDir, file.name);
      const event = parseCodexSession(filePath, boundary);
      if (event) {
        events.push(event);
      }
    }
  } catch (err: any) {
    console.warn(`⚠️  读取 Codex 会话数据失败: ${err.message}`);
  }

  return events;
}
