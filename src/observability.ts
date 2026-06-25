export type LogValue = string | number | boolean | undefined;

export interface RunMetadataOptions {
  version: string;
  timezone: string;
  reportDate: string;
  configPath: string;
  outputDir: string;
  repoCount: number;
  now?: () => Date;
  random?: () => number;
  nodeVersion?: string;
  platform?: string;
  arch?: string;
}

export interface RunMetadata {
  run_id: string;
  version: string;
  node: string;
  platform: string;
  arch: string;
  timezone: string;
  report_date: string;
  config_path: string;
  output_dir: string;
  repos: number;
}

export interface PhaseTimerOptions {
  nowMs?: () => number;
  log?: (line: string) => void;
}

export interface PhaseTimer {
  finish(fields?: Record<string, LogValue>): void;
  fail(err: unknown, fields?: Record<string, LogValue>): void;
}

function formatValue(value: LogValue): string | undefined {
  if (value === undefined) return undefined;
  const raw = String(value);
  if (/^[A-Za-z0-9._:/@+-]+$/.test(raw)) return raw;
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function formatKeyValueLine(prefix: string, fields: Record<string, LogValue>): string {
  const parts = Object.entries(fields)
    .map(([key, value]) => {
      const formatted = formatValue(value);
      return formatted === undefined ? undefined : `${key}=${formatted}`;
    })
    .filter((part): part is string => Boolean(part));

  return `[${prefix}] ${parts.join(" ")}`;
}

function runIdTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}

function randomSuffix(random: () => number): string {
  return Math.floor(random() * 36).toString(36);
}

export function createRunMetadata(options: RunMetadataOptions): RunMetadata {
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const date = now();

  return {
    run_id: `${runIdTimestamp(date)}-${randomSuffix(random)}`,
    version: options.version,
    node: options.nodeVersion ?? process.version,
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    timezone: options.timezone,
    report_date: options.reportDate,
    config_path: options.configPath,
    output_dir: options.outputDir,
    repos: options.repoCount,
  };
}

export function createPhaseTimer(
  name: string,
  options: PhaseTimerOptions = {}
): PhaseTimer {
  const nowMs = options.nowMs ?? (() => Date.now());
  const log = options.log ?? console.log;
  const startedAt = nowMs();

  return {
    finish(fields: Record<string, LogValue> = {}) {
      log(formatKeyValueLine(name, {
        status: "ok",
        duration_ms: nowMs() - startedAt,
        ...fields,
      }));
    },
    fail(err: unknown, fields: Record<string, LogValue> = {}) {
      const message = err instanceof Error ? err.message : String(err);
      log(formatKeyValueLine(name, {
        status: "error",
        duration_ms: nowMs() - startedAt,
        ...fields,
        error: message,
      }));
    },
  };
}
