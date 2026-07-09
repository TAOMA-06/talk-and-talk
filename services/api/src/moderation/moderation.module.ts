import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { AI_PROVIDER } from "./ai/ai-provider.interface";
import { DeepSeekAIProvider } from "./ai/deepseek.provider";
import { MockAIProvider } from "./ai/mock-ai.provider";
import { ModerationCaseService } from "./moderation-case.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { RuleEngine } from "./rule-engine";

@Module({
  imports: [ConfigModule],
  controllers: [ModerationController],
  providers: [
    RuleEngine,
    MockAIProvider,
    DeepSeekAIProvider,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService, MockAIProvider, DeepSeekAIProvider],
      useFactory: (
        config: ConfigService,
        mock: MockAIProvider,
        deepseek: DeepSeekAIProvider
      ) => {
        const nodeEnv = config.get<string>("NODE_ENV", "development");
        const apiKey = config.get<string>("DEEPSEEK_API_KEY")?.trim();
        if (nodeEnv === "test" || !apiKey) {
          return mock;
        }
        return deepseek;
      }
    },
    ModerationService,
    ModerationCaseService
  ],
  exports: [ModerationService, ModerationCaseService, RuleEngine]
})
export class ModerationModule {}
