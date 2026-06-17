import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, execSync } from "child_process";

vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
    Separator: class Separator {},
  },
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import inquirer from "inquirer";
import { parseRawRepoInputs, selectTrackedRepos } from "../src/setup";

const prompt = vi.mocked(inquirer.prompt);
const mockedExecSync = vi.mocked(execSync);

function createGitRepo(name: string): string {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), `daily-report-${name}-`));
  execFileSync("git", ["init"], { cwd: repoPath, stdio: "ignore" });
  return fs.realpathSync.native(repoPath);
}

describe("parseRawRepoInputs", () => {
  it("treats blank input as the current directory", () => {
    expect(parseRawRepoInputs("   ")).toEqual([""]);
  });

  it("splits comma-separated paths and drops empty segments", () => {
    expect(parseRawRepoInputs(" repo-a, , repo-b ")).toEqual(["repo-a", "repo-b"]);
  });
});

describe("selectTrackedRepos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecSync.mockReturnValue("");
  });

  it("keeps an existing repository when it remains selected", async () => {
    const repoPath = createGitRepo("keep");
    prompt.mockResolvedValueOnce({ repos: [repoPath] });

    await expect(selectTrackedRepos([repoPath])).resolves.toEqual([repoPath]);
  });

  it("removes an existing repository when it is unchecked", async () => {
    const repoPath = createGitRepo("remove");
    prompt.mockResolvedValueOnce({ repos: [] });

    await expect(selectTrackedRepos([repoPath])).resolves.toEqual([]);
  });

  it("deduplicates manually entered repositories", async () => {
    const repoPath = createGitRepo("custom");
    prompt
      .mockResolvedValueOnce({ repos: ["__custom__"] })
      .mockResolvedValueOnce({ path: `${repoPath}, ${repoPath}` });

    await expect(selectTrackedRepos([])).resolves.toEqual([repoPath]);
  });
});
