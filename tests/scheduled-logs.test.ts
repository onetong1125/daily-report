import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getScheduledLogPaths, runWithScheduledLogs } from "../src/scheduled-logs";
import { DailyReportConfig } from "../src/types";

function makeConfig(): DailyReportConfig {
  return {
    repos: [],
    llm: {
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o",
      maxRetries: 5,
      retryBaseDelayMs: 1000,
      requestTimeoutMs: 30000,
    },
    report: {
      outputDir: "~/.daily-report/reports",
      printToTerminal: true,
      timezone: "Asia/Shanghai",
    },
    privacy: {
      requireConfirmation: true,
      maxTokensSent: 4096,
      allowedFields: [
        "source",
        "repo",
        "timestamp",
        "entity_id",
        "entity_type",
        "summary",
      ],
    },
    schedule: {
      enabled: true,
      cron: "00 21 * * *",
    },
  };
}

describe("getScheduledLogPaths", () => {
  it("uses dated stdout and stderr log files", () => {
    expect(getScheduledLogPaths("/tmp/daily-report-logs", "2026-06-24")).toEqual({
      stdout: path.join("/tmp/daily-report-logs", "2026-06-24.stdout.log"),
      stderr: path.join("/tmp/daily-report-logs", "2026-06-24.stderr.log"),
    });
  });
});

describe("runWithScheduledLogs", () => {
  it("routes scheduled output to dated log files", async () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-logs-"));

    await runWithScheduledLogs(
      makeConfig(),
      async () => {
        console.log("stdout message");
        console.log("count: %d", 3);
        console.warn("stderr message");
      },
      {
        date: "2026-06-24",
        logsDir,
        now: () => new Date("2026-06-24T10:30:00.000Z"),
      }
    );

    const stdout = fs.readFileSync(path.join(logsDir, "2026-06-24.stdout.log"), "utf-8");
    const stderr = fs.readFileSync(path.join(logsDir, "2026-06-24.stderr.log"), "utf-8");

    expect(stdout).toContain("=== daily-report scheduled run started 2026-06-24T10:30:00.000Z ===");
    expect(stdout).toContain("[run] run_id=");
    expect(stdout).toContain("version=");
    expect(stdout).toContain("timezone=Asia/Shanghai");
    expect(stdout).toContain("report_date=2026-06-24");
    expect(stdout).toContain("repos=0");
    expect(stdout).toContain("stdout message");
    expect(stdout).toContain("count: 3");
    expect(stdout).toContain("=== daily-report scheduled run finished 2026-06-24T10:30:00.000Z ===");
    expect(stderr).toContain("stderr message");
  });
});
