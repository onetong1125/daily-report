import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectGitEvents } from "../src/collectors/git-collector";
import { TimeBoundary } from "../src/types";

// Mock child_process.execSync
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";

const boundary: TimeBoundary = {
  startUtc: "2026-06-02T00:00:00Z",
  endUtc: "2026-06-03T00:00:00Z",
  date: "2026-06-02",
};

describe("collectGitEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no repos are configured", () => {
    const events = collectGitEvents([], boundary);
    expect(events).toEqual([]);
  });

  it("returns empty array when repo has no commits today", () => {
    (execSync as any).mockReturnValue("");
    const events = collectGitEvents(["/test/repo"], boundary);
    expect(events).toEqual([]);
  });

  it("parses a single commit correctly", () => {
    const gitOutput = "abc123def|feat: add login feature|testuser|2026-06-02T10:30:00+08:00";
    (execSync as any).mockReturnValue(gitOutput);

    const events = collectGitEvents(["/test/repo"], boundary);

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("git");
    expect(events[0].repo).toBe("/test/repo");
    expect(events[0].entity_id.length).toBeGreaterThanOrEqual(7); // SHA is at least 7 chars
    expect(events[0].entity_type).toBe("commit");
    expect(events[0].summary).toBe("feat: add login feature");
    expect(events[0].author).toBe("testuser");
    expect(events[0].timestamp).toBe("2026-06-02T10:30:00+08:00");
    expect(events[0].related_entities).toEqual([]);
  });

  it("parses multiple commits", () => {
    const gitOutput = [
      "sha1|feat: feature A|alice|2026-06-02T09:00:00Z",
      "sha2|fix: bug B|bob|2026-06-02T14:00:00Z",
      "sha3|chore: cleanup|charlie|2026-06-02T18:00:00Z",
    ].join("\n");
    (execSync as any).mockReturnValue(gitOutput);

    const events = collectGitEvents(["/test/repo"], boundary);

    expect(events).toHaveLength(3);
    expect(events[0].entity_id).toBe("sha1");
    expect(events[1].entity_id).toBe("sha2");
    expect(events[2].entity_id).toBe("sha3");
  });

  it("extracts repo name from path", () => {
    const gitOutput = "sha1|feat: test|user|2026-06-02T10:00:00Z";
    (execSync as any).mockReturnValue(gitOutput);

    const events = collectGitEvents(["/home/user/projects/my-awesome-project"], boundary);

    expect(events).toHaveLength(1);
    // repo is the full path, not just the name
    expect(events[0].repo).toBe("/home/user/projects/my-awesome-project");
  });

  it("truncates long commit subjects to 80 chars", () => {
    const longSubject = "A".repeat(100);
    const gitOutput = `sha1|${longSubject}|user|2026-06-02T10:00:00Z`;
    (execSync as any).mockReturnValue(gitOutput);

    const events = collectGitEvents(["/test/repo"], boundary);

    expect(events).toHaveLength(1);
    expect(events[0].summary.length).toBe(80);
    expect(events[0].summary.endsWith("...")).toBe(true);
  });

  it("skips lines with missing SHA or subject", () => {
    const gitOutput = [
      "|no sha|user|2026-06-02T10:00:00Z",  // missing sha
      "sha1||user|2026-06-02T10:00:00Z",       // missing subject
      "sha2|valid commit|user|2026-06-02T10:00:00Z",  // valid
    ].join("\n");
    (execSync as any).mockReturnValue(gitOutput);

    const events = collectGitEvents(["/test/repo"], boundary);

    expect(events).toHaveLength(1);
    expect(events[0].entity_id).toBe("sha2");
  });

  it("gracefully skips repos that cause git errors", () => {
    (execSync as any).mockImplementation(() => {
      throw new Error("fatal: not a git repository");
    });

    const events = collectGitEvents(["/bad/repo", "/test/repo"], boundary);

    // Both repos fail, but execution continues
    expect(events).toEqual([]);
  });

  it("continues collecting from other repos when one repo fails", () => {
    (execSync as any).mockImplementation((cmd: string) => {
      if (cmd.includes("/bad/repo")) {
        throw new Error("fatal: not a git repository");
      }
      return "sha1|feat: test|user|2026-06-02T10:00:00Z";
    });

    const events = collectGitEvents(["/bad/repo", "/test/repo"], boundary);

    // Should get events from the good repo
    expect(events).toHaveLength(1);
    expect(events[0].repo).toBe("/test/repo");
  });

  it("passes correct time boundary to git log command", () => {
    (execSync as any).mockReturnValue("");

    collectGitEvents(["/test/repo"], boundary);

    const callArg = (execSync as any).mock.calls[0][0];
    expect(callArg).toContain('--since="2026-06-02T00:00:00Z"');
    expect(callArg).toContain('--until="2026-06-03T00:00:00Z"');
  });
});
