import { Module } from "@nestjs/common";
import { ModerationModule } from "../moderation/moderation.module";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

@Module({
  imports: [ModerationModule],
  controllers: [ReviewsController],
  providers: [ReviewsService]
})
export class ReviewsModule {}
