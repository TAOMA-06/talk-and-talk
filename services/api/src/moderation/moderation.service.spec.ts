import { Injectable } from "@nestjs/common";

import { AIProvider, AIModerationResult } from "./ai/ai-provider.interface";
import { ModerationService } from "./moderation.service";
import { RuleEngine } from "./rule-engine";

class ControllableAIProvider implements AIProvider {
  calls = 0;
  next: AIModerationResult = { score: 0.05, reasons: [], available: false };

  async moderate(): Promise<AIModerationResult> {
    this.calls += 1;
    return this.next;
  }
}

describe("ModerationService orchestration", () => {
  const engine = new RuleEngine();
  let ai: ControllableAIProvider;
  let service: ModerationService;

  beforeEach(() => {
    ai = new ControllableAIProvider();
    service = new ModerationService(engine, ai);
  });

  it("skips AI for high-risk block", async () => {
    const result = await service.moderateAsync("我们加微信聊吧", "chat");
    expect(result.decision).toBe("block");
    expect(result.usedAI).toBe(false);
    expect(ai.calls).toBe(0);
  });

  it("falls back to rules when AI unavailable", async () => {
    ai.next = { score: 0.9, reasons: ["ai"], available: false };
    const result = await service.moderateAsync("今天有点累", "chat");
    expect(result.decision).toBe("allow");
    expect(result.usedAI).toBe(false);
    expect(ai.calls).toBe(1);
  });

  it("merges AI score when available", async () => {
    ai.next = { score: 0.7, reasons: ["AI 判定风险偏高"], available: true };
    const result = await service.moderateAsync("今天有点累", "chat");
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.decision).toBe("warn");
    expect(result.usedAI).toBe(true);
    expect(result.reasons).toContain("AI 判定风险偏高");
  });
});
