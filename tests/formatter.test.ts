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
  const emptyReport: DailyReport = {
    date: "2026-06-02",
    tldr: ["完成了功能 A", "修复了 bug B"],
    git_section: "Git 活动",
    github_section: "无",
    claude_section: "讨论了架构",
    codex_section: "无",
    tomorrow_suggestions: ["补充测试", "提交 PR"],
  };

  it("includes date and weekday in header", () => {
    const md = formatMarkdown(emptyReport);
    expect(md).toContain("# 📋 日报 - 2026-06-02");
    // 2026-06-02 is a Tuesday
    expect(md).toContain("周二");
  });

  it("includes TL;DR section", () => {
    const md = formatMarkdown(emptyReport);
    expect(md).toContain("## TL;DR");
    expect(md).toContain("- 完成了功能 A");
    expect(md).toContain("- 修复了 bug B");
  });

  it("includes tomorrow suggestions", () => {
    const md = formatMarkdown(emptyReport);
    expect(md).toContain("## 📌 明日行动建议");
    expect(md).toContain("1. 补充测试");
    expect(md).toContain("2. 提交 PR");
  });

  it("uses text sections when no grouped events provided", () => {
    const report: DailyReport = {
      ...emptyReport,
      git_section: "做了很多 Git 操作",
    };
    const md = formatMarkdown(report);
    expect(md).toContain("做了很多 Git 操作");
  });

  it("generates Git activity table from grouped events", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({ entity_id: "abcdef1234567", summary: "feat: add login" }),
        makeEvent({ entity_id: "deadbeef999", summary: "fix: logout bug" }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(emptyReport, grouped);

    expect(md).toContain("## 💻 Git 活动");
    expect(md).toContain("| 提交 | 说明 |");
    expect(md).toContain("abcdef1");
    expect(md).toContain("feat: add login");
    expect(md).toContain("deadbee");
    expect(md).toContain("fix: logout bug");
  });

  it("groups git events by repo", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({ repo: "/path/to/project-a", entity_id: "sha1", summary: "commit a" }),
        makeEvent({ repo: "/path/to/project-b", entity_id: "sha2", summary: "commit b" }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(emptyReport, grouped);

    expect(md).toContain("### project-a (1 commits)");
    expect(md).toContain("### project-b (1 commits)");
  });

  it("shows cross-references in git table", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({
          entity_id: "sha1",
          summary: "feat: add JWT",
          related_entities: ["PR#42"],
        }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(emptyReport, grouped);

    expect(md).toContain("→ PR#42");
  });

  it("generates GitHub activity from grouped events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [
        makeEvent({
          source: "github",
          repo: "owner/repo",
          entity_type: "pr",
          entity_id: "42",
          summary: "Add JWT support",
          state: "open",
        }),
      ],
      claude_events: [],
      codex_events: [],
    };

    const md = formatMarkdown(emptyReport, grouped);

    expect(md).toContain("## 🌐 GitHub 活动");
    expect(md).toContain("owner/repo");
    expect(md).toContain("[open]");
    expect(md).toContain("Add JWT support");
  });

  it("generates Claude section from grouped events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          repo: "/path/to/project",
          entity_type: "session",
          summary: "讨论了架构设计",
          message_count: 42,
        }),
      ],
      codex_events: [],
    };

    const md = formatMarkdown(emptyReport, grouped);

    expect(md).toContain("## 🤖 Claude Code 对话");
    expect(md).toContain("讨论了架构设计");
  });

  it("generates Codex section from grouped events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [
        makeEvent({
          source: "codex",
          repo: "/path/to/project",
          entity_type: "session",
          summary: "代码审查",
        }),
      ],
    };

    const md = formatMarkdown(emptyReport, grouped);

    expect(md).toContain("## 🤖 Codex 对话");
    expect(md).toContain("代码审查");
  });

  it("shows '无' for empty sections when using text fallback", () => {
    const report: DailyReport = {
      date: "2026-06-02",
      tldr: ["休息日"],
      git_section: "无",
      github_section: "无",
      claude_section: "无",
      codex_section: "无",
      tomorrow_suggestions: [],
    };

    const md = formatMarkdown(report);
    // All sections should be present with "无" content
    expect(md).toContain("## 💻 Git 活动");
    expect(md).toContain("## 🌐 GitHub 活动");
  });

  it("renders empty tomorrow suggestions section with no items", () => {
    const report: DailyReport = {
      ...emptyReport,
      tomorrow_suggestions: [],
    };

    const md = formatMarkdown(report);
    // Section header is always present, but no numbered items
    expect(md).toContain("📌 明日行动建议");
    // No numbered items should follow the header
    const afterHeader = md.split("📌 明日行动建议")[1] || "";
    const lines = afterHeader.trim().split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(0);
  });
});
