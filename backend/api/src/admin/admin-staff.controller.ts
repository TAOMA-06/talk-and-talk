import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  ListEligibleStaffSuccessorsDto,
  ListStaffCredentialsDto,
  SuspendStaffCredentialDto
} from "./dto/staff-offboarding.dto";
import { StaffOffboardingService } from "./staff-offboarding.service";

@Controller("admin/staff")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminStaffController {
  constructor(private readonly staffOffboarding: StaffOffboardingService) {}

  @Get()
  list(@Query() query: ListStaffCredentialsDto) {
    return this.staffOffboarding.list(query);
  }

  @Get("eligible-successors")
  eligibleSuccessors(@Query() query: ListEligibleStaffSuccessorsDto) {
    return this.staffOffboarding.listEligibleSuccessors(query);
  }

  @Post(":userId/suspensions")
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("userId") targetUserId: string,
    @Body() dto: SuspendStaffCredentialDto
  ) {
    return this.staffOffboarding.suspend(actor.id, targetUserId, dto);
  }
}
