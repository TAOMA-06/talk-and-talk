export type ModerationDecision = "allow" | "warn" | "block" | "review";
export type RiskLevel = "low" | "medium" | "high";
export type ModerationSource = "chat" | "community" | "report" | "profile";

export interface ModerationContext {
  recentMessages?: string[];
  safetyScore?: number;
  isVerified?: boolean;
}

export interface RuleModerationResult {
  decision: ModerationDecision;
  riskLevel: RiskLevel;
  score: number;
  reasons: string[];
  matchedRules: string[];
  usedAI: false;
}

interface Rule {
  id: string;
  patterns: string[];
  score: number;
  reason: string;
}

export class RuleEngine {
  private readonly blockRules: Rule[] = [
    { id: "contact.wechat", patterns: ["加微信", "加v", "加V", "vx", "wx", "v信", "薇信", "微信号", "私加"], score: 0.92, reason: "疑似引导私下联系" },
    { id: "contact.offline", patterns: ["线下", "见面", "见个面", "出来见", "酒店", "宾馆"], score: 0.9, reason: "疑似线下邀约" },
    { id: "finance.transfer", patterns: ["转账", "打款", "红包", "支付宝", "收款码"], score: 0.93, reason: "疑似私下交易" },
    { id: "sexual.explicit", patterns: ["裸聊", "色情", "开房"], score: 0.95, reason: "疑似低俗或越界内容" }
  ];

  private readonly warnRules: Rule[] = [
    { id: "harass.pua", patterns: ["听话", "乖一点", "别装", "你不行"], score: 0.62, reason: "疑似不尊重或 PUA 表达" },
    { id: "privacy.request", patterns: ["住址", "身份证", "真实姓名", "你在哪"], score: 0.58, reason: "疑似索要隐私信息" },
    { id: "offline.implicit", patterns: ["今晚见", "能不能见", "出来聊"], score: 0.6, reason: "疑似变相线下邀约" }
  ];

  private readonly reviewRules: Rule[] = [
    { id: "ads.promo", patterns: ["代理", "兼职赚钱", "加我了解", "推广"], score: 0.42, reason: "疑似广告或引流" },
    { id: "conflict.bait", patterns: ["滚", "废物", "傻"], score: 0.38, reason: "疑似引战或攻击性表达" }
  ];

  moderate(text: string, source: ModerationSource, context?: ModerationContext): RuleModerationResult {
    const normalized = this.normalize(text);
    const reasons: string[] = [];
    const matchedRules: string[] = [];
    let score = 0.05;

    for (const rule of [...this.blockRules, ...this.warnRules, ...this.reviewRules]) {
      if (this.matches(rule, normalized)) {
        score = Math.max(score, rule.score);
        reasons.push(rule.reason);
        matchedRules.push(rule.id);
      }
    }

    const contextScore = this.contextualRiskScore(normalized, context?.recentMessages ?? []);
    if (contextScore > 0) {
      score = Math.max(score, contextScore);
      reasons.push("近期会话存在连续风险表达");
      matchedRules.push("context.accumulation");
    }

    if (source === "community" && (normalized.includes("广告") || normalized.includes("引流"))) {
      score = Math.max(score, 0.7);
      reasons.push("社区内容疑似广告引流");
      matchedRules.push("community.ads");
    }

    return {
      decision: this.decisionFor(score),
      riskLevel: this.riskLevelFor(score),
      score,
      reasons: reasons.length ? [...new Set(reasons)] : ["内容正常"],
      matchedRules,
      usedAI: false
    };
  }

  normalize(text: string): string {
    let value = text.toLowerCase();
    value = value.replaceAll(" ", "").replaceAll("　", "").replaceAll("＋", "+");
    value = value.replaceAll("vx", "微信").replaceAll("wx", "微信").replaceAll("加v", "加微");
    value = value.replaceAll("薇", "微").replaceAll("v", "微");
    return value;
  }

  private matches(rule: Rule, text: string): boolean {
    return rule.patterns.some((pattern) => text.includes(this.normalize(pattern)));
  }

  private scoreText(text: string, source: ModerationSource = "chat"): number {
    const normalized = this.normalize(text);
    let score = 0.05;
    for (const rule of [...this.blockRules, ...this.warnRules, ...this.reviewRules]) {
      if (this.matches(rule, normalized)) {
        score = Math.max(score, rule.score);
      }
    }
    if (source === "community" && (normalized.includes("广告") || normalized.includes("引流"))) {
      score = Math.max(score, 0.7);
    }
    return score;
  }

  private contextualRiskScore(current: string, history: string[]): number {
    const riskyHistory = history.slice(-2).filter((item) => this.scoreText(item) >= 0.35);
    if (!riskyHistory.length) return 0;

    const currentScore = this.scoreText(current);
    return currentScore >= 0.35 ? Math.min(1, currentScore + 0.15) : 0;
  }

  decisionFor(score: number): ModerationDecision {
    if (score >= 0.85) return "block";
    if (score >= 0.55) return "warn";
    if (score >= 0.35) return "review";
    return "allow";
  }

  riskLevelFor(score: number): RiskLevel {
    if (score >= 0.85) return "high";
    if (score >= 0.55) return "medium";
    return "low";
  }
}
