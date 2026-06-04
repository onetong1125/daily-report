import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { DailyReportConfig } from "./types";
import { saveConfig, loadConfig } from "./config";

const PLIST_LABEL = "com.daily-report";
const PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${PLIST_LABEL}.plist`
);

/**
 * Convert friendly time format to cron expression.
 * Supported:
 *   "18:00"          → "0 18 * * *"
 *   "18:00 weekday"  → "0 18 * * 1-5"
 *   "18:00 mon,fri"  → "0 18 * * 1,5"
 *   "0 18 * * 1-5"   → passed through
 */
export function parseTimeExpression(input: string): string {
  // If it looks like a cron expression already, return as-is
  if (/^[\d*,/\-]+\s+[\d*,/\-]+\s+[\d*,/\-]+\s+[\d*,/\-]+\s+[\d*,/\-]+$/.test(input.trim())) {
    return input.trim();
  }

  const parts = input.trim().split(/\s+/);
  let hour = "18";
  let minute = "0";
  let dayOfWeek = "*";

  // Parse time
  const timeMatch = parts[0].match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    hour = timeMatch[1];
    minute = timeMatch[2];
  }

  // Parse frequency
  if (parts.length > 1) {
    const freq = parts.slice(1).join(" ");
    const weekdays: Record<string, string> = {
      mon: "1", monday: "1",
      tue: "2", tuesday: "2",
      wed: "3", wednesday: "3",
      thu: "4", thursday: "4",
      fri: "5", friday: "5",
      sat: "6", saturday: "6",
      sun: "0", sunday: "0",
    };

    if (freq === "weekday" || freq === "weekdays") {
      dayOfWeek = "1-5";
    } else if (freq === "weekend") {
      dayOfWeek = "0,6";
    } else {
      // Parse individual days
      const days = freq.split(",").map((d) => weekdays[d.trim().toLowerCase()] || d.trim());
      dayOfWeek = days.join(",");
    }
  }

  return `${minute} ${hour} * * ${dayOfWeek}`;
}

/**
 * Resolve the path to the daily-report binary.
 * Uses `which` to find the actual installed location,
 * falling back to running via node + dist/index.js.
 */
function resolveBinPath(): string {
  try {
    const found = execSync("which daily-report 2>/dev/null || true", {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    if (found) return found;
  } catch {
    // `which` failed, use fallback
  }

  // Fallback: run via the current node + the compiled script
  return `${process.execPath} ${path.resolve(__dirname, "index.js")}`;
}

/**
 * Enable scheduled daily report on macOS via launchd.
 */
export function scheduleOn(config: DailyReportConfig): void {
  const cron = config.schedule.cron;

  if (process.platform === "darwin") {
    // Resolve the actual binary path (which may differ on Apple Silicon vs Intel)
    const binPath = resolveBinPath();

    // If binPath contains a space (node + script fallback), split into
    // separate ProgramArguments. Otherwise it's a direct symlink path.
    const args = binPath.includes(" ")
      ? [...binPath.split(" "), "--quiet"]
      : [binPath, "--quiet"];

    // Create launchd plist
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((a) => `        <string>${a}</string>`).join("\n")}
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${cron.split(" ")[1]}</integer>
        <key>Minute</key>
        <integer>${cron.split(" ")[0]}</integer>${cron.split(" ")[4] !== "*" ? `
        <key>Weekday</key>
        <integer>${cron.split(" ")[4]}</integer>` : ""}
    </dict>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), ".daily-report", "logs", "stdout.log")}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), ".daily-report", "logs", "stderr.log")}</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;

    // Ensure LaunchAgents directory exists
    const launchDir = path.dirname(PLIST_PATH);
    if (!fs.existsSync(launchDir)) {
      fs.mkdirSync(launchDir, { recursive: true });
    }

    fs.writeFileSync(PLIST_PATH, plist, "utf-8");

    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null || true`, { stdio: "pipe" });
      execSync(`launchctl load "${PLIST_PATH}"`, { stdio: "pipe" });
      console.log("✅ 定时任务已启用 (launchd)");
    } catch (err: any) {
      console.error(`❌ 注册 launchd 任务失败: ${err.message}`);
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
      const binPath = resolveBinPath();
      lines.push(`${cron} ${binPath} --quiet # daily-report`);

      // Write new crontab
      const tmpFile = path.join(os.tmpdir(), "daily-report-crontab");
      fs.writeFileSync(tmpFile, lines.filter((l) => l.trim()).join("\n") + "\n", "utf-8");
      execSync(`crontab "${tmpFile}"`, { stdio: "pipe" });
      fs.unlinkSync(tmpFile);
      console.log("✅ 定时任务已启用 (crontab)");
    } catch (err: any) {
      console.error(`❌ 注册 crontab 任务失败: ${err.message}`);
    }
  }

  // Update config
  config.schedule.enabled = true;
  saveConfig(config);
}

/**
 * Disable scheduled daily report.
 */
export function scheduleOff(config: DailyReportConfig): void {
  if (process.platform === "darwin") {
    try {
      execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null || true`, { stdio: "pipe" });
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
}

/**
 * Check if scheduling is currently active.
 */
export function isScheduled(): boolean {
  if (process.platform === "darwin") {
    return fs.existsSync(PLIST_PATH);
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
