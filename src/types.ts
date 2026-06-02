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

// Report structure returned by generator
export interface DailyReport {
  date: string;
  tldr: string[];
  git_section: string;
  github_section: string;
  claude_section: string;
  codex_section: string;
  tomorrow_suggestions: string[];
}

// Config types
export interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
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
