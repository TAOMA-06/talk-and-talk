import { Body, Controller, Get, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { CompanionsService } from "../companions/companions.service";
import { CreateCompanionDto, UpdateCompanionDto } from "../companions/dto/companion-profile.dto";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { PaymentsService } from "../payments/payments.service";
import { UsersService } from "../users/users.service";
import { CompleteAccountDeletionDto, ListAccountDeletionRequestsDto } from "./dto/account-deletion.dto";
import { UpdateAccountStatusDto } from "./dto/update-account-status.dto";
import { UpdateUserVerificationDto } from "./dto/update-user-verification.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    private readonly companionsService: CompanionsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly paymentsService: PaymentsService
  ) {}

  @Get("status")
  status() {
    return { module: "admin", status: "active" };
  }

  @Get("account-deletions")
  listAccountDeletions(@Query() query: ListAccountDeletionRequestsDto) {
    return this.usersService.listDeletionRequests(query.status, query.page, query.pageSize);
  }

  @Post("account-deletions/:id/start")
  startAccountDeletion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string
  ) {
    return this.usersService.startDeletionRequest(requestId, actor.id);
  }

  @Post("account-deletions/:id/complete")
  completeAccountDeletion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: CompleteAccountDeletionDto
  ) {
    return this.usersService.completeDeletionRequest(requestId, actor.id, dto.note);
  }

  @Post("account-deletions/:id/orders/:orderId/payment/sync")
  async syncDeletionPayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Param("orderId") orderId: string
  ) {
    const userId = await this.usersService.getDeletionSettlementUserId(requestId, orderId);
    const result = await this.paymentsService.settlePaymentForDeletion(userId, orderId);
    await this.audit.record({
      actorId: actor.id,
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
  async syncDeletionRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Param("orderId") orderId: string
  ) {
    const userId = await this.usersService.getDeletionSettlementUserId(requestId, orderId);
    const result = await this.paymentsService.syncRefund(userId, orderId);
    await this.audit.record({
      actorId: actor.id,
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
      { actorId: actor.id, requestId }
    );
    return result;
  }

  @Patch("users/:id/account-status")
  async updateAccountStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") userId: string,
    @Body() dto: UpdateAccountStatusDto
  ) {
    if (actor.id === userId && dto.status !== "active") {
      throw new AppException("SELF_LOCKOUT_FORBIDDEN", "Administrators cannot restrict their own account", HttpStatus.CONFLICT);
    }
    const changedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const existing = await tx.user.findUnique({ where: { id: userId } });
      if (!existing) {
        throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
      }
      if (dto.status === "active") {
        const deletion = await tx.accountDeletionRequest.findFirst({
          where: { userId, status: { in: ["processing", "completed"] } },
          select: { id: true, status: true },
          orderBy: { updatedAt: "desc" }
        });
        if (deletion?.status === "completed") {
          throw new AppException(
            "ACCOUNT_DELETION_FINALIZED",
            "A completed account deletion cannot be reactivated",
            HttpStatus.CONFLICT
          );
        }
        if (deletion?.status === "processing") {
          throw new AppException(
            "ACCOUNT_DELETION_IN_PROGRESS",
            "An account being deleted cannot be reactivated",
            HttpStatus.CONFLICT
          );
        }
      }
      const user = await tx.user.update({
        where: { id: userId },
        data: { accountStatus: dto.status }
      });
      if (dto.status !== "active") {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: changedAt }
        });
      }
      await this.audit.record({
        actorId: actor.id,
        action: "account.status_updated",
        resourceType: "user",
        resourceId: userId,
        metadata: {
          previousStatus: existing.accountStatus,
          nextStatus: dto.status,
          reason: dto.reason?.trim() || null
        }
      }, tx);
      return user;
    });
    return { userId: updated.id, accountStatus: updated.accountStatus };
  }

  @Patch("users/:id/verification")
  async updateUserVerification(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") userId: string,
    @Body() dto: UpdateUserVerificationDto
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
    }
    const profile = await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, isVerified: dto.isVerified },
      update: { isVerified: dto.isVerified }
    });
    await this.audit.record({
      actorId: actor.id,
      action: "user.verification_updated",
      resourceType: "user",
      resourceId: userId,
      metadata: { isVerified: dto.isVerified, reason: dto.reason?.trim() || null }
    });
    return { userId, isVerified: profile.isVerified };
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
