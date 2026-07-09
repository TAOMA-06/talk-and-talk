import { Inject, Injectable } from "@nestjs/common";

import { AI_PROVIDER, AIProvider } from "./ai/ai-provider.interface";
import {
  ModerationContext,
  ModerationDecision,
  ModerationSource,
  RiskLevel,
  RuleEngine
} from "./rule-engine";

export type { ModerationContext, ModerationDecision, ModerationSource, RiskLevel };

export interface ModerationResult {
  decision: ModerationDecision;
  riskLevel: RiskLevel;
  score: number;
  reasons: string[];
  matchedRules: string[];
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
      score: rule.score,
      reasons: rule.reasons,
      matchedRules: rule.matchedRules,
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
        score: rule.score,
        reasons: rule.reasons,
        matchedRules: rule.matchedRules,
        usedAI: false
      };
    }

    const ai = await this.aiProvider.moderate(text, context);
    if (!ai.available) {
      return {
        decision: rule.decision,
        riskLevel: rule.riskLevel,
        score: rule.score,
        reasons: rule.reasons,
        matchedRules: rule.matchedRules,
        usedAI: false
      };
    }

    const score = Math.max(rule.score, ai.score);
    const reasons = [...new Set([...rule.reasons.filter((r) => r !== "内容正常"), ...ai.reasons])];
    return {
      decision: this.ruleEngine.decisionFor(score),
      riskLevel: this.ruleEngine.riskLevelFor(score),
      score,
      reasons: reasons.length ? reasons : ["内容正常"],
      matchedRules: rule.matchedRules,
      usedAI: true
    };
  }

  isAIConfigured(): boolean {
    return process.env.DEEPSEEK_API_KEY?.trim() !== undefined && process.env.DEEPSEEK_API_KEY.trim() !== "";
  }
}
