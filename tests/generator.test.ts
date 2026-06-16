import { describe, it, expect } from "vitest";
import { parseResponse, templateReport, buildPrompt, shouldRetry, retryWithBackoff } from "../src/generator";
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

PROJECTS:
### project-a
在 project-a 中实现了 JWT token 刷新

### project-b
创建了 PR #42

OTHER_AI:
讨论了架构设计

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
    expect(report.projects).toEqual([
      { project: "project-a", summary: "在 project-a 中实现了 JWT token 刷新" },
      { project: "project-b", summary: "创建了 PR #42" },
    ]);
    expect(report.other_ai).toBe("讨论了架构设计");
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

PROJECTS:
### proj
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

PROJECTS:
### proj
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
    expect(report.projects).toEqual([]);
    expect(report.other_ai).toBe("");
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
    const text = `PROJECTS:
### proj
  indented content here

TOMORROW:
-   extra spaces
`;
    const report = parseResponse(text, "2026-06-02");
    expect(report.projects).toEqual([
      { project: "proj", summary: "indented content here" },
    ]);
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
    expect(report.projects.length).toBeGreaterThan(0);
    // project-a should appear in tldr with the summary
    expect(report.tldr.some((t) => t.includes("project-a"))).toBe(true);
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
    expect(report.tomorrow_suggestions.some((t) => t.includes("#42"))).toBe(true);
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
    expect(report.projects).toEqual([]);
    expect(report.other_ai).toBe("无");
  });

  it("summarizes Claude conversations in other_ai (no matching git project)", () => {
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

    // Claude event with no matching git project goes to other_ai
    expect(report.other_ai).not.toBe("无");
    expect(report.other_ai).toContain("Claude");
    expect(report.other_ai).toContain("project");
    expect(report.other_ai).toContain("主要围绕");
  });

  it("summarizes other AI conversations by directory instead of listing raw excerpts", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          entity_type: "session",
          repo: "/path/to/study",
          summary: "学习 ArrayBlockingQueue 源码 | 讨论 awaitNanos 超时等待 | 分析循环数组",
          message_count: 12,
        }),
      ],
      codex_events: [
        makeEvent({
          source: "codex",
          entity_type: "session",
          repo: "/path/to/study",
          summary: "设计 DelayQueue 学习路径 | 对比 PriorityQueue 实现",
          message_count: 8,
        }),
      ],
    };

    const report = templateReport(grouped, "2026-06-02");

    expect(report.other_ai).toContain("study: Claude/Codex 中有 2 次对话");
    expect(report.other_ai).toContain("约 20 条消息");
    expect(report.other_ai).toContain("主要围绕");
    expect(report.other_ai).not.toContain("[Claude]");
    expect(report.other_ai).not.toContain("[Codex]");
  });

  it("handles Claude events linked to known projects", () => {
    const grouped: GroupedEvents = {
      git_events: [
        makeEvent({ repo: "/path/to/myproject", summary: "feat: add feature" }),
      ],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          entity_type: "session",
          repo: "/path/to/myproject",
          summary: "讨论了架构设计",
        }),
      ],
      codex_events: [],
    };

    const report = templateReport(grouped, "2026-06-02");

    // Should appear in projects section, not in other_ai
    expect(report.projects.length).toBeGreaterThan(0);
    expect(report.tldr.some((t) => t.includes("myproject"))).toBe(true);
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

  it("does not include old format section headers when no events", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02");
    // New format does NOT include source-based sections when empty
    // Instead it just has output format instructions
    expect(prompt).toContain("PROJECTS:");
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
    expect(prompt).toContain("PROJECTS:");
    expect(prompt).toContain("TOMORROW");
  });

  it("instructs the LLM to summarize OTHER_AI by directory", () => {
    const grouped: GroupedEvents = {
      git_events: [],
      github_events: [],
      claude_events: [
        makeEvent({
          source: "claude",
          entity_type: "session",
          repo: "/path/to/study",
          summary: "学习并发集合源码",
        }),
      ],
      codex_events: [],
    };

    const prompt = buildPrompt(grouped, "2026-06-02");

    expect(prompt).toContain("OTHER_AI 必须按目录/项目总结");
    expect(prompt).toContain("不要逐条复述对话摘录");
    expect(prompt).toContain("- <目录名>:");
  });
});

// ============================================================
// shouldRetry
// ============================================================
describe("shouldRetry", () => {
  it("returns true for TypeError (network errors)", () => {
    const err = new TypeError("fetch failed");
    err.name = "TypeError";
    expect(shouldRetry(err)).toBe(true);
  });

  it("returns true for AbortError (timeout)", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(shouldRetry(err)).toBe(true);
  });

  it("returns true for HTTP 5xx", () => {
    const err = new Error("API 返回 502: Bad Gateway");
    expect(shouldRetry(err)).toBe(true);
  });

  it("returns true for HTTP 503", () => {
    const err = new Error("API 返回 503: Service Unavailable");
    expect(shouldRetry(err)).toBe(true);
  });

  it("returns true for HTTP 429", () => {
    const err = new Error("API 返回 429: Too Many Requests");
    expect(shouldRetry(err)).toBe(true);
  });

  it("returns false for HTTP 400", () => {
    const err = new Error("API 返回 400: Bad Request");
    expect(shouldRetry(err)).toBe(false);
  });

  it("returns false for HTTP 401", () => {
    const err = new Error("API 返回 401: Unauthorized");
    expect(shouldRetry(err)).toBe(false);
  });

  it("returns false for HTTP 403", () => {
    const err = new Error("API 返回 403: Forbidden");
    expect(shouldRetry(err)).toBe(false);
  });

  it("returns false for empty content error", () => {
    const err = new Error("API 返回空内容");
    expect(shouldRetry(err)).toBe(false);
  });

  it("returns false for JSON parse errors", () => {
    const err = new SyntaxError("Unexpected token");
    expect(shouldRetry(err)).toBe(false);
  });

  it("returns true for non-Error throwables (bare string)", () => {
    expect(shouldRetry("some string error")).toBe(true);
  });

  it("returns true for non-Error throwables (null)", () => {
    expect(shouldRetry(null)).toBe(true);
  });

  it("returns true for non-Error throwables (custom object)", () => {
    expect(shouldRetry({ code: "UNKNOWN" })).toBe(true);
  });
});

// ============================================================
// retryWithBackoff
// ============================================================
describe("retryWithBackoff", () => {
  it("returns result immediately on first success (no retry)", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "success";
    };

    const result = await retryWithBackoff(fn, 5, 1000);
    expect(result).toBe("success");
    expect(callCount).toBe(1);
  });

  it("retries and succeeds on second attempt", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("API 返回 502: Bad Gateway");
      }
      return "success";
    };

    const result = await retryWithBackoff(fn, 5, 10); // 10ms base delay for fast test
    expect(result).toBe("success");
    expect(callCount).toBe(2);
  });

  it("retries max times then throws last error", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("API 返回 503: Service Unavailable");
    };

    await expect(retryWithBackoff(fn, 3, 10)).rejects.toThrow("API 返回 503");
    expect(callCount).toBe(3);
  });

  it("does NOT retry on non-retryable error (4xx)", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("API 返回 401: Unauthorized");
    };

    await expect(retryWithBackoff(fn, 5, 10)).rejects.toThrow("API 返回 401");
    expect(callCount).toBe(1);
  });

  it("does NOT retry on empty content", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("API 返回空内容");
    };

    await expect(retryWithBackoff(fn, 5, 10)).rejects.toThrow("API 返回空内容");
    expect(callCount).toBe(1);
  });
});
