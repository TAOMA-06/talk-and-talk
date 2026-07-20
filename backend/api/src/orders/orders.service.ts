import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppException } from "../common/errors/app.exception";
import { AuditRecordInput, AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import {
  WECHAT_PAY_PROVIDER,
  WECHAT_PREPAY_TTL_MS,
  WeChatPayProvider
} from "../payments/wechat/wechat-pay.provider";
import { CreateOrderDto } from "./dto/create-order.dto";

const SERVICE_EARLY_START_MS = 15 * 60 * 1000;
export const COMPANION_PAYMENT_RESERVATION_MS = 15 * 60 * 1000;
const MIN_RESERVATION_PAYMENT_WINDOW_MS = 60 * 1000;

type OrderRecord = {
  id: string;
  userId: string;
  companionId: string;
  themeId: string;
  durationMinutes: number;
  amountCents: number;
  currency: string;
  status: string;
  scheduledAt: Date;
  companionNameSnapshot: string;
  companionRoleSnapshot: string;
  companionInitialsSnapshot: string;
  themeNameSnapshot: string;
  conversationId: string | null;
  companionConfirmedAt: Date | null;
  companionResponseDeadlineAt?: Date | null;
  paymentReservationExpiresAt: Date | null;
  serviceStartedAt?: Date | null;
  platformFeeBps?: number;
  platformFeeCents?: number;
  companionPayableCents?: number;
  paidAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  customerConfirmedAt?: Date | null;
  refundRequestDeadlineAt?: Date | null;
  clientRequestId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  conversation?: { externalId: string } | null;
  user?: { profile: { displayName: string | null } | null };
  refunds?: any[];
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly wechat: WeChatPayProvider,
    @Optional() private readonly recommendations?: RecommendationsService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly audit?: AuditService
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    const clientRequestId = dto.clientRequestId?.trim() || null;
    if (clientRequestId) {
      const existing = await this.prisma.order.findFirst({
        where: { userId, clientRequestId },
        include: {
          conversation: { select: { externalId: true } },
          refunds: { orderBy: { createdAt: "desc" }, take: 1 }
        }
      } as any);
      if (existing) {
        this.assertIdempotentOrderMatches(existing, dto);
        return this.toDto(existing);
      }
    }
    if (this.config?.get<string>("COMMERCIAL_RELEASE_MODE", "internal") === "commercial" && !clientRequestId) {
      throw new AppException(
        "ORDER_CLIENT_REQUEST_ID_REQUIRED",
        "clientRequestId is required for commercial order intake",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    if (this.config?.get<boolean>("ORDER_INTAKE_ENABLED", true) === false) {
      throw new AppException(
        "ORDER_INTAKE_PAUSED",
        "New order intake is temporarily paused",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const durationMinutes = dto.durationMinutes;
    if (durationMinutes % 30 !== 0) {
      throw new AppException(
        "INVALID_DURATION",
        "durationMinutes must be a multiple of 30",
        HttpStatus.BAD_REQUEST
      );
    }

    const recommendationImpressionId = dto.recommendationImpressionId
      ? await this.validateRecommendationAttribution(userId, dto.recommendationImpressionId, dto.companionId)
      : null;

    const units = Math.max(1, Math.ceil(durationMinutes / 30));
    const now = Date.now();
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt.getTime() <= now) {
      throw new AppException("INVALID_SCHEDULE", "scheduledAt must be in the future", HttpStatus.BAD_REQUEST);
    }
    const maxScheduleDays = this.config?.get<number>("ORDER_MAX_SCHEDULE_DAYS") ?? 30;
    if (scheduledAt.getTime() > now + maxScheduleDays * 24 * 60 * 60_000) {
      throw new AppException(
        "ORDER_SCHEDULE_TOO_FAR",
        `scheduledAt must be within ${maxScheduleDays} days`,
        HttpStatus.BAD_REQUEST,
        { maxScheduleDays }
      );
    }

    const responseWindowMinutes = this.config?.get<number>("ORDER_RESPONSE_WINDOW_MINUTES") ?? 10;
    const responseDeadlineAt = new Date(now + responseWindowMinutes * 60_000);
    const paymentCutoff = new Date(scheduledAt.getTime() - 5 * 60_000);
    if (paymentCutoff.getTime() <= responseDeadlineAt.getTime()) {
      throw new AppException(
        "ORDER_SCHEDULE_TOO_SOON",
        "scheduledAt must leave enough time for companion confirmation and payment",
        HttpStatus.BAD_REQUEST
      );
    }
    const platformFeeBps = this.config?.get<number>("PLATFORM_FEE_BPS") ?? 0;

    const order = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // One lightweight transaction-scoped lock serializes the bounded intake
      // counters across replicas and also makes a concurrent client retry see
      // the first committed order before it creates another financial intent.
      // Prisma's driver adapter cannot deserialize PostgreSQL's native `void`
      // result. Cast the lock function result to a supported scalar while
      // preserving the transaction-scoped lock side effect.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('talk-and-talk:order-intake'))::text AS "lock"`;
      if (clientRequestId) {
        const duplicate = await db.order.findFirst({ where: { userId, clientRequestId } });
        if (duplicate) {
          this.assertIdempotentOrderMatches(duplicate, dto);
          return duplicate;
        }
      }
      // Commercial submission/suspension also locks this row. Eligibility,
      // pricing and evidence snapshots must therefore be read after acquiring
      // the same lock, not from a pre-transaction marketplace lookup.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${dto.companionId} FOR UPDATE`;
      const companion: any = await db.companionProfile.findFirst({
        where: {
          id: dto.companionId,
          isPublished: true,
          isVerified: true,
          ownerUserId: { not: null },
          owner: { accountStatus: "active", profile: { isVerified: true } },
          commercialProfile: { status: "verified" }
        },
        include: { commercialProfile: true }
      });
      if (!companion) {
        throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
      }
      await this.assertOrderIntakeCapacity(db, userId, companion.id);
      const amountCents = companion.pricePerHalfHour * units * 100;
      const platformFeeCents = Math.floor(amountCents * platformFeeBps / 10_000);
      const companionPayableCents = amountCents - platformFeeCents;
      const created = await db.order.create({
        data: {
          userId,
          companionId: companion.id,
          themeId: dto.themeId,
          durationMinutes,
          amountCents,
          currency: "CNY",
          status: "pending",
          scheduledAt,
          companionNameSnapshot: companion.name,
          companionRoleSnapshot: companion.role,
          companionInitialsSnapshot: companion.initials,
          themeNameSnapshot: this.themeName(dto.themeId),
          recommendationImpressionId,
          clientRequestId,
          companionResponseDeadlineAt: responseDeadlineAt,
          platformFeeBps,
          platformFeeCents,
          companionPayableCents,
          settlementRecipientRefSnapshot: companion.commercialProfile?.settlementRecipientRef ?? null,
          settlementRecipientMaskedSnapshot: companion.commercialProfile?.settlementRecipientMasked ?? null,
          taxProfileRefSnapshot: companion.commercialProfile?.taxProfileRef ?? null,
          identityEvidenceRefSnapshot: companion.commercialProfile?.identityEvidenceRef ?? null,
          serviceAgreementVersionSnapshot: companion.commercialProfile?.serviceAgreementVersion ?? null,
          serviceAgreementEvidenceRefSnapshot: companion.commercialProfile?.serviceAgreementEvidenceRef ?? null
        }
      });
      if (companion.ownerUserId) {
        await this.enqueueTransactionalNotification(db, {
          userId: companion.ownerUserId,
          type: "orderStatus",
          title: "有新的预约请求",
          body: "请在响应时限内确认或拒绝这笔预约。",
          data: { orderId: created.id, status: "pending", responseDeadlineAt: responseDeadlineAt.toISOString() },
          eventKey: `order:${created.id}:created`,
          templateKey: "newOrder"
        });
      }
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.created",
        resourceType: "order",
        resourceId: created.id,
        metadata: {
          companionId: companion.id,
          amountCents,
          durationMinutes,
          scheduledAt: scheduledAt.toISOString(),
          clientRequestId
        }
      });
      return created;
    });

    return this.toDto(order);
  }

  private assertIdempotentOrderMatches(existing: any, dto: CreateOrderDto): void {
    if (
      existing.companionId !== dto.companionId ||
      existing.themeId !== dto.themeId ||
      existing.durationMinutes !== dto.durationMinutes ||
      new Date(existing.scheduledAt).getTime() !== new Date(dto.scheduledAt).getTime()
    ) {
      throw new AppException(
        "ORDER_IDEMPOTENCY_KEY_REUSED",
        "clientRequestId was already used for a different order request",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertOrderIntakeCapacity(db: any, userId: string, companionId: string): Promise<void> {
    if (!this.config) return;
    const openStatuses = ["pending", "paying", "paid", "inService"];
    // Interactive Prisma transactions use one pg client. Keep these queries
    // sequential: pg 8 only tolerates concurrent client.query calls and pg 9
    // removes that behavior.
    const openTotal = await db.order.count({ where: { status: { in: openStatuses } } });
    const openForUser = await db.order.count({ where: { userId, status: { in: openStatuses } } });
    const pendingForCompanion = await db.order.count({
      where: { companionId, status: "pending", companionConfirmedAt: null }
    });
    const maxOpenTotal = this.config.get<number>("ORDER_MAX_OPEN_TOTAL", 500);
    const maxOpenPerUser = this.config.get<number>("ORDER_MAX_OPEN_PER_USER", 3);
    const maxPendingPerCompanion = this.config.get<number>("ORDER_MAX_PENDING_PER_COMPANION", 20);
    if (openForUser >= maxOpenPerUser) {
      throw new AppException(
        "ORDER_ACTIVE_LIMIT_REACHED",
        "Finish or cancel an active order before creating another",
        HttpStatus.CONFLICT,
        { limit: maxOpenPerUser }
      );
    }
    if (pendingForCompanion >= maxPendingPerCompanion) {
      throw new AppException(
        "COMPANION_REQUEST_QUEUE_FULL",
        "This companion has reached the current pending-request capacity",
        HttpStatus.CONFLICT,
        { limit: maxPendingPerCompanion }
      );
    }
    if (openTotal >= maxOpenTotal) {
      throw new AppException(
        "ORDER_INTAKE_CAPACITY_REACHED",
        "The platform has reached its controlled open-order capacity",
        HttpStatus.SERVICE_UNAVAILABLE,
        { limit: maxOpenTotal }
      );
    }
  }

  private async validateRecommendationAttribution(userId: string, impressionId: string, companionId: string) {
    if (!this.recommendations) {
      throw new AppException(
        "RECOMMENDATIONS_UNAVAILABLE",
        "Recommendation attribution is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return this.recommendations.validateOrderAttribution(userId, impressionId, companionId);
  }

  async list(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { conversation: { select: { externalId: true } }, refunds: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" }
    } as any);

    return {
      items: orders.map((order: OrderRecord) => this.toDto(order))
    };
  }

  async listForCompanion(userId: string) {
    const companion = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId }
    } as any);
    if (!companion) {
      return { items: [] };
    }
    const orders = await this.prisma.order.findMany({
      where: { companionId: companion.id },
      include: {
        conversation: { select: { externalId: true } },
        user: { select: { profile: { select: { displayName: true } } } }
      },
      orderBy: { scheduledAt: "asc" }
    } as any);
    return { items: orders.map((order: OrderRecord) => this.toDto(order)) };
  }

  async startService(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { select: { ownerUserId: true } },
          conversation: { select: { externalId: true } }
        }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "paid") {
        throw new AppException("ORDER_INVALID_STATE", "Only paid orders can start", HttpStatus.CONFLICT);
      }
      const activeRefund = await db.refundTransaction.findFirst({
        where: {
          orderId,
          status: { in: ["pendingReview", "pending", "processing", "success", "failed"] }
        },
        select: { id: true }
      });
      if (activeRefund) {
        throw new AppException(
          "ORDER_REFUND_IN_PROGRESS",
          "Service cannot start while a refund request is active",
          HttpStatus.CONFLICT
        );
      }
      const now = Date.now();
      const scheduledStart = order.scheduledAt.getTime();
      const scheduledEnd = scheduledStart + order.durationMinutes * 60_000;
      if (now < scheduledStart - SERVICE_EARLY_START_MS) {
        throw new AppException(
          "ORDER_SERVICE_NOT_READY",
          "Service can only start within 15 minutes of the scheduled time",
          HttpStatus.CONFLICT
        );
      }
      if (now >= scheduledEnd) {
        throw new AppException(
          "ORDER_SERVICE_WINDOW_EXPIRED",
          "The scheduled service window has ended",
          HttpStatus.CONFLICT
        );
      }
      const updated = await db.order.update({
        where: { id: orderId },
        data: { status: "inService", serviceStartedAt: new Date() },
        include: { conversation: { select: { externalId: true } } }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: updated.userId,
        type: "orderStatus",
        title: "服务已开始",
        body: "陪伴者已开始本次服务。",
        data: { orderId, status: "inService" },
        eventKey: `order:${orderId}:started`,
        templateKey: "serviceStarted"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.service_started",
        resourceType: "order",
        resourceId: orderId,
        metadata: {
          scheduledAt: order.scheduledAt.toISOString(),
          serviceStartedAt: updated.serviceStartedAt?.toISOString?.() ?? null
        }
      });
      return updated;
    }, { maxWait: 5_000, timeout: 10_000 });
    return this.toDto(updated);
  }

  async confirmOrder(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // The companion lock serializes confirmation and prepay for every one of
      // their bookings.  Without it two overlapping pending orders can both
      // be confirmed before either customer reaches the payment screen.
      const target: any = await db.order.findUnique({
        where: { id: orderId },
        select: { companionId: true }
      });
      if (target?.companionId) {
        await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${target.companionId} FOR UPDATE`;
      }
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { include: { owner: { include: { profile: true } }, commercialProfile: true } },
          conversation: true
        }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "pending") {
        throw new AppException("ORDER_INVALID_STATE", "Only pending orders can be confirmed", HttpStatus.CONFLICT);
      }
      const now = new Date();
      if (order.scheduledAt.getTime() <= now.getTime()) {
        throw new AppException("ORDER_SCHEDULE_EXPIRED", "Past bookings cannot be confirmed", HttpStatus.CONFLICT);
      }
      if (order.companionResponseDeadlineAt && order.companionResponseDeadlineAt.getTime() <= now.getTime()) {
        throw new AppException(
          "ORDER_RESPONSE_WINDOW_EXPIRED",
          "This booking request has reached its companion response deadline",
          HttpStatus.CONFLICT
        );
      }
      if (
        order.companion.availability === "busy" ||
        order.companion.availableTimes.length === 0 ||
        order.companion.owner?.accountStatus !== "active" ||
        order.companion.owner?.profile?.isVerified !== true ||
        order.companion.commercialProfile?.status !== "verified"
      ) {
        throw new AppException("COMPANION_UNAVAILABLE", "Companion is not accepting this booking", HttpStatus.CONFLICT);
      }
      if (
        order.companionConfirmedAt &&
        (!order.paymentReservationExpiresAt || order.paymentReservationExpiresAt.getTime() > now.getTime())
      ) {
        return order;
      }

      const reservationExpiresAt = this.paymentReservationExpiresAt(order.scheduledAt, now);
      await this.assertCompanionSlotReservable(db, order, now);
      const updated = await db.order.update({
        where: { id: orderId },
        data: {
          companionConfirmedAt: now,
          companionResponseDeadlineAt: null,
          paymentReservationExpiresAt: reservationExpiresAt
        },
        include: { conversation: { select: { externalId: true } } }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: updated.userId,
        type: "orderStatus",
        title: "预约已确认",
        body: "陪伴者已确认本次预约，请在保留时段结束前完成支付。",
        data: {
          orderId,
          status: "pending",
          companionConfirmed: true,
          paymentReservationExpiresAt: updated.paymentReservationExpiresAt?.toISOString() ?? null
        },
        eventKey: `order:${orderId}:confirmed:${now.toISOString()}`,
        templateKey: "orderConfirmed"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.companion_confirmed",
        resourceType: "order",
        resourceId: orderId,
        metadata: { paymentReservationExpiresAt: reservationExpiresAt.toISOString() }
      });
      return updated;
    });
    return this.toDto(updated);
  }

  async rejectOrder(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: { companion: { select: { ownerUserId: true } }, conversation: true }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "pending" || order.companionConfirmedAt) {
        throw new AppException("ORDER_INVALID_STATE", "Only unconfirmed pending orders can be rejected", HttpStatus.CONFLICT);
      }
      const activePayment = await db.paymentTransaction.findFirst({
        where: { orderId, status: "initiated" },
        select: { id: true }
      });
      if (activePayment) {
        throw new AppException(
          "ORDER_PAYMENT_IN_PROGRESS",
          "An order with an active payment cannot be rejected",
          HttpStatus.CONFLICT
        );
      }
      const updated = await db.order.update({
        where: { id: orderId },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
          companionResponseDeadlineAt: null,
          paymentReservationExpiresAt: null
        },
        include: { conversation: { select: { externalId: true } } }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: updated.userId,
        type: "orderStatus",
        title: "预约未被接受",
        body: "陪伴者当前无法接受该时段，订单已取消且不会扣款。",
        data: { orderId, status: "cancelled" },
        eventKey: `order:${orderId}:rejected`,
        templateKey: "orderRejected"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.companion_rejected",
        resourceType: "order",
        resourceId: orderId
      });
      return updated;
    });
    return this.toDto(updated);
  }

  async completeService(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { select: { ownerUserId: true } },
          conversation: { select: { externalId: true } }
        }
      });
      if (!order || order.companion.ownerUserId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "inService") {
        throw new AppException("ORDER_INVALID_STATE", "Only in-service orders can complete", HttpStatus.CONFLICT);
      }
      const completedAt = new Date();
      const serviceStartedAt = order.serviceStartedAt ?? order.scheduledAt;
      const earliestCompletionAt = new Date(
        Math.max(order.scheduledAt.getTime(), serviceStartedAt.getTime()) + order.durationMinutes * 60_000
      );
      if (completedAt.getTime() < earliestCompletionAt.getTime()) {
        throw new AppException(
          "ORDER_SERVICE_NOT_COMPLETE",
          "Service cannot be completed before the scheduled duration has elapsed",
          HttpStatus.CONFLICT
        );
      }
      const refundWindowHours = this.config?.get<number>("REFUND_REQUEST_WINDOW_HOURS") ?? 72;
      const refundRequestDeadlineAt = new Date(completedAt.getTime() + refundWindowHours * 60 * 60_000);
      const updated = await db.order.update({
        where: { id: orderId },
        data: { status: "completed", completedAt, refundRequestDeadlineAt },
        include: { conversation: { select: { externalId: true } } }
      });
      const holdHours = this.config?.get<number>("COMPANION_SETTLEMENT_HOLD_HOURS") ?? 96;
      // Never reconstruct commercial evidence from today's profile. Orders that
      // predate the immutable snapshot stay held for explicit historical review.
      const settlementRecipientRefSnapshot = order.settlementRecipientRefSnapshot ?? null;
      const settlementRecipientMaskedSnapshot = order.settlementRecipientMaskedSnapshot ?? null;
      const taxProfileRefSnapshot = order.taxProfileRefSnapshot ?? null;
      const identityEvidenceRefSnapshot = order.identityEvidenceRefSnapshot ?? null;
      const serviceAgreementVersionSnapshot = order.serviceAgreementVersionSnapshot ?? null;
      const serviceAgreementEvidenceRefSnapshot = order.serviceAgreementEvidenceRefSnapshot ?? null;
      const settlementSnapshotComplete = Boolean(
        settlementRecipientRefSnapshot &&
        settlementRecipientMaskedSnapshot &&
        taxProfileRefSnapshot &&
        identityEvidenceRefSnapshot &&
        serviceAgreementVersionSnapshot &&
        serviceAgreementEvidenceRefSnapshot
      );
      await db.companionEarning.upsert({
        where: { orderId },
        create: {
          orderId,
          companionId: updated.companionId,
          grossCents: updated.amountCents,
          platformFeeBps: updated.platformFeeBps ?? 0,
          platformFeeCents: updated.platformFeeCents ?? 0,
          payableCents: updated.companionPayableCents ?? updated.amountCents,
          status: settlementSnapshotComplete ? "pending" : "held",
          holdReason: settlementSnapshotComplete ? null : "commercial_profile_snapshot_missing",
          availableAt: new Date(completedAt.getTime() + holdHours * 60 * 60_000),
          settlementRecipientRefSnapshot,
          settlementRecipientMaskedSnapshot,
          taxProfileRefSnapshot,
          identityEvidenceRefSnapshot,
          serviceAgreementVersionSnapshot,
          serviceAgreementEvidenceRefSnapshot
        },
        update: {}
      });
      await this.enqueueTransactionalNotification(db, {
        userId: updated.userId,
        type: "orderStatus",
        title: "服务已完成",
        body: "本次服务已完成；如有履约或退款问题，请在订单中提交客服工单。",
        data: { orderId, status: "completed", refundRequestDeadlineAt: refundRequestDeadlineAt.toISOString() },
        eventKey: `order:${orderId}:completed`,
        templateKey: "serviceCompleted"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.service_completed",
        resourceType: "order",
        resourceId: orderId,
        metadata: {
          completedAt: completedAt.toISOString(),
          refundRequestDeadlineAt: refundRequestDeadlineAt.toISOString(),
          earningAvailableAt: new Date(completedAt.getTime() + holdHours * 60 * 60_000).toISOString()
        }
      });
      return updated;
    }, { maxWait: 5_000, timeout: 10_000 });
    return this.toDto(updated);
  }

  async get(userId: string, orderId: string) {
    const order = await this.findOwnedOrThrow(userId, orderId);
    return this.toDto(order);
  }

  async confirmCompletion(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "completed") {
        throw new AppException("ORDER_INVALID_STATE", "Only a completed order can be confirmed", HttpStatus.CONFLICT);
      }
      if (order.customerConfirmedAt) return order;
      const blockingRefund = await db.refundTransaction.findFirst({
        where: { orderId, status: { in: ["pendingReview", "pending", "processing", "failed"] } },
        select: { id: true }
      });
      const blockingTicket = await db.supportTicket.findFirst({
        where: { orderId, status: { in: ["open", "inProgress"] } },
        select: { id: true }
      });
      if (blockingRefund || blockingTicket) {
        throw new AppException(
          "ORDER_DISPUTE_IN_PROGRESS",
          "Completion cannot be confirmed while a refund or support dispute is open",
          HttpStatus.CONFLICT
        );
      }
      const confirmedAt = new Date();
      const result = await db.order.update({
        where: { id: orderId },
        data: { customerConfirmedAt: confirmedAt }
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.customer_confirmed_completion",
        resourceType: "order",
        resourceId: orderId,
        metadata: { customerConfirmedAt: confirmedAt.toISOString() }
      });
      return result;
    });
    return this.toDto(updated);
  }

  async cancel(userId: string, orderId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Serialize with prepay and payment callbacks. A locally closed WeChat
      // prepay remains externally payable, so never cancel an order once an
      // initiated payment exists.
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          conversation: { select: { externalId: true } },
          companion: { select: { ownerUserId: true } }
        }
      });
      if (!order || order.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (!["pending", "paying"].includes(order.status)) {
        throw new AppException(
          "ORDER_INVALID_STATE",
          "Only pending or paying orders can be cancelled",
          HttpStatus.CONFLICT
        );
      }

      const activePayment = await db.paymentTransaction.findFirst({
        where: { orderId, status: "initiated" },
        select: { id: true, outTradeNo: true, createdAt: true, expiresAt: true }
      });
      if (activePayment) {
        const expiresAt = activePayment.expiresAt instanceof Date
          ? activePayment.expiresAt
          : new Date(activePayment.createdAt.getTime() + WECHAT_PREPAY_TTL_MS);
        if (expiresAt.getTime() > Date.now()) {
          throw new AppException(
            "ORDER_PAYMENT_IN_PROGRESS",
            "Order has an active WeChat payment and cannot be cancelled",
            HttpStatus.CONFLICT
          );
        }

        await this.wechat.closePayment(activePayment.outTradeNo);
        const closed = await db.paymentTransaction.updateMany({
          where: { id: activePayment.id, status: "initiated" },
          data: { status: "closed" }
        });
        if (closed.count !== 1) {
          throw new AppException(
            "PAYMENT_STATE_CHANGED",
            "Payment state changed while closing the expired prepay",
            HttpStatus.CONFLICT
          );
        }
      }

      const updated = await db.order.update({
        where: { id: orderId },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
          companionResponseDeadlineAt: null,
          paymentReservationExpiresAt: null
        },
        include: { conversation: { select: { externalId: true } } }
      });
      if (order.companion?.ownerUserId) {
        await this.enqueueTransactionalNotification(db, {
          userId: order.companion.ownerUserId,
          type: "orderStatus",
          title: "预约已取消",
          body: "客户已取消本次预约，已释放对应时段。",
          data: { orderId, status: "cancelled" },
          eventKey: `order:${orderId}:cancelled`,
          templateKey: "orderCancelled"
        });
      }
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.customer_cancelled",
        resourceType: "order",
        resourceId: orderId
      });
      return updated;
    }, { maxWait: 5_000, timeout: 10_000 });

    return this.toDto(updated);
  }

  toDto(order: OrderRecord) {
    return {
      id: order.id,
      userId: order.userId,
      companionId: order.companionId,
      themeId: order.themeId,
      durationMinutes: order.durationMinutes,
      amountCents: order.amountCents,
      amountYuan: Math.round(order.amountCents / 100),
      currency: order.currency,
      status: order.status,
      scheduledAt: (order.scheduledAt ?? order.createdAt).toISOString(),
      companionSnapshot: {
        name: order.companionNameSnapshot ?? "",
        role: order.companionRoleSnapshot ?? "",
        initials: order.companionInitialsSnapshot ?? ""
      },
      themeNameSnapshot: order.themeNameSnapshot ?? this.themeName(order.themeId),
      customer: order.user ? {
        id: order.userId,
        name: order.user.profile?.displayName ?? "用户",
        initials: (order.user.profile?.displayName ?? "用户").slice(0, 2)
      } : null,
      refund: order.refunds?.[0] ? {
        id: order.refunds[0].id,
        outRefundNo: order.refunds[0].outRefundNo,
        amountCents: order.refunds[0].amountCents,
        status: order.refunds[0].status,
        reason: order.refunds[0].reason,
        reviewNote: order.refunds[0].reviewNote,
        failureReason: order.refunds[0].failureReason
      } : null,
      conversationId: order.conversation?.externalId ?? null,
      companionConfirmedAt: order.companionConfirmedAt?.toISOString() ?? null,
      companionResponseDeadlineAt: order.companionResponseDeadlineAt?.toISOString() ?? null,
      paymentReservationExpiresAt: order.paymentReservationExpiresAt?.toISOString() ?? null,
      serviceStartedAt: order.serviceStartedAt?.toISOString() ?? null,
      platformFeeBps: order.platformFeeBps ?? 0,
      platformFeeCents: order.platformFeeCents ?? 0,
      companionPayableCents: order.companionPayableCents ?? order.amountCents,
      paidAt: order.paidAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      customerConfirmedAt: order.customerConfirmedAt?.toISOString() ?? null,
      refundRequestDeadlineAt: order.refundRequestDeadlineAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private async findOwnedOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { select: { externalId: true } }, refunds: { orderBy: { createdAt: "desc" }, take: 1 } }
    } as any);

    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    return order;
  }

  private async findServiceOrderOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { companion: { select: { ownerUserId: true } }, conversation: { select: { externalId: true } } }
    } as any);
    if (!order || order.companion.ownerUserId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    return order;
  }

  /**
   * Clears reservations that have not produced a payment.  This is safe to run
   * from every application replica: the guarded update is the ownership claim
   * and only its winner sends the customer-facing expiry notification.
   */
  async expireUnpaidReservations(limit = 100): Promise<number> {
    const now = new Date();
    const candidates: Array<{ id: string; userId: string; paymentReservationExpiresAt: Date | null }> = await this.prisma.order.findMany({
      where: {
        status: "pending",
        companionConfirmedAt: { not: null },
        paymentReservationExpiresAt: { lte: now }
      },
      select: { id: true, userId: true, paymentReservationExpiresAt: true },
      orderBy: { paymentReservationExpiresAt: "asc" },
      take: Math.min(Math.max(limit, 1), 200)
    } as any);

    let expired = 0;
    for (const candidate of candidates) {
      const released = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const changed = await db.order.updateMany({
          where: {
            id: candidate.id,
            status: "pending",
            companionConfirmedAt: { not: null },
            paymentReservationExpiresAt: { lte: now }
          },
          data: { companionConfirmedAt: null, paymentReservationExpiresAt: null }
        });
        if (changed.count !== 1) return false;
        await this.enqueueTransactionalNotification(db, {
          userId: candidate.userId,
          type: "orderStatus",
          title: "预约保留已结束",
          body: "本次预约未在保留时间内完成支付，已释放时段；如仍需要服务，请等待陪伴者再次确认。",
          data: { orderId: candidate.id, status: "pending", companionConfirmed: false },
          eventKey: `order:${candidate.id}:reservation-expired:${candidate.paymentReservationExpiresAt?.toISOString() ?? now.toISOString()}`,
          templateKey: "reservationExpired"
        });
        return true;
      });
      if (released) expired += 1;
    }
    return expired;
  }

  /**
   * An unconfirmed request is not allowed to sit indefinitely. The same
   * guarded update makes this safe across every API replica and establishes a
   * concrete companion-response SLA for commercial operation.
   */
  async expireUnconfirmedOrders(limit = 100): Promise<number> {
    const now = new Date();
    const candidates: Array<{ id: string; userId: string }> = await this.prisma.order.findMany({
      where: {
        status: "pending",
        companionConfirmedAt: null,
        companionResponseDeadlineAt: { lte: now }
      },
      select: { id: true, userId: true },
      orderBy: { companionResponseDeadlineAt: "asc" },
      take: Math.min(Math.max(limit, 1), 200)
    } as any);
    let expired = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const update = await db.order.updateMany({
          where: {
            id: candidate.id,
            status: "pending",
            companionConfirmedAt: null,
            companionResponseDeadlineAt: { lte: now }
          },
          data: {
            status: "cancelled",
            cancelledAt: now,
            companionResponseDeadlineAt: null
          }
        });
        if (update.count !== 1) return false;
        await this.enqueueTransactionalNotification(db, {
          userId: candidate.userId,
          type: "orderStatus",
          title: "预约请求已超时",
          body: "陪伴者未在响应时限内确认，本次预约已自动取消且未扣款。",
          data: { orderId: candidate.id, status: "cancelled", reason: "companion_response_timeout" },
          eventKey: `order:${candidate.id}:response-expired`,
          templateKey: "orderResponseExpired"
        });
        return true;
      });
      if (changed) expired += 1;
    }
    return expired;
  }

  private paymentReservationExpiresAt(scheduledAt: Date, now: Date): Date {
    const latestPaymentTime = scheduledAt.getTime() - 5 * 60_000;
    const reservationExpiresAt = new Date(Math.min(now.getTime() + COMPANION_PAYMENT_RESERVATION_MS, latestPaymentTime));
    if (reservationExpiresAt.getTime() <= now.getTime() + MIN_RESERVATION_PAYMENT_WINDOW_MS) {
      throw new AppException(
        "ORDER_PAYMENT_WINDOW_EXPIRED",
        "The booking is too close to its payment cutoff to reserve",
        HttpStatus.CONFLICT
      );
    }
    return reservationExpiresAt;
  }

  private async assertCompanionSlotReservable(db: any, order: any, now: Date): Promise<void> {
    const scheduledEnd = new Date(order.scheduledAt.getTime() + order.durationMinutes * 60_000);
    const candidateRefs: Array<{ id: string }> = await db.$queryRaw`
      SELECT candidate."id"
      FROM "Order" AS candidate
      WHERE candidate."companionId" = ${order.companionId}
        AND candidate."id" <> ${order.id}
        AND candidate."scheduledAt" < ${scheduledEnd}
        AND candidate."scheduledAt" + candidate."durationMinutes" * INTERVAL '1 minute' > ${order.scheduledAt}
        AND candidate."status" IN ('pending', 'paying', 'paid', 'inService', 'completed')
      ORDER BY candidate."id"
    `;

    for (const candidateRef of candidateRefs ?? []) {
      const candidateId = String(candidateRef.id);
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidateId} FOR UPDATE`;
      const candidate = await db.order.findUnique({ where: { id: candidateId } });
      if (!candidate || !["pending", "paying", "paid", "inService", "completed"].includes(candidate.status)) continue;
      if (["paying", "paid", "inService", "completed"].includes(candidate.status)) {
        this.throwCompanionSlotUnavailable();
      }
      if (!candidate.companionConfirmedAt) continue;
      if (!candidate.paymentReservationExpiresAt || candidate.paymentReservationExpiresAt.getTime() > now.getTime()) {
        this.throwCompanionSlotUnavailable();
      }
      await db.order.updateMany({
        where: {
          id: candidate.id,
          status: "pending",
          companionConfirmedAt: { not: null },
          paymentReservationExpiresAt: { lte: now }
        },
        data: { companionConfirmedAt: null, paymentReservationExpiresAt: null }
      });
    }
  }

  private throwCompanionSlotUnavailable(): never {
    throw new AppException(
      "COMPANION_SLOT_UNAVAILABLE",
      "The companion already has a reservation, payment, or service for this time slot",
      HttpStatus.CONFLICT
    );
  }

  private async enqueueTransactionalNotification(db: any, input: Parameters<NotificationsService["createTransactional"]>[1]) {
    const transactional = (this.notifications as any).createTransactional;
    if (typeof transactional === "function") {
      return transactional.call(this.notifications, db, input);
    }
    // Isolated legacy unit doubles do not model the outbox. Production always
    // receives NotificationsService and therefore takes the transactional path.
    return this.notifications.create(input.userId, input.type, input.title, input.body, input.data);
  }

  private async recordAudit(db: any, input: AuditRecordInput) {
    if (!this.audit) return;
    await this.audit.record(input, db);
  }

  private themeName(themeId: string) {
    return ({
      t1: "情绪倾听",
      t2: "职场减压",
      t3: "睡前语音",
      t4: "学习陪伴",
      t5: "运动鼓励",
      t6: "兴趣聊天"
    } as Record<string, string>)[themeId] ?? "线上沟通";
  }
}
