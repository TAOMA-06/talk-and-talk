import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { CrisisInterventionModule } from "../crisis-intervention/crisis-intervention.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AI_PROVIDER } from "./ai/ai-provider.interface";
import { DeepSeekAIProvider } from "./ai/deepseek.provider";
import { ChatRestrictionService } from "./chat-restriction.service";
import { DisabledMediaAnalysisProvider, DisabledMediaStorageProvider } from "./media/disabled-media.providers";
import { ControlledCaseEvidenceController } from "./media/controlled-case-evidence.controller";
import { ControlledCaseEvidenceService } from "./media/controlled-case-evidence.service";
import { ControlledCaseEvidenceWorker } from "./media/controlled-case-evidence.worker";
import { MediaAssetService } from "./media/media-asset.service";
import { MEDIA_ANALYSIS_PROVIDER, MEDIA_STORAGE_PROVIDER } from "./media/media-provider.interface";
import { MediaModerationWorker } from "./media/media-moderation.worker";
import { MockMediaAnalysisProvider, MockMediaStorageProvider } from "./media/mock-media.providers";
import { ModerationCaseService } from "./moderation-case.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { RuleEngine } from "./rule-engine";

@Module({
  imports: [ConfigModule, CrisisInterventionModule, NotificationsModule],
  controllers: [ModerationController, ControlledCaseEvidenceController],
  providers: [
    RuleEngine,
    DeepSeekAIProvider,
    DisabledMediaStorageProvider,
    DisabledMediaAnalysisProvider,
    MockMediaStorageProvider,
    MockMediaAnalysisProvider,
    {
      provide: AI_PROVIDER,
      useExisting: DeepSeekAIProvider
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
    MediaModerationWorker,
    ControlledCaseEvidenceWorker,
    ControlledCaseEvidenceService
  ],
  exports: [
    ModerationService,
    ModerationCaseService,
    RuleEngine,
    ChatRestrictionService,
    MediaAssetService,
    MediaModerationWorker,
    ControlledCaseEvidenceWorker,
    ControlledCaseEvidenceService
  ]
})
export class ModerationModule {}
