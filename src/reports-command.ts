import * as fs from "fs";
import * as path from "path";
import { getReportsDir, loadConfig } from "./config";

export interface DatedReportFile {
  date: string;
  path: string;
  size: number;
}

export interface ReportFsDeps {
  existsSync?: (filePath: string) => boolean;
  readdirSync?: (dir: string) => string[];
  statSync?: (filePath: string) => { size: number };
  readFileSync?: (filePath: string, encoding: "utf-8") => string;
}

function depsWithDefaults(deps: ReportFsDeps): Required<ReportFsDeps> {
  return {
    existsSync: deps.existsSync ?? fs.existsSync,
    readdirSync: deps.readdirSync ?? ((dir) => fs.readdirSync(dir)),
    statSync: deps.statSync ?? ((filePath) => fs.statSync(filePath)),
    readFileSync: deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding)),
  };
}

export function isReportFileName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(name);
}

export function discoverReports(reportsDir: string, deps: ReportFsDeps = {}): DatedReportFile[] {
  const fsDeps = depsWithDefaults(deps);
  if (!fsDeps.existsSync(reportsDir)) return [];

  return fsDeps.readdirSync(reportsDir)
    .filter(isReportFileName)
    .map((name) => {
      const filePath = path.join(reportsDir, name);
      return {
        date: name.replace(/\.md$/, ""),
        path: filePath,
        size: fsDeps.statSync(filePath).size,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function sizeText(size: number): string {
  return `${size} bytes`;
}

export function formatReportList(reports: DatedReportFile[]): string {
  if (reports.length === 0) return "No reports found.";
  return reports.map((report) => `${report.date}  ${report.path} (${sizeText(report.size)})`).join("\n");
}

export function formatLatestReportSummary(report: DatedReportFile | undefined): string {
  if (!report) return "No reports found.";
  return [
    `latest report: ${report.date}`,
    `path: ${report.path} (${sizeText(report.size)})`,
  ].join("\n");
}

export function findReportByDate(reports: DatedReportFile[], date: string): DatedReportFile | undefined {
  return reports.find((report) => report.date === date);
}

function resolveReportsDir(): string {
  return getReportsDir(loadConfig());
}

export function printReportList(): void {
  console.log(formatReportList(discoverReports(resolveReportsDir())));
}

export function printLatestReportSummary(): void {
  console.log(formatLatestReportSummary(discoverReports(resolveReportsDir())[0]));
}

export function printReport(date?: string): void {
  const reportsDir = resolveReportsDir();
  const reports = discoverReports(reportsDir);
  const report = date ? findReportByDate(reports, date) : reports[0];

  if (!report) {
    if (date) {
      console.error(`No report found for ${date} in ${reportsDir}.`);
    } else {
      console.error(`No reports found in ${reportsDir}.`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(fs.readFileSync(report.path, "utf-8"));
}
