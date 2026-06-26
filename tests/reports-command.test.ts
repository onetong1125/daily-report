import { describe, expect, it } from "vitest";
import {
  discoverReports,
  findReportByDate,
  formatLatestReportSummary,
  formatReportList,
  isReportFileName,
} from "../src/reports-command";

describe("isReportFileName", () => {
  it("matches dated markdown reports only", () => {
    expect(isReportFileName("2026-06-24.md")).toBe(true);
    expect(isReportFileName("2026-06-24.log")).toBe(false);
    expect(isReportFileName("notes.md")).toBe(false);
  });
});

describe("discoverReports", () => {
  it("discovers dated reports and sorts newest first", () => {
    const reports = discoverReports("/reports", {
      existsSync: () => true,
      readdirSync: () => [
        "2026-06-23.md",
        "draft.md",
        "2026-06-24.md",
        "2026-06-24.log",
      ],
      statSync: (filePath) => ({ size: filePath.includes("2026-06-24") ? 34 : 12 }),
    });

    expect(reports).toEqual([
      {
        date: "2026-06-24",
        path: "/reports/2026-06-24.md",
        size: 34,
      },
      {
        date: "2026-06-23",
        path: "/reports/2026-06-23.md",
        size: 12,
      },
    ]);
  });

  it("returns an empty list when the reports directory is missing", () => {
    expect(discoverReports("/reports", {
      existsSync: () => false,
    })).toEqual([]);
  });
});

describe("formatReportList", () => {
  it("prints report dates, paths, and sizes", () => {
    expect(formatReportList([
      {
        date: "2026-06-24",
        path: "/reports/2026-06-24.md",
        size: 34,
      },
    ])).toBe("2026-06-24  /reports/2026-06-24.md (34 bytes)");
  });

  it("prints a helpful message when no reports exist", () => {
    expect(formatReportList([])).toBe("No reports found.");
  });
});

describe("formatLatestReportSummary", () => {
  it("prints latest report path", () => {
    expect(formatLatestReportSummary({
      date: "2026-06-24",
      path: "/reports/2026-06-24.md",
      size: 34,
    })).toBe([
      "latest report: 2026-06-24",
      "path: /reports/2026-06-24.md (34 bytes)",
    ].join("\n"));
  });

  it("prints a helpful message when no reports exist", () => {
    expect(formatLatestReportSummary(undefined)).toBe("No reports found.");
  });
});

describe("findReportByDate", () => {
  it("finds a report by date", () => {
    expect(findReportByDate([
      {
        date: "2026-06-24",
        path: "/reports/2026-06-24.md",
        size: 34,
      },
    ], "2026-06-24")).toEqual({
      date: "2026-06-24",
      path: "/reports/2026-06-24.md",
      size: 34,
    });
  });
});
