import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { NotificationsModule } from "../notifications/notifications.module";
import { AI_PROVIDER } from "./ai/ai-provider.interface";
import { DeepSeekAIProvider } from "./ai/deepseek.provider";
import { MockAIProvider } from "./ai/mock-ai.provider";
import { ChatRestrictionService } from "./chat-restriction.service";
import { DisabledMediaAnalysisProvider, DisabledMediaStorageProvider } from "./media/disabled-media.providers";
import { MediaAssetService } from "./media/media-asset.service";
import { MEDIA_ANALYSIS_PROVIDER, MEDIA_STORAGE_PROVIDER } from "./media/media-provider.interface";
import { MediaModerationWorker } from "./media/media-moderation.worker";
import { MockMediaAnalysisProvider, MockMediaStorageProvider } from "./media/mock-media.providers";
import { ModerationCaseService } from "./moderation-case.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { RuleEngine } from "./rule-engine";

@Module({
  imports: [ConfigModule, NotificationsModule],
  controllers: [ModerationController],
  providers: [
    RuleEngine,
    MockAIProvider,
    DeepSeekAIProvider,
    DisabledMediaStorageProvider,
    DisabledMediaAnalysisProvider,
    MockMediaStorageProvider,
    MockMediaAnalysisProvider,
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
    ModerationCaseService,
    ChatRestrictionService,
    {
      provide: MEDIA_STORAGE_PROVIDER,
      inject: [ConfigService, DisabledMediaStorageProvider, MockMediaStorageProvider],
      useFactory: (
        config: ConfigService,
        disabled: DisabledMediaStorageProvider,
        mock: MockMediaStorageProvider
      ) => config.get<boolean>("MEDIA_FEATURE_ENABLED") && config.get<string>("MEDIA_PROVIDER") === "mock"
        ? mock
        : disabled
    },
    {
      provide: MEDIA_ANALYSIS_PROVIDER,
      inject: [ConfigService, DisabledMediaAnalysisProvider, MockMediaAnalysisProvider],
      useFactory: (
        config: ConfigService,
        disabled: DisabledMediaAnalysisProvider,
        mock: MockMediaAnalysisProvider
      ) => config.get<boolean>("MEDIA_FEATURE_ENABLED") && config.get<string>("MEDIA_PROVIDER") === "mock"
        ? mock
        : disabled
    },
    MediaAssetService,
    MediaModerationWorker
  ],
  exports: [
    ModerationService,
    ModerationCaseService,
    RuleEngine,
    ChatRestrictionService,
    MediaAssetService,
    MediaModerationWorker
  ]
})
export class ModerationModule {}
