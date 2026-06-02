import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DailyReportConfig } from "./types";

const CONFIG_DIR = path.join(os.homedir(), ".daily-report");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: DailyReportConfig = {
  repos: [],
  llm: {
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "${OPENAI_API_KEY}",
    model: "gpt-4o",
  },
  report: {
    outputDir: path.join(CONFIG_DIR, "reports"),
    printToTerminal: true,
    timezone: "Asia/Shanghai",
  },
  privacy: {
    requireConfirmation: true,
    maxTokensSent: 4096,
    allowedFields: [
      "source", "repo", "timestamp", "entity_id", "entity_type",
      "summary", "related_entities", "author", "state", "message_count",
    ],
  },
  schedule: {
    enabled: false,
    cron: "0 18 * * 1-5",
  },
};

/** Resolve ${ENV_VAR} placeholders in a string */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "");
}

/** Ensure the config directory exists */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const reportsDir = path.join(CONFIG_DIR, "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const logsDir = path.join(CONFIG_DIR, "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

/** Load config from ~/.daily-report/config.json, with defaults for missing fields */
export function loadConfig(): DailyReportConfig {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const userConfig = JSON.parse(raw) as Partial<DailyReportConfig>;

    // Deep merge with defaults
    const merged: DailyReportConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      repos: userConfig.repos ?? DEFAULT_CONFIG.repos,
      llm: { ...DEFAULT_CONFIG.llm, ...(userConfig.llm ?? {}) },
      report: { ...DEFAULT_CONFIG.report, ...(userConfig.report ?? {}) },
      privacy: { ...DEFAULT_CONFIG.privacy, ...(userConfig.privacy ?? {}) },
      schedule: { ...DEFAULT_CONFIG.schedule, ...(userConfig.schedule ?? {}) },
    };

    // Resolve home directory in outputDir
    merged.report.outputDir = merged.report.outputDir.replace(/^~/, os.homedir());

    return merged;
  } catch (err) {
    console.error(`Failed to load config, using defaults: ${err}`);
    return { ...DEFAULT_CONFIG };
  }
}

/** Save config to ~/.daily-report/config.json */
export function saveConfig(config: DailyReportConfig): void {
  ensureConfigDir();
  // Write with pretty formatting for user readability
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** Get the resolved API key (env vars resolved) */
export function getResolvedApiKey(config: DailyReportConfig): string {
  return resolveEnvVars(config.llm.apiKey);
}

/** Get config directory path */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/** Get reports directory path */
export function getReportsDir(config: DailyReportConfig): string {
  return config.report.outputDir.replace(/^~/, os.homedir());
}

/** Get logs directory path */
export function getLogsDir(): string {
  return path.join(CONFIG_DIR, "logs");
}
