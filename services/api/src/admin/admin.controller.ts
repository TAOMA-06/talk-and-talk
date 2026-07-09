import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CompanionsService } from "../companions/companions.service";
import { CreateCompanionDto, UpdateCompanionDto } from "../companions/dto/companion-profile.dto";
import { AuditService } from "../common/audit/audit.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly audit: AuditService
  ) {}

  @Get("status")
  status() {
    return { module: "admin", status: "active" };
  }

  @Post("companions")
  async createCompanion(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanionDto) {
    const result = await this.companionsService.create(dto);
    await this.audit.record({
      actorId: user.id,
      action: "companion.create",
      resourceType: "companion",
      resourceId: result.id,
      metadata: { name: result.name }
    });
    return result;
  }

  @Patch("companions/:id")
  async updateCompanion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateCompanionDto
  ) {
    const result = await this.companionsService.update(id, dto);
    await this.audit.record({
      actorId: user.id,
      action: "companion.update",
      resourceType: "companion",
      resourceId: id,
      metadata: { fields: Object.keys(dto) }
    });
    return result;
  }

  @Post("companions/:id/publish")
  async publishCompanion(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const result = await this.companionsService.publish(id);
    await this.audit.record({
      actorId: user.id,
      action: "companion.publish",
      resourceType: "companion",
      resourceId: id
    });
    return result;
  }

  @Post("companions/:id/unpublish")
  async unpublishCompanion(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const result = await this.companionsService.unpublish(id);
    await this.audit.record({
      actorId: user.id,
      action: "companion.unpublish",
      resourceType: "companion",
      resourceId: id
    });
    return result;
  }
}
