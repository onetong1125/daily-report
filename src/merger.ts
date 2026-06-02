import { SanitizedEvent, GroupedEvents } from "./types";

/**
 * Merge and deduplicate events across all collectors.
 *
 * Rules (spec §6.2):
 * - Git commit → git_events (primary), cross-referenced in github_events
 * - GitHub PR/Issue/Review → github_events (primary)
 * - Claude/Codex session → respective conversation sections
 * - Same entity_id across sources → keep the primary one, add cross-refs
 *
 * Dedup key: `${source}:${entity_type}:${entity_id}`
 */
export function mergeAndDedup(events: SanitizedEvent[]): GroupedEvents {
  // Dedup by unique key, preferring the "primary" source
  const byId = new Map<string, SanitizedEvent>();

  // Priority order for dedup: git > github > claude > codex
  const sourcePriority: Record<string, number> = {
    git: 1,
    github: 2,
    claude: 3,
    codex: 4,
  };

  for (const event of events) {
    const key = `${event.entity_type}:${event.entity_id}`;
    const existing = byId.get(key);

    if (!existing || sourcePriority[event.source] < sourcePriority[existing.source]) {
      // Keep this one as primary, merge cross-references from the old one
      if (existing) {
        event.related_entities = [
          ...new Set([...event.related_entities, ...existing.related_entities]),
        ];
      }
      byId.set(key, event);
    } else {
      // Add cross-reference to the primary
      existing.related_entities = [
        ...new Set([...existing.related_entities, event.entity_id]),
      ];
    }
  }

  // Group by source
  const grouped: GroupedEvents = {
    git_events: [],
    github_events: [],
    claude_events: [],
    codex_events: [],
  };

  for (const event of byId.values()) {
    switch (event.source) {
      case "git":
        grouped.git_events.push(event);
        break;
      case "github":
        grouped.github_events.push(event);
        break;
      case "claude":
        grouped.claude_events.push(event);
        break;
      case "codex":
        grouped.codex_events.push(event);
        break;
    }
  }

  return grouped;
}
