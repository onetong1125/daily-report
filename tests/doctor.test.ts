import { describe, it, expect } from "vitest";
import { formatDoctorReport, DoctorCheck, collectDoctorChecks } from "../src/doctor";
import { DailyReportConfig } from "../src/types";

function makeConfig(): DailyReportConfig {
  return {
    repos: ["/repo/ok", "/repo/missing"],
    llm: {
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "${OPENAI_API_KEY}",
      model: "gpt-4o",
      maxRetries: 5,
      retryBaseDelayMs: 1000,
      requestTimeoutMs: 30000,
    },
    report: {
      outputDir: "/home/me/.daily-report/reports",
      printToTerminal: true,
      timezone: "Asia/Shanghai",
    },
    privacy: {
      requireConfirmation: true,
      maxTokensSent: 4096,
      allowedFields: ["source", "repo", "timestamp", "entity_id", "entity_type", "summary"],
    },
    schedule: {
      enabled: true,
      cron: "00 21 * * *",
    },
  };
}

describe("formatDoctorReport", () => {
  it("prints ok, warn, and error checks with actions", () => {
    const checks: DoctorCheck[] = [
      { name: "config", status: "ok", message: "配置文件可读取", details: "~/.daily-report/config.json" },
      { name: "github", status: "warn", message: "gh 不可用，跳过 GitHub 数据采集", action: "运行 gh auth status 检查登录状态" },
      { name: "scheduler", status: "error", message: "系统调度未注册", action: "运行 daily-report schedule on" },
    ];

    expect(formatDoctorReport(checks)).toBe([
      "daily-report doctor",
      "",
      "✅ config: 配置文件可读取 (~/.daily-report/config.json)",
      "⚠️  github: gh 不可用，跳过 GitHub 数据采集",
      "   └─ github action: 运行 gh auth status 检查登录状态",
      "❌ scheduler: 系统调度未注册",
      "   └─ scheduler action: 运行 daily-report schedule on",
      "",
      "summary: ok=1 warn=1 error=1",
    ].join("\n"));
  });
});

describe("collectDoctorChecks", () => {
  function collectSchedulerCheck(enabled: boolean, scheduled: boolean) {
    const config = makeConfig();
    config.schedule.enabled = enabled;

    return collectDoctorChecks({
      config,
      configPath: "/home/me/.daily-report/config.json",
      logsDir: "/home/me/.daily-report/logs",
      reportsDir: "/home/me/.daily-report/reports",
      homeDir: "/home/me",
      env: { OPENAI_API_KEY: "sk-test" },
      existsSync: (filePath) => [
        "/home/me/.daily-report/config.json",
        "/repo/ok",
        "/repo/ok/.git",
      ].includes(filePath),
      readdirSync: () => [],
      execFileSync: () => "Logged in",
      isScheduled: () => scheduled,
    }).find((check) => check.name === "scheduler");
  }

  it("checks config, api key, repos, gh, sessions, scheduler, and recent files", () => {
    const checks = collectDoctorChecks({
      config: makeConfig(),
      configPath: "/home/me/.daily-report/config.json",
      logsDir: "/home/me/.daily-report/logs",
      reportsDir: "/home/me/.daily-report/reports",
      homeDir: "/home/me",
      env: { OPENAI_API_KEY: "sk-test" },
      existsSync: (filePath) => [
        "/home/me/.daily-report/config.json",
        "/repo/ok",
        "/repo/ok/.git",
        "/home/me/.claude/projects",
        "/home/me/.codex/sessions",
        "/home/me/.daily-report/logs/2026-06-24.stdout.log",
        "/home/me/.daily-report/reports/2026-06-24.md",
      ].includes(filePath),
      readdirSync: (dir) => {
        if (dir === "/home/me/.daily-report/logs") return ["2026-06-24.stdout.log", "2026-06-24.stderr.log"];
        if (dir === "/home/me/.daily-report/reports") return ["2026-06-24.md"];
        return [];
      },
      execFileSync: (cmd, args) => {
        if (cmd === "gh" && args[0] === "auth") return "Logged in";
        throw new Error(`unexpected command ${cmd}`);
      },
      isScheduled: () => true,
    });

    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["config", "ok"],
      ["api-key", "ok"],
      ["repos", "warn"],
      ["github", "ok"],
      ["claude", "ok"],
      ["codex", "ok"],
      ["scheduler", "ok"],
      ["logs", "ok"],
      ["reports", "ok"],
    ]);
    expect(checks.find((check) => check.name === "repos")?.message).toContain("1 个仓库不可访问");
  });

  it("does not load or create config before reporting a missing config file", () => {
    const checks = collectDoctorChecks({
      configPath: "/home/me/.daily-report/config.json",
      logsDir: "/home/me/.daily-report/logs",
      reportsDir: "/home/me/.daily-report/reports",
      homeDir: "/home/me",
      env: {},
      existsSync: () => false,
      readdirSync: () => {
        throw new Error("missing directory");
      },
      execFileSync: () => {
        throw new Error("gh unavailable");
      },
      isScheduled: () => false,
      loadConfig: () => {
        throw new Error("should not load a missing config");
      },
    });

    expect(checks.find((check) => check.name === "config")).toMatchObject({
      status: "warn",
      message: "配置文件不存在，将使用默认配置",
      action: "运行 daily-report setup",
    });
  });

  it("reports stale system scheduler registration when config is disabled", () => {
    expect(collectSchedulerCheck(false, true)).toMatchObject({
      status: "error",
      message: "配置关闭但系统调度仍注册",
      action: "运行 daily-report schedule off 清理系统调度",
    });
  });

  it("reports missing system scheduler registration when config is enabled", () => {
    expect(collectSchedulerCheck(true, false)).toMatchObject({
      status: "error",
      message: "配置启用但系统调度未注册",
      action: "运行 daily-report schedule on 或 daily-report schedule set \"21:00\"",
    });
  });
});
