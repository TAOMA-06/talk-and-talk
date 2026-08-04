import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";

import { AuthenticatedUser } from "../../auth/auth.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { CommercialService } from "../../commercial/commercial.service";
import { CommercialFunnelService } from "../../commercial/commercial-funnel.service";
import { CommercialOpsMetricsService } from "../../commercial/commercial-ops-metrics.service";
import { CommercialFunnelQueryDto } from "../../commercial/dto/commercial-funnel-query.dto";
import { CancelPayoutClaimDto } from "../../commercial/dto/cancel-payout-claim.dto";
import { SubmitPayoutDto } from "../../commercial/dto/submit-payout.dto";
import { SubmitRecoveryEvidenceDto } from "../../commercial/dto/submit-recovery-evidence.dto";
import { UpsertCompanionCommercialProfileDto } from "../../commercial/dto/upsert-companion-commercial-profile.dto";
import { SuspendCompanionCommercialProfileDto } from "../../commercial/dto/suspend-companion-commercial-profile.dto";
import { AssignSupportTicketDto } from "../../support/dto/assign-support-ticket.dto";
import { ListSupportTicketsDto } from "../../support/dto/list-support-tickets.dto";
import { ResolveSupportTicketDto } from "../../support/dto/resolve-support-ticket.dto";
import { SupportService } from "../../support/support.service";
import { InitiateSupportRefundDto } from "../../support/dto/initiate-support-refund.dto";
import { PaymentsService } from "../../payments/payments.service";
import { ListCompanionRecoveriesDto } from "../../commercial/dto/list-commercial-ledger.dto";

@Controller("admin/commercial")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("support", "finance", "supply", "operations", "admin")
export class AdminCommercialController {
  constructor(
    private readonly commercial: CommercialService,
    private readonly commercialFunnel: CommercialFunnelService,
    private readonly commercialOpsMetrics: CommercialOpsMetricsService,
    private readonly support: SupportService,
    private readonly payments: PaymentsService
  ) {}

  @Get("readiness")
  @Roles("operations", "admin")
  readiness() {
    return this.commercial.operationalReadiness();
  }

  @Get("funnel")
  @Roles("operations", "admin")
  funnel(@Query() query: CommercialFunnelQueryDto) {
    return this.commercialFunnel.get(query);
  }

  @Get("ops-metrics")
  @Roles("operations", "admin", "finance")
  opsMetrics(@Query() query: CommercialFunnelQueryDto) {
    return this.commercialOpsMetrics.get(query);
  }

  @Get("earnings")
  @Roles("finance", "admin")
  earnings(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("status") status?: string
  ) {
    return this.commercial.listAdmin({
      page: page ? Number.parseInt(page, 10) : undefined,
      pageSize: pageSize ? Number.parseInt(pageSize, 10) : undefined,
      status
    });
  }

  @Get("companions")
  @Roles("supply", "admin")
  commercialProfiles(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string
  ) {
    return this.commercial.listCommercialProfiles(
      status,
      page ? Number.parseInt(page, 10) : undefined,
      pageSize ? Number.parseInt(pageSize, 10) : undefined
    );
  }

  @Post("companions/:id/profile-submissions")
  @HttpCode(HttpStatus.OK)
  @Roles("supply", "admin")
  submitCommercialProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string,
    @Body() dto: UpsertCompanionCommercialProfileDto
  ) {
    return this.commercial.upsertCommercialProfile(actor.id, companionId, dto);
  }

  @Post("companions/:id/profile-verifications")
  @HttpCode(HttpStatus.OK)
  @Roles("supply", "admin")
  verifyCommercialProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string
  ) {
    return this.commercial.verifyCommercialProfile(actor.id, companionId);
  }

  @Post("companions/:id/profile-suspensions")
  @HttpCode(HttpStatus.OK)
  @Roles("supply", "admin")
  suspendCommercialProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string,
    @Body() dto: SuspendCompanionCommercialProfileDto
  ) {
    return this.commercial.suspendCommercialProfile(actor.id, companionId, dto.reason);
  }

  @Post("earnings/:id/payout-claims")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  claimPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string
  ) {
    return this.commercial.claimPayout(actor.id, earningId);
  }

  @Post("earnings/:id/payout-submissions")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  recordPayoutEvidence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string,
    @Body() dto: SubmitPayoutDto
  ) {
    return this.commercial.recordPayoutEvidence(actor.id, earningId, dto);
  }

  @Post("earnings/:id/payout-cancellations")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  cancelPayoutClaim(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string,
    @Body() dto: CancelPayoutClaimDto
  ) {
    return this.commercial.cancelPayoutClaim(actor.id, earningId, dto);
  }

  @Post("earnings/:id/payout-verifications")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  verifyPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string
  ) {
    return this.commercial.verifyPayout(actor.id, earningId);
  }

  @Get("recoveries")
  @Roles("finance", "admin")
  recoveries(@Query() query: ListCompanionRecoveriesDto) {
    return this.commercial.listRecoveries(query);
  }

  @Post("recoveries/:id/evidence")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  recordRecoveryEvidence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") recoveryId: string,
    @Body() dto: SubmitRecoveryEvidenceDto
  ) {
    return this.commercial.recordRecoveryEvidence(actor.id, recoveryId, dto.evidenceReference);
  }

  @Post("recoveries/:id/verify")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  verifyRecovery(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") recoveryId: string
  ) {
    return this.commercial.verifyRecovery(actor.id, recoveryId);
  }

  @Get("support/tickets")
  @Roles("support", "admin")
  supportTickets(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListSupportTicketsDto
  ) {
    return this.support.listAdmin(actor, query);
  }

  @Get("support/tickets/:id")
  @Roles("support", "admin")
  supportTicket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string
  ) {
    return this.support.getAdmin(actor, ticketId);
  }

  @Get("support/claimable")
  @Roles("support")
  claimableSupportTickets(@Query() query: ListSupportTicketsDto) {
    return this.support.listClaimable(query);
  }

  @Post("support/tickets/:id/claim")
  @Roles("support")
  claimSupportTicket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string
  ) {
    return this.support.claim(actor.id, ticketId);
  }

  @Post("support/tickets/:id/assign")
  @HttpCode(HttpStatus.OK)
  @Roles("admin")
  assignSupportTicket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: AssignSupportTicketDto
  ) {
    return this.support.assign(actor, ticketId, dto.assignedToUserId);
  }

  @Post("support/tickets/:id/resolve")
  @HttpCode(HttpStatus.OK)
  @Roles("support", "admin")
  resolveSupportTicket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: ResolveSupportTicketDto
  ) {
    return this.support.resolve(actor.id, ticketId, dto);
  }

  @Post("support/tickets/:id/refunds")
  @HttpCode(HttpStatus.OK)
  @Roles("support", "admin")
  initiateSupportRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: InitiateSupportRefundDto
  ) {
    return this.payments.requestSupportRefund(actor.id, ticketId, dto.reason);
  }
}
