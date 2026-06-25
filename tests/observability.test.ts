import { describe, it, expect, vi } from "vitest";
import {
  formatKeyValueLine,
  createRunMetadata,
  createPhaseTimer,
} from "../src/observability";

describe("formatKeyValueLine", () => {
  it("formats stable grep-friendly key-value lines", () => {
    expect(formatKeyValueLine("run", {
      run_id: "20260624-224814-abc123",
      version: "0.2.3",
      repos: 5,
      api_key_configured: true,
    })).toBe("[run] run_id=20260624-224814-abc123 version=0.2.3 repos=5 api_key_configured=true");
  });

  it("quotes values that contain whitespace and escapes quotes", () => {
    expect(formatKeyValueLine("save", {
      path: "/tmp/my report.md",
      message: "said \"ok\"",
    })).toBe("[save] path=\"/tmp/my report.md\" message=\"said \\\"ok\\\"\"");
  });
});

describe("createRunMetadata", () => {
  it("uses injected values to build deterministic metadata", () => {
    const metadata = createRunMetadata({
      version: "0.2.3",
      timezone: "Asia/Shanghai",
      reportDate: "2026-06-24",
      configPath: "~/.daily-report/config.json",
      outputDir: "~/.daily-report/reports",
      repoCount: 3,
      now: () => new Date("2026-06-24T14:48:14.880Z"),
      random: () => 0.5,
      nodeVersion: "v20.19.4",
      platform: "darwin",
      arch: "arm64",
    });

    expect(metadata).toMatchObject({
      run_id: "20260624-144814-i",
      version: "0.2.3",
      timezone: "Asia/Shanghai",
      report_date: "2026-06-24",
      config_path: "~/.daily-report/config.json",
      output_dir: "~/.daily-report/reports",
      repos: 3,
      node: "v20.19.4",
      platform: "darwin",
      arch: "arm64",
    });
  });
});

describe("createPhaseTimer", () => {
  it("logs phase completion with duration and counts", () => {
    const log = vi.fn();
    const timer = createPhaseTimer("collect:git", {
      nowMs: (() => {
        const values = [100, 145];
        return () => values.shift() ?? 145;
      })(),
      log,
    });

    timer.finish({ repos: 5, events: 12 });

    expect(log).toHaveBeenCalledWith("[collect:git] status=ok duration_ms=45 repos=5 events=12");
  });

  it("logs phase failure with duration and message", () => {
    const log = vi.fn();
    const timer = createPhaseTimer("collect:github", {
      nowMs: (() => {
        const values = [200, 260];
        return () => values.shift() ?? 260;
      })(),
      log,
    });

    timer.fail(new Error("gh unavailable"), { repos: 5 });

    expect(log).toHaveBeenCalledWith("[collect:github] status=error duration_ms=60 repos=5 error=\"gh unavailable\"");
  });
});
