import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CommunityService } from "./community.service";
import { ListCommunityItemsDto } from "./dto/community.dto";

/** Private intake receipts are intentionally kept separate from public posts. */
@Controller("community/reports")
@UseGuards(JwtAuthGuard)
export class CommunityReportsController {
  constructor(private readonly community: CommunityService) {}

  @Get("mine")
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCommunityItemsDto = new ListCommunityItemsDto()
  ) {
    return this.community.listMyReportReceipts(user.id, query);
  }
}
