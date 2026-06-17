import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

function resolveInputPath(input: string): string {
  const trimmed = input.trim();
  const expanded = trimmed.replace(/^~(?=$|\/)/, os.homedir());
  return path.resolve(expanded);
}

function realpathIfExists(repoPath: string): string {
  try {
    return fs.realpathSync.native(repoPath);
  } catch {
    return repoPath;
  }
}

function getGitTopLevelPath(repoPath: string): string | undefined {
  try {
    const topLevel = execFileSync(
      "git",
      ["-C", repoPath, "rev-parse", "--show-toplevel"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return topLevel.length > 0 ? realpathIfExists(topLevel) : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeRepoPath(input: string): string {
  const repoPath = resolveInputPath(input);
  return getGitTopLevelPath(repoPath) ?? realpathIfExists(repoPath);
}

export function getRepoPathInputError(input: string): string | undefined {
  const repoPath = resolveInputPath(input);
  if (!getGitTopLevelPath(repoPath)) {
    return "不是有效的 Git 仓库";
  }

  return undefined;
}

export function hasRepoPath(repos: string[], repoPath: string): boolean {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  return repos.some((existing) => normalizeRepoPath(existing) === normalizedRepoPath);
}

export function uniqueRepoPaths(repos: string[]): string[] {
  const uniqueRepos: string[] = [];
  for (const repo of repos) {
    const normalizedRepo = normalizeRepoPath(repo);
    if (!uniqueRepos.includes(normalizedRepo)) {
      uniqueRepos.push(normalizedRepo);
    }
  }
  return uniqueRepos;
}
