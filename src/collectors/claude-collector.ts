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
/**
 * Extract a human-readable conversation summary from user messages.
 * Returns null if no meaningful content can be extracted,
 * signalling that this session should be skipped.
 */
export function extractClaudeSummary(messages: string[]): string | null {
  if (messages.length === 0) return null;

  // Filter out system prompts, skill instructions, and other noise
  const noisePatterns = [
    /^</,                           // XML tags
    /^You are/,                     // system prompts
    /^#!/,                          // shebang
    /^#/,                           // Markdown headings (skill content, instructions)
    /^Base directory for this skill/i,  // skill instructions
    /^\[Request interrupted/,       // interrupt markers
    /^\[{/,                         // JSON-ish system messages
    /^EXTREMELY IMPORTANT/,         // skill emphasis banners
    /^IMPORTANT:/,                  // instruction banners
  ];
  const isNoise = (m: string): boolean => noisePatterns.some((p) => p.test(m));

  const substantive = messages
    .map((m) => m.trim())
    .filter((m) => m.length > 20)
    .filter((m) => !isNoise(m));

  if (substantive.length === 0) return null;

  // Take up to 5 representative messages, truncate each to 120 chars
  const excerpts = substantive.slice(0, 5).map((m) => {
    const cleaned = m.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return cleaned.length > 120 ? cleaned.slice(0, 117) + "..." : cleaned;
  });

  return excerpts.join(" | ");
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
    const topicSummary = extractClaudeSummary(userMessages);
    if (!topicSummary) return null;

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
