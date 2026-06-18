import { DailyReportConfig } from "./types";

export interface GenerateOutputOptions {
  quiet?: boolean;
  save?: boolean;
}

export function shouldPrintReportBody(
  config: DailyReportConfig,
  options: GenerateOutputOptions
): boolean {
  return config.report.printToTerminal && !options.quiet;
}

export function shouldPrintLlmNotice(config: DailyReportConfig): boolean {
  return config.privacy.requireConfirmation;
}

export function shouldPrintSavedReportPath(options: GenerateOutputOptions): boolean {
  return options.save !== false;
}
