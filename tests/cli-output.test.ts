import { describe, expect, it } from "vitest";
import { shouldPrintLlmNotice, shouldPrintReportBody, shouldPrintSavedReportPath } from "../src/cli-output";
import { DailyReportConfig } from "../src/types";

function makeConfig(overrides: Partial<DailyReportConfig> = {}): DailyReportConfig {
  return {
    repos: [],
    llm: {
      provider: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "test",
      model: "test-model",
    },
    report: {
      outputDir: "/tmp/daily-report",
      printToTerminal: true,
      timezone: "Asia/Shanghai",
    },
    privacy: {
      requireConfirmation: true,
      maxTokensSent: 4096,
      allowedFields: [],
    },
    schedule: {
      enabled: false,
      cron: "0 18 * * 1-5",
    },
    ...overrides,
  };
}

describe("CLI output policy", () => {
  it("keeps LLM notices and saved paths visible in quiet mode", () => {
    const config = makeConfig();

    expect(shouldPrintReportBody(config, { quiet: true })).toBe(false);
    expect(shouldPrintLlmNotice(config)).toBe(true);
    expect(shouldPrintSavedReportPath({ quiet: true })).toBe(true);
  });

  it("honors report.printToTerminal for the report body", () => {
    const config = makeConfig({
      report: {
        outputDir: "/tmp/daily-report",
        printToTerminal: false,
        timezone: "Asia/Shanghai",
      },
    });

    expect(shouldPrintReportBody(config, {})).toBe(false);
  });

  it("does not print a saved path when saving is disabled", () => {
    expect(shouldPrintSavedReportPath({ save: false })).toBe(false);
  });
});
