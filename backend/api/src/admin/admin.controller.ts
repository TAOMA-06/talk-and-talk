import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CompanionsService } from "../companions/companions.service";
import { CreateCompanionDto, UpdateCompanionDto } from "../companions/dto/companion-profile.dto";
import { UserAccountActionsService } from "../account-governance/user-account-actions.service";
import { AuditService } from "../common/audit/audit.service";
import { PaymentsService } from "../payments/payments.service";
import { CustomerAdultEligibilityService } from "../users/customer-adult-eligibility.service";
import {
  ListCustomerAdultEligibilityDto,
  MarkCustomerAdultDto,
  MarkCustomerIneligibleDto
} from "../users/dto/customer-adult-eligibility.dto";
import { UsersService } from "../users/users.service";
import {
  CompleteAccountDeletionDto,
  ListAccountDeletionRequestsDto,
  ListAccountDeletionSettlementOrdersDto,
  RetryAccountDeletionDto
} from "./dto/account-deletion.dto";
import {
  ListIdentityVerificationRequestsDto,
  ReviewIdentityVerificationRequestDto
} from "./dto/identity-verification-review.dto";
import { UpdateAccountStatusDto } from "./dto/update-account-status.dto";
import { UpdateUserVerificationDto } from "./dto/update-user-verification.dto";
import { IdentityVerificationService } from "./identity-verification.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("support", "finance", "supply", "operations", "admin")
export class AdminController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly audit: AuditService,
    private readonly accountActions: UserAccountActionsService,
    private readonly usersService: UsersService,
    private readonly paymentsService: PaymentsService,
    private readonly identityVerification: IdentityVerificationService,
    private readonly customerAdultEligibility: CustomerAdultEligibilityService
  ) {}

  @Get("status")
  status() {
    return { module: "admin", status: "active" };
  }

  @Get("account-deletions")
  @Roles("admin")
  listAccountDeletions(@Query() query: ListAccountDeletionRequestsDto) {
    return this.usersService.listDeletionRequests(query.status, query.page, query.pageSize);
  }

  @Get("account-deletions/:id/settlement")
  @Roles("finance", "admin")
  deletionSettlement(
    @Param("id") requestId: string,
    @Query() query: ListAccountDeletionSettlementOrdersDto
  ) {
    return this.usersService.getDeletionSettlementDetails(requestId, query.page, query.pageSize);
  }

  @Post("account-deletions/:id/start")
  @HttpCode(HttpStatus.OK)
  @Roles("admin")
  startAccountDeletion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string
  ) {
    return this.usersService.startDeletionRequest(requestId, actor.id);
  }

  @Post("account-deletions/:id/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles("admin")
  completeAccountDeletion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: CompleteAccountDeletionDto
  ) {
    return this.usersService.completeDeletionRequest(requestId, actor.id, dto.note);
  }

  @Post("account-deletions/:id/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles("admin")
  retryAccountDeletion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: RetryAccountDeletionDto
  ) {
    return this.usersService.retryDeletionExecution(requestId, actor.id, dto.reason);
  }

  @Post("account-deletions/:id/orders/:orderId/payment/sync")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  async syncDeletionPayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Param("orderId") orderId: string
  ) {
    const userId = await this.usersService.getDeletionSettlementUserId(requestId, orderId);
    const result = await this.paymentsService.settlePaymentForDeletion(userId, orderId);
    await this.audit.record({
      actorId: actor.id,
      subjectUserIds: [userId],
      action: "account.deletion_payment_synced",
      resourceType: "accountDeletionRequest",
      resourceId: requestId,
      metadata: {
        userId,
        orderId,
        syncCode: result.sync.code,
        closedExpiredPayment: result.closedExpiredPayment
      }
    });
    return result;
  }

  @Post("account-deletions/:id/orders/:orderId/refund/sync")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  async syncDeletionRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Param("orderId") orderId: string
  ) {
    const userId = await this.usersService.getDeletionSettlementUserId(requestId, orderId);
    const result = await this.paymentsService.syncRefund(userId, orderId);
    await this.audit.record({
      actorId: actor.id,
      subjectUserIds: [userId],
      action: "account.deletion_refund_synced",
      resourceType: "accountDeletionRequest",
      resourceId: requestId,
      metadata: {
        userId,
        orderId,
        refundId: result.refund.id,
        refundStatus: result.refund.status,
        orderStatus: result.order.status
      }
    });
    return result;
  }

  @Post("account-deletions/:id/orders/:orderId/refund/initiate")
  @HttpCode(HttpStatus.OK)
  @Roles("finance", "admin")
  async initiateDeletionRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Param("orderId") orderId: string
  ) {
    const userId = await this.usersService.getDeletionSettlementUserId(requestId, orderId);
    const result = await this.paymentsService.requestRefund(
      userId,
      orderId,
      "ACCOUNT_DELETION_SETTLEMENT",
      { actorId: actor.id, requestId, reasonCode: "ACCOUNT_DELETION_SETTLEMENT" }
    );
    return result;
  }

  @Patch("users/:id/account-status")
  @Roles("admin")
  async updateAccountStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") userId: string,
    @Body() dto: UpdateAccountStatusDto
  ) {
    return this.accountActions.setAccountStatus(actor.id, userId, dto);
  }

  @Patch("users/:id/verification")
  @Roles("supply", "admin")
  async updateUserVerification(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") userId: string,
    @Body() dto: UpdateUserVerificationDto
  ) {
    // Compatibility route: a PATCH now submits an auditable proposal. The
    // subject's KYC state changes only after a different staff member approves.
    return this.identityVerification.submitRequest(actor, userId, dto);
  }

  @Get("identity-verification-requests")
  @Roles("supply", "admin")
  listIdentityVerificationRequests(@Query() query: ListIdentityVerificationRequestsDto) {
    return this.identityVerification.listRequests(query);
  }

  @Post("identity-verification-requests/:id/approve")
  @Roles("supply", "admin")
  approveIdentityVerificationRequest(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: ReviewIdentityVerificationRequestDto
  ) {
    return this.identityVerification.approveRequest(actor, requestId, dto);
  }

  @Post("identity-verification-requests/:id/reject")
  @Roles("supply", "admin")
  rejectIdentityVerificationRequest(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: ReviewIdentityVerificationRequestDto
  ) {
    return this.identityVerification.rejectRequest(actor, requestId, dto);
  }

  @Get("customer-adult-eligibility")
  @Roles("supply", "admin")
  listCustomerAdultEligibility(@Query() query: ListCustomerAdultEligibilityDto) {
    return this.customerAdultEligibility.list(query);
  }

  @Post("customer-adult-eligibility/:id/adult")
  @HttpCode(HttpStatus.OK)
  @Roles("supply", "admin")
  markCustomerAdult(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: MarkCustomerAdultDto
  ) {
    return this.customerAdultEligibility.markAdult(actor, requestId, dto);
  }

  @Post("customer-adult-eligibility/:id/ineligible")
  @HttpCode(HttpStatus.OK)
  @Roles("supply", "admin")
  markCustomerIneligible(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: MarkCustomerIneligibleDto
  ) {
    return this.customerAdultEligibility.markIneligible(actor, requestId, dto);
  }

  @Get("companions")
  @Roles("supply", "admin")
  listCompanions(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("commercialStatus") commercialStatus?: string
  ) {
    return this.companionsService.listAdmin(
      Number.parseInt(page ?? "1", 10),
      Number.parseInt(pageSize ?? "50", 10),
      commercialStatus
    );
  }

  @Post("companions")
  @Roles("supply", "admin")
  async createCompanion(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanionDto) {
    const result = await this.companionsService.create(dto);
    await this.audit.record({
      actorId: user.id,
      subjectUserIds: dto.ownerUserId ? [dto.ownerUserId] : [],
      action: "companion.create",
      resourceType: "companion",
      resourceId: result.id,
      metadata: { companionId: result.id, name: result.name }
    });
    return result;
  }

  @Patch("companions/:id")
  @Roles("supply", "admin")
  async updateCompanion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: UpdateCompanionDto
  ) {
    const result = await this.companionsService.update(id, dto);
    const ownerUserId = await this.companionsService.ownerUserIdForAudit(id);
    await this.audit.record({
      actorId: user.id,
      subjectUserIds: ownerUserId ? [ownerUserId] : [],
      action: "companion.update",
      resourceType: "companion",
      resourceId: id,
      metadata: { companionId: id, fields: Object.keys(dto) }
    });
    return result;
  }

  @Post("companions/:id/publish")
  @Roles("supply", "admin")
  async publishCompanion(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const result = await this.companionsService.publish(id);
    const ownerUserId = await this.companionsService.ownerUserIdForAudit(id);
    await this.audit.record({
      actorId: user.id,
      subjectUserIds: ownerUserId ? [ownerUserId] : [],
      action: "companion.publish",
      resourceType: "companion",
      resourceId: id,
      metadata: { companionId: id }
    });
    return result;
  }

  @Post("companions/:id/unpublish")
  @Roles("supply", "admin")
  async unpublishCompanion(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const result = await this.companionsService.unpublish(id);
    const ownerUserId = await this.companionsService.ownerUserIdForAudit(id);
    await this.audit.record({
      actorId: user.id,
      subjectUserIds: ownerUserId ? [ownerUserId] : [],
      action: "companion.unpublish",
      resourceType: "companion",
      resourceId: id,
      metadata: { companionId: id }
    });
    return result;
  }
}
