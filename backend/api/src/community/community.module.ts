import { Module } from "@nestjs/common";
import { ModerationModule } from "../moderation/moderation.module";
import { CommunityController } from "./community.controller";
import { CommunityReportsController } from "./community-reports.controller";
import { CommunityService } from "./community.service";

@Module({ imports: [ModerationModule], controllers: [CommunityController, CommunityReportsController], providers: [CommunityService] })
export class CommunityModule {}
