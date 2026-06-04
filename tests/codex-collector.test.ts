import { describe, it, expect } from "vitest";
import { extractCodexSummary } from "../src/collectors/codex-collector";

describe("extractCodexSummary", () => {
  it('returns "无对话内容" for empty messages array', () => {
    expect(extractCodexSummary([])).toBe("无对话内容");
  });

  it("joins up to 5 substantive messages with | separator", () => {
    const messages = [
      "请帮我 review 这段代码的潜在安全漏洞和性能瓶颈",
      "需要检查性能问题和安全漏洞并且生成详细的报告",
      "这是一个 Python 项目需要完整的代码审查流程",
    ];
    const summary = extractCodexSummary(messages);

    expect(summary).toContain("review 这段代码");
    expect(summary).toContain("性能问题");
    expect(summary).toContain(" | ");
  });

  it("filters out system prompts and skill instructions", () => {
    const messages = [
      "<system-reminder>Context info</system-reminder>",
      "You are an AI assistant",
      "Base directory for this skill: /path",
      "实际的工作内容: 修复了一个并发 bug 并添加了完整的单元测试覆盖",
    ];
    const summary = extractCodexSummary(messages);

    expect(summary).toContain("并发 bug");
    expect(summary).not.toContain("system-reminder");
    expect(summary).not.toContain("AI assistant");
    expect(summary).not.toContain("Base directory");
  });

  it("truncates long messages to 120 chars", () => {
    const longMessage = "X".repeat(200) + " tail";
    const summary = extractCodexSummary([longMessage]);

    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(123);
  });

  it("filters messages shorter than 20 characters", () => {
    const messages = ["ok", "yes", "no", "A meaningful discussion about code review"];
    const summary = extractCodexSummary(messages);

    expect(summary).toContain("code review");
    expect(summary).not.toContain("ok");
    expect(summary).not.toContain("yes");
  });

  it("replaces newlines with spaces", () => {
    const messages = ["实现日报\n生成功能\n模块的完整核心逻辑代码与测试"];
    const summary = extractCodexSummary(messages);

    expect(summary).not.toContain("\n");
    expect(summary).toContain("实现日报 生成功能 模块");
  });
});
