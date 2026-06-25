import * as fs from "fs";
import * as path from "path";
import { getLogsDir } from "./config";

export interface DatedLogFiles {
  date: string;
  stdout?: string;
  stderr?: string;
  stdoutSize?: number;
  stderrSize?: number;
}

export interface LogFsDeps {
  existsSync?: (filePath: string) => boolean;
  readdirSync?: (dir: string) => string[];
  statSync?: (filePath: string) => { size: number };
  readFileSync?: (filePath: string, encoding: "utf-8") => string;
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
  for (const name of fsDeps.readdirSync(logsDir)) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2})\.(stdout|stderr)\.log$/);
    if (!match) continue;

    const [, date, stream] = match;
    const current = byDate.get(date) ?? { date };
    const filePath = path.join(logsDir, name);
    const size = fsDeps.statSync(filePath).size;

    if (stream === "stdout") {
      current.stdout = filePath;
      current.stdoutSize = size;
    } else {
      current.stderr = filePath;
      current.stderrSize = size;
    }

    byDate.set(date, current);
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function formatLogList(logs: DatedLogFiles[]): string {
  if (logs.length === 0) return "No scheduled logs found.";
  return logs.map((log) => [
    log.date,
    `  stdout: ${log.stdout ?? "(missing)"}`,
    `  stderr: ${log.stderr ?? "(missing)"}`,
  ].join("\n")).join("\n\n");
}

function sizeText(size: number | undefined): string {
  return size === undefined ? "missing" : `${size} bytes`;
}

export function formatLatestLogSummary(log: DatedLogFiles | undefined): string {
  if (!log) return "No scheduled logs found.";
  return [
    `latest scheduled logs: ${log.date}`,
    `stdout: ${log.stdout ?? "(missing)"} (${sizeText(log.stdoutSize)})`,
    `stderr: ${log.stderr ?? "(missing)"} (${sizeText(log.stderrSize)})`,
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

export function printLogTail(options: { lines?: string; stream?: "stdout" | "stderr" } = {}): void {
  const lineCount = Math.max(1, Number.parseInt(options.lines ?? "80", 10) || 80);
  const stream = options.stream ?? "stdout";
  const latest = discoverDatedLogs()[0];
  const filePath = stream === "stderr" ? latest?.stderr : latest?.stdout;

  if (!latest || !filePath) {
    console.log(`No ${stream} scheduled log found.`);
    return;
  }

  console.log(`==> ${filePath} <==`);
  console.log(tailLines(fs.readFileSync(filePath, "utf-8"), lineCount));
}
