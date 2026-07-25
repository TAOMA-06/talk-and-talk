import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../../auth/auth.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { CommercialService } from "../../commercial/commercial.service";
import { CommercialFunnelService } from "../../commercial/commercial-funnel.service";
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

@Controller("admin/commercial")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminCommercialController {
  constructor(
    private readonly commercial: CommercialService,
    private readonly commercialFunnel: CommercialFunnelService,
    private readonly support: SupportService,
    private readonly payments: PaymentsService
  ) {}

  @Get("readiness")
  readiness() {
    return this.commercial.operationalReadiness();
  }

  @Get("funnel")
  funnel(@Query() query: CommercialFunnelQueryDto) {
    return this.commercialFunnel.get(query);
  }

  @Get("earnings")
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
  commercialProfiles(@Query("status") status?: string) {
    return this.commercial.listCommercialProfiles(status);
  }

  @Post("companions/:id/profile-submissions")
  submitCommercialProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string,
    @Body() dto: UpsertCompanionCommercialProfileDto
  ) {
    return this.commercial.upsertCommercialProfile(actor.id, companionId, dto);
  }

  @Post("companions/:id/profile-verifications")
  verifyCommercialProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string
  ) {
    return this.commercial.verifyCommercialProfile(actor.id, companionId);
  }

  @Post("companions/:id/profile-suspensions")
  suspendCommercialProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") companionId: string,
    @Body() dto: SuspendCompanionCommercialProfileDto
  ) {
    return this.commercial.suspendCommercialProfile(actor.id, companionId, dto.reason);
  }

  @Post("earnings/:id/payout-claims")
  claimPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string
  ) {
    return this.commercial.claimPayout(actor.id, earningId);
  }

  @Post("earnings/:id/payout-submissions")
  recordPayoutEvidence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string,
    @Body() dto: SubmitPayoutDto
  ) {
    return this.commercial.recordPayoutEvidence(actor.id, earningId, dto);
  }

  @Post("earnings/:id/payout-cancellations")
  cancelPayoutClaim(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string,
    @Body() dto: CancelPayoutClaimDto
  ) {
    return this.commercial.cancelPayoutClaim(actor.id, earningId, dto);
  }

  @Post("earnings/:id/payout-verifications")
  verifyPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") earningId: string
  ) {
    return this.commercial.verifyPayout(actor.id, earningId);
  }

  @Get("recoveries")
  recoveries(@Query("status") status?: string) {
    return this.commercial.listRecoveries(status);
  }

  @Post("recoveries/:id/evidence")
  recordRecoveryEvidence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") recoveryId: string,
    @Body() dto: SubmitRecoveryEvidenceDto
  ) {
    return this.commercial.recordRecoveryEvidence(actor.id, recoveryId, dto.evidenceReference);
  }

  @Post("recoveries/:id/verify")
  verifyRecovery(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") recoveryId: string
  ) {
    return this.commercial.verifyRecovery(actor.id, recoveryId);
  }

  @Get("support/tickets")
  supportTickets(@Query() query: ListSupportTicketsDto) {
    return this.support.listAdmin(query);
  }

  @Post("support/tickets/:id/assign")
  assignSupportTicket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: AssignSupportTicketDto
  ) {
    return this.support.assign(actor.id, ticketId, dto.assignedToUserId);
  }

  @Post("support/tickets/:id/resolve")
  resolveSupportTicket(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: ResolveSupportTicketDto
  ) {
    return this.support.resolve(actor.id, ticketId, dto);
  }

  @Post("support/tickets/:id/refunds")
  initiateSupportRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: InitiateSupportRefundDto
  ) {
    return this.payments.requestSupportRefund(actor.id, ticketId, dto.reason);
  }
}
