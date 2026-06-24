import { saveConfig as defaultSaveConfig } from "./config";
import { scheduleOff as defaultScheduleOff, scheduleOn as defaultScheduleOn } from "./scheduler";
import { DailyReportConfig } from "./types";

type ScheduleConfig = DailyReportConfig["schedule"];

interface ApplyScheduleConfigDeps {
  scheduleOn?: (config: DailyReportConfig) => boolean;
  scheduleOff?: (config: DailyReportConfig) => boolean;
  saveConfig?: (config: DailyReportConfig) => void;
}

export function applyScheduleConfig(
  config: DailyReportConfig,
  schedule: ScheduleConfig,
  deps: ApplyScheduleConfigDeps = {}
): boolean {
  const previousSchedule = { ...config.schedule };
  const scheduleOn = deps.scheduleOn ?? defaultScheduleOn;
  const scheduleOff = deps.scheduleOff ?? defaultScheduleOff;
  const saveConfig = deps.saveConfig ?? defaultSaveConfig;

  config.schedule = { ...schedule };

  if (config.schedule.enabled) {
    if (!scheduleOn(config)) {
      config.schedule = previousSchedule;
      saveConfig(config);
      return false;
    }
    return true;
  }

  return scheduleOff(config);
}
