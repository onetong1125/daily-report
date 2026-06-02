import { execSync } from "child_process";
import { SanitizedEvent, TimeBoundary } from "../types";

/**
 * Check if `gh` CLI is available and authenticated.
 */
export function isGhAvailable(): boolean {
  try {
    execSync("gh auth status", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract owner/repo from a local git remote URL.
 * Supports both HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
function extractOwnerRepo(repoPath: string): string | null {
  try {
    const remote = execSync(`git -C "${repoPath}" remote get-url origin`, {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    // SSH: git@github.com:owner/repo.git
    const sshMatch = remote.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) return httpsMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * Safely run gh command, return parsed JSON or null on failure.
 */
function ghJson(cmd: string): any[] {
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!output) return [];
    return JSON.parse(output);
  } catch {
    return [];
  }
}

/**
 * Get today's date string for gh search queries (YYYY-MM-DD).
 */
function todayDateStr(boundary: TimeBoundary): string {
  return boundary.date;
}

/**
 * Collect GitHub activity for configured repos.
 * Queries per spec §5.3: PRs (created + merged), Issues (updated),
 * Reviews, and user commits.
 */
export function collectGitHubEvents(
  repos: string[],
  boundary: TimeBoundary
): SanitizedEvent[] {
  if (!isGhAvailable()) {
    console.warn("⚠️  gh 不可用，跳过 GitHub 数据采集");
    return [];
  }

  const events: SanitizedEvent[] = [];
  const today = todayDateStr(boundary);
  const seen = new Set<string>(); // dedup by entity_id

  // Get authenticated username for commit queries
  let username = "";
  try {
    username = execSync("gh api user --jq .login", {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
  } catch {
    // continue without commit queries
  }

  const addEvent = (event: SanitizedEvent): void => {
    const key = `${event.source}:${event.entity_type}:${event.entity_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      events.push(event);
    }
  };

  for (const repoPath of repos) {
    const ownerRepo = extractOwnerRepo(repoPath);
    if (!ownerRepo) continue;

    // 1. PRs created today
    const createdPRs = ghJson(
      `gh search prs --repo ${ownerRepo} --created ${today} --json number,title,state,url,createdAt --limit 30`
    );
    for (const pr of createdPRs) {
      if (!pr.number || !pr.title) continue;
      addEvent({
        source: "github",
        repo: ownerRepo,
        timestamp: pr.createdAt || boundary.startUtc,
        entity_id: String(pr.number),
        entity_type: "pr",
        summary: pr.title.length > 80 ? pr.title.slice(0, 77) + "..." : pr.title,
        related_entities: [],
        author: username || undefined,
        state: pr.state || "open",
      });
    }

    // 2. PRs merged today
    const mergedPRs = ghJson(
      `gh search prs --repo ${ownerRepo} --merged --merged-at ${today} --json number,title,state,url,mergedAt --limit 30`
    );
    for (const pr of mergedPRs) {
      if (!pr.number || !pr.title) continue;
      addEvent({
        source: "github",
        repo: ownerRepo,
        timestamp: pr.mergedAt || boundary.startUtc,
        entity_id: String(pr.number),
        entity_type: "pr",
        summary: pr.title.length > 80 ? pr.title.slice(0, 77) + "..." : pr.title,
        related_entities: [],
        author: username || undefined,
        state: "merged",
      });
    }

    // 3. Issues updated today
    const updatedIssues = ghJson(
      `gh search issues --repo ${ownerRepo} --updated ${today} --json number,title,state,url,updatedAt --limit 30`
    );
    for (const issue of updatedIssues) {
      if (!issue.number || !issue.title) continue;
      addEvent({
        source: "github",
        repo: ownerRepo,
        timestamp: issue.updatedAt || boundary.startUtc,
        entity_id: String(issue.number),
        entity_type: "issue",
        summary: issue.title.length > 80 ? issue.title.slice(0, 77) + "..." : issue.title,
        related_entities: [],
        author: username || undefined,
        state: issue.state || "open",
      });
    }

    // 4. Recent PRs for review activity
    const activePRs = ghJson(
      `gh pr list --repo ${ownerRepo} --search "updated:${today}" --json number --limit 20`
    );
    for (const pr of activePRs) {
      if (!pr.number) continue;
      try {
        const reviews = ghJson(
          `gh api "repos/${ownerRepo}/pulls/${pr.number}/reviews" --jq '.[] | select(.submitted_at >= "${boundary.startUtc}") | {id, submitted_at, state}' --limit 10`
        );
        for (const review of reviews) {
          if (!review.id) continue;
          addEvent({
            source: "github",
            repo: ownerRepo,
            timestamp: review.submitted_at || boundary.startUtc,
            entity_id: String(review.id),
            entity_type: "review",
            summary: `Reviewed: PR #${pr.number}`,
            related_entities: [String(pr.number)],
            author: username || undefined,
            state: review.state || "commented",
          });
        }
      } catch {
        // skip reviews for this PR
      }
    }

    // 5. User's own commits today
    if (username) {
      const commits = ghJson(
        `gh api "repos/${ownerRepo}/commits?since=${boundary.startUtc}&until=${boundary.endUtc}&author=${username}" --jq '.[] | {sha, commit: {message, author: {date}}}' --limit 50`
      );
      for (const c of commits) {
        if (!c.sha) continue;
        const msg = c.commit?.message?.split("\n")[0] || "";
        const summary = msg.length > 80 ? msg.slice(0, 77) + "..." : msg;
        addEvent({
          source: "github",
          repo: ownerRepo,
          timestamp: c.commit?.author?.date || boundary.startUtc,
          entity_id: c.sha.slice(0, 7),
          entity_type: "commit",
          summary,
          related_entities: [],
          author: username,
        });
      }
    }
  }

  return events;
}
