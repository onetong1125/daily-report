import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SanitizedEvent, TimeBoundary } from "../types";

const CODEX_SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");

/**
 * Simple keyword/topic extraction (same strategy as Claude collector).
 * Does NOT call any LLM.
 */
/**
 * Extract a human-readable conversation summary from user messages.
 * Takes the first few substantive messages as context excerpts.
 */
export function extractCodexSummary(messages: string[]): string {
  if (messages.length === 0) return "无对话内容";

  const noisePatterns = [
    /^</,
    /^You are/,
    /^#!/,
    /^Base directory for this skill/i,
    /^\[Request interrupted/,
    /^\[{/
  ];
  const isNoise = (m: string): boolean => noisePatterns.some((p) => p.test(m));

  const substantive = messages
    .map((m) => m.trim())
    .filter((m) => m.length > 20)
    .filter((m) => !isNoise(m));

  if (substantive.length === 0) {
    const totalChars = messages.join("").length;
    if (totalChars > 2000) return "有大量技术对话";
    if (totalChars > 300) return "有简短对话";
    return "几乎无对话内容";
  }

  const excerpts = substantive.slice(0, 5).map((m) => {
    const cleaned = m.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.length > 120 ? cleaned.slice(0, 117) + "..." : cleaned;
  });

  return excerpts.join(" | ");
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

    const topicSummary = extractCodexSummary(userMessages);

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
