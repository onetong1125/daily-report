import { describe, it, expect } from "vitest";
import { extractClaudeSummary } from "../src/collectors/claude-collector";

describe("extractClaudeSummary", () => {
  it('returns "无对话内容" for empty messages array', () => {
    expect(extractClaudeSummary([])).toBe("无对话内容");
  });

  it("joins up to 5 substantive messages with | separator", () => {
    const messages = [
      "请帮我实现一个日报工具用于展示每日工作总结",
      "需要聚合 Git、GitHub 和 AI 对话数据生成报告",
      "使用 TypeScript 开发命令行工具",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("请帮我实现一个日报工具");
    expect(summary).toContain("需要聚合 Git、GitHub 和 AI 对话数据");
    expect(summary).toContain(" | ");
  });

  it("filters out system prompts (lines starting with <)", () => {
    const messages = [
      "<system-reminder>You are a helpful assistant</system-reminder>",
      "请帮我写一个完整的用户登录认证代码模块和测试",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("用户登录认证");
    expect(summary).not.toContain("system-reminder");
  });

  it("filters out skill instructions", () => {
    const messages = [
      "Base directory for this skill: /path/to/skill",
      "让我们讨论一下项目架构设计和模块划分方案细节",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("架构设计");
    expect(summary).not.toContain("Base directory");
  });

  it("filters out interrupt markers", () => {
    const messages = [
      "[Request interrupted by user]",
      "继续之前的工作：完善日报工具的配置管理功能",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("继续之前的工作");
    expect(summary).not.toContain("interrupted");
  });

  it('returns "几乎无对话内容" when all messages are noise', () => {
    const messages = [
      "<system>",
      "You are a helpful assistant",
      "#!/bin/bash",
    ];
    const summary = extractClaudeSummary(messages);
    expect(summary).toBe("几乎无对话内容");
  });

  it("truncates long messages to 120 chars", () => {
    const longMessage = "A".repeat(200) + " important content";
    const messages = [longMessage];
    const summary = extractClaudeSummary(messages);

    // Should be truncated with "..."
    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(123); // 120 chars + "..."
  });

  it("filters messages shorter than 20 characters", () => {
    const messages = [
      "hi",
      "ok",
      "This is a meaningful message about the project design and structure",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("meaningful");
    // "hi" and "ok" are too short and should be filtered out
    expect(summary).not.toMatch(/\bhi\b/);
    expect(summary).not.toMatch(/\bok\b/);
  });

  it("replaces newlines with spaces in excerpts", () => {
    const messages = [
      "请帮我\n实现一个\n日报工具用于展示每日工作内容总结报告",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).not.toContain("\n");
    expect(summary).toContain("请帮我 实现一个 日报工具");
  });

  it("collapses multiple whitespace to single space", () => {
    const messages = [
      "请帮我   实现一个    日报工具用于展示每日工作内容总结",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("请帮我 实现一个 日报工具");
  });

  it('returns "有大量技术对话" when total chars > 2000 but all are short', () => {
    // Create many short messages (<20 chars each) so all are filtered,
    // but total chars is large
    const shortMessages = Array(150).fill("short msg here!!!"); // 15 chars each
    // Actually each is 16 chars (including the !!!) — still < 20
    // Hmm, "short msg here!!!" is 18 chars, < 20.
    // 150 * 18 = 2700 > 2000
    const summary = extractClaudeSummary(shortMessages);

    // All individual messages are too short, but total chars > 2000
    expect(summary).toBe("有大量技术对话");
  });

  it('returns "有简短对话" when total chars > 300 but < 2000 with all short messages', () => {
    // Create messages that are all < 20 chars each
    const shortMessages = Array(30).fill("short message test!"); // 18 chars * 30 = 540
    const summary = extractClaudeSummary(shortMessages);

    expect(summary).toBe("有简短对话");
  });

  it("takes only first 5 substantive messages", () => {
    const messages = [
      "message one about project planning",
      "message two about implementation",
      "message three about testing",
      "message four about deployment",
      "message five about monitoring",
      "message six should not appear",
      "message seven should not appear either",
    ];
    const summary = extractClaudeSummary(messages);

    expect(summary).toContain("message one");
    expect(summary).toContain("message five");
    expect(summary).not.toContain("message six");
    expect(summary).not.toContain("message seven");
  });
});
