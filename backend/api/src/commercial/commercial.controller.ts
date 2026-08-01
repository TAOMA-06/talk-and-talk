import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CommercialService } from "./commercial.service";
import { ListCompanionEarningsDto } from "./dto/list-commercial-ledger.dto";

@Controller("commercial")
@UseGuards(JwtAuthGuard)
export class CommercialController {
  constructor(private readonly commercial: CommercialService) {}

  @Get("earnings/me")
  earnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCompanionEarningsDto
  ) {
    return this.commercial.listForCompanion(user.id, query);
  }
}
