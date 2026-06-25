import { describe, it, expect } from "vitest";
import {
  discoverDatedLogs,
  formatLogList,
  formatLatestLogSummary,
  tailLines,
} from "../src/logs-command";

describe("discoverDatedLogs", () => {
  it("pairs dated stdout and stderr logs and sorts newest first", () => {
    const logs = discoverDatedLogs("/logs", {
      existsSync: () => true,
      readdirSync: () => [
        "2026-06-23.stdout.log",
        "2026-06-24.stderr.log",
        "2026-06-24.stdout.log",
        "stdout.log",
        "not-a-log.txt",
      ],
      statSync: (filePath) => ({ size: filePath.includes("stderr") ? 12 : 34 }),
    });

    expect(logs).toEqual([
      {
        date: "2026-06-24",
        stdout: "/logs/2026-06-24.stdout.log",
        stderr: "/logs/2026-06-24.stderr.log",
        stdoutSize: 34,
        stderrSize: 12,
      },
      {
        date: "2026-06-23",
        stdout: "/logs/2026-06-23.stdout.log",
        stderr: undefined,
        stdoutSize: 34,
        stderrSize: undefined,
      },
    ]);
  });
});

describe("formatLogList", () => {
  it("prints discovered log dates and paths", () => {
    expect(formatLogList([
      {
        date: "2026-06-24",
        stdout: "/logs/2026-06-24.stdout.log",
        stderr: "/logs/2026-06-24.stderr.log",
        stdoutSize: 34,
        stderrSize: 12,
      },
    ])).toContain("2026-06-24");
  });
});

describe("formatLatestLogSummary", () => {
  it("prints latest stdout and stderr paths", () => {
    expect(formatLatestLogSummary({
      date: "2026-06-24",
      stdout: "/logs/2026-06-24.stdout.log",
      stderr: "/logs/2026-06-24.stderr.log",
      stdoutSize: 34,
      stderrSize: 12,
    })).toBe([
      "latest scheduled logs: 2026-06-24",
      "stdout: /logs/2026-06-24.stdout.log (34 bytes)",
      "stderr: /logs/2026-06-24.stderr.log (12 bytes)",
    ].join("\n"));
  });
});

describe("tailLines", () => {
  it("returns the last N lines", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toBe("c\nd");
  });
});
