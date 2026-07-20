import { RuleEngine } from "./rule-engine";

describe("RuleEngine", () => {
  const engine = new RuleEngine();

  it("blocks legacy wechat contact patterns", () => {
    const result = engine.moderate("我们加微信聊吧", "chat");
    expect(result.decision).toBe("block");
    expect(result.matchedRules).toContain("contact.wechat");
  });

  it("blocks wechat variants and transfer patterns", () => {
    for (const text of ["加v", "vx联系", "私下转账"]) {
      const result = engine.moderate(text, "chat");
      expect(result.decision).not.toBe("allow");
    }
  });

  it("detects spaced offline patterns via normalization", () => {
    const result = engine.moderate("线 下 见个面", "chat");
    expect(result.decision).not.toBe("allow");
  });

  it("allows normal emotional messages", () => {
    const result = engine.moderate("今天有点累，想有人认真听我说完", "chat");
    expect(result.decision).toBe("allow");
  });

  it("flags community ads", () => {
    const result = engine.moderate("代理兼职赚钱，加我了解", "community");
    expect(result.decision).not.toBe("allow");
  });

  it("maps scores to decisions", () => {
    expect(engine.decisionFor(0.9)).toBe("block");
    expect(engine.decisionFor(0.6)).toBe("warn");
    expect(engine.decisionFor(0.4)).toBe("review");
    expect(engine.decisionFor(0.1)).toBe("allow");
  });

  it("accumulates contextual risk", () => {
    const result = engine.moderate("今晚见", "chat", {
      recentMessages: ["能不能见", "出来聊"]
    });
    expect(result.matchedRules).toContain("context.accumulation");
    expect(result.score).toBeGreaterThanOrEqual(0.55);
  });

  it("normalizes homoglyphs and pinyin shortcuts", () => {
    expect(engine.normalize("加 V x")).toContain("微");
    expect(engine.normalize("薇信")).toContain("微信");
  });

  it("puts self-harm and violence signals into critical priority without contacting anyone automatically", () => {
    const selfHarm = engine.moderate("我真的不想活了", "chat");
    const violence = engine.moderate("我会弄死你", "chat");
    expect(selfHarm.categories).toContain("selfHarm");
    expect(selfHarm.priority).toBe("critical");
    expect(violence.categories).toContain("violence");
    expect(violence.priority).toBe("critical");
  });
});
