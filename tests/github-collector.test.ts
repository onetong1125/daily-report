import { describe, it, expect } from "vitest";
import { parseGitRemoteUrl, isGhAvailable } from "../src/collectors/github-collector";

// ============================================================
// parseGitRemoteUrl
// ============================================================
describe("parseGitRemoteUrl", () => {
  it("parses HTTPS github.com URLs", () => {
    expect(parseGitRemoteUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("parses HTTPS github.com URLs without .git suffix", () => {
    expect(parseGitRemoteUrl("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("parses SSH git@github.com URLs", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  it("parses SSH without .git suffix", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo")).toBe("owner/repo");
  });

  it("handles repo with hyphens and dots", () => {
    expect(parseGitRemoteUrl("https://github.com/my-org/my-project.git")).toBe("my-org/my-project");
  });

  it("handles SSH with hyphens and dots", () => {
    expect(parseGitRemoteUrl("git@github.com:my-org/my-project.name.git")).toBe("my-org/my-project.name");
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitRemoteUrl("https://gitlab.com/owner/repo.git")).toBeNull();
  });

  it("returns null for SSH non-GitHub URLs", () => {
    expect(parseGitRemoteUrl("git@gitlab.com:owner/repo.git")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitRemoteUrl("")).toBeNull();
  });

  it("returns null for invalid URL format", () => {
    expect(parseGitRemoteUrl("not-a-valid-url")).toBeNull();
  });
});

// ============================================================
// isGhAvailable
// ============================================================
describe("isGhAvailable", () => {
  it("returns boolean (true if gh CLI is authenticated)", () => {
    // Can only test the return type — actual result depends on environment
    const result = isGhAvailable();
    expect(typeof result).toBe("boolean");
  });
});
