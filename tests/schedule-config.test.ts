import { describe, expect, it } from "vitest";
import { applyScheduleConfig } from "../src/schedule-config";
import { DailyReportConfig } from "../src/types";

function makeConfig(): DailyReportConfig {
  return {
    repos: [],
    llm: {
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "${OPENAI_API_KEY}",
      model: "gpt-4o",
    },
    report: {
      outputDir: "~/.daily-report/reports",
      printToTerminal: true,
      timezone: "Asia/Shanghai",
    },
    privacy: {
      requireConfirmation: true,
      maxTokensSent: 4096,
      allowedFields: ["source"],
    },
    schedule: {
      enabled: false,
      cron: "0 18 * * 1-5",
    },
  };
}

describe("applyScheduleConfig", () => {
  it("registers the system scheduler when config schedule enables scheduling", () => {
    const config = makeConfig();
    let registeredCron: string | undefined;
    let offCalls = 0;
    let saveCalls = 0;

    const ok = applyScheduleConfig(
      config,
      { enabled: true, cron: "00 21 * * *" },
      {
        scheduleOn: (updatedConfig) => {
          registeredCron = updatedConfig.schedule.cron;
          return true;
        },
        scheduleOff: () => {
          offCalls++;
          return true;
        },
        saveConfig: () => {
          saveCalls++;
        },
      }
    );

    expect(ok).toBe(true);
    expect(registeredCron).toBe("00 21 * * *");
    expect(offCalls).toBe(0);
    expect(saveCalls).toBe(0);
    expect(config.schedule).toEqual({ enabled: true, cron: "00 21 * * *" });
  });

  it("restores the previous schedule config when registration fails", () => {
    const config = makeConfig();
    const savedSchedules: DailyReportConfig["schedule"][] = [];

    const ok = applyScheduleConfig(
      config,
      { enabled: true, cron: "00 21 * * *" },
      {
        scheduleOn: () => false,
        scheduleOff: () => true,
        saveConfig: (updatedConfig) => {
          savedSchedules.push({ ...updatedConfig.schedule });
        },
      }
    );

    expect(ok).toBe(false);
    expect(config.schedule).toEqual({ enabled: false, cron: "0 18 * * 1-5" });
    expect(savedSchedules).toEqual([{ enabled: false, cron: "0 18 * * 1-5" }]);
  });

  it("unregisters the system scheduler when config schedule disables scheduling", () => {
    const config = makeConfig();
    config.schedule = { enabled: true, cron: "00 21 * * *" };
    let onCalls = 0;
    let disabledCron: string | undefined;

    const ok = applyScheduleConfig(
      config,
      { enabled: false, cron: "00 21 * * *" },
      {
        scheduleOn: () => {
          onCalls++;
          return true;
        },
        scheduleOff: (updatedConfig) => {
          disabledCron = updatedConfig.schedule.cron;
          return true;
        },
        saveConfig: () => undefined,
      }
    );

    expect(ok).toBe(true);
    expect(onCalls).toBe(0);
    expect(disabledCron).toBe("00 21 * * *");
    expect(config.schedule).toEqual({ enabled: false, cron: "00 21 * * *" });
  });
});
