import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CommunityService } from "./community.service";
import { CreateCommunityPostDto, CreateCommunityPostReportDto, ListCommunityItemsDto, SetCommunityLikeDto } from "./dto/community.dto";

@Controller("community/posts")
@UseGuards(JwtAuthGuard)
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCommunityItemsDto) {
    return this.community.list(user.id, query);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCommunityPostDto) {
    return this.community.create(user.id, dto);
  }

  @Post(":id/report")
  report(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: CreateCommunityPostReportDto) {
    return this.community.reportPost(user.id, id, dto);
  }

  @Post(":id/like")
  like(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: SetCommunityLikeDto) {
    return this.community.setLike(user.id, id, dto.liked);
  }
}
