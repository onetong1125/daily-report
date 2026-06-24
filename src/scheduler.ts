import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync, execSync } from "child_process";
import { DailyReportConfig } from "./types";
import { saveConfig } from "./config";

const PLIST_LABEL = "com.daily-report";
const PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${PLIST_LABEL}.plist`
);

export interface LaunchdCalendarInterval {
  Minute?: number;
  Hour?: number;
  Day?: number;
  Month?: number;
  Weekday?: number;
}

const WEEKDAYS: Record<string, string> = {
  mon: "1", monday: "1",
  tue: "2", tuesday: "2",
  wed: "3", wednesday: "3",
  thu: "4", thursday: "4",
  fri: "5", friday: "5",
  sat: "6", saturday: "6",
  sun: "0", sunday: "0",
};

export const SCHEDULE_EXPRESSION_HELP = [
  "支持的格式:",
  "  daily-report schedule set \"21:00\"",
  "  daily-report schedule set \"21:00 weekday\"",
  "  daily-report schedule set \"21:00 weekend\"",
  "  daily-report schedule set \"21:00 mon,fri\"",
  "  daily-report schedule set \"00 21 * * *\"",
  "提示: cron 表达式建议加引号，避免 shell 展开 *。",
].join("\n");

export function getScheduleTimeInputError(input: string): string | undefined {
  try {
    parseTimeExpression(`${input.trim()} *`);
    return undefined;
  } catch {
    return "请输入 HH:mm 格式，例如 21:00（小时 0-23，分钟 0-59）";
  }
}

/**
 * Convert friendly time format to cron expression.
 * Supported:
 *   "18:00"          → "0 18 * * *"
 *   "18:00 *"        → "0 18 * * *"
 *   "18:00 weekday"  → "0 18 * * 1-5"
 *   "18:00 mon,fri"  → "0 18 * * 1,5"
 *   "0 18 * * 1-5"   → passed through
 */
export function parseTimeExpression(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Schedule expression cannot be empty");
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    validateCronExpression(trimmed);
    return trimmed;
  }

  if (parts.length > 5) {
    throw new Error(`Expected a 5-field cron expression, got ${parts.length} fields. Quote cron expressions that contain *.`);
  }

  const timeMatch = parts[0].match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    throw new Error(`Invalid schedule expression: ${input}`);
  }

  const hour = timeMatch[1];
  const minute = timeMatch[2];
  parseCronNumber(hour, 0, 23, "hour");
  parseCronNumber(minute, 0, 59, "minute");

  let dayOfWeek = "*";
  if (parts.length > 1) {
    const freq = parts.slice(1).join(" ").trim().toLowerCase();
    if (freq === "*") {
      dayOfWeek = "*";
    } else if (freq === "weekday" || freq === "weekdays") {
      dayOfWeek = "1-5";
    } else if (freq === "weekend") {
      dayOfWeek = "0,6";
    } else {
      const days = freq.split(",").map((day) => {
        const normalized = WEEKDAYS[day.trim().toLowerCase()];
        if (!normalized) {
          throw new Error(`Invalid schedule frequency: ${day}`);
        }
        return normalized;
      });
      dayOfWeek = days.join(",");
    }
  }

  const cron = `${minute} ${hour} * * ${dayOfWeek}`;
  validateCronExpression(cron);
  return cron;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function getLaunchctlDomain(): string {
  const getuid = process.getuid;
  return `gui/${typeof getuid === "function" ? getuid() : os.userInfo().uid}`;
}

function resolveDailyReportLauncher(): string {
  try {
    const found = execSync("command -v daily-report 2>/dev/null || true", {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (found) return found;
  } catch {
    // Fall through to a clearer error below.
  }

  throw new Error("Cannot find the global daily-report command. Run `npm install -g daily-report` before enabling schedule.");
}

function resolveScheduledCommand(): string[] {
  return buildScheduledCommandArgs(resolveDailyReportLauncher());
}

export function buildScheduledCommandArgs(dailyReportCommand: string): string[] {
  return [dailyReportCommand, "run-scheduled"];
}

function serializeShellCommand(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function parseCronNumber(value: string, min: number, max: number, fieldName: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${fieldName} field: ${value}`);
  }
  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    throw new Error(`Invalid ${fieldName} value: ${value}`);
  }
  return parsed;
}

function expandCronField(
  field: string,
  min: number,
  max: number,
  fieldName: string,
  normalize?: (value: number) => number
): number[] | undefined {
  if (field === "*") return undefined;

  const values = new Set<number>();
  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`Invalid ${fieldName} field: ${field}`);
    }

    const stepParts = part.split("/");
    if (stepParts.length > 2) {
      throw new Error(`Invalid ${fieldName} field: ${field}`);
    }

    const [rangePart, stepPart] = stepParts;
    const step = stepPart === undefined
      ? 1
      : parseCronNumber(stepPart, 1, max - min + 1, fieldName);

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const rangeParts = rangePart.split("-");
      if (rangeParts.length !== 2) {
        throw new Error(`Invalid ${fieldName} range: ${rangePart}`);
      }
      const [rawStart, rawEnd] = rangeParts;
      start = parseCronNumber(rawStart, min, max, fieldName);
      end = parseCronNumber(rawEnd, min, max, fieldName);
      if (start > end) {
        throw new Error(`Invalid ${fieldName} range: ${rangePart}`);
      }
    } else {
      start = parseCronNumber(rangePart, min, max, fieldName);
      end = start;
    }

    for (let value = start; value <= end; value += step) {
      values.add(normalize ? normalize(value) : value);
    }
  }

  return [...values].sort((a, b) => a - b);
}

export function validateCronExpression(cron: string): void {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected a 5-field cron expression, got: ${cron}`);
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = parts;
  expandCronField(minuteField, 0, 59, "minute");
  expandCronField(hourField, 0, 23, "hour");
  expandCronField(dayField, 1, 31, "day");
  expandCronField(monthField, 1, 12, "month");
  expandCronField(weekdayField, 0, 7, "weekday");
}

export function cronToLaunchdCalendarIntervals(cron: string): LaunchdCalendarInterval[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected a 5-field cron expression, got: ${cron}`);
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = parts;
  const minutes = expandCronField(minuteField, 0, 59, "minute");
  const hours = expandCronField(hourField, 0, 23, "hour");
  const days = expandCronField(dayField, 1, 31, "day");
  const months = expandCronField(monthField, 1, 12, "month");
  const weekdays = expandCronField(
    weekdayField,
    0,
    7,
    "weekday",
    (value) => (value === 7 ? 0 : value)
  );

  if (days && weekdays) {
    throw new Error("macOS launchd cannot safely represent cron expressions that restrict both day-of-month and weekday");
  }

  const fields: Array<[keyof LaunchdCalendarInterval, number[] | undefined]> = [
    ["Month", months],
    ["Day", days],
    ["Weekday", weekdays],
    ["Hour", hours],
    ["Minute", minutes],
  ];

  let intervals: LaunchdCalendarInterval[] = [{}];
  for (const [key, values] of fields) {
    if (!values) continue;
    intervals = intervals.flatMap((interval) =>
      values.map((value) => ({ ...interval, [key]: value }))
    );
  }

  return intervals;
}

function renderLaunchdInterval(interval: LaunchdCalendarInterval, indent: string): string {
  const keys: Array<keyof LaunchdCalendarInterval> = ["Month", "Day", "Weekday", "Hour", "Minute"];
  const body = keys
    .filter((key) => interval[key] !== undefined)
    .map((key) => `${indent}    <key>${key}</key>\n${indent}    <integer>${interval[key]}</integer>`)
    .join("\n");
  return `${indent}<dict>${body ? `\n${body}\n${indent}` : ""}</dict>`;
}

function renderStartCalendarInterval(cron: string): string {
  const intervals = cronToLaunchdCalendarIntervals(cron);
  if (intervals.length === 1) {
    return renderLaunchdInterval(intervals[0], "    ");
  }

  return [
    "    <array>",
    ...intervals.map((interval) => renderLaunchdInterval(interval, "        ")),
    "    </array>",
  ].join("\n");
}

function launchdPathEnv(): string {
  const candidates = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(candidates.filter(Boolean))].join(":");
}

function buildLaunchdPlist(cron: string, args: string[]): string {
  const stdoutPath = path.join(os.homedir(), ".daily-report", "logs", "stdout.log");
  const stderrPath = path.join(os.homedir(), ".daily-report", "logs", "stderr.log");
  const pathEnv = launchdPathEnv();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((a) => `        <string>${xmlEscape(a)}</string>`).join("\n")}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xmlEscape(pathEnv)}</string>
    </dict>
    <key>StartCalendarInterval</key>
${renderStartCalendarInterval(cron)}
    <key>StandardOutPath</key>
    <string>${xmlEscape(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(stderrPath)}</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;
}

function unloadLaunchdJob(): void {
  try {
    execFileSync("launchctl", ["bootout", getLaunchctlDomain(), PLIST_PATH], { stdio: "pipe" });
  } catch {
    try {
      execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe" });
    } catch {
      // The job may not be loaded yet.
    }
  }
}

function loadLaunchdJob(): void {
  try {
    execFileSync("launchctl", ["bootstrap", getLaunchctlDomain(), PLIST_PATH], { stdio: "pipe" });
  } catch {
    execFileSync("launchctl", ["load", PLIST_PATH], { stdio: "pipe" });
  }
}

/**
 * Enable scheduled daily report on macOS via launchd.
 */
export function scheduleOn(config: DailyReportConfig): boolean {
  const cron = config.schedule.cron;

  if (process.platform === "darwin") {
    try {
      const args = resolveScheduledCommand();
      const plist = buildLaunchdPlist(cron, args);
      fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
      fs.mkdirSync(path.join(os.homedir(), ".daily-report", "logs"), { recursive: true });
      fs.writeFileSync(PLIST_PATH, plist, "utf-8");
      unloadLaunchdJob();
      loadLaunchdJob();
      console.log("✅ 定时任务已启用 (launchd)");
    } catch (err: any) {
      console.error(`❌ 注册 launchd 任务失败: ${err.message}`);
      config.schedule.enabled = false;
      saveConfig(config);
      return false;
    }
  } else {
    // Linux: crontab
    try {
      // Get existing crontab
      const existing = execSync("crontab -l 2>/dev/null || true", {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();

      // Remove any existing daily-report entries
      const lines = existing.split("\n").filter((l) => !l.includes("daily-report"));
      const command = serializeShellCommand(resolveScheduledCommand());
      lines.push(`${cron} ${command} # daily-report`);

      // Write new crontab
      const tmpFile = path.join(os.tmpdir(), "daily-report-crontab");
      fs.writeFileSync(tmpFile, lines.filter((l) => l.trim()).join("\n") + "\n", "utf-8");
      execSync(`crontab "${tmpFile}"`, { stdio: "pipe" });
      fs.unlinkSync(tmpFile);
      console.log("✅ 定时任务已启用 (crontab)");
    } catch (err: any) {
      console.error(`❌ 注册 crontab 任务失败: ${err.message}`);
      config.schedule.enabled = false;
      saveConfig(config);
      return false;
    }
  }

  // Update config
  config.schedule.enabled = true;
  saveConfig(config);
  return true;
}

/**
 * Disable scheduled daily report.
 */
export function scheduleOff(config: DailyReportConfig): boolean {
  if (process.platform === "darwin") {
    try {
      unloadLaunchdJob();
      if (fs.existsSync(PLIST_PATH)) {
        fs.unlinkSync(PLIST_PATH);
      }
      console.log("✅ 定时任务已关闭 (launchd)");
    } catch (err: any) {
      console.error(`❌ 关闭 launchd 任务失败: ${err.message}`);
    }
  } else {
    try {
      const existing = execSync("crontab -l 2>/dev/null || true", {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      const lines = existing.split("\n").filter((l) => !l.includes("daily-report"));
      if (lines.filter((l) => l.trim()).length > 0) {
        const tmpFile = path.join(os.tmpdir(), "daily-report-crontab");
        fs.writeFileSync(tmpFile, lines.filter((l) => l.trim()).join("\n") + "\n", "utf-8");
        execSync(`crontab "${tmpFile}"`, { stdio: "pipe" });
        fs.unlinkSync(tmpFile);
      } else {
        execSync("crontab -r", { stdio: "pipe" });
      }
      console.log("✅ 定时任务已关闭 (crontab)");
    } catch {
      // crontab might be empty
    }
  }

  config.schedule.enabled = false;
  saveConfig(config);
  return true;
}

/**
 * Check if scheduling is currently active.
 */
export function isScheduled(): boolean {
  if (process.platform === "darwin") {
    if (!fs.existsSync(PLIST_PATH)) return false;
    try {
      execFileSync("launchctl", ["print", `${getLaunchctlDomain()}/${PLIST_LABEL}`], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      const crontab = execSync("crontab -l 2>/dev/null || true", {
        encoding: "utf-8",
        stdio: "pipe",
      });
      return crontab.includes("daily-report");
    } catch {
      return false;
    }
  }
}
