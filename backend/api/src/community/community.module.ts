import { Module } from "@nestjs/common";
import { ModerationModule } from "../moderation/moderation.module";
import { CommunityController } from "./community.controller";
import { CommunityService } from "./community.service";

@Module({ imports: [ModerationModule], controllers: [CommunityController], providers: [CommunityService] })
export class CommunityModule {}
