import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function normalizeRepoPath(input: string): string {
  const trimmed = input.trim();
  const expanded = trimmed.replace(/^~(?=$|\/)/, os.homedir());
  return path.resolve(expanded);
}

export function getRepoPathInputError(input: string): string | undefined {
  const repoPath = normalizeRepoPath(input);
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return "不是有效的 Git 仓库";
  }

  return undefined;
}

export function hasRepoPath(repos: string[], repoPath: string): boolean {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  return repos.some((existing) => normalizeRepoPath(existing) === normalizedRepoPath);
}
