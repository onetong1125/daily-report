import { describe, it, expect } from "vitest";
import { formatMarkdown } from "../src/formatter";
import { DailyReport, GroupedEvents, SanitizedEvent } from "../src/types";

function makeEvent(overrides: Partial<SanitizedEvent> = {}): SanitizedEvent {
  return {
    source: "git",
    repo: "/test/repo",
    timestamp: "2026-06-02T10:00:00Z",
    entity_id: "abc1234567",
    entity_type: "commit",
    summary: "test commit",
    related_entities: [],
    ...overrides,
  };
}

describe("formatMarkdown", () => {
  const report: DailyReport = {
    date: "2026-06-02",
    tldr: ["完成了功能 A", "修复了 bug B"],
    projects: [
      {
        project: "project-a",
        summary: "完成 project-a 的登录功能",
      },
      {
        project: "project-b",
        summary: "修复 project-b 的退出问题",
      },
    ],
    other_ai: "讨论了架构设计",
    tomorrow_suggestions: ["补充测试", "提交 PR"],
  };

  it("includes date and weekday in header", () => {
    const md = formatMarkdown(report);

    expect(md).toContain("# 📋 日报 - 2026-06-02");
    expect(md).toContain("周二");
  });

  it("includes TL;DR section", () => {
    const md = formatMarkdown(report);

    expect(md).toContain("## TL;DR");
    expect(md).toContain("- 完成了功能 A");
    expect(md).toContain("- 修复了 bug B");
  });

  it("renders project summaries without grouped events", () => {
    const md = formatMarkdown(report);

    expect(md).toContain("## 📁 project-a");
    expect(md).toContain("完成 project-a 的登录功能");
    expect(md).toContain("## 📁 project-b");
    expect(md).toContain("修复 project-b 的退出问题");
    expect(md).not.toContain("### Git 提交");
  });

  it("renders other AI section", () => {
    const md = formatMarkdown(report);

    expect(md).toContain("## 💬 其他 AI 对话");
    expect(md).toContain("讨论了架构设计");
  });

  it("uses 无 for empty other AI section", () => {
    const md = formatMarkdown({ ...report, other_ai: "" });

    expect(md).toContain("## 💬 其他 AI 对话");
    expect(md).toContain("\n无\n");
  });

  it("includes tomorrow suggestions", () => {
    const md = formatMarkdown(report);

    expect(md).toContain("## 📌 明日行动建议");
    expect(md).toContain("1. 补充测试");
    expect(md).toContain("2. 提交 PR");
  });

  it("renders empty tomorrow suggestions section with no items", () => {
    const md = formatMarkdown({ ...report, tomorrow_suggestions: [] });

    expect(md).toContain("📌 明日行动建议");
    const afterHeader = md.split("📌 明日行动建议")[1] || "";
    const lines = afterHeader.trim().split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(0);
  });

  it("generates Git activity table for matching project events", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({
          repo: "/path/to/project-a",
          entity_id: "abcdef1234567",
          summary: "feat: add login",
        }),
        makeEvent({
          repo: "/path/to/project-a",
          entity_id: "deadbeef999",
          summary: "fix: logout bug",
        }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(report, grouped);

    expect(md).toContain("### Git 提交");
    expect(md).toContain("| 提交 | 说明 |");
    expect(md).toContain("abcdef1");
    expect(md).toContain("feat: add login");
    expect(md).toContain("deadbee");
    expect(md).toContain("fix: logout bug");
  });

  it("does not render unrelated project events", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({
          repo: "/path/to/project-c",
          entity_id: "abcdef1234567",
          summary: "feat: unrelated",
        }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(report, grouped);

    expect(md).not.toContain("feat: unrelated");
  });

  it("generates GitHub activity for matching project events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [
        makeEvent({
          source: "github",
          repo: "owner/project-a",
          entity_type: "pr",
          entity_id: "42",
          summary: "Add JWT support",
          state: "open",
        }),
      ],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(report, grouped);

    expect(md).toContain("### GitHub 活动");
    expect(md).toContain("[open] pr: Add JWT support");
  });

  it("does not append Claude excerpts for matching project events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          repo: "/path/to/project-a",
          entity_type: "session",
          summary: "讨论了架构设计",
          message_count: 42,
        }),
      ],
      codex_events: [],
    };

    const md = formatMarkdown(report, grouped);

    expect(md).not.toContain("### Claude Code 对话");
    expect(md).not.toContain("- 讨论了架构设计");
    expect(md).toContain("完成 project-a 的登录功能");
  });

  it("does not append Codex excerpts for matching project events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [
        makeEvent({
          source: "codex",
          repo: "/path/to/project-a",
          entity_type: "session",
          summary: "代码审查",
        }),
      ],
    };

    const md = formatMarkdown(report, grouped);

    expect(md).not.toContain("### Codex 对话");
    expect(md).not.toContain("- 代码审查");
    expect(md).toContain("完成 project-a 的登录功能");
  });
});
