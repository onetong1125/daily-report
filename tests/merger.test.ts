import { describe, it, expect } from "vitest";
import { mergeAndDedup } from "../src/merger";
import { SanitizedEvent } from "../src/types";

function makeEvent(overrides: Partial<SanitizedEvent> = {}): SanitizedEvent {
  return {
    source: "git",
    repo: "/test/repo",
    timestamp: "2026-06-02T10:00:00Z",
    entity_id: "abc123",
    entity_type: "commit",
    summary: "test",
    related_entities: [],
    ...overrides,
  };
}

describe("mergeAndDedup", () => {
  it("returns empty groups when given an empty array", () => {
    const result = mergeAndDedup([]);
    expect(result.git_events).toEqual([]);
    expect(result.github_events).toEqual([]);
    expect(result.claude_events).toEqual([]);
    expect(result.codex_events).toEqual([]);
  });

  it("groups events by source", () => {
    const events: SanitizedEvent[] = [
      makeEvent({ source: "git", entity_id: "g1", entity_type: "commit" }),
      makeEvent({ source: "github", entity_id: "gh1", entity_type: "pr" }),
      makeEvent({ source: "claude", entity_id: "c1", entity_type: "session" }),
      makeEvent({ source: "codex", entity_id: "cx1", entity_type: "session" }),
    ];

    const result = mergeAndDedup(events);

    expect(result.git_events).toHaveLength(1);
    expect(result.github_events).toHaveLength(1);
    expect(result.claude_events).toHaveLength(1);
    expect(result.codex_events).toHaveLength(1);
  });

  it("deduplicates events with the same entity_type:entity_id key", () => {
    const events: SanitizedEvent[] = [
      makeEvent({ source: "git", entity_id: "dup", entity_type: "commit" }),
      makeEvent({ source: "github", entity_id: "dup", entity_type: "commit" }),
    ];

    const result = mergeAndDedup(events);

    // git has higher priority, so the git one survives
    expect(result.git_events).toHaveLength(1);
    expect(result.github_events).toHaveLength(0);
    expect(result.git_events[0].source).toBe("git");
  });

  it("prefers git over github when deduplicating", () => {
    const events: SanitizedEvent[] = [
      makeEvent({ source: "github", entity_id: "123", entity_type: "pr" }),
      makeEvent({ source: "git", entity_id: "123", entity_type: "pr" }),
    ];

    const result = mergeAndDedup(events);

    expect(result.git_events).toHaveLength(1);
    expect(result.github_events).toHaveLength(0);
    expect(result.git_events[0].source).toBe("git");
  });

  it("prefers github over claude when deduplicating", () => {
    const events: SanitizedEvent[] = [
      makeEvent({ source: "claude", entity_id: "456", entity_type: "session" }),
      makeEvent({ source: "github", entity_id: "456", entity_type: "session" }),
    ];

    const result = mergeAndDedup(events);

    expect(result.github_events).toHaveLength(1);
    expect(result.claude_events).toHaveLength(0);
    expect(result.github_events[0].source).toBe("github");
  });

  it("merges cross-references from deduplicated event into primary", () => {
    const gitEvent = makeEvent({
      source: "git",
      entity_id: "abc",
      entity_type: "commit",
      related_entities: ["git-ref"],
    });
    const ghEvent = makeEvent({
      source: "github",
      entity_id: "abc",
      entity_type: "commit",
      related_entities: ["PR#42"],
    });

    const result = mergeAndDedup([gitEvent, ghEvent]);

    // git wins because of higher priority
    expect(result.git_events).toHaveLength(1);
    // When lower-priority is dedup'd, its entity_id is added as cross-reference to primary
    expect(result.git_events[0].related_entities).toContain("git-ref");
    expect(result.git_events[0].related_entities).toContain("abc");
  });

  it("adds cross-reference to primary when lower-priority event arrives first", () => {
    // github arrives first, then git (higher priority) arrives
    const ghEvent = makeEvent({
      source: "github",
      entity_id: "abc",
      entity_type: "commit",
      related_entities: ["cross-ref-1"],
    });
    const gitEvent = makeEvent({
      source: "git",
      entity_id: "abc",
      entity_type: "commit",
      related_entities: ["cross-ref-2"],
    });

    const result = mergeAndDedup([ghEvent, gitEvent]);

    // git wins and absorbs github's cross-refs
    expect(result.git_events).toHaveLength(1);
    const survived = result.git_events[0];
    expect(survived.related_entities).toContain("cross-ref-1");
    expect(survived.related_entities).toContain("cross-ref-2");
  });

  it("deduplicates across different entity_types independently", () => {
    // same entity_id but different entity_type → different dedup key
    const commit = makeEvent({ entity_id: "123", entity_type: "commit" });
    const pr = makeEvent({ entity_id: "123", entity_type: "pr" });

    const result = mergeAndDedup([commit, pr]);

    expect(result.git_events).toHaveLength(2);
  });

  it("de-duplicates related_entities (no duplicates in array)", () => {
    const gitEvent = makeEvent({
      source: "git",
      entity_id: "xyz",
      entity_type: "commit",
      related_entities: ["ref1", "ref1", "ref2"],
    });
    const ghEvent = makeEvent({
      source: "github",
      entity_id: "xyz",
      entity_type: "commit",
      related_entities: ["ref1", "ref3"],
    });

    const result = mergeAndDedup([gitEvent, ghEvent]);

    const survived = result.git_events[0];
    // Primary's own dupes are removed, lower-priority's entity_id added
    expect(survived.related_entities.filter((r) => r === "ref1")).toHaveLength(1);
    expect(survived.related_entities).toContain("ref2");
    // Lower-priority event's entity_id is added as cross-reference
    expect(survived.related_entities).toContain("xyz");
  });

  it("handles multiple commits in the same repo", () => {
    const events: SanitizedEvent[] = [
      makeEvent({ entity_id: "sha1", entity_type: "commit", summary: "fix: bug" }),
      makeEvent({ entity_id: "sha2", entity_type: "commit", summary: "feat: new feature" }),
      makeEvent({ entity_id: "sha3", entity_type: "commit", summary: "chore: cleanup" }),
    ];

    const result = mergeAndDedup(events);

    expect(result.git_events).toHaveLength(3);
  });
});
