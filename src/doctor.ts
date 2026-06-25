import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync as defaultExecFileSync } from "child_process";
import {
  getConfigPath,
  getDefaultConfig,
  getLogsDir,
  getReportsDir,
  loadConfig as defaultLoadConfig,
  resolveEnvVarsWithEnv,
} from "./config";
import { isScheduledLogFileName } from "./logs-command";
import { isScheduled as defaultIsScheduled } from "./scheduler";
import { DailyReportConfig } from "./types";

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  details?: string;
  action?: string;
}

export interface DoctorDeps {
  config?: DailyReportConfig;
  configPath?: string;
  logsDir?: string;
  reportsDir?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  readdirSync?: (dir: string) => string[];
  readFileSync?: (filePath: string, encoding: "utf-8") => string;
  execFileSync?: (cmd: string, args: string[]) => string | Buffer;
  isScheduled?: () => boolean;
  loadConfig?: () => DailyReportConfig;
}

function icon(status: DoctorStatus): string {
  if (status === "ok") return "✅";
  if (status === "warn") return "⚠️ ";
  return "❌";
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const counts = {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    error: checks.filter((check) => check.status === "error").length,
  };

  const lines = ["daily-report doctor", ""];

  for (const check of checks) {
    const details = check.details ? ` (${check.details})` : "";
    lines.push(`${icon(check.status)} ${check.name}: ${check.message}${details}`);
    if (check.action) {
      lines.push(`   └─ ${check.name} action: ${check.action}`);
    }
  }

  lines.push("");
  lines.push(`summary: ok=${counts.ok} warn=${counts.warn} error=${counts.error}`);
  return lines.join("\n");
}

function hasFiles(
  dir: string,
  suffix: string,
  deps: Required<Pick<DoctorDeps, "existsSync" | "readdirSync">>
): boolean {
  try {
    if (!deps.existsSync(dir)) {
      const names = deps.readdirSync(dir);
      return names.some((name) => name.endsWith(suffix));
    }
    return deps.readdirSync(dir).some((name) => name.endsWith(suffix));
  } catch {
    return false;
  }
}

function hasDatedLogs(
  dir: string,
  deps: Required<Pick<DoctorDeps, "existsSync" | "readdirSync">>
): boolean {
  try {
    if (!deps.existsSync(dir)) return false;
    return deps.readdirSync(dir).some(isScheduledLogFileName);
  } catch {
    return false;
  }
}

export function collectDoctorChecks(deps: DoctorDeps = {}): DoctorCheck[] {
  const configPath = deps.configPath ?? getConfigPath();
  const existsSync = deps.existsSync ?? fs.existsSync;
  const configExists = existsSync(configPath);
  const readFileSync = deps.readFileSync ?? ((filePath: string, encoding: "utf-8") => fs.readFileSync(filePath, encoding));
  const loadConfig = deps.loadConfig ?? defaultLoadConfig;
  let configLoadError: unknown;
  let config: DailyReportConfig;
  if (deps.config) {
    config = deps.config;
  } else if (configExists) {
    try {
      JSON.parse(readFileSync(configPath, "utf-8"));
      config = loadConfig();
    } catch (err) {
      configLoadError = err;
      config = getDefaultConfig();
    }
  } else {
    config = getDefaultConfig();
  }
  const logsDir = deps.logsDir ?? getLogsDir();
  const reportsDir = deps.reportsDir ?? getReportsDir(config);
  const homeDir = deps.homeDir ?? os.homedir();
  const env = deps.env ?? process.env;
  const readdirSync = deps.readdirSync ?? ((dir: string) => fs.readdirSync(dir));
  const execFileSync = deps.execFileSync ??
    ((cmd: string, args: string[]) => defaultExecFileSync(cmd, args, { stdio: "pipe" }));
  const isScheduled = deps.isScheduled ?? defaultIsScheduled;

  const checks: DoctorCheck[] = [];

  if (!configExists) {
    checks.push({ name: "config", status: "warn", message: "配置文件不存在，将使用默认配置", action: "运行 daily-report setup" });
  } else if (configLoadError) {
    checks.push({
      name: "config",
      status: "error",
      message: "配置文件无法读取，已使用默认配置继续诊断",
      details: configPath,
      action: "修复或重新生成 ~/.daily-report/config.json",
    });
  } else {
    checks.push({ name: "config", status: "ok", message: "配置文件可读取", details: configPath });
  }

  const resolvedApiKey = resolveEnvVarsWithEnv(config.llm.apiKey, env);
  checks.push(resolvedApiKey
    ? { name: "api-key", status: "ok", message: "API Key 已配置" }
    : { name: "api-key", status: "warn", message: "API Key 未解析到有效值", action: "设置环境变量或运行 daily-report config llm" });

  const missingRepos = config.repos.filter((repo) => !existsSync(repo) || !existsSync(path.join(repo, ".git")));
  checks.push(missingRepos.length === 0
    ? { name: "repos", status: "ok", message: "追踪仓库可访问", details: `${config.repos.length} 个` }
    : { name: "repos", status: "warn", message: `${missingRepos.length} 个仓库不可访问`, details: missingRepos.join(", "), action: "运行 daily-report config repos 更新列表" });

  try {
    execFileSync("gh", ["auth", "status"]);
    checks.push({ name: "github", status: "ok", message: "gh 已登录" });
  } catch {
    checks.push({ name: "github", status: "warn", message: "gh 不可用，跳过 GitHub 数据采集", action: "运行 gh auth status 检查登录状态" });
  }

  const claudeDir = path.join(homeDir, ".claude", "projects");
  checks.push(existsSync(claudeDir)
    ? { name: "claude", status: "ok", message: "Claude 会话目录存在", details: claudeDir }
    : { name: "claude", status: "warn", message: "Claude 会话目录不存在，跳过 Claude 数据采集", details: claudeDir });

  const codexDir = path.join(homeDir, ".codex", "sessions");
  checks.push(existsSync(codexDir)
    ? { name: "codex", status: "ok", message: "Codex 会话目录存在", details: codexDir }
    : { name: "codex", status: "warn", message: "Codex 会话目录不存在，跳过 Codex 数据采集", details: codexDir });

  const scheduled = isScheduled();
  if (config.schedule.enabled && scheduled) {
    checks.push({ name: "scheduler", status: "ok", message: "系统调度已注册" });
  } else if (config.schedule.enabled) {
    checks.push({
      name: "scheduler",
      status: "error",
      message: "配置启用但系统调度未注册",
      action: "运行 daily-report schedule on 或 daily-report schedule set \"21:00\"",
    });
  } else if (scheduled) {
    checks.push({
      name: "scheduler",
      status: "error",
      message: "配置关闭但系统调度仍注册",
      action: "运行 daily-report schedule off 清理系统调度",
    });
  } else {
    checks.push({
      name: "scheduler",
      status: "warn",
      message: "定时任务未启用",
      action: "运行 daily-report schedule on 或 daily-report schedule set \"21:00\"",
    });
  }

  const fileDeps = { existsSync, readdirSync };
  checks.push(hasDatedLogs(logsDir, fileDeps)
    ? { name: "logs", status: "ok", message: "找到最近的定时日志", details: logsDir }
    : { name: "logs", status: "warn", message: "没有找到定时日志", details: logsDir, action: "等待一次定时运行或执行 daily-report run-scheduled" });

  checks.push(hasFiles(reportsDir, ".md", fileDeps)
    ? { name: "reports", status: "ok", message: "找到已生成日报", details: reportsDir }
    : { name: "reports", status: "warn", message: "没有找到已生成日报", details: reportsDir, action: "运行 daily-report" });

  return checks;
}

export function runDoctor(): void {
  console.log(formatDoctorReport(collectDoctorChecks()));
}
