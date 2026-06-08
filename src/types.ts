// Shared types for daily-report tool
// SanitizedEvent is the unified schema all collectors map to (§4.3)

export type EventSource = "git" | "github" | "claude" | "codex";
export type EntityType = "commit" | "pr" | "issue" | "review" | "session";

export interface SanitizedEvent {
  source: EventSource;
  repo: string;
  timestamp: string;          // ISO 8601 UTC
  entity_id: string;          // commit SHA / PR number / session ID
  entity_type: EntityType;
  summary: string;            // one-line summary extracted locally
  related_entities: string[]; // cross-references to other entity_ids
  author?: string;
  state?: string;             // PR/Issue state: open/merged/closed
  message_count?: number;     // session events only
}

// Grouped events after merger
export interface GroupedEvents {
  git_events: SanitizedEvent[];
  github_events: SanitizedEvent[];
  claude_events: SanitizedEvent[];
  codex_events: SanitizedEvent[];
}

// Per-project summary in the report
export interface ProjectSummary {
  project: string;
  summary: string;
}

// Report structure returned by generator — project-oriented, not source-oriented
export interface DailyReport {
  date: string;
  tldr: string[];
  projects: ProjectSummary[];
  other_ai: string;
  tomorrow_suggestions: string[];
}

// Config types
export interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries?: number;         // 最大重试次数，默认 5
  retryBaseDelayMs?: number;   // 基础延迟 ms，默认 1000
  requestTimeoutMs?: number;   // 单次请求超时 ms，默认 30000
}

export interface ReportConfig {
  outputDir: string;
  printToTerminal: boolean;
  timezone: string;
}

export interface PrivacyConfig {
  requireConfirmation: boolean;
  maxTokensSent: number;
  allowedFields: string[];
}

export interface ScheduleConfig {
  enabled: boolean;
  cron: string;
}

export interface DailyReportConfig {
  repos: string[];
  llm: LLMConfig;
  report: ReportConfig;
  privacy: PrivacyConfig;
  schedule: ScheduleConfig;
}

// Time boundary result
export interface TimeBoundary {
  startUtc: string;  // ISO 8601, half-open start
  endUtc: string;    // ISO 8601, half-open end
  date: string;       // YYYY-MM-DD in the configured timezone
}
