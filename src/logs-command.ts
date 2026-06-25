import * as fs from "fs";
import * as path from "path";
import { getLogsDir } from "./config";

export interface DatedLogFiles {
  date: string;
  log?: string;
  size?: number;
  legacyStdout?: string;
  legacyStderr?: string;
  legacyStdoutSize?: number;
  legacyStderrSize?: number;
}

export interface LogFsDeps {
  existsSync?: (filePath: string) => boolean;
  readdirSync?: (dir: string) => string[];
  statSync?: (filePath: string) => { size: number };
  readFileSync?: (filePath: string, encoding: "utf-8") => string;
}

export function isScheduledLogFileName(name: string): boolean {
  return /^(\d{4}-\d{2}-\d{2})\.log$/.test(name) ||
    /^(\d{4}-\d{2}-\d{2})\.(stdout|stderr)\.log$/.test(name) ||
    /^(stdout|stderr)\.log$/.test(name);
}

function depsWithDefaults(deps: LogFsDeps): Required<LogFsDeps> {
  return {
    existsSync: deps.existsSync ?? fs.existsSync,
    readdirSync: deps.readdirSync ?? ((dir) => fs.readdirSync(dir)),
    statSync: deps.statSync ?? ((filePath) => fs.statSync(filePath)),
    readFileSync: deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding)),
  };
}

export function discoverDatedLogs(logsDir: string = getLogsDir(), deps: LogFsDeps = {}): DatedLogFiles[] {
  const fsDeps = depsWithDefaults(deps);
  if (!fsDeps.existsSync(logsDir)) return [];

  const byDate = new Map<string, DatedLogFiles>();
  let launchdLog: DatedLogFiles | undefined;
  for (const name of fsDeps.readdirSync(logsDir)) {
    const combinedMatch = name.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
    const legacyMatch = name.match(/^(\d{4}-\d{2}-\d{2})\.(stdout|stderr)\.log$/);
    const undatedLegacyMatch = name.match(/^(stdout|stderr)\.log$/);
    if (!combinedMatch && !legacyMatch && !undatedLegacyMatch) continue;

    const date = combinedMatch?.[1] ?? legacyMatch?.[1] ?? "launchd";
    const stream = legacyMatch?.[2] ?? undatedLegacyMatch?.[1];
    const current = date === "launchd"
      ? launchdLog ?? { date }
      : byDate.get(date) ?? { date };
    const filePath = path.join(logsDir, name);
    const size = fsDeps.statSync(filePath).size;

    if (!stream) {
      current.log = filePath;
      current.size = size;
    } else if (stream === "stdout") {
      current.legacyStdout = filePath;
      current.legacyStdoutSize = size;
    } else {
      current.legacyStderr = filePath;
      current.legacyStderrSize = size;
    }

    if (date === "launchd") {
      launchdLog = current;
    } else {
      byDate.set(date, current);
    }
  }

  if (byDate.size === 0 && launchdLog) {
    byDate.set(launchdLog.date, launchdLog);
  }

  return [...byDate.values()].sort((a, b) => {
    if (a.date === "launchd") return 1;
    if (b.date === "launchd") return -1;
    return b.date.localeCompare(a.date);
  });
}

export function formatLogList(logs: DatedLogFiles[]): string {
  if (logs.length === 0) return "No scheduled logs found.";
  return logs.map((log) => {
    if (log.log) {
      return [
        log.date,
        `  log: ${log.log}`,
      ].join("\n");
    }
    return [
      log.date,
      `  legacy stdout: ${log.legacyStdout ?? "(missing)"}`,
      `  legacy stderr: ${log.legacyStderr ?? "(missing)"}`,
    ].join("\n");
  }).join("\n\n");
}

function sizeText(size: number | undefined): string {
  return size === undefined ? "missing" : `${size} bytes`;
}

export function formatLatestLogSummary(log: DatedLogFiles | undefined): string {
  if (!log) return "No scheduled logs found.";
  if (log.log) {
    return [
      `latest scheduled log: ${log.date}`,
      `log: ${log.log} (${sizeText(log.size)})`,
    ].join("\n");
  }

  return [
    `latest scheduled log: ${log.date}`,
    `legacy stdout: ${log.legacyStdout ?? "(missing)"} (${sizeText(log.legacyStdoutSize)})`,
    `legacy stderr: ${log.legacyStderr ?? "(missing)"} (${sizeText(log.legacyStderrSize)})`,
  ].join("\n");
}

export function tailLines(content: string, lineCount: number): string {
  return content.trimEnd().split("\n").slice(-lineCount).join("\n");
}

export function printLogList(): void {
  console.log(formatLogList(discoverDatedLogs()));
}

export function printLatestLogSummary(): void {
  console.log(formatLatestLogSummary(discoverDatedLogs()[0]));
}

export function printLogTail(options: { lines?: string } = {}): void {
  const lineCount = Math.max(1, Number.parseInt(options.lines ?? "80", 10) || 80);
  const latest = discoverDatedLogs()[0];
  const filePath = latest?.log ?? latest?.legacyStdout ?? latest?.legacyStderr;

  if (!latest || !filePath) {
    console.log("No scheduled log found.");
    return;
  }

  console.log(`==> ${filePath} <==`);
  console.log(tailLines(fs.readFileSync(filePath, "utf-8"), lineCount));
}
