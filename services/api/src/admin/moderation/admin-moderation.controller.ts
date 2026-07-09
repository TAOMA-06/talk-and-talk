import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { AuthenticatedUser } from "../../auth/auth.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { AdminModerationService } from "./admin-moderation.service";
import { CaseActionDto } from "./dto/case-action.dto";
import { CreateLabelDto } from "./dto/create-label.dto";
import { ListAdminCasesQueryDto } from "./dto/list-admin-cases.dto";

@Controller("admin/moderation")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("moderator", "admin")
export class AdminModerationController {
  constructor(private readonly adminModeration: AdminModerationService) {}

  @Get("overview")
  overview() {
    return this.adminModeration.overview();
  }

  @Get("cases")
  listCases(@Query() query: ListAdminCasesQueryDto) {
    return this.adminModeration.listCases(query);
  }

  @Get("cases/:id")
  getCase(@Param("id") id: string) {
    return this.adminModeration.getCase(id);
  }

  @Get("cases/:id/conversation")
  conversation(@Param("id") id: string) {
    return this.adminModeration.conversationEvidence(id);
  }

  @Post("cases/:id/actions")
  applyAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CaseActionDto
  ) {
    return this.adminModeration.applyAction(id, user.id, dto.action, dto.note);
  }

  @Post("labels")
  createLabel(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLabelDto) {
    return this.adminModeration.createLabel(user.id, dto);
  }

  @Get("labels/export")
  exportLabels() {
    return this.adminModeration.exportLabels();
  }
}
