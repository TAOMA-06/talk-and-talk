import { ModerationContext } from "../rule-engine";

export const AI_PROVIDER = "AI_PROVIDER";

export interface AIModerationResult {
  score: number;
  reasons: string[];
  available: boolean;
}

export interface AIProvider {
  moderate(text: string, context?: ModerationContext): Promise<AIModerationResult>;
}
