import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { getRepoPathInputError, hasRepoPath, normalizeRepoPath, uniqueRepoPaths } from "../src/repo-path";

function createGitRepo(name: string): string {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), `daily-report-${name}-`));
  execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
  return fs.realpathSync.native(repoPath);
}

describe("normalizeRepoPath", () => {
  it("resolves blank input to the current directory", () => {
    expect(normalizeRepoPath("")).toBe(process.cwd());
    expect(normalizeRepoPath("   ")).toBe(process.cwd());
  });

  it("trims input and resolves relative paths against the current directory", () => {
    expect(normalizeRepoPath(" . ")).toBe(process.cwd());
  });

  it("expands home-directory paths", () => {
    expect(normalizeRepoPath("~/test-repo")).toBe(path.join(os.homedir(), "test-repo"));
  });

  it("normalizes repository subdirectories to the Git top-level path", () => {
    const repoPath = createGitRepo("subdir");
    const subdir = path.join(repoPath, "nested");
    fs.mkdirSync(subdir);

    expect(normalizeRepoPath(subdir)).toBe(repoPath);
  });

  it("normalizes symlinked repository paths to the real top-level path", () => {
    const repoPath = createGitRepo("symlink");
    const symlinkPath = path.join(os.tmpdir(), `daily-report-link-${Date.now()}`);
    fs.symlinkSync(repoPath, symlinkPath);

    expect(normalizeRepoPath(symlinkPath)).toBe(repoPath);
  });
});

describe("getRepoPathInputError", () => {
  it("accepts blank input when the current directory is a Git repository", () => {
    expect(getRepoPathInputError("")).toBeUndefined();
    expect(getRepoPathInputError("   ")).toBeUndefined();
  });

  it("accepts relative paths when they resolve to Git repositories", () => {
    expect(getRepoPathInputError(".")).toBeUndefined();
  });

  it("rejects paths that are not Git repositories", () => {
    const nonRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-non-repo-"));

    expect(getRepoPathInputError(nonRepoDir)).toBe("不是有效的 Git 仓库");
  });

  it("accepts paths with a .git directory", () => {
    const repoDir = createGitRepo("repo");

    expect(getRepoPathInputError(` ${repoDir} `)).toBeUndefined();
  });
});

describe("hasRepoPath", () => {
  it("matches duplicate repositories after normalizing paths", () => {
    const repoPath = process.cwd();

    expect(hasRepoPath([repoPath], ".")).toBe(true);
  });

  it("returns false when the normalized path is not configured", () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "daily-report-repo-"));

    expect(hasRepoPath([repoPath], process.cwd())).toBe(false);
  });
});

describe("uniqueRepoPaths", () => {
  it("deduplicates repositories after normalizing paths", () => {
    expect(uniqueRepoPaths([process.cwd(), "."])).toEqual([process.cwd()]);
  });
});
