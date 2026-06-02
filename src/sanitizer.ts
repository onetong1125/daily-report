import { SanitizedEvent } from "./types";

/**
 * Validate and sanitize events according to the allowedFields whitelist.
 * Strips any field not in the allowed list, and filters out events
 * with missing required fields (source, repo, entity_id, summary).
 */
export function sanitizeEvents(
  events: SanitizedEvent[],
  allowedFields: string[]
): SanitizedEvent[] {
  const sanitized: SanitizedEvent[] = [];

  for (const event of events) {
    // Skip events missing required fields
    if (!event.source || !event.repo || !event.entity_id || !event.summary) {
      console.warn(`⚠️  Sanitizer: 跳过不完整事件 (source=${event.source}, entity_id=${event.entity_id})`);
      continue;
    }

    // Build a new event with only allowed fields
    const clean: any = {};
    for (const field of allowedFields) {
      if (field in event) {
        clean[field] = (event as any)[field];
      }
    }

    // Ensure required fields are always present
    clean.source = event.source;
    clean.repo = event.repo;
    clean.entity_id = event.entity_id;
    clean.entity_type = event.entity_type;
    clean.summary = event.summary;
    clean.related_entities = event.related_entities || [];
    if (event.timestamp) clean.timestamp = event.timestamp;

    sanitized.push(clean as SanitizedEvent);
  }

  return sanitized;
}
