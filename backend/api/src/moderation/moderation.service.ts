import { Inject, Injectable } from "@nestjs/common";

import { AI_PROVIDER, AIProvider } from "./ai/ai-provider.interface";
import {
  ModerationContext,
  ModerationCategory,
  ModerationDecision,
  ModerationPriority,
  ModerationSource,
  RiskLevel,
  RuleEngine
} from "./rule-engine";

export type {
  ModerationCategory,
  ModerationContext,
  ModerationDecision,
  ModerationPriority,
  ModerationSource,
  RiskLevel
};

export interface ModerationResult {
  decision: ModerationDecision;
  riskLevel: RiskLevel;
  priority: ModerationPriority;
  score: number;
  reasons: string[];
  matchedRules: string[];
  categories: ModerationCategory[];
  policyVersion: string;
  provider?: string;
  providerVersion?: string;
  usedAI: boolean;
}

@Injectable()
export class ModerationService {
  constructor(
    private readonly ruleEngine: RuleEngine,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider
  ) {}

  /** Sync rule-only path for callers that cannot await (prefer moderateAsync). */
  moderate(text: string, source: ModerationSource, context?: ModerationContext): ModerationResult {
    const rule = this.ruleEngine.moderate(text, source, context);
    return {
      decision: rule.decision,
      riskLevel: rule.riskLevel,
      priority: rule.priority,
      score: rule.score,
      reasons: rule.reasons,
      matchedRules: rule.matchedRules,
      categories: rule.categories,
      policyVersion: rule.policyVersion,
      provider: "rule-engine",
      usedAI: false
    };
  }

  async moderateAsync(
    text: string,
    source: ModerationSource,
    context?: ModerationContext
  ): Promise<ModerationResult> {
    const rule = this.ruleEngine.moderate(text, source, context);

    if (rule.decision === "block" && rule.riskLevel === "high") {
      return {
        decision: rule.decision,
        riskLevel: rule.riskLevel,
        priority: rule.priority,
        score: rule.score,
        reasons: rule.reasons,
        matchedRules: rule.matchedRules,
        categories: rule.categories,
        policyVersion: rule.policyVersion,
        provider: "rule-engine",
        usedAI: false
      };
    }

    const ai = await this.aiProvider.moderate(text, context);
    if (!ai.available) {
      return {
        decision: rule.decision,
        riskLevel: rule.riskLevel,
        priority: rule.priority,
        score: rule.score,
        reasons: rule.reasons,
        matchedRules: rule.matchedRules,
        categories: rule.categories,
        policyVersion: rule.policyVersion,
        provider: "rule-engine",
        usedAI: false
      };
    }

    const score = Math.max(rule.score, ai.score);
    const reasons = [...new Set([...rule.reasons.filter((r) => r !== "内容正常"), ...ai.reasons])];
    const categories = normalizeCategories([...rule.categories, ...(ai.categories ?? [])]);
    const decision = this.ruleEngine.decisionFor(score);
    return {
      decision,
      riskLevel: this.ruleEngine.riskLevelFor(score),
      priority: priorityFor(decision, categories),
      score,
      reasons: reasons.length ? reasons : ["内容正常"],
      matchedRules: rule.matchedRules,
      categories,
      policyVersion: rule.policyVersion,
      provider: ai.provider,
      providerVersion: ai.providerVersion,
      usedAI: true
    };
  }

  isAIConfigured(): boolean {
    return process.env.DEEPSEEK_API_KEY?.trim() !== undefined && process.env.DEEPSEEK_API_KEY.trim() !== "";
  }
}

function normalizeCategories(categories: ModerationCategory[]): ModerationCategory[] {
  const unique = [...new Set(categories)];
  const nonNormal = unique.filter((category) => category !== "normal");
  return nonNormal.length ? nonNormal : ["normal"];
}

function priorityFor(
  decision: ModerationDecision,
  categories: ModerationCategory[]
): ModerationPriority {
  if (categories.includes("selfHarm") || categories.includes("violence")) return "critical";
  if (decision === "block" || decision === "warn") return "high";
  return "normal";
}
