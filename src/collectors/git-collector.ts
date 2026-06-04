import { execSync } from "child_process";
import { SanitizedEvent } from "../types";
import { TimeBoundary } from "../types";

/**
 * Scan configured Git repos for today's commits.
 * Each commit is mapped to a SanitizedEvent.
 * Repos that fail are skipped gracefully (per spec §7).
 */
export function collectGitEvents(
  repos: string[],
  boundary: TimeBoundary
): SanitizedEvent[] {
  const events: SanitizedEvent[] = [];

  for (const repoPath of repos) {
    try {
      const repoName = repoPath.split("/").pop() || repoPath;
      const cmd = `git -C "${repoPath}" log --since="${boundary.startUtc}" --until="${boundary.endUtc}" --format="%H|%s|%an|%aI" --all`;
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (!output) continue; // no commits today

      const lines = output.split("\n");
      for (const line of lines) {
        const [sha, subject, author, isoTime] = line.split("|");
        if (!sha || !subject) continue;

        // Truncate subject to 80 chars for summary
        const summary = subject.length > 80 ? subject.slice(0, 77) + "..." : subject;

        events.push({
          source: "git",
          repo: repoPath,
          timestamp: isoTime,
          entity_id: sha.slice(0, 7),
          entity_type: "commit",
          summary,
          related_entities: [],
          author,
        });
      }
    } catch (err: any) {
      // Skip this repo gracefully
      console.warn(`⚠️ 无法访问仓库: ${repoPath} (${err.message?.split("\n")[0] || err})`);
    }
  }

  return events;
}
