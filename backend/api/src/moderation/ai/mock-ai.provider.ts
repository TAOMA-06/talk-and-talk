import { Injectable } from "@nestjs/common";

import { ModerationContext } from "../rule-engine";
import { AIModerationResult, AIProvider } from "./ai-provider.interface";

@Injectable()
export class MockAIProvider implements AIProvider {
  async moderate(_text: string, _context?: ModerationContext): Promise<AIModerationResult> {
    return {
      score: 0.05,
      reasons: [],
      categories: [],
      provider: "mock",
      providerVersion: "rule-only",
      available: false
    };
  }
}
