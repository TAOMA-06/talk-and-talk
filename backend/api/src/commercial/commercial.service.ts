import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { WECHAT_PREPAY_TTL_MS } from "../payments/wechat/wechat-pay.provider";

type ListEarningsQuery = { page?: number; pageSize?: number; status?: string };
type CommercialProfileInput = {
  settlementRecipientRef: string;
  settlementRecipientMasked: string;
  taxProfileRef: string;
  identityEvidenceRef: string;
  serviceAgreementVersion: string;
  serviceAgreementEvidenceRef: string;
};
const EARNING_STATUSES = ["pending", "available", "held", "paid", "void"] as const;
const ACTIVE_REFUND_STATUSES = ["pendingReview", "pending", "processing", "failed"] as const;

@Injectable()
export class CommercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  async listForCompanion(userId: string) {
    const companion = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true }
    } as any);
    if (!companion) return { items: [] };
    const earnings = await this.prisma.companionEarning.findMany({
      where: { companionId: companion.id },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 100
    } as any);
    return { items: earnings.map((earning: any) => this.toDto(earning, false)) };
  }

  async listAdmin(query: ListEarningsQuery = {}) {
    const page = Number.isSafeInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
    const pageSize = Number.isSafeInteger(query.pageSize) && (query.pageSize ?? 0) > 0
      ? Math.min(100, query.pageSize!)
      : 50;
    if (query.status && !EARNING_STATUSES.includes(query.status as typeof EARNING_STATUSES[number])) {
      throw new AppException("EARNING_STATUS_INVALID", "Unknown earning status", HttpStatus.BAD_REQUEST);
    }
    const where: any = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.companionEarning.findMany({
        where,
        include: {
          order: true,
          companion: { select: { id: true, name: true, ownerUserId: true } }
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.companionEarning.count({ where } as any)
    ]);
    return {
      items: items.map((earning: any) => this.toDto(earning, true)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async listCommercialProfiles(status?: string) {
    if (status && !["pendingReview", "verified", "suspended"].includes(status)) {
      throw new AppException("COMMERCIAL_PROFILE_STATUS_INVALID", "Unknown commercial profile status", HttpStatus.BAD_REQUEST);
    }
    const items = await this.prisma.companionCommercialProfile.findMany({
      where: status ? { status } : {},
      include: { companion: { select: { id: true, name: true, ownerUserId: true, isPublished: true } } },
      orderBy: { updatedAt: "asc" },
      take: 200
    } as any);
    return { items: items.map((item: any) => this.commercialProfileDto(item)) };
  }

  async operationalReadiness() {
    const now = new Date();
    const trtcEnabled = this.config.get<boolean>("TRTC_ENABLED", false) === true;
    const trtcRoomControlEnabled = this.config.get<boolean>("TRTC_ROOM_CONTROL_ENABLED", false) === true;
    const trtcEmergencyStopEnabled = this.config.get<boolean>("TRTC_EMERGENCY_STOP_ENABLED", false) === true;
    const [
      failedRefunds,
      staleRefunds,
      overdueSupport,
      failedNotifications,
      staleNotificationLeases,
      pendingCommercialProfiles,
      unresolvedRecoveries,
      stalePayoutClaims,
      moderationProviderUnavailable,
      criticalModeration,
      overdueModeration,
      mediaDeletionBacklog,
      stalePrepays,
      expiredOrderRequests,
      expiredPaymentReservations,
      expiredPaidServiceWindows,
      staleInService,
      voiceTerminationBacklog,
      voiceEmergencyDrainPending
    ] = await Promise.all([
      this.prisma.refundTransaction.count({ where: { status: "failed" } } as any),
      this.prisma.refundTransaction.count({
        where: {
          OR: [
            { status: "pending", updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
            {
              status: "processing",
              nextReconcileAt: { lt: new Date(now.getTime() - 15 * 60_000) }
            },
            {
              status: "processing",
              createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) }
            }
          ]
        }
      } as any),
      this.prisma.supportTicket.count({
        where: { status: { in: ["open", "inProgress"] }, dueAt: { lt: now } }
      } as any),
      // A failed WeChat push remains operationally actionable until the durable
      // in-app notification is read. Reading the in-app copy closes the user
      // communication gap without pretending the provider delivery succeeded.
      this.prisma.notificationDelivery.count({
        where: { status: "failed", notification: { readAt: null } }
      } as any),
      this.prisma.notificationDelivery.count({
        where: { status: "processing", leaseExpiresAt: { lte: now } }
      } as any),
      this.prisma.companionCommercialProfile.count({ where: { status: "pendingReview" } } as any),
      this.prisma.companionRecovery.count({ where: { status: { in: ["due", "pendingVerification"] } } } as any),
      this.prisma.companionEarning.count({
        where: {
          status: "held",
          holdReason: { in: ["payout_execution_claimed", "payout_verification_pending"] },
          payoutSubmittedAt: { lt: new Date(Date.now() - 30 * 60_000) }
        }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          status: { in: ["pending", "autoReviewing", "humanReview"] },
          matchedRules: { has: "provider.unavailable" }
        }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          status: { in: ["pending", "autoReviewing", "humanReview"] },
          priority: "critical"
        }
      } as any),
      this.prisma.moderationCase.count({
        where: {
          status: { in: ["pending", "autoReviewing", "humanReview"] },
          dueAt: { lt: now }
        }
      } as any),
      this.prisma.mediaAsset.count({
        where: {
          expiresAt: { lte: now },
          status: { not: "expired" },
          lastError: "storage_delete_failed"
        }
      } as any),
      this.prisma.paymentTransaction.count({
        where: {
          status: "initiated",
          OR: [
            { expiresAt: { lte: now } },
            { expiresAt: null, createdAt: { lte: new Date(now.getTime() - WECHAT_PREPAY_TTL_MS) } }
          ]
        }
      } as any),
      this.prisma.order.count({
        where: {
          status: "pending",
          companionConfirmedAt: null,
          companionResponseDeadlineAt: { lte: now }
        }
      } as any),
      this.prisma.order.count({
        where: {
          status: "pending",
          companionConfirmedAt: { not: null },
          paymentReservationExpiresAt: { lte: now }
        }
      } as any),
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count"
        FROM "Order"
        WHERE "status" = 'paid'
          AND "scheduledAt" + "durationMinutes" * INTERVAL '1 minute' + INTERVAL '10 minutes' < NOW()
      `,
      this.prisma.$queryRaw<Array<{ id: string; scheduledAt: Date }>>`
        SELECT "id", "scheduledAt"
        FROM "Order"
        WHERE "status" = 'inService'
          AND "scheduledAt" + "durationMinutes" * INTERVAL '1 minute' + INTERVAL '30 minutes' < NOW()
        ORDER BY "scheduledAt" ASC
        LIMIT 100
      `,
      trtcEnabled
        ? this.prisma.voiceSession.count({
            where: {
              terminationCompletedAt: null,
              terminationRequestedAt: { not: null },
              AND: [
                { OR: [{ terminationLeaseUntil: null }, { terminationLeaseUntil: { lte: now } }] },
                { OR: [{ terminationNextAttemptAt: null }, { terminationNextAttemptAt: { lte: now } }] }
              ]
            }
          } as any)
        : Promise.resolve(0),
      trtcEnabled && trtcEmergencyStopEnabled
        ? this.prisma.voiceSession.count({ where: { terminationCompletedAt: null } } as any)
        : Promise.resolve(0)
    ]);
    const blockers = {
      orderIntakeDisabled: this.config.get<boolean>("ORDER_INTAKE_ENABLED", true) ? 0 : 1,
      payoutClaimsDisabled: this.config.get<boolean>("PAYOUT_CLAIMS_ENABLED", true) ? 0 : 1,
      failedRefunds,
      staleRefunds,
      overdueSupport,
      failedNotifications,
      staleNotificationLeases,
      pendingCommercialProfiles,
      unresolvedRecoveries,
      stalePayoutClaims,
      moderationProviderUnavailable,
      criticalModeration,
      overdueModeration,
      mediaDeletionBacklog,
      stalePrepays,
      expiredOrderRequests,
      expiredPaymentReservations,
      expiredPaidServiceWindows: Number(expiredPaidServiceWindows[0]?.count ?? 0),
      staleInService: staleInService.length,
      voiceRoomControlDisabled: trtcEnabled && !trtcRoomControlEnabled ? 1 : 0,
      voiceEmergencyStopActive: trtcEmergencyStopEnabled ? 1 : 0,
      voiceTerminationBacklog,
      voiceEmergencyDrainPending
    };
    return {
      status: Object.values(blockers).some((value) => value > 0) ? "attentionRequired" : "clear",
      checkedAt: now.toISOString(),
      blockers,
      voice: {
        enabled: trtcEnabled,
        roomControlEnabled: trtcRoomControlEnabled,
        emergencyStopEnabled: trtcEmergencyStopEnabled,
        terminationBacklog: voiceTerminationBacklog,
        emergencyDrainPending: voiceEmergencyDrainPending
      },
      staleInServiceOrders: staleInService.map((order) => ({
        id: order.id,
        scheduledAt: order.scheduledAt.toISOString()
      }))
    };
  }

  async upsertCommercialProfile(actorId: string, companionId: string, input: CommercialProfileInput) {
    const normalized = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value.trim()])
    ) as CommercialProfileInput;
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({ where: { id: companionId } });
      if (!companion) throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
      const duplicate = await db.companionCommercialProfile.findFirst({
        where: { settlementRecipientRef: normalized.settlementRecipientRef, companionId: { not: companionId } },
        select: { companionId: true }
      });
      if (duplicate) {
        throw new AppException(
          "SETTLEMENT_RECIPIENT_ALREADY_BOUND",
          "Settlement recipient reference is already bound to another companion",
          HttpStatus.CONFLICT
        );
      }
      const now = new Date();
      const profile = await db.companionCommercialProfile.upsert({
        where: { companionId },
        create: {
          companionId,
          ...normalized,
          status: "pendingReview",
          submittedAt: now,
          submittedById: actorId
        },
        update: {
          ...normalized,
          status: "pendingReview",
          submittedAt: now,
          submittedById: actorId,
          verifiedAt: null,
          verifiedById: null,
          suspendedAt: null,
          suspendedById: null,
          suspendedReason: null
        }
      });
      if (companion.isPublished) {
        await db.companionProfile.update({ where: { id: companionId }, data: { isPublished: false } });
      }
      await this.audit.record({
        actorId,
        action: "commercial.companion_profile_submitted",
        resourceType: "companionCommercialProfile",
        resourceId: companionId,
        metadata: {
          settlementRecipientMasked: normalized.settlementRecipientMasked,
          serviceAgreementVersion: normalized.serviceAgreementVersion,
          unpublishedForReview: companion.isPublished
        }
      }, db);
      return profile;
    });
    return this.commercialProfileDto(result);
  }

  async verifyCommercialProfile(actorId: string, companionId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const companion = await db.companionProfile.findUnique({
        where: { id: companionId },
        include: { owner: { include: { profile: true } } }
      });
      const profile = await db.companionCommercialProfile.findUnique({ where: { companionId } });
      if (!companion || !profile) {
        throw new AppException("COMMERCIAL_PROFILE_NOT_FOUND", "Commercial profile not found", HttpStatus.NOT_FOUND);
      }
      if (profile.status !== "pendingReview") {
        throw new AppException("COMMERCIAL_PROFILE_INVALID_STATE", "Profile is not awaiting review", HttpStatus.CONFLICT);
      }
      if (profile.submittedById === actorId) {
        throw new AppException(
          "COMMERCIAL_PROFILE_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify the commercial profile",
          HttpStatus.FORBIDDEN
        );
      }
      if (!companion.ownerUserId || companion.owner?.accountStatus !== "active" || companion.owner?.profile?.isVerified !== true) {
        throw new AppException(
          "COMPANION_OWNER_NOT_VERIFIED",
          "The companion owner must be active and identity-verified",
          HttpStatus.CONFLICT
        );
      }
      const updated = await db.companionCommercialProfile.update({
        where: { companionId },
        data: { status: "verified", verifiedAt: new Date(), verifiedById: actorId }
      });
      await this.audit.record({
        actorId,
        action: "commercial.companion_profile_verified",
        resourceType: "companionCommercialProfile",
        resourceId: companionId,
        metadata: { submittedById: profile.submittedById }
      }, db);
      return updated;
    });
    return this.commercialProfileDto(result);
  }

  async suspendCommercialProfile(actorId: string, companionId: string, reason: string) {
    const normalizedReason = reason.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
      const profile = await db.companionCommercialProfile.findUnique({ where: { companionId } });
      if (!profile) throw new AppException("COMMERCIAL_PROFILE_NOT_FOUND", "Commercial profile not found", HttpStatus.NOT_FOUND);
      const updated = await db.companionCommercialProfile.update({
        where: { companionId },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendedById: actorId,
          suspendedReason: normalizedReason
        }
      });
      await db.companionProfile.updateMany({ where: { id: companionId }, data: { isPublished: false } });
      await this.audit.record({
        actorId,
        action: "commercial.companion_profile_suspended",
        resourceType: "companionCommercialProfile",
        resourceId: companionId,
        metadata: { reason: normalizedReason }
      }, db);
      return updated;
    });
    return this.commercialProfileDto(result);
  }

  /**
   * This deliberately never calls a payout provider. The first operator first
   * claims the payout under an Order → CompanionEarning lock, then performs
   * any external transfer. A separate evidence and second-review step are
   * required before a ledger row becomes paid.
   */
  async claimPayout(actorId: string, earningId: string) {
    if (this.config.get<boolean>("PAYOUT_CLAIMS_ENABLED", true) === false) {
      throw new AppException(
        "PAYOUT_CLAIMS_PAUSED",
        "New payout execution claims are temporarily paused",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "available") {
        throw new AppException(
          "EARNING_NOT_PAYABLE",
          "Only an available earning can be claimed for payout execution",
          HttpStatus.CONFLICT
        );
      }
      if (
        !earning.settlementRecipientRefSnapshot ||
        !earning.settlementRecipientMaskedSnapshot ||
        !earning.taxProfileRefSnapshot ||
        !earning.identityEvidenceRefSnapshot ||
        !earning.serviceAgreementVersionSnapshot ||
        !earning.serviceAgreementEvidenceRefSnapshot
      ) {
        throw new AppException(
          "EARNING_SETTLEMENT_SNAPSHOT_MISSING",
          "Settlement, tax and agreement snapshots are required before payout",
          HttpStatus.CONFLICT
        );
      }
      if (earning.companion?.commercialProfile?.status !== "verified") {
        throw new AppException(
          "EARNING_COMMERCIAL_PROFILE_NOT_VERIFIED",
          "The companion commercial profile must remain verified at payout time",
          HttpStatus.CONFLICT
        );
      }
      const holdReason = await this.payoutHoldReason(db, earning.orderId);
      if (holdReason) {
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
        });
        // Return rather than throw inside the transaction so the protective
        // hold commits before the caller receives the conflict response.
        return { holdReason, earning: held };
      }
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: "held",
          holdReason: "payout_execution_claimed",
          payoutSubmittedAt: new Date(),
          payoutSubmittedById: actorId,
          paidReference: null,
          paidAmountCents: null,
          paidRecipientRef: null,
          payoutEvidenceDigest: null
        },
        include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
      });
      await this.audit.record({
        actorId,
        action: "commercial.earning_payout_claimed",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          payableCents: earning.payableCents,
          payoutExecutionClaimed: true
        }
      }, db);
      return { holdReason: null, earning: updated };
    });
    this.throwPayoutHold(result.holdReason);
    return this.toDto(result.earning, true);
  }

  async cancelPayoutClaim(actorId: string, earningId: string, evidence: {
    reason: string;
    noTransferEvidenceReference: string;
    evidenceDigest: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "held" || earning.holdReason !== "payout_execution_claimed" || earning.paidReference) {
        throw new AppException(
          "EARNING_PAYOUT_CLAIM_NOT_CANCELLABLE",
          "Only an unsubmitted manual payout claim can be cancelled",
          HttpStatus.CONFLICT
        );
      }
      if (!earning.payoutSubmittedById || earning.payoutSubmittedById === actorId) {
        throw new AppException(
          "EARNING_PAYOUT_CANCELLATION_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify that no transfer occurred",
          HttpStatus.FORBIDDEN
        );
      }
      const nextHoldReason = await this.payoutHoldReason(db, earning.orderId);
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: nextHoldReason ? "held" : "available",
          holdReason: nextHoldReason,
          payoutSubmittedAt: null,
          payoutSubmittedById: null,
          paidReference: null,
          paidAmountCents: null,
          paidRecipientRef: null,
          payoutEvidenceDigest: null
        },
        include: {
          order: true,
          companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
        }
      });
      await this.audit.record({
        actorId,
        action: "commercial.earning_payout_claim_cancelled",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          originalClaimantId: earning.payoutSubmittedById,
          reason: evidence.reason.trim(),
          noTransferEvidenceReference: evidence.noTransferEvidenceReference.trim(),
          evidenceDigest: evidence.evidenceDigest.toLowerCase(),
          resultingHoldReason: nextHoldReason
        }
      }, db);
      return updated;
    });
    return this.toDto(result, true);
  }

  async recordPayoutEvidence(actorId: string, earningId: string, evidence: {
    paidReference: string;
    paidAmountCents: number;
    paidRecipientRef: string;
    payoutEvidenceDigest: string;
  }) {
    const reference = evidence.paidReference.trim();
    if (!reference) {
      throw new AppException("EARNING_REFERENCE_REQUIRED", "A manual payout reference is required", HttpStatus.BAD_REQUEST);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "held" || earning.holdReason !== "payout_execution_claimed") {
        throw new AppException(
          "EARNING_PAYOUT_CLAIM_REQUIRED",
          "This earning must be claimed before payout evidence can be recorded",
          HttpStatus.CONFLICT
        );
      }
      if (earning.payoutSubmittedById !== actorId) {
        throw new AppException(
          "EARNING_PAYOUT_CLAIM_OWNER_REQUIRED",
          "Only the administrator who claimed this payout can record transfer evidence",
          HttpStatus.FORBIDDEN
        );
      }
      if (evidence.paidAmountCents !== earning.payableCents) {
        throw new AppException(
          "EARNING_PAYOUT_AMOUNT_MISMATCH",
          "Payout evidence amount does not match the ledger",
          HttpStatus.CONFLICT
        );
      }
      if (evidence.paidRecipientRef.trim() !== earning.settlementRecipientRefSnapshot) {
        throw new AppException(
          "EARNING_PAYOUT_RECIPIENT_MISMATCH",
          "Payout recipient does not match the immutable order snapshot",
          HttpStatus.CONFLICT
        );
      }
      const duplicate = await db.companionEarning.findFirst({
        where: { paidReference: reference, id: { not: earning.id } },
        select: { id: true }
      });
      if (duplicate) {
        throw new AppException(
          "EARNING_PAYOUT_REFERENCE_DUPLICATE",
          "Payout reference is already in use",
          HttpStatus.CONFLICT
        );
      }
      const holdReason = await this.payoutHoldReason(db, earning.orderId);
      if (holdReason) {
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
        });
        return { holdReason, earning: held };
      }
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: {
          status: "held",
          holdReason: "payout_verification_pending",
          payoutSubmittedAt: new Date(),
          paidReference: reference,
          paidAmountCents: evidence.paidAmountCents,
          paidRecipientRef: evidence.paidRecipientRef.trim(),
          payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase()
        },
        include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
      });
      await this.audit.record({
        actorId,
        action: "commercial.earning_payout_evidence_recorded",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          payableCents: earning.payableCents,
          paidReference: reference,
          paidAmountCents: evidence.paidAmountCents,
          paidRecipientRef: evidence.paidRecipientRef.trim(),
          payoutEvidenceDigest: evidence.payoutEvidenceDigest.toLowerCase(),
          verificationRequired: true
        }
      }, db);
      return { holdReason: null, earning: updated };
    });
    this.throwPayoutHold(result.holdReason);
    return this.toDto(result.earning, true);
  }

  async verifyPayout(actorId: string, earningId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const earning = await this.lockPayoutEarning(db, earningId);
      if (earning.status !== "held" || earning.holdReason !== "payout_verification_pending") {
        throw new AppException(
          "EARNING_PAYOUT_REVIEW_REQUIRED",
          "This earning is not awaiting payout verification",
          HttpStatus.CONFLICT
        );
      }
      if (
        !earning.payoutSubmittedAt ||
        !earning.payoutSubmittedById ||
        !earning.paidReference ||
        earning.paidAmountCents !== earning.payableCents ||
        earning.paidRecipientRef !== earning.settlementRecipientRefSnapshot ||
        !/^[a-f0-9]{64}$/.test(earning.payoutEvidenceDigest ?? "")
      ) {
        throw new AppException(
          "EARNING_PAYOUT_EVIDENCE_MISSING",
          "Payout evidence must be recorded before verification",
          HttpStatus.CONFLICT
        );
      }
      if (earning.payoutSubmittedById === actorId) {
        throw new AppException(
          "EARNING_PAYOUT_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify this payout",
          HttpStatus.FORBIDDEN
        );
      }
      const holdReason = await this.payoutHoldReason(db, earning.orderId);
      if (holdReason) {
        const held = await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason },
          include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
        });
        return { holdReason, earning: held };
      }
      const updated = await db.companionEarning.update({
        where: { id: earning.id },
        data: { status: "paid", paidAt: new Date(), holdReason: null },
        include: { order: true, companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } } }
      });
      await this.audit.record({
        actorId,
        action: "commercial.earning_payout_verified",
        resourceType: "companionEarning",
        resourceId: earning.id,
        metadata: {
          orderId: earning.orderId,
          companionId: earning.companionId,
          payableCents: earning.payableCents,
          paidReference: earning.paidReference,
          submittedById: earning.payoutSubmittedById
        }
      }, db);
      return { holdReason: null, earning: updated };
    });
    this.throwPayoutHold(result.holdReason);
    return this.toDto(result.earning, true);
  }

  async listRecoveries(status?: string) {
    if (status && !["due", "pendingVerification", "recovered"].includes(status)) {
      throw new AppException("RECOVERY_STATUS_INVALID", "Unknown recovery status", HttpStatus.BAD_REQUEST);
    }
    const items = await this.prisma.companionRecovery.findMany({
      where: status ? { status } : {},
      include: {
        companion: { select: { id: true, name: true, ownerUserId: true } },
        refund: { include: { order: true } }
      },
      orderBy: { createdAt: "asc" },
      take: 200
    } as any);
    return { items: items.map((item: any) => this.recoveryDto(item)) };
  }

  async recordRecoveryEvidence(actorId: string, recoveryId: string, evidenceReference: string) {
    const reference = evidenceReference.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionRecovery" WHERE "id" = ${recoveryId} FOR UPDATE`;
      const recovery = await db.companionRecovery.findUnique({ where: { id: recoveryId } });
      if (!recovery) throw new AppException("RECOVERY_NOT_FOUND", "Companion recovery not found", HttpStatus.NOT_FOUND);
      if (recovery.status !== "due") {
        throw new AppException("RECOVERY_INVALID_STATE", "Only a due recovery can receive evidence", HttpStatus.CONFLICT);
      }
      const duplicate = await db.companionRecovery.findFirst({
        where: { evidenceReference: reference, id: { not: recoveryId } },
        select: { id: true }
      });
      if (duplicate) {
        throw new AppException("RECOVERY_REFERENCE_DUPLICATE", "Recovery evidence reference is already in use", HttpStatus.CONFLICT);
      }
      const updated = await db.companionRecovery.update({
        where: { id: recoveryId },
        data: {
          status: "pendingVerification",
          evidenceReference: reference,
          evidenceSubmittedAt: new Date(),
          evidenceSubmittedById: actorId
        }
      });
      await this.audit.record({
        actorId,
        action: "commercial.recovery_evidence_recorded",
        resourceType: "companionRecovery",
        resourceId: recoveryId,
        metadata: { amountCents: recovery.amountCents, evidenceReference: reference }
      }, db);
      return updated;
    });
    return this.recoveryDto(result);
  }

  async verifyRecovery(actorId: string, recoveryId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "CompanionRecovery" WHERE "id" = ${recoveryId} FOR UPDATE`;
      const recovery = await db.companionRecovery.findUnique({ where: { id: recoveryId } });
      if (!recovery) throw new AppException("RECOVERY_NOT_FOUND", "Companion recovery not found", HttpStatus.NOT_FOUND);
      if (recovery.status !== "pendingVerification" || !recovery.evidenceReference || !recovery.evidenceSubmittedById) {
        throw new AppException("RECOVERY_INVALID_STATE", "Recovery evidence is not awaiting verification", HttpStatus.CONFLICT);
      }
      if (recovery.evidenceSubmittedById === actorId) {
        throw new AppException(
          "RECOVERY_SECOND_REVIEW_REQUIRED",
          "A different administrator must verify the recovery",
          HttpStatus.FORBIDDEN
        );
      }
      const updated = await db.companionRecovery.update({
        where: { id: recoveryId },
        data: { status: "recovered", verifiedAt: new Date(), verifiedById: actorId }
      });
      await this.audit.record({
        actorId,
        action: "commercial.recovery_verified",
        resourceType: "companionRecovery",
        resourceId: recoveryId,
        metadata: {
          amountCents: recovery.amountCents,
          evidenceReference: recovery.evidenceReference,
          evidenceSubmittedById: recovery.evidenceSubmittedById
        }
      }, db);
      return updated;
    });
    return this.recoveryDto(result);
  }

  async holdForOrder(orderId: string, reason = "unresolved_support_ticket", db: any = this.prisma) {
    const updated = await db.companionEarning.updateMany({
      where: { orderId, status: { in: ["pending", "available", "held"] } },
      data: { status: "held", holdReason: reason }
    } as any);
    return updated.count;
  }

  /**
   * Promotes matured funds only when every order-linked ticket is resolved.
   * It also catches a ticket created after an earning became available and
   * moves it back to held before an operator can pay it out.
   */
  async reconcileEarnings(limit = 50) {
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), 200);
    const candidates: Array<{ id: string; status: string; orderId: string }> = await this.prisma.$queryRaw`
      SELECT earning."id", earning."status", earning."orderId"
      FROM "CompanionEarning" AS earning
      WHERE earning."status" IN ('pending', 'available', 'held')
      ORDER BY earning."availableAt" ASC, earning."id" ASC
      LIMIT ${safeLimit}
    `;
    let available = 0;
    let held = 0;
    for (const candidate of candidates ?? []) {
      const result = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
        await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const earning = await db.companionEarning.findUnique({ where: { id: candidate.id } });
        if (!earning || !["pending", "available", "held"].includes(earning.status)) return "unchanged";
        const holdReason = await this.payoutHoldReason(db, earning.orderId);
        if (holdReason) {
          if (earning.status !== "held" || earning.holdReason !== holdReason) {
            await db.companionEarning.update({
              where: { id: earning.id },
              data: { status: "held", holdReason }
            });
            return "held";
          }
          return "unchanged";
        }
        if (earning.payoutSubmittedAt && earning.payoutSubmittedById) {
          const payoutHoldReason = earning.paidReference
            ? "payout_verification_pending"
            : "payout_execution_claimed";
          if (earning.status !== "held" || earning.holdReason !== payoutHoldReason) {
            await db.companionEarning.update({
              where: { id: earning.id },
              data: { status: "held", holdReason: payoutHoldReason }
            });
            return "held";
          }
          return "unchanged";
        }
        if (earning.availableAt.getTime() > Date.now()) return "unchanged";
        if (earning.status !== "available") {
          await db.companionEarning.update({
            where: { id: earning.id },
            data: { status: "available", holdReason: null }
          });
          return "available";
        }
        return "unchanged";
      });
      if (result === "available") available += 1;
      if (result === "held") held += 1;
    }
    return { scanned: candidates?.length ?? 0, available, held };
  }

  private async lockPayoutEarning(db: any, earningId: string) {
    // All payout-affecting flows lock Order first, then CompanionEarning. Refund
    // and support creation use the same order lock, preventing a transfer from
    // racing a newly opened dispute or refund request.
    const pointer = await db.companionEarning.findUnique({
      where: { id: earningId },
      select: { orderId: true }
    });
    if (!pointer) {
      throw new AppException("EARNING_NOT_FOUND", "Companion earning not found", HttpStatus.NOT_FOUND);
    }
    await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${pointer.orderId} FOR UPDATE`;
    await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${earningId} FOR UPDATE`;
    const earning = await db.companionEarning.findUnique({
      where: { id: earningId },
      include: {
        order: true,
        companion: { select: { id: true, name: true, ownerUserId: true, commercialProfile: true } }
      }
    });
    if (!earning) {
      throw new AppException("EARNING_NOT_FOUND", "Companion earning not found", HttpStatus.NOT_FOUND);
    }
    return earning;
  }

  private async payoutHoldReason(db: any, orderId: string): Promise<string | null> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { completedAt: true, refundRequestDeadlineAt: true }
    });
    const earningRef = await db.companionEarning.findUnique({
      where: { orderId },
      select: {
        companionId: true,
        settlementRecipientRefSnapshot: true,
        settlementRecipientMaskedSnapshot: true,
        taxProfileRefSnapshot: true,
        identityEvidenceRefSnapshot: true,
        serviceAgreementVersionSnapshot: true,
        serviceAgreementEvidenceRefSnapshot: true
      }
    });
    const unresolved = await db.supportTicket.findFirst({
      where: { orderId, status: { in: ["open", "inProgress"] } },
      select: { id: true }
    });
    const activeRefund = await db.refundTransaction.findFirst({
      where: { orderId, status: { in: ACTIVE_REFUND_STATUSES } },
      select: { id: true, status: true }
    });
    const recovery = earningRef && db.companionRecovery?.findFirst
      ? await db.companionRecovery.findFirst({
          where: { companionId: earningRef.companionId, status: { in: ["due", "pendingVerification"] } },
          select: { id: true }
        })
      : null;
    const commercialProfile = earningRef && db.companionCommercialProfile?.findUnique
      ? await db.companionCommercialProfile.findUnique({
          where: { companionId: earningRef.companionId },
          select: { status: true }
        })
      : null;
    if (recovery) return "companion_recovery_due";
    if (
      earningRef &&
      (!earningRef.settlementRecipientRefSnapshot ||
        !earningRef.settlementRecipientMaskedSnapshot ||
        !earningRef.taxProfileRefSnapshot ||
        !earningRef.identityEvidenceRefSnapshot ||
        !earningRef.serviceAgreementVersionSnapshot ||
        !earningRef.serviceAgreementEvidenceRefSnapshot)
    ) {
      return "commercial_profile_snapshot_missing";
    }
    if (earningRef && commercialProfile?.status !== "verified") return "commercial_profile_not_verified";
    if (unresolved) return "unresolved_support_ticket";
    if (activeRefund?.status === "failed") return "refund_attention_required";
    if (activeRefund) return "refund_in_progress";
    const refundWindowHours = this.config.get<number>("REFUND_REQUEST_WINDOW_HOURS") ?? 72;
    const refundDeadline = order?.refundRequestDeadlineAt ?? (
      order?.completedAt ? new Date(order.completedAt.getTime() + refundWindowHours * 60 * 60_000) : null
    );
    return refundDeadline && refundDeadline.getTime() > Date.now() ? "refund_window_open" : null;
  }

  private throwPayoutHold(holdReason: string | null) {
    if (holdReason === "unresolved_support_ticket") {
      throw new AppException(
        "EARNING_HELD_FOR_SUPPORT",
        "This earning is held while an associated support ticket is unresolved",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_in_progress") {
      throw new AppException(
        "EARNING_HELD_FOR_REFUND",
        "This earning is held while an associated refund is in progress",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_attention_required") {
      throw new AppException(
        "EARNING_HELD_FOR_FAILED_REFUND",
        "This earning is held until the failed refund is reconciled or formally resolved",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "companion_recovery_due") {
      throw new AppException(
        "EARNING_HELD_FOR_COMPANION_RECOVERY",
        "This companion has an unresolved post-payout refund recovery",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "refund_window_open") {
      throw new AppException(
        "EARNING_REFUND_WINDOW_OPEN",
        "This earning cannot be paid before the customer refund request window closes",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "commercial_profile_snapshot_missing") {
      throw new AppException(
        "EARNING_SETTLEMENT_SNAPSHOT_MISSING",
        "Settlement, tax and agreement snapshots are required before payout",
        HttpStatus.CONFLICT
      );
    }
    if (holdReason === "commercial_profile_not_verified") {
      throw new AppException(
        "EARNING_COMMERCIAL_PROFILE_NOT_VERIFIED",
        "The companion commercial profile must remain verified at payout time",
        HttpStatus.CONFLICT
      );
    }
  }

  settlementHoldHours() {
    return this.config.get<number>("COMPANION_SETTLEMENT_HOLD_HOURS") ?? 96;
  }

  private toDto(earning: any, includeOperations: boolean) {
    const dto = {
      id: earning.id,
      orderId: earning.orderId,
      companionId: earning.companionId,
      grossCents: earning.grossCents,
      platformFeeBps: earning.platformFeeBps,
      platformFeeCents: earning.platformFeeCents,
      payableCents: earning.payableCents,
      status: earning.status,
      availableAt: earning.availableAt.toISOString(),
      paidAt: earning.paidAt?.toISOString() ?? null,
      holdReason: earning.holdReason ?? null,
      createdAt: earning.createdAt.toISOString(),
      updatedAt: earning.updatedAt.toISOString(),
      order: earning.order ? {
        scheduledAt: earning.order.scheduledAt?.toISOString?.() ?? null,
        status: earning.order.status,
        amountCents: earning.order.amountCents,
        companionName: earning.order.companionNameSnapshot
      } : null
    } as Record<string, unknown>;
    if (includeOperations) {
      dto.paidReference = earning.paidReference ?? null;
      dto.paidAmountCents = earning.paidAmountCents ?? null;
      dto.paidRecipientRef = earning.paidRecipientRef ?? null;
      dto.payoutEvidenceDigest = earning.payoutEvidenceDigest ?? null;
      dto.settlementRecipientRefSnapshot = earning.settlementRecipientRefSnapshot ?? null;
      dto.settlementRecipientMaskedSnapshot = earning.settlementRecipientMaskedSnapshot ?? null;
      dto.taxProfileRefSnapshot = earning.taxProfileRefSnapshot ?? null;
      dto.identityEvidenceRefSnapshot = earning.identityEvidenceRefSnapshot ?? null;
      dto.serviceAgreementVersionSnapshot = earning.serviceAgreementVersionSnapshot ?? null;
      dto.serviceAgreementEvidenceRefSnapshot = earning.serviceAgreementEvidenceRefSnapshot ?? null;
      dto.payoutSubmittedAt = earning.payoutSubmittedAt?.toISOString() ?? null;
      dto.payoutSubmittedById = earning.payoutSubmittedById ?? null;
      dto.companion = earning.companion ? {
        id: earning.companion.id,
        name: earning.companion.name,
        ownerUserId: earning.companion.ownerUserId
      } : null;
    }
    return dto;
  }

  private recoveryDto(recovery: any) {
    return {
      id: recovery.id,
      refundId: recovery.refundId,
      earningId: recovery.earningId,
      companionId: recovery.companionId,
      amountCents: recovery.amountCents,
      status: recovery.status,
      reason: recovery.reason,
      evidenceReference: recovery.evidenceReference ?? null,
      evidenceSubmittedAt: recovery.evidenceSubmittedAt?.toISOString?.() ?? null,
      evidenceSubmittedById: recovery.evidenceSubmittedById ?? null,
      verifiedAt: recovery.verifiedAt?.toISOString?.() ?? null,
      verifiedById: recovery.verifiedById ?? null,
      companion: recovery.companion ?? null,
      orderId: recovery.refund?.orderId ?? null,
      createdAt: recovery.createdAt?.toISOString?.() ?? null,
      updatedAt: recovery.updatedAt?.toISOString?.() ?? null
    };
  }

  private commercialProfileDto(profile: any) {
    return {
      companionId: profile.companionId,
      status: profile.status,
      settlementRecipientMasked: profile.settlementRecipientMasked,
      taxProfileRef: profile.taxProfileRef,
      identityEvidenceRef: profile.identityEvidenceRef,
      serviceAgreementVersion: profile.serviceAgreementVersion,
      serviceAgreementEvidenceRef: profile.serviceAgreementEvidenceRef,
      submittedAt: profile.submittedAt?.toISOString?.() ?? null,
      submittedById: profile.submittedById,
      verifiedAt: profile.verifiedAt?.toISOString?.() ?? null,
      verifiedById: profile.verifiedById ?? null,
      suspendedAt: profile.suspendedAt?.toISOString?.() ?? null,
      suspendedById: profile.suspendedById ?? null,
      suspendedReason: profile.suspendedReason ?? null,
      companion: profile.companion ?? null,
      createdAt: profile.createdAt?.toISOString?.() ?? null,
      updatedAt: profile.updatedAt?.toISOString?.() ?? null
    };
  }
}
