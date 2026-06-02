import { describe, it, expect } from "vitest";
import { sanitizeEvents } from "../src/sanitizer";
import { SanitizedEvent } from "../src/types";

const ALLOWED_FIELDS = [
  "source", "repo", "timestamp", "entity_id", "entity_type",
  "summary", "related_entities", "author", "state", "message_count",
];

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
    state: "open",
    ...overrides,
  };
}

describe("sanitizeEvents", () => {
  it("returns an empty array when given an empty array", () => {
    expect(sanitizeEvents([], ALLOWED_FIELDS)).toEqual([]);
  });

  it("preserves all allowed fields for a valid event", () => {
    const event = makeEvent();
    const result = sanitizeEvents([event], ALLOWED_FIELDS);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("git");
    expect(result[0].repo).toBe("/test/repo");
    expect(result[0].entity_id).toBe("abc123");
    expect(result[0].entity_type).toBe("commit");
    expect(result[0].summary).toBe("test commit");
    expect(result[0].author).toBe("testuser");
    expect(result[0].state).toBe("open");
    expect(result[0].timestamp).toBe("2026-06-02T10:00:00Z");
  });

  it("strips fields not in the allowed list", () => {
    const event = { ...makeEvent(), extraField: "should-be-removed" } as any;
    const result = sanitizeEvents([event], ALLOWED_FIELDS);

    expect(result).toHaveLength(1);
    expect((result[0] as any).extraField).toBeUndefined();
  });

  it("filters out events missing required field: source", () => {
    const event = makeEvent({ source: "" as any });
    expect(sanitizeEvents([event], ALLOWED_FIELDS)).toHaveLength(0);
  });

  it("filters out events missing required field: repo", () => {
    const event = makeEvent({ repo: "" });
    expect(sanitizeEvents([event], ALLOWED_FIELDS)).toHaveLength(0);
  });

  it("filters out events missing required field: entity_id", () => {
    const event = makeEvent({ entity_id: "" });
    expect(sanitizeEvents([event], ALLOWED_FIELDS)).toHaveLength(0);
  });

  it("filters out events missing required field: summary", () => {
    const event = makeEvent({ summary: "" });
    expect(sanitizeEvents([event], ALLOWED_FIELDS)).toHaveLength(0);
  });

  it("ensures required fields are always present even if not in allowedFields", () => {
    const event = makeEvent({ related_entities: ["ref1"] });
    const limitedFields = ["source", "repo"]; // very restrictive
    const result = sanitizeEvents([event], limitedFields);

    expect(result).toHaveLength(1);
    // Required fields always present
    expect(result[0].source).toBe("git");
    expect(result[0].repo).toBe("/test/repo");
    expect(result[0].entity_id).toBe("abc123");
    expect(result[0].entity_type).toBe("commit");
    expect(result[0].summary).toBe("test commit");
    expect(result[0].related_entities).toEqual(["ref1"]);
  });

  it("ensures related_entities defaults to empty array when not present", () => {
    const event = makeEvent();
    delete (event as any).related_entities;
    const result = sanitizeEvents([event], ALLOWED_FIELDS);

    expect(result).toHaveLength(1);
    expect(result[0].related_entities).toEqual([]);
  });

  it("works with custom allowed fields whitelist", () => {
    const event = makeEvent({ author: "testuser", state: "open" });
    const limitedFields = ["source", "repo", "entity_id", "entity_type", "summary"];
    const result = sanitizeEvents([event], limitedFields);

    expect(result).toHaveLength(1);
    expect(result[0].author).toBeUndefined();
    expect(result[0].state).toBeUndefined();
    expect(result[0].source).toBe("git");
  });

  it("handles multiple events, keeping valid and discarding invalid", () => {
    const valid1 = makeEvent({ entity_id: "1" });
    const invalid = makeEvent({ entity_id: "", source: "" as any });
    const valid2 = makeEvent({ entity_id: "2" });

    const result = sanitizeEvents([valid1, invalid, valid2], ALLOWED_FIELDS);

    expect(result).toHaveLength(2);
    expect(result[0].entity_id).toBe("1");
    expect(result[1].entity_id).toBe("2");
  });

  it("handles events from different sources", () => {
    const gitEvent = makeEvent({ source: "git", entity_id: "git-1" });
    const ghEvent = makeEvent({ source: "github", entity_id: "gh-1", entity_type: "pr" });
    const claudeEvent = makeEvent({ source: "claude", entity_id: "claude-1", entity_type: "session" });

    const result = sanitizeEvents([gitEvent, ghEvent, claudeEvent], ALLOWED_FIELDS);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.source)).toEqual(["git", "github", "claude"]);
  });
});
