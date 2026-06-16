import { describe, it, expect } from "vitest";
import { cronToLaunchdCalendarIntervals, parseTimeExpression } from "../src/scheduler";

describe("parseTimeExpression", () => {
  // --- Cron pass-through ---
  it("passes through standard cron expressions unchanged", () => {
    expect(parseTimeExpression("0 18 * * 1-5")).toBe("0 18 * * 1-5");
  });

  it("passes through zero-padded cron expressions unchanged", () => {
    expect(parseTimeExpression("00 21 * * *")).toBe("00 21 * * *");
  });

  it("passes through cron with comma-separated days", () => {
    expect(parseTimeExpression("30 9 * * 1,3,5")).toBe("30 9 * * 1,3,5");
  });

  it("passes through cron with wildcard minutes using */N syntax", () => {
    expect(parseTimeExpression("*/15 8 * * *")).toBe("*/15 8 * * *");
  });

  it("trims whitespace from input", () => {
    expect(parseTimeExpression("  0 18 * * 1-5  ")).toBe("0 18 * * 1-5");
  });

  // --- Friendly time formats ---
  it('parses "18:00" to daily cron', () => {
    expect(parseTimeExpression("18:00")).toBe("00 18 * * *");
  });

  it('parses "9:30" to correct minute and hour', () => {
    expect(parseTimeExpression("9:30")).toBe("30 9 * * *");
  });

  it('parses "18:00 weekday" to weekdays only', () => {
    expect(parseTimeExpression("18:00 weekday")).toBe("00 18 * * 1-5");
  });

  it('parses "18:00 weekdays" (plural) to weekdays', () => {
    expect(parseTimeExpression("18:00 weekdays")).toBe("00 18 * * 1-5");
  });

  it('parses "18:00 weekend" to Saturday+Sunday', () => {
    expect(parseTimeExpression("18:00 weekend")).toBe("00 18 * * 0,6");
  });

  it("parses individual weekday names", () => {
    expect(parseTimeExpression("9:00 mon,fri")).toBe("00 9 * * 1,5");
  });

  it("parses full weekday names", () => {
    expect(parseTimeExpression("9:00 monday")).toBe("00 9 * * 1");
  });

  it("parses mixed abbreviated day names", () => {
    expect(parseTimeExpression("10:00 tue,thu")).toBe("00 10 * * 2,4");
  });

  it("parses weekday names with spaces after commas", () => {
    expect(parseTimeExpression("10:00 tue, thu")).toBe("00 10 * * 2,4");
  });

  // --- Edge cases ---
  it("rejects frequency-only input", () => {
    expect(() => parseTimeExpression("weekday")).toThrow(/Invalid schedule expression/);
  });

  it("handles single-digit hours with leading zero minutes", () => {
    expect(parseTimeExpression("8:05")).toBe("05 8 * * *");
  });

  it("defaults to all days when no frequency is given", () => {
    expect(parseTimeExpression("12:00")).toBe("00 12 * * *");
  });

  it("parses setup daily frequency wildcard", () => {
    expect(parseTimeExpression("21:00 *")).toBe("00 21 * * *");
  });

  it("rejects invalid friendly time values", () => {
    expect(() => parseTimeExpression("24:00")).toThrow(/Invalid hour value/);
    expect(() => parseTimeExpression("18:60")).toThrow(/Invalid minute value/);
  });

  it("rejects unknown friendly frequencies", () => {
    expect(() => parseTimeExpression("18:00 nonsense")).toThrow(/Invalid schedule frequency/);
  });

  it("rejects malformed friendly expressions", () => {
    expect(() => parseTimeExpression("18:00 weekday extra")).toThrow(/Invalid schedule frequency/);
  });

  it("rejects cron expressions with out-of-range values", () => {
    expect(() => parseTimeExpression("99 18 * * *")).toThrow(/Invalid minute value/);
    expect(() => parseTimeExpression("0 24 * * *")).toThrow(/Invalid hour value/);
  });

  it("rejects cron expressions with malformed fields", () => {
    expect(() => parseTimeExpression("*/0 18 * * *")).toThrow(/Invalid minute value/);
    expect(() => parseTimeExpression("0 18 * * mon")).toThrow(/Invalid weekday field/);
    expect(() => parseTimeExpression("0 18 * * * *"))
      .toThrow(/Expected a 5-field cron expression/);
  });

  it("explains shell-expanded cron expressions", () => {
    expect(() => parseTimeExpression("00 21 file-a file-b file-c file-d"))
      .toThrow(/Quote cron expressions that contain \*/);
  });
});

describe("cronToLaunchdCalendarIntervals", () => {
  it("converts a daily cron expression to one launchd interval", () => {
    expect(cronToLaunchdCalendarIntervals("00 21 * * *")).toEqual([
      { Hour: 21, Minute: 0 },
    ]);
  });

  it("expands weekday ranges because launchd Weekday is a single integer", () => {
    expect(cronToLaunchdCalendarIntervals("0 18 * * 1-5")).toEqual([
      { Weekday: 1, Hour: 18, Minute: 0 },
      { Weekday: 2, Hour: 18, Minute: 0 },
      { Weekday: 3, Hour: 18, Minute: 0 },
      { Weekday: 4, Hour: 18, Minute: 0 },
      { Weekday: 5, Hour: 18, Minute: 0 },
    ]);
  });

  it("expands comma-separated weekend days", () => {
    expect(cronToLaunchdCalendarIntervals("30 9 * * 0,6")).toEqual([
      { Weekday: 0, Hour: 9, Minute: 30 },
      { Weekday: 6, Hour: 9, Minute: 30 },
    ]);
  });

  it("expands stepped minute expressions", () => {
    expect(cronToLaunchdCalendarIntervals("*/20 8 * * *")).toEqual([
      { Hour: 8, Minute: 0 },
      { Hour: 8, Minute: 20 },
      { Hour: 8, Minute: 40 },
    ]);
  });

  it("normalizes cron Sunday 7 to launchd Sunday 0", () => {
    expect(cronToLaunchdCalendarIntervals("0 18 * * 7")).toEqual([
      { Weekday: 0, Hour: 18, Minute: 0 },
    ]);
  });

  it("rejects cron expressions that launchd cannot safely represent", () => {
    expect(() => cronToLaunchdCalendarIntervals("0 18 1 * 1")).toThrow(
      /day-of-month and weekday/
    );
  });
});
