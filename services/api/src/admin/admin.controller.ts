import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CompanionsService } from "../companions/companions.service";
import { CreateCompanionDto, UpdateCompanionDto } from "../companions/dto/companion-profile.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(private readonly companionsService: CompanionsService) {}

  @Get("status")
  status() {
    return { module: "admin", status: "active" };
  }

  @Post("companions")
  createCompanion(@Body() dto: CreateCompanionDto) {
    return this.companionsService.create(dto);
  }

  @Patch("companions/:id")
  updateCompanion(@Param("id") id: string, @Body() dto: UpdateCompanionDto) {
    return this.companionsService.update(id, dto);
  }

  @Post("companions/:id/publish")
  publishCompanion(@Param("id") id: string) {
    return this.companionsService.publish(id);
  }

  @Post("companions/:id/unpublish")
  unpublishCompanion(@Param("id") id: string) {
    return this.companionsService.unpublish(id);
  }
}
