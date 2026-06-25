import { describe, it, expect } from "vitest";
import {
  discoverDatedLogs,
  formatLogList,
  formatLatestLogSummary,
  tailLines,
} from "../src/logs-command";

describe("discoverDatedLogs", () => {
  it("discovers dated combined logs and sorts newest first", () => {
    const logs = discoverDatedLogs("/logs", {
      existsSync: () => true,
      readdirSync: () => [
        "2026-06-23.log",
        "2026-06-24.log",
        "stdout.log",
        "not-a-log.txt",
      ],
      statSync: (filePath) => ({ size: filePath.includes("2026-06-24") ? 34 : 12 }),
    });

    expect(logs).toEqual([
      {
        date: "2026-06-24",
        log: "/logs/2026-06-24.log",
        size: 34,
      },
      {
        date: "2026-06-23",
        log: "/logs/2026-06-23.log",
        size: 12,
      },
    ]);
  });

  it("keeps legacy dated stdout and stderr logs discoverable", () => {
    const logs = discoverDatedLogs("/logs", {
      existsSync: () => true,
      readdirSync: () => [
        "2026-06-24.stderr.log",
        "2026-06-24.stdout.log",
      ],
      statSync: (filePath) => ({ size: filePath.includes("stderr") ? 12 : 34 }),
    });

    expect(logs).toEqual([
      {
        date: "2026-06-24",
        legacyStdout: "/logs/2026-06-24.stdout.log",
        legacyStderr: "/logs/2026-06-24.stderr.log",
        legacyStdoutSize: 34,
        legacyStderrSize: 12,
      },
    ]);
  });

  it("keeps undated launchd stdout and stderr logs discoverable", () => {
    const logs = discoverDatedLogs("/logs", {
      existsSync: () => true,
      readdirSync: () => [
        "stderr.log",
        "stdout.log",
      ],
      statSync: (filePath) => ({ size: filePath.includes("stderr") ? 12 : 34 }),
    });

    expect(logs).toEqual([
      {
        date: "launchd",
        legacyStdout: "/logs/stdout.log",
        legacyStderr: "/logs/stderr.log",
        legacyStdoutSize: 34,
        legacyStderrSize: 12,
      },
    ]);
  });
});

describe("formatLogList", () => {
  it("prints discovered log dates and paths", () => {
    expect(formatLogList([
      {
        date: "2026-06-24",
        log: "/logs/2026-06-24.log",
        size: 34,
      },
    ])).toContain("2026-06-24");
  });
});

describe("formatLatestLogSummary", () => {
  it("prints latest combined log path", () => {
    expect(formatLatestLogSummary({
      date: "2026-06-24",
      log: "/logs/2026-06-24.log",
      size: 34,
    })).toBe([
      "latest scheduled log: 2026-06-24",
      "log: /logs/2026-06-24.log (34 bytes)",
    ].join("\n"));
  });

  it("prints undated launchd log paths", () => {
    expect(formatLatestLogSummary({
      date: "launchd",
      legacyStdout: "/logs/stdout.log",
      legacyStderr: "/logs/stderr.log",
      legacyStdoutSize: 34,
      legacyStderrSize: 12,
    })).toBe([
      "latest scheduled log: launchd",
      "legacy stdout: /logs/stdout.log (34 bytes)",
      "legacy stderr: /logs/stderr.log (12 bytes)",
    ].join("\n"));
  });
});

describe("tailLines", () => {
  it("returns the last N lines", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toBe("c\nd");
  });
});
