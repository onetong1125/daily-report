import { describe, it, expect } from "vitest";
import { resolveEnvVars } from "../src/config";

describe("resolveEnvVars", () => {
  it("returns the same string if no env var placeholders", () => {
    expect(resolveEnvVars("plain-string")).toBe("plain-string");
  });

  it("resolves a single ${ENV_VAR} placeholder", () => {
    process.env.TEST_VAR = "resolved-value";
    expect(resolveEnvVars("prefix-${TEST_VAR}-suffix")).toBe("prefix-resolved-value-suffix");
    delete process.env.TEST_VAR;
  });

  it("resolves multiple env var placeholders", () => {
    process.env.A = "alpha";
    process.env.B = "beta";
    expect(resolveEnvVars("${A}-${B}")).toBe("alpha-beta");
    delete process.env.A;
    delete process.env.B;
  });

  it("replaces missing env vars with empty string", () => {
    expect(resolveEnvVars("${NONEXISTENT_VAR_XYZ}")).toBe("");
  });

  it("handles partial missing env vars", () => {
    process.env.EXISTS = "yes";
    expect(resolveEnvVars("${EXISTS}-${MISSING}")).toBe("yes-");
    delete process.env.EXISTS;
  });

  it("returns empty string for empty input", () => {
    expect(resolveEnvVars("")).toBe("");
  });

  it("handles trailing env var placeholder", () => {
    process.env.KEY = "value";
    expect(resolveEnvVars("prefix-${KEY}")).toBe("prefix-value");
    delete process.env.KEY;
  });

  it("handles leading env var placeholder", () => {
    process.env.KEY = "value";
    expect(resolveEnvVars("${KEY}-suffix")).toBe("value-suffix");
    delete process.env.KEY;
  });
});
