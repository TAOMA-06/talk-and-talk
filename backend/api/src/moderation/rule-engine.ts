export type ModerationDecision = "allow" | "warn" | "block" | "review";
export type RiskLevel = "low" | "medium" | "high";
export type ModerationSource = "chat" | "community" | "report" | "profile";
export type ModerationPriority = "normal" | "high" | "critical";
export type ModerationCategory =
  | "privateContact"
  | "offlineMeetup"
  | "privatePayment"
  | "fraudOrSpam"
  | "sexualContent"
  | "harassmentOrHate"
  | "privacy"
  | "selfHarm"
  | "violence"
  | "normal";

export interface ModerationContext {
  /** Most recent conversation content, ordered oldest to newest. */
  recentMessages?: string[];
  safetyScore?: number;
  isVerified?: boolean;
  /** Existing high-risk events for this sender in the rolling safety window. */
  recentHighRiskBlocks?: number;
}

export interface RuleModerationResult {
  decision: ModerationDecision;
  riskLevel: RiskLevel;
  priority: ModerationPriority;
  score: number;
  reasons: string[];
  matchedRules: string[];
  categories: ModerationCategory[];
  policyVersion: string;
  usedAI: false;
}

interface Rule {
  id: string;
  patterns: string[];
  score: number;
  reason: string;
  category: ModerationCategory;
}

const POLICY_VERSION = "chat-v2";

/**
 * Deterministic safety layer. It is intentionally conservative for hard platform
 * red lines: an AI provider can elevate a decision but can never downgrade them.
 */
export class RuleEngine {
  private readonly blockRules: Rule[] = [
    {
      id: "contact.wechat",
      patterns: ["加微信", "加v", "加V", "vx", "wx", "v信", "薇信", "微信号", "私加", "二维码"],
      score: 0.92,
      reason: "疑似引导私下联系",
      category: "privateContact"
    },
    {
      id: "contact.offline",
      patterns: ["线下", "见面", "见个面", "出来见", "酒店", "宾馆", "去你家", "来我家"],
      score: 0.9,
      reason: "疑似线下邀约",
      category: "offlineMeetup"
    },
    {
      id: "finance.transfer",
      patterns: ["转账", "打款", "红包", "支付宝", "收款码", "借钱", "投资回报"],
      score: 0.93,
      reason: "疑似私下交易或资金风险",
      category: "privatePayment"
    },
    {
      id: "fraud.scam",
      patterns: ["稳赚", "内幕消息", "刷单", "带你赚钱", "高回报", "先付款"],
      score: 0.94,
      reason: "疑似诈骗或高风险引流",
      category: "fraudOrSpam"
    },
    {
      id: "sexual.explicit",
      patterns: ["裸聊", "色情", "开房", "约炮", "成人视频", "性服务"],
      score: 0.95,
      reason: "疑似低俗、性内容或越界内容",
      category: "sexualContent"
    },
    {
      id: "violence.threat",
      patterns: ["杀了你", "弄死你", "砍死", "打断你的腿", "去死吧"],
      score: 0.96,
      reason: "疑似暴力威胁",
      category: "violence"
    }
  ];

  private readonly warnRules: Rule[] = [
    {
      id: "harass.pua",
      patterns: ["听话", "乖一点", "别装", "你不行", "废物", "滚", "傻"],
      score: 0.62,
      reason: "疑似不尊重、攻击或 PUA 表达",
      category: "harassmentOrHate"
    },
    {
      id: "privacy.request",
      patterns: ["住址", "身份证", "真实姓名", "你在哪", "手机号", "定位发我"],
      score: 0.65,
      reason: "疑似索要隐私信息",
      category: "privacy"
    },
    {
      id: "offline.implicit",
      patterns: ["今晚见", "能不能见", "出来聊", "方便出来"],
      score: 0.6,
      reason: "疑似变相线下邀约",
      category: "offlineMeetup"
    }
  ];

  private readonly reviewRules: Rule[] = [
    {
      id: "ads.promo",
      patterns: ["代理", "兼职赚钱", "加我了解", "推广", "群发", "招募"],
      score: 0.42,
      reason: "疑似广告或引流",
      category: "fraudOrSpam"
    },
    {
      id: "selfharm.risk",
      patterns: ["不想活了", "想自杀", "结束生命", "伤害自己", "割腕"],
      score: 0.5,
      reason: "检测到自伤风险，需要优先关怀",
      category: "selfHarm"
    }
  ];

  moderate(text: string, source: ModerationSource, context?: ModerationContext): RuleModerationResult {
    const normalized = this.normalize(text);
    const reasons: string[] = [];
    const matchedRules: string[] = [];
    const categories: ModerationCategory[] = [];
    let score = 0.05;

    const addMatch = (rule: Rule) => {
      score = Math.max(score, rule.score);
      reasons.push(rule.reason);
      matchedRules.push(rule.id);
      categories.push(rule.category);
    };

    for (const rule of [...this.blockRules, ...this.warnRules, ...this.reviewRules]) {
      if (this.matches(rule, normalized)) addMatch(rule);
    }

    // Phone numbers are deliberately detected after normalization so spacing and
    // punctuation do not evade the private-contact rule.
    if (/(?:^|\D)1[3-9]\d{9}(?:$|\D)/.test(normalized)) {
      score = Math.max(score, 0.92);
      reasons.push("疑似分享手机号等私下联系方式");
      matchedRules.push("contact.phone");
      categories.push("privateContact");
    }

    const contextScore = this.contextualRiskScore(normalized, context?.recentMessages ?? []);
    if (contextScore > 0) {
      score = Math.max(score, contextScore);
      reasons.push("近期会话存在连续风险表达");
      matchedRules.push("context.accumulation");
    }

    if ((context?.recentHighRiskBlocks ?? 0) > 0 && score >= 0.35) {
      score = Math.min(1, score + 0.1);
      reasons.push("发送方近期存在高风险违规记录");
      matchedRules.push("context.senderRisk");
    }

    if (source === "community" && (normalized.includes("广告") || normalized.includes("引流"))) {
      score = Math.max(score, 0.7);
      reasons.push("社区内容疑似广告引流");
      matchedRules.push("community.ads");
      categories.push("fraudOrSpam");
    }

    const uniqueCategories = [...new Set(categories)];
    const decision = this.decisionFor(score);
    return {
      decision,
      riskLevel: this.riskLevelFor(score),
      priority: this.priorityFor(decision, uniqueCategories),
      score,
      reasons: reasons.length ? [...new Set(reasons)] : ["内容正常"],
      matchedRules: [...new Set(matchedRules)],
      categories: uniqueCategories.length ? uniqueCategories : ["normal"],
      policyVersion: POLICY_VERSION,
      usedAI: false
    };
  }

  normalize(text: string): string {
    let value = text.normalize("NFKC").toLowerCase();
    value = value
      .replace(/[\s\u3000\-_,，。！？!@#￥$%^&*()（）【】\[\]{}<>《》:：;；]/g, "")
      .replaceAll("＋", "+");
    value = value
      .replaceAll("vx", "微信")
      .replaceAll("wx", "微信")
      .replaceAll("加v", "加微")
      .replaceAll("v信", "微信")
      .replaceAll("薇", "微")
      .replaceAll("v", "微");
    return value;
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

  private matches(rule: Rule, text: string): boolean {
    return rule.patterns.some((pattern) => text.includes(this.normalize(pattern)));
  }

  private scoreText(text: string, source: ModerationSource = "chat"): number {
    return this.moderate(text, source).score;
  }

  private contextualRiskScore(current: string, history: string[]): number {
    const riskyHistory = history.slice(-10).filter((item) => this.scoreText(item) >= 0.35);
    if (!riskyHistory.length) return 0;

    const currentScore = this.scoreText(current);
    return currentScore >= 0.35 ? Math.min(1, currentScore + 0.15) : 0;
  }

  private priorityFor(
    decision: ModerationDecision,
    categories: ModerationCategory[]
  ): ModerationPriority {
    if (categories.includes("selfHarm") || categories.includes("violence")) return "critical";
    if (decision === "block" || decision === "warn") return "high";
    return "normal";
  }
}
