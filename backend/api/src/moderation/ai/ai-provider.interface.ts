import { ModerationCategory, ModerationContext } from "../rule-engine";

export const AI_PROVIDER = "AI_PROVIDER";

export interface AIModerationResult {
  score: number;
  reasons: string[];
  categories?: ModerationCategory[];
  provider?: string;
  providerVersion?: string;
  available: boolean;
  /**
   * The provider deliberately refused the text because user-authored content
   * is kept inside Talk&Talk's local rule and human-review boundary. This is
   * different from a provider outage and must never trigger an external retry.
   */
  skippedForPrivacy?: boolean;
}

export interface AIProvider {
  moderate(text: string, context?: ModerationContext): Promise<AIModerationResult>;
}
