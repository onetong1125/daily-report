import { describe, it, expect } from "vitest";
import { parseResponse, templateReport, buildPrompt } from "../src/generator";
import { SanitizedEvent, GroupedEvents, DailyReport } from "../src/types";

function makeEvent(overrides: Partial<SanitizedEvent> = {}): SanitizedEvent {
  return {
    source: "git",
    repo: "/test/repo",
    timestamp: "2026-06-02T10:00:00Z",
    entity_id: "abc123",
    entity_type: "commit",
    summary: "test commit",
    related_entities: [],
    author: "testuser",
    ...overrides,
  };
}

// ============================================================
// parseResponse
// ============================================================
describe("parseResponse", () => {
  const sampleOutput = `TL;DR:
- 完成了 JWT refresh token 功能
- 修复了 2 个 bug

GIT_SECTION:
在 project-a 中实现了 JWT token 刷新

GITHUB_SECTION:
创建了 PR #42

CLAUDE_SECTION:
讨论了架构设计

CODEX_SECTION:
无

TOMORROW:
- 补充 JWT 测试用例
- 跑 CI 验证
`;

  it("parses a complete LLM response into DailyReport", () => {
    const report = parseResponse(sampleOutput, "2026-06-02");

    expect(report.date).toBe("2026-06-02");
    expect(report.tldr).toEqual([
      "完成了 JWT refresh token 功能",
      "修复了 2 个 bug",
    ]);
    expect(report.git_section).toBe("在 project-a 中实现了 JWT token 刷新");
    expect(report.github_section).toBe("创建了 PR #42");
    expect(report.claude_section).toBe("讨论了架构设计");
    expect(report.codex_section).toBe("无");
    expect(report.tomorrow_suggestions).toEqual([
      "补充 JWT 测试用例",
      "跑 CI 验证",
    ]);
  });

  it("parses TL;DR with asterisk and dash bullets", () => {
    const text = `TL;DR:
* item one
- item two
* item three
GIT_SECTION:
some git
TOMORROW:
- do this
`;
    const report = parseResponse(text, "2026-06-02");
    expect(report.tldr).toEqual(["item one", "item two", "item three"]);
  });

  it("handles numbered tomorrow suggestions", () => {
    const text = `TL;DR:
- did work
GIT_SECTION:
commits
TOMORROW:
1. first task
2. second task
3. third task
`;
    const report = parseResponse(text, "2026-06-02");
    expect(report.tomorrow_suggestions).toEqual([
      "first task",
      "second task",
      "third task",
    ]);
  });

  it("returns empty arrays/strings for missing sections", () => {
    const text = "TL;DR:\n- only tldr";
    const report = parseResponse(text, "2026-06-02");

    expect(report.tldr).toEqual(["only tldr"]);
    expect(report.git_section).toBe("");
    expect(report.github_section).toBe("");
    expect(report.claude_section).toBe("");
    expect(report.codex_section).toBe("");
    expect(report.tomorrow_suggestions).toEqual([]);
  });

  it("handles TL;DR without colon", () => {
    const text = `TL;DR
- item 1
- item 2

TOMORROW:
- next
`;
    const report = parseResponse(text, "2026-06-02");
    expect(report.tldr).toEqual(["item 1", "item 2"]);
    expect(report.tomorrow_suggestions).toEqual(["next"]);
  });

  it("trims whitespace from parsed values", () => {
    const text = `GIT_SECTION:
  indented content here
TOMORROW:
-   extra spaces
`;
    const report = parseResponse(text, "2026-06-02");
    expect(report.git_section).toBe("indented content here");
    expect(report.tomorrow_suggestions).toEqual(["extra spaces"]);
  });

  it("filters empty lines from TL;DR and TOMORROW", () => {
    const text = `TL;DR:
- item 1

- item 2

TOMORROW:

- do this

`;
    const report = parseResponse(text, "2026-06-02");
    expect(report.tldr).toEqual(["item 1", "item 2"]);
    expect(report.tomorrow_suggestions).toEqual(["do this"]);
  });
});

// ============================================================
// templateReport
// ============================================================
describe("templateReport", () => {
  it("generates tldr from git events grouped by repo", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({ repo: "/path/to/project-a", entity_id: "sha1", summary: "feat: add login" }),
        makeEvent({ repo: "/path/to/project-a", entity_id: "sha2", summary: "fix: logout bug" }),
        makeEvent({ repo: "/path/to/project-b", entity_id: "sha3", summary: "chore: update deps" }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.tldr.length).toBeGreaterThan(0);
    expect(report.tldr.some((t) => t.includes("project-a"))).toBe(true);
    expect(report.tldr.some((t) => t.includes("2"))).toBe(true); // 2 commits in project-a
  });

  it("generates tldr for GitHub PR and review activity", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [
        makeEvent({ source: "github", entity_id: "42", entity_type: "pr", summary: "Add JWT", state: "open" }),
        makeEvent({ source: "github", entity_id: "43", entity_type: "review", summary: "Reviewed: PR #42" }),
      ],
      claude_events: [],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.tldr.some((t) => t.includes("GitHub"))).toBe(true);
    expect(report.tldr.some((t) => t.includes("PR"))).toBe(true);
  });

  it("generates tomorrow suggestions from WIP commits", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({ entity_id: "wip1", summary: "feat: implement auth" }),
        makeEvent({ entity_id: "wip2", summary: "fix: resolve race condition" }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.tomorrow_suggestions.length).toBeGreaterThan(0);
    const suggestion = report.tomorrow_suggestions[0];
    expect(suggestion).toContain("继续完成");
  });

  it("generates tomorrow suggestions from open PRs", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [
        makeEvent({ source: "github", entity_id: "42", entity_type: "pr", summary: "Add JWT", state: "open" }),
      ],
      claude_events: [],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.tomorrow_suggestions.length).toBeGreaterThan(0);
    expect(report.tomorrow_suggestions[0]).toContain("#42");
  });

  it("includes manual todo in suggestions", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02", "手动补充: 完成测试");

    expect(report.tomorrow_suggestions).toContain("手动补充: 完成测试");
  });

  it("shows rest day message when no activity", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.tldr).toHaveLength(1);
    expect(report.tldr[0]).toContain("休息");
    expect(report.git_section).toBe("无");
    expect(report.github_section).toBe("无");
    expect(report.claude_section).toBe("无");
    expect(report.codex_section).toBe("无");
  });

  it("summarizes Claude conversations", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          entity_type: "session",
          repo: "/path/to/project",
          summary: "讨论了架构设计 | 实现了功能",
        }),
      ],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.tldr.some((t) => t.includes("Claude"))).toBe(true);
    expect(report.claude_section).not.toBe("无");
  });

  it("excludes '无对话内容' conversations from tldr", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          entity_type: "session",
          repo: "/path/to/project",
          summary: "无对话内容",
        }),
      ],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    // "无对话内容" should not appear in tldr
    expect(report.tldr.filter((t) => t.includes("Claude"))).toHaveLength(0);
  });
});

// ============================================================
// buildPrompt
// ============================================================
describe("buildPrompt", () => {
  it("includes date in the prompt", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02");
    expect(prompt).toContain("2026-06-02");
  });

  it("includes git commit details", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({ entity_id: "abcdef1234567", summary: "feat: new feature" }),
      ],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02");
    expect(prompt).toContain("abcdef1"); // truncated SHA
    expect(prompt).toContain("feat: new feature");
  });

  it('shows "无" when no git events', () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02");
    expect(prompt).toContain("Git 提交活动: 无");
  });

  it("includes manual todo when provided", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02", "完成测试");
    expect(prompt).toContain("完成测试");
  });

  it("includes output format instructions", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02");
    expect(prompt).toContain("TL;DR");
    expect(prompt).toContain("GIT_SECTION");
    expect(prompt).toContain("TOMORROW");
  });
});
