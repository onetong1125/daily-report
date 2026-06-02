import { TimeBoundary } from "./types";

/**
 * Calculate the UTC half-open interval [startUtc, endUtc) for a given date
 * in the specified timezone.
 *
 * Example: timeBoundary("2026-06-02", "Asia/Shanghai")
 *   → { startUtc: "2026-06-01T16:00:00.000Z", endUtc: "2026-06-02T16:00:00.000Z", date: "2026-06-02" }
 *
 * If `date` is undefined, today's date in the given timezone is used.
 */
export function timeBoundary(
  dateStr?: string,
  timezone?: string
): TimeBoundary {
  const tz = timezone || "Asia/Shanghai";

  // Determine the target date string in the given timezone
  let targetDate: string;
  if (dateStr) {
    targetDate = dateStr; // YYYY-MM-DD
  } else {
    // Today's date in the specified timezone
    const now = new Date();
    targetDate = now.toLocaleDateString("sv-SE", { timeZone: tz }); // sv-SE gives YYYY-MM-DD
  }

  // Create Date objects at midnight of target date and next day, in the timezone
  // We construct in UTC by using the timezone offset
  const startLocal = new Date(`${targetDate}T00:00:00`);
  const endLocal = new Date(`${targetDate}T00:00:00`);
  endLocal.setDate(endLocal.getDate() + 1);

  // These Date objects are in local system time. We need to convert to the target timezone.
  // Strategy: get the UTC timestamp for midnight in the target timezone.
  // We do this by creating a formatter that outputs the UTC equivalent.
  const startFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // To get UTC timestamps, we use the fact that Date.UTC gives us the timestamp
  // We parse the target date and construct the UTC equivalent using the timezone offset
  // The simplest reliable approach: use Temporal-like manual calculation

  // Actually, let's use a simpler approach:
  // Create a date string in the format that represents midnight in the target timezone,
  // then convert to UTC by constructing with timezone offset

  // Get the timezone offset at the target date
  const probeDate = new Date(`${targetDate}T12:00:00`);
  const probeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(probeDate);

  // Build a mapping of part types to values
  const parts: Record<string, string> = {};
  for (const p of probeParts) {
    parts[p.type] = p.value;
  }

  // Get the offset string like "GMT+08:00"
  const offsetStr = parts.timeZoneName || "";
  const offsetMatch = offsetStr.match(/GMT([+-]\d{2}):(\d{2})/);
  let offsetMinutes = 0;
  if (offsetMatch) {
    offsetMinutes = parseInt(offsetMatch[1]) * 60 + parseInt(offsetMatch[2]);
  }

  // Midnight in target timezone → UTC
  const startUtc = new Date(
    Date.UTC(
      parseInt(parts.year),
      parseInt(parts.month) - 1,
      parseInt(parts.day),
      0,
      0,
      0
    ) - offsetMinutes * 60 * 1000
  );

  // Next day midnight → UTC (half-open end)
  const endLocalDate = new Date(
    parseInt(parts.year),
    parseInt(parts.month) - 1,
    parseInt(parts.day) + 1
  );
  const endUtc = new Date(
    Date.UTC(
      endLocalDate.getFullYear(),
      endLocalDate.getMonth(),
      endLocalDate.getDate(),
      0,
      0,
      0
    ) - offsetMinutes * 60 * 1000
  );

  return {
    startUtc: startUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
    endUtc: endUtc.toISOString().replace(/\.\d{3}Z$/, "Z"),
    date: targetDate,
  };
}

/**
 * Get today's date string in the given timezone.
 */
export function todayInTimezone(timezone?: string): string {
  const tz = timezone || "Asia/Shanghai";
  return new Date().toLocaleDateString("sv-SE", { timeZone: tz });
}
