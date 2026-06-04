import { describe, it, expect } from "vitest";
import { parseTimeExpression } from "../src/scheduler";

describe("parseTimeExpression", () => {
  // --- Cron pass-through ---
  it("passes through standard cron expressions unchanged", () => {
    expect(parseTimeExpression("0 18 * * 1-5")).toBe("0 18 * * 1-5");
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

  // --- Edge cases ---
  it("defaults to daily when only a frequency word is given (no time part)", () => {
    // Input without a time part — frequency is only parsed with >1 parts
    expect(parseTimeExpression("weekday")).toBe("0 18 * * *");
  });

  it("handles single-digit hours with leading zero minutes", () => {
    expect(parseTimeExpression("8:05")).toBe("05 8 * * *");
  });

  it("defaults to all days when no frequency is given", () => {
    expect(parseTimeExpression("12:00")).toBe("00 12 * * *");
  });
});
