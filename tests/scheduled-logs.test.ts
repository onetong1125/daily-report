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
  it("uses a dated combined log file", () => {
    expect(getScheduledLogPaths("/tmp/daily-report-logs", "2026-06-24")).toEqual({
      log: path.join("/tmp/daily-report-logs", "2026-06-24.log"),
    });
  });
});

describe("runWithScheduledLogs", () => {
  it("routes scheduled output to a dated combined log file", async () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-logs-"));

    await runWithScheduledLogs(
      makeConfig(),
      async () => {
        console.log("stdout message");
        console.log("count: %d", 3);
        console.warn("stderr message");
        console.log("after warning");
      },
      {
        date: "2026-06-24",
        logsDir,
        now: () => new Date("2026-06-24T10:30:00.000Z"),
      }
    );

    const log = fs.readFileSync(path.join(logsDir, "2026-06-24.log"), "utf-8");

    expect(log).toContain("=== daily-report scheduled run started 2026-06-24T10:30:00.000Z ===");
    expect(log).toContain("[run] run_id=");
    expect(log).toContain("version=");
    expect(log).toContain("timezone=Asia/Shanghai");
    expect(log).toContain("report_date=2026-06-24");
    expect(log).toContain("repos=0");
    expect(log).toContain("stdout message");
    expect(log).toContain("count: 3");
    expect(log).toContain("[stderr] stderr message");
    expect(log).toContain("after warning");
    expect(log).toContain("=== daily-report scheduled run finished 2026-06-24T10:30:00.000Z ===");
    expect(log.indexOf("stdout message")).toBeLessThan(log.indexOf("[stderr] stderr message"));
    expect(log.indexOf("[stderr] stderr message")).toBeLessThan(log.indexOf("after warning"));
  });
});
