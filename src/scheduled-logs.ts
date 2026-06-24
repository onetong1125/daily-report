import * as fs from "fs";
import * as path from "path";
import { format } from "util";
import { getLogsDir } from "./config";
import { todayInTimezone } from "./timeboundary";
import { DailyReportConfig } from "./types";

export interface ScheduledLogPaths {
  stdout: string;
  stderr: string;
}

export interface ScheduledLogOptions {
  date?: string;
  logsDir?: string;
  now?: () => Date;
}

export function getScheduledLogPaths(logsDir: string, date: string): ScheduledLogPaths {
  return {
    stdout: path.join(logsDir, `${date}.stdout.log`),
    stderr: path.join(logsDir, `${date}.stderr.log`),
  };
}

function writeLine(fd: number, message: string): void {
  fs.writeSync(fd, `${message}\n`);
}

function patchConsole(stdoutFd: number, stderrFd: number): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => writeLine(stdoutFd, format(...args));
  console.warn = (...args: unknown[]) => writeLine(stderrFd, format(...args));
  console.error = (...args: unknown[]) => writeLine(stderrFd, format(...args));

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

  const stdoutFd = fs.openSync(logPaths.stdout, "a");
  const stderrFd = fs.openSync(logPaths.stderr, "a");
  const restoreConsole = patchConsole(stdoutFd, stderrFd);

  try {
    writeLine(stdoutFd, `=== daily-report scheduled run started ${now().toISOString()} ===`);
    await run();
    writeLine(stdoutFd, `=== daily-report scheduled run finished ${now().toISOString()} ===`);
  } catch (err: any) {
    writeLine(stderrFd, `=== daily-report scheduled run failed ${now().toISOString()} ===`);
    writeLine(stderrFd, err?.stack || err?.message || String(err));
    throw err;
  } finally {
    restoreConsole();
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}
