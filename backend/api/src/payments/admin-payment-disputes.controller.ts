import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import {
  AssignPaymentDisputeDto,
  CompletePaymentDisputeDto,
  ListPaymentDisputeEvidenceDto,
  ListPaymentDisputesDto,
  ReplyPaymentDisputeDto
} from "./dto/payment-dispute.dto";
import { PaymentDisputesService } from "./payment-disputes.service";

@Controller("admin/commercial/payment-disputes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("support", "finance", "admin")
export class AdminPaymentDisputesController {
  constructor(private readonly disputes: PaymentDisputesService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListPaymentDisputesDto) {
    return this.disputes.listAdmin(actor, query);
  }

  @Get(":id")
  get(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.getAdmin(id, actor);
  }

  @Get(":id/evidence/:resource")
  evidence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Param("resource") resource: string,
    @Query() query: ListPaymentDisputeEvidenceDto
  ) {
    return this.disputes.listAdminEvidence(actor, id, resource, query);
  }

  @Post(":id/claims")
  @HttpCode(200)
  @Roles("support")
  claim(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.claim(actor, id);
  }

  @Post(":id/assignments")
  @HttpCode(200)
  @Roles("admin")
  assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: AssignPaymentDisputeDto
  ) {
    return this.disputes.assign(actor, id, dto);
  }

  @Post(":id/replies")
  @HttpCode(200)
  @Roles("support", "admin")
  reply(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ReplyPaymentDisputeDto
  ) {
    return this.disputes.reply(actor, id, dto);
  }

  @Post(":id/completions")
  @HttpCode(200)
  @Roles("support", "admin")
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CompletePaymentDisputeDto
  ) {
    return this.disputes.complete(actor, id, dto);
  }

  @Post(":id/sync")
  @HttpCode(200)
  sync(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.sync(actor, id);
  }
}
