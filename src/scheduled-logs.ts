import * as fs from "fs";
import * as path from "path";
import { format } from "util";
import { getLogsDir } from "./config";
import { getVersion, logRunHeader } from "./report-runner";
import { todayInTimezone } from "./timeboundary";
import { DailyReportConfig } from "./types";

export interface ScheduledLogPaths {
  log: string;
}

export interface ScheduledLogOptions {
  date?: string;
  logsDir?: string;
  now?: () => Date;
}

export function getScheduledLogPaths(logsDir: string, date: string): ScheduledLogPaths {
  return {
    log: path.join(logsDir, `${date}.log`),
  };
}

function writeLine(fd: number, message: string): void {
  fs.writeSync(fd, `${message}\n`);
}

function writeTaggedLines(fd: number, tag: string, message: string): void {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) {
    writeLine(fd, `[${tag}]`);
    return;
  }
  for (const line of lines) {
    writeLine(fd, `[${tag}] ${line}`);
  }
}

function patchConsole(logFd: number): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => writeLine(logFd, format(...args));
  console.warn = (...args: unknown[]) => writeTaggedLines(logFd, "stderr", format(...args));
  console.error = (...args: unknown[]) => writeTaggedLines(logFd, "stderr", format(...args));

  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };
}

export async function runWithScheduledLogs(
  config: DailyReportConfig,
  run: () => Promise<void>,
  options: ScheduledLogOptions = {}
): Promise<void> {
  const date = options.date ?? todayInTimezone(config.report.timezone);
  const logsDir = options.logsDir ?? getLogsDir();
  const now = options.now ?? (() => new Date());
  const logPaths = getScheduledLogPaths(logsDir, date);

  fs.mkdirSync(logsDir, { recursive: true });

  const logFd = fs.openSync(logPaths.log, "a");
  const restoreConsole = patchConsole(logFd);

  try {
    writeLine(logFd, `=== daily-report scheduled run started ${now().toISOString()} ===`);
    logRunHeader({
      version: getVersion(),
      timezone: config.report.timezone,
      reportDate: date,
      outputDir: config.report.outputDir,
      repoCount: config.repos.length,
    });
    await run();
    writeLine(logFd, `=== daily-report scheduled run finished ${now().toISOString()} ===`);
  } catch (err: any) {
    writeLine(logFd, `=== daily-report scheduled run failed ${now().toISOString()} ===`);
    writeTaggedLines(logFd, "stderr", err?.stack || err?.message || String(err));
    throw err;
  } finally {
    restoreConsole();
    fs.closeSync(logFd);
  }
}
