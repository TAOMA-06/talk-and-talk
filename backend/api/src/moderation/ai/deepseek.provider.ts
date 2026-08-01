import { Injectable } from "@nestjs/common";

import { ModerationContext } from "../rule-engine";
import { AIModerationResult, AIProvider } from "./ai-provider.interface";

@Injectable()
export class DeepSeekAIProvider implements AIProvider {
  async moderate(_text: string, _context?: ModerationContext): Promise<AIModerationResult> {
    // DeepSeek's generic chat service is not an approved destination for the
    // emotional, health, crisis, sexual, identity or contact data that may be
    // present in companionship content. Refuse every user-authored payload at
    // the provider boundary so a future caller cannot bypass orchestration.
    return {
      score: 0.05,
      reasons: [],
      categories: [],
      provider: "deepseek",
      available: false,
      skippedForPrivacy: true
    };
  }
}
