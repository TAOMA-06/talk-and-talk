import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppException } from "../common/errors/app.exception";
import { AuditRecordInput, AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import { VoiceRoomControlService } from "../voice/voice-room-control.service";
import {
  WECHAT_PAY_PROVIDER,
  WECHAT_PREPAY_TTL_MS,
  WeChatPayProvider
} from "../payments/wechat/wechat-pay.provider";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CreateOrderExperienceFeedbackDto } from "./dto/create-order-experience-feedback.dto";
import { CreateOrderRescheduleRequestDto } from "./dto/create-order-reschedule-request.dto";

const SERVICE_EARLY_START_MS = 15 * 60 * 1000;
export const COMPANION_PAYMENT_RESERVATION_MS = 15 * 60 * 1000;
const MIN_RESERVATION_PAYMENT_WINDOW_MS = 60 * 1000;
const STRUCTURED_AVAILABILITY_STEP_MS = 30 * 60 * 1000;
const MIN_RESCHEDULE_RESPONSE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_RESCHEDULE_RESPONSE_WINDOW_MINUTES = 12 * 60;
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const WORKBENCH_TODAY_TIMEZONE = "Asia/Shanghai";
const WORKBENCH_TODAY_ORDER_STATUSES = ["pending", "paying", "paid", "inService", "completed"] as const;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function beijingDayBounds(now: Date): { date: string; start: Date; end: Date } {
  // China has no daylight-saving transitions. Shift before reading UTC so the
  // day boundary stays deterministic even when an API host runs elsewhere.
  const beijing = new Date(now.getTime() + BEIJING_UTC_OFFSET_MS);
  const year = beijing.getUTCFullYear();
  const month = beijing.getUTCMonth();
  const day = beijing.getUTCDate();
  const start = new Date(Date.UTC(year, month, day) - BEIJING_UTC_OFFSET_MS);
  return {
    date: `${year}-${twoDigits(month + 1)}-${twoDigits(day)}`,
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000)
  };
}

type OrderRecord = {
  id: string;
  userId: string;
  companionId: string;
  serviceOfferingId?: string | null;
  serviceOfferingCodeSnapshot?: string | null;
  serviceOfferingTitleSnapshot?: string | null;
  serviceOfferingDeliveryModeSnapshot?: "text" | "voice" | null;
  serviceOfferingDurationSnapshot?: number | null;
  serviceOfferingPriceCentsSnapshot?: number | null;
  serviceOfferingCurrencySnapshot?: string | null;
  availabilityWindowId?: string | null;
  availabilityWindowStartsAtSnapshot?: Date | null;
  availabilityWindowEndsAtSnapshot?: Date | null;
  availabilityWindowCapacitySnapshot?: number | null;
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
  customerServiceGuidelinesConfirmedAt?: Date | null;
  companionServiceGuidelinesConfirmedAt?: Date | null;
  refundRequestDeadlineAt?: Date | null;
  clientRequestId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  conversation?: { externalId: string } | null;
  companion?: { ownerUserId: string | null } | null;
  user?: { profile: { displayName: string | null } | null };
  refunds?: any[];
  experienceFeedback?: {
    id: string;
    rating: number;
    tags: string[];
    note: string | null;
    createdAt: Date;
  } | null;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly wechat: WeChatPayProvider,
    @Optional() private readonly recommendations?: RecommendationsService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly moderation?: ModerationService,
    @Optional() private readonly moderationCases?: ModerationCaseService,
    @Optional() private readonly voiceRoomControl?: VoiceRoomControlService
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    const serviceOfferingId = this.normalizeServiceOfferingId(dto.serviceOfferingId);
    const availabilityWindowId = this.normalizeAvailabilityWindowId(dto.availabilityWindowId);
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
        this.assertIdempotentOrderMatches(existing, dto, serviceOfferingId, availabilityWindowId);
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
    const requestedDurationMinutes = dto.durationMinutes;
    if (requestedDurationMinutes % 30 !== 0) {
      throw new AppException(
        "INVALID_DURATION",
        "durationMinutes must be a multiple of 30",
        HttpStatus.BAD_REQUEST
      );
    }

    const recommendationImpressionId = dto.recommendationImpressionId
      ? await this.validateRecommendationAttribution(userId, dto.recommendationImpressionId, dto.companionId)
      : null;

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
          this.assertIdempotentOrderMatches(duplicate, dto, serviceOfferingId, availabilityWindowId);
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
      const serviceOffering = serviceOfferingId
        ? await this.lockActiveServiceOffering(db, {
          serviceOfferingId,
          companionId: companion.id,
          requestedDurationMinutes,
          themeId: dto.themeId
        })
        : null;
      this.assertVoiceDeliveryModeEnabled(serviceOffering?.deliveryMode);
      const durationMinutes = serviceOffering?.durationMinutes ?? requestedDurationMinutes;
      const availabilityWindow = availabilityWindowId
        ? await this.lockActiveAvailabilityWindow(db, {
          availabilityWindowId,
          companionId: companion.id,
          scheduledAt,
          durationMinutes
        })
        : null;
      if (availabilityWindow) {
        await this.assertStructuredAvailabilityCapacity(db, {
          companionId: companion.id,
          scheduledAt,
          durationMinutes,
          availabilityWindow,
          excludeOrderId: null
        }, new Date(now));
      }
      const amountCents = serviceOffering?.priceCents
        ?? companion.pricePerHalfHour * Math.max(1, Math.ceil(durationMinutes / 30)) * 100;
      const currency = serviceOffering?.currency ?? "CNY";
      const platformFeeCents = Math.floor(amountCents * platformFeeBps / 10_000);
      const companionPayableCents = amountCents - platformFeeCents;
      const created = await db.order.create({
        data: {
          userId,
          companionId: companion.id,
          serviceOfferingId,
          serviceOfferingCodeSnapshot: serviceOffering?.code ?? null,
          serviceOfferingTitleSnapshot: serviceOffering?.title ?? null,
          serviceOfferingDeliveryModeSnapshot: serviceOffering?.deliveryMode ?? null,
          serviceOfferingDurationSnapshot: serviceOffering?.durationMinutes ?? null,
          serviceOfferingPriceCentsSnapshot: serviceOffering?.priceCents ?? null,
          serviceOfferingCurrencySnapshot: serviceOffering?.currency ?? null,
          availabilityWindowId,
          availabilityWindowStartsAtSnapshot: availabilityWindow?.startsAt ?? null,
          availabilityWindowEndsAtSnapshot: availabilityWindow?.endsAt ?? null,
          availabilityWindowCapacitySnapshot: availabilityWindow?.capacity ?? null,
          themeId: dto.themeId,
          durationMinutes,
          amountCents,
          currency,
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
      await db.orderTimelineEvent.create({
        data: {
          orderId: created.id,
          type: "orderCreated",
          actorId: userId,
          actorRole: "customer",
          // Timeline payloads stay intentionally compact. The public DTO does
          // not expose arbitrary metadata; participants get their schedule
          // from the order itself and linked reschedule requests when present.
          payload: { scheduledAt: scheduledAt.toISOString() }
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
          serviceOfferingId,
          availabilityWindowId,
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

  private assertIdempotentOrderMatches(
    existing: any,
    dto: CreateOrderDto,
    serviceOfferingId: string | null,
    availabilityWindowId: string | null
  ): void {
    if (
      existing.companionId !== dto.companionId ||
      (existing.serviceOfferingId ?? null) !== serviceOfferingId ||
      (existing.availabilityWindowId ?? null) !== availabilityWindowId ||
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

  private normalizeServiceOfferingId(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    if (!normalized) {
      throw new AppException(
        "INVALID_SERVICE_OFFERING",
        "serviceOfferingId cannot be blank",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private normalizeAvailabilityWindowId(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    if (!normalized) {
      throw new AppException(
        "INVALID_AVAILABILITY_WINDOW",
        "availabilityWindowId cannot be blank",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private async lockActiveServiceOffering(
    db: any,
    input: {
      serviceOfferingId: string;
      companionId: string;
      requestedDurationMinutes: number;
      themeId: string;
    }
  ) {
    await db.$queryRaw`
      SELECT "id" FROM "CompanionServiceOffering"
      WHERE "id" = ${input.serviceOfferingId} AND "companionId" = ${input.companionId}
      FOR UPDATE
    `;
    const offering = await db.companionServiceOffering.findFirst({
      where: {
        id: input.serviceOfferingId,
        companionId: input.companionId,
        isActive: true
      }
    });
    if (!offering) {
      throw new AppException(
        "SERVICE_OFFERING_UNAVAILABLE",
        "This service offering is no longer available",
        HttpStatus.CONFLICT
      );
    }
    if (offering.durationMinutes !== input.requestedDurationMinutes) {
      throw new AppException(
        "SERVICE_OFFERING_DURATION_MISMATCH",
        "Requested duration does not match the selected service offering",
        HttpStatus.CONFLICT,
        { expectedDurationMinutes: offering.durationMinutes }
      );
    }
    if (offering.topicIds.length > 0 && !offering.topicIds.includes(input.themeId)) {
      throw new AppException(
        "SERVICE_OFFERING_THEME_UNSUPPORTED",
        "Selected service offering does not support this topic",
        HttpStatus.CONFLICT
      );
    }
    if (offering.currency !== "CNY") {
      throw new AppException(
        "SERVICE_OFFERING_CURRENCY_UNSUPPORTED",
        "Only CNY service offerings are currently supported",
        HttpStatus.CONFLICT
      );
    }
    return offering;
  }

  assertVoiceOrderFeatureEnabled(order: { serviceOfferingDeliveryModeSnapshot?: unknown } | null | undefined): void {
    this.assertVoiceDeliveryModeEnabled(order?.serviceOfferingDeliveryModeSnapshot);
  }

  private assertVoiceDeliveryModeEnabled(deliveryMode: unknown): void {
    if (deliveryMode !== "voice") return;
    if (this.config?.get<boolean>("TRTC_ENABLED", false) !== true) {
      throw new AppException(
        "VOICE_FEATURE_DISABLED",
        "Real-time voice is not configured for this environment",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    if (this.config?.get<boolean>("TRTC_EMERGENCY_STOP_ENABLED", false) === true) {
      throw new AppException(
        "VOICE_FEATURE_EMERGENCY_STOP",
        "Real-time voice is temporarily unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private async lockActiveAvailabilityWindow(
    db: any,
    input: {
      availabilityWindowId: string;
      companionId: string;
      scheduledAt: Date;
      durationMinutes: number;
    }
  ) {
    await db.$queryRaw`
      SELECT "id" FROM "CompanionAvailabilityWindow"
      WHERE "id" = ${input.availabilityWindowId} AND "companionId" = ${input.companionId}
      FOR UPDATE
    `;
    const window = await db.companionAvailabilityWindow.findFirst({
      where: {
        id: input.availabilityWindowId,
        companionId: input.companionId,
        isActive: true
      }
    });
    if (!window) {
      throw new AppException(
        "AVAILABILITY_WINDOW_UNAVAILABLE",
        "The selected availability window is no longer available",
        HttpStatus.CONFLICT
      );
    }

    const scheduledAtMs = input.scheduledAt.getTime();
    const scheduledEnd = new Date(scheduledAtMs + input.durationMinutes * 60_000);
    if (
      scheduledAtMs % STRUCTURED_AVAILABILITY_STEP_MS !== 0 ||
      scheduledAtMs < window.startsAt.getTime() ||
      scheduledEnd.getTime() > window.endsAt.getTime()
    ) {
      throw new AppException(
        "AVAILABILITY_SLOT_INVALID",
        "The requested time is not a bookable candidate in this availability window",
        HttpStatus.CONFLICT,
        {
          availabilityWindowId: input.availabilityWindowId,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
          durationMinutes: input.durationMinutes
        }
      );
    }
    return window;
  }

  private async assertStructuredAvailabilityCapacity(
    db: any,
    input: {
      companionId: string;
      scheduledAt: Date;
      durationMinutes: number;
      availabilityWindow: { id: string; capacity: number };
      excludeOrderId: string | null;
    },
    now: Date
  ): Promise<void> {
    await this.assertSlotCapacity(db, {
      companionId: input.companionId,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      capacity: input.availabilityWindow.capacity,
      availabilityWindowId: input.availabilityWindow.id,
      excludeOrderId: input.excludeOrderId
    }, now);
  }

  private async assertSlotCapacity(
    db: any,
    input: {
      companionId: string;
      scheduledAt: Date;
      durationMinutes: number;
      capacity: number;
      availabilityWindowId: string | null;
      excludeOrderId: string | null;
    },
    now: Date
  ): Promise<void> {
    const scheduledEnd = new Date(input.scheduledAt.getTime() + input.durationMinutes * 60_000);
    const excludeOrderId = input.excludeOrderId ?? "";
    const candidateRefs: Array<{ id: string }> = await db.$queryRaw`
      SELECT candidate."id"
      FROM "Order" AS candidate
      WHERE candidate."companionId" = ${input.companionId}
        AND candidate."id" <> ${excludeOrderId}
        AND candidate."scheduledAt" < ${scheduledEnd}
        AND candidate."scheduledAt" + candidate."durationMinutes" * INTERVAL '1 minute' > ${input.scheduledAt}
        AND candidate."status" IN ('pending', 'paying', 'paid', 'inService', 'completed')
      ORDER BY candidate."id"
    `;

    let reservedCount = 0;
    for (const candidateRef of candidateRefs ?? []) {
      const candidateId = String(candidateRef.id);
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidateId} FOR UPDATE`;
      const candidate = await db.order.findUnique({ where: { id: candidateId } });
      if (!candidate || !["pending", "paying", "paid", "inService", "completed"].includes(candidate.status)) continue;
      if (["paying", "paid", "inService", "completed"].includes(candidate.status)) {
        reservedCount += 1;
        continue;
      }
      if (!candidate.companionConfirmedAt) continue;
      if (!candidate.paymentReservationExpiresAt || candidate.paymentReservationExpiresAt.getTime() > now.getTime()) {
        reservedCount += 1;
        continue;
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

    if (reservedCount >= input.capacity) {
      this.throwCompanionSlotUnavailable({
        availabilityWindowId: input.availabilityWindowId,
        capacity: input.capacity,
        reservedCount
      });
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
      include: {
        conversation: { select: { externalId: true } },
        refunds: { orderBy: { createdAt: "desc" }, take: 1 },
        experienceFeedback: true
      },
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

  async listTodayForCompanion(userId: string, now = new Date()) {
    const companion = await this.findEligibleCompanionForWorkbench(userId);
    const day = beijingDayBounds(now);
    const [orders, pendingConfirmationCount] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          companionId: companion.id,
          status: { in: WORKBENCH_TODAY_ORDER_STATUSES },
          scheduledAt: { gte: day.start, lt: day.end }
        },
        // This workbench feed is intentionally narrower than /orders/service.
        // It must not carry customer, conversation, refund, settlement or
        // internal order fields into a day-planning surface.
        select: {
          id: true,
          scheduledAt: true,
          durationMinutes: true,
          status: true,
          serviceOfferingTitleSnapshot: true,
          themeNameSnapshot: true
        },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]
      } as any),
      this.prisma.order.count({
        where: {
          companionId: companion.id,
          status: "pending",
          companionConfirmedAt: null
        }
      } as any)
    ]);

    return {
      date: day.date,
      timezone: WORKBENCH_TODAY_TIMEZONE,
      pendingConfirmationCount,
      items: (orders as Array<{
        id: string;
        scheduledAt: Date;
        durationMinutes: number;
        status: string;
        serviceOfferingTitleSnapshot: string | null;
        themeNameSnapshot: string | null;
      }>).map((order) => ({
        id: order.id,
        scheduledAt: order.scheduledAt.toISOString(),
        durationMinutes: order.durationMinutes,
        status: order.status,
        serviceTitle: order.serviceOfferingTitleSnapshot || order.themeNameSnapshot || "陪伴服务"
      }))
    };
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
      this.assertVoiceOrderFeatureEnabled(order);
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
      await this.cancelPendingRescheduleRequest(db, {
        order,
        actorId: userId,
        actorRole: "companion",
        reason: "service_started"
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
      this.assertVoiceOrderFeatureEnabled(order);
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
        (!order.availabilityWindowId && (order.companion.availableTimes?.length ?? 0) === 0) ||
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
      await this.cancelPendingRescheduleRequest(db, {
        order,
        actorId: userId,
        actorRole: "companion",
        reason: "order_rejected"
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
      // Normal flows close a pending reschedule when service starts. Keep this
      // completion-time guard for orders created before that rule, manual data
      // repair, or an exceptional state transition that left a stale proposal.
      await this.cancelPendingRescheduleRequest(db, {
        order,
        actorId: userId,
        actorRole: "companion",
        reason: "service_completed"
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
    await this.voiceRoomControl?.terminateForOrder(orderId, "service_completed");
    return this.toDto(updated);
  }

  async get(userId: string, orderId: string) {
    const order = await this.findOwnedOrThrow(userId, orderId);
    return this.toDto(order);
  }

  /**
   * A participant-facing activity feed. This is separate from AuditLog so
   * customer and companion clients never receive staff-only evidence,
   * moderation details, or settlement metadata.
   */
  async timeline(userId: string, orderId: string) {
    await this.findOrderParticipantOrThrow(userId, orderId);
    const events = await (this.prisma as any).orderTimelineEvent.findMany({
      where: { orderId },
      include: { rescheduleRequest: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return { orderId, items: events.map((event: any) => this.toTimelineDto(event)) };
  }

  /**
   * Records a proposal without touching the booked appointment.  Both parties
   * can initiate it, but a pending proposal is unique per order and is only a
   * capacity-checked suggestion until the other party accepts it later.
   */
  async requestReschedule(userId: string, orderId: string, dto: CreateOrderRescheduleRequestDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order: any = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { select: { ownerUserId: true } },
          refunds: {
            where: { status: { in: ["pendingReview", "pending", "processing", "failed"] } },
            select: { id: true },
            take: 1
          }
        }
      });
      if (!order || (order.userId !== userId && order.companion?.ownerUserId !== userId)) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }

      const now = new Date();
      this.assertRescheduleEligible(order, now);
      const requestedScheduledAt = this.parseRescheduleRequestedAt(dto.requestedScheduledAt, now);
      if (requestedScheduledAt.getTime() === order.scheduledAt.getTime()) {
        throw new AppException(
          "RESCHEDULE_SCHEDULE_UNCHANGED",
          "The requested appointment time is the same as the current appointment",
          HttpStatus.CONFLICT
        );
      }
      const availabilityWindowId = this.normalizeAvailabilityWindowId(dto.availabilityWindowId);
      const hasStructuredAvailability = Boolean(
        order.availabilityWindowId ||
        order.availabilityWindowStartsAtSnapshot ||
        order.availabilityWindowEndsAtSnapshot
      );
      if (hasStructuredAvailability && !availabilityWindowId) {
        throw new AppException(
          "RESCHEDULE_AVAILABILITY_REQUIRED",
          "A new structured availability window is required for this appointment",
          HttpStatus.UNPROCESSABLE_ENTITY
        );
      }

      const existing = await db.orderRescheduleRequest.findFirst({
        where: { orderId, status: "pending" },
        orderBy: { createdAt: "asc" }
      });
      if (existing) {
        if (existing.expiresAt.getTime() > now.getTime()) {
          throw new AppException(
            "RESCHEDULE_REQUEST_PENDING",
            "This order already has a reschedule request awaiting a response",
            HttpStatus.CONFLICT,
            { expiresAt: existing.expiresAt.toISOString() }
          );
        }
        const expired = await db.orderRescheduleRequest.update({
          where: { id: existing.id },
          data: { status: "expired", respondedAt: now }
        });
        await db.orderTimelineEvent.create({
          data: {
            orderId,
            type: "rescheduleExpired",
            actorId: null,
            actorRole: "system",
            rescheduleRequestId: expired.id
          }
        });
      }

      let availabilityWindow: any = null;
      if (availabilityWindowId) {
        availabilityWindow = await this.lockActiveAvailabilityWindow(db, {
          availabilityWindowId,
          companionId: order.companionId,
          scheduledAt: requestedScheduledAt,
          durationMinutes: order.durationMinutes
        });
        // The current appointment remains in place while this is merely a
        // proposal, but it will be released in the later atomic acceptance
        // transaction. Excluding it here avoids rejecting a valid adjacent or
        // overlapping move solely because of the same order's old slot.
        await this.assertStructuredAvailabilityCapacity(db, {
          companionId: order.companionId,
          scheduledAt: requestedScheduledAt,
          durationMinutes: order.durationMinutes,
          availabilityWindow,
          excludeOrderId: order.id
        }, now);
      } else {
        // Legacy appointments still cannot propose a time that overlaps a
        // paid, reserved, active, or completed appointment for the companion.
        await this.assertSlotCapacity(db, {
          companionId: order.companionId,
          scheduledAt: requestedScheduledAt,
          durationMinutes: order.durationMinutes,
          capacity: 1,
          availabilityWindowId: null,
          excludeOrderId: order.id
        }, now);
      }

      const requesterRole = order.userId === userId ? "customer" : "companion";
      const recipientUserId = requesterRole === "customer" ? order.companion?.ownerUserId : order.userId;
      if (!recipientUserId) {
        throw new AppException(
          "ORDER_PARTICIPANT_UNAVAILABLE",
          "The other order participant is no longer available for a reschedule request",
          HttpStatus.CONFLICT
        );
      }
      const expiresAt = this.rescheduleRequestExpiresAt(order, now);
      const created = await db.orderRescheduleRequest.create({
        data: {
          orderId,
          requestedByUserId: userId,
          requestedByRole: requesterRole,
          originalScheduledAt: order.scheduledAt,
          requestedScheduledAt,
          requestedAvailabilityWindowId: availabilityWindow?.id ?? null,
          requestedAvailabilityWindowStartsAtSnapshot: availabilityWindow?.startsAt ?? null,
          requestedAvailabilityWindowEndsAtSnapshot: availabilityWindow?.endsAt ?? null,
          requestedAvailabilityWindowCapacitySnapshot: availabilityWindow?.capacity ?? null,
          status: "pending",
          expiresAt
        }
      });
      await db.orderTimelineEvent.create({
        data: {
          orderId,
          type: "rescheduleRequested",
          actorId: userId,
          actorRole: requesterRole,
          rescheduleRequestId: created.id
        }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: recipientUserId,
        type: "orderStatus",
        title: "有新的改期请求",
        body: requesterRole === "customer"
          ? "客户希望调整本次预约时间，请在订单页查看并处理。"
          : "陪伴者希望调整本次预约时间，请在订单页查看并处理。",
        data: {
          orderId,
          rescheduleRequestId: created.id,
          status: "pending",
          expiresAt: expiresAt.toISOString()
        },
        eventKey: `order:${orderId}:reschedule:${created.id}:requested`,
        templateKey: "rescheduleRequested"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.reschedule_requested",
        resourceType: "orderRescheduleRequest",
        resourceId: created.id,
        metadata: {
          orderId,
          requesterRole,
          originalScheduledAt: order.scheduledAt.toISOString(),
          requestedScheduledAt: requestedScheduledAt.toISOString(),
          requestedAvailabilityWindowId: availabilityWindow?.id ?? null,
          expiresAt: expiresAt.toISOString()
        }
      });
      return created;
    }, { maxWait: 5_000, timeout: 10_000 });
    return this.toRescheduleRequestDto(result);
  }

  /**
   * Accepting a proposal is the only path in this service that changes the
   * booked appointment. All mutable inputs are re-read under locks: the
   * proposal snapshot proves intent, while the live availability window and
   * capacity check prove that accepting it is still safe right now.
   */
  async acceptReschedule(userId: string, orderId: string, requestId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "OrderRescheduleRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const order: any = await db.order.findUnique({
        where: { id: orderId },
        include: {
          companion: { select: { ownerUserId: true } },
          refunds: {
            where: { status: { in: ["pendingReview", "pending", "processing", "failed"] } },
            select: { id: true },
            take: 1
          }
        }
      });
      if (!order || (order.userId !== userId && order.companion?.ownerUserId !== userId)) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      const request = await db.orderRescheduleRequest.findUnique({ where: { id: requestId } });
      if (!request || request.orderId !== orderId) {
        throw new AppException("RESCHEDULE_REQUEST_NOT_FOUND", "Reschedule request not found", HttpStatus.NOT_FOUND);
      }
      if (request.requestedByUserId === userId) {
        throw new AppException(
          "RESCHEDULE_REQUEST_SELF_RESPONSE_FORBIDDEN",
          "The participant who proposed a reschedule cannot accept it",
          HttpStatus.FORBIDDEN
        );
      }
      if (request.status !== "pending") {
        throw new AppException(
          "RESCHEDULE_REQUEST_INVALID_STATE",
          "Only a pending reschedule request can be accepted",
          HttpStatus.CONFLICT,
          { status: request.status }
        );
      }

      const now = new Date();
      if (
        request.expiresAt.getTime() <= now.getTime() ||
        order.scheduledAt.getTime() !== request.originalScheduledAt.getTime()
      ) {
        const expired = await db.orderRescheduleRequest.update({
          where: { id: request.id },
          data: { status: "expired", respondedAt: now }
        });
        await db.orderTimelineEvent.create({
          data: {
            orderId,
            type: "rescheduleExpired",
            actorId: null,
            actorRole: "system",
            rescheduleRequestId: expired.id
          }
        });
        throw new AppException(
          "RESCHEDULE_REQUEST_EXPIRED",
          "This reschedule request is no longer valid",
          HttpStatus.CONFLICT
        );
      }
      this.assertRescheduleEligible(order, now);
      const hasStructuredAvailability = Boolean(
        order.availabilityWindowId ||
        order.availabilityWindowStartsAtSnapshot ||
        order.availabilityWindowEndsAtSnapshot
      );
      if (hasStructuredAvailability && !request.requestedAvailabilityWindowId) {
        throw new AppException(
          "RESCHEDULE_REQUEST_AVAILABILITY_MISSING",
          "A structured reschedule request must retain its candidate availability window",
          HttpStatus.CONFLICT
        );
      }

      let availabilityWindow: any = null;
      if (request.requestedAvailabilityWindowId) {
        availabilityWindow = await this.lockActiveAvailabilityWindow(db, {
          availabilityWindowId: request.requestedAvailabilityWindowId,
          companionId: order.companionId,
          scheduledAt: request.requestedScheduledAt,
          durationMinutes: order.durationMinutes
        });
        await this.assertStructuredAvailabilityCapacity(db, {
          companionId: order.companionId,
          scheduledAt: request.requestedScheduledAt,
          durationMinutes: order.durationMinutes,
          availabilityWindow,
          excludeOrderId: order.id
        }, now);
      } else {
        await this.assertSlotCapacity(db, {
          companionId: order.companionId,
          scheduledAt: request.requestedScheduledAt,
          durationMinutes: order.durationMinutes,
          capacity: 1,
          availabilityWindowId: null,
          excludeOrderId: order.id
        }, now);
      }

      const responderRole = order.userId === userId ? "customer" : "companion";
      const updatedOrder = await db.order.update({
        where: { id: orderId },
        data: {
          scheduledAt: request.requestedScheduledAt,
          availabilityWindowId: availabilityWindow?.id ?? null,
          availabilityWindowStartsAtSnapshot: availabilityWindow?.startsAt ?? null,
          availabilityWindowEndsAtSnapshot: availabilityWindow?.endsAt ?? null,
          availabilityWindowCapacitySnapshot: availabilityWindow?.capacity ?? null
        },
        include: { conversation: { select: { externalId: true } }, refunds: { orderBy: { createdAt: "desc" }, take: 1 } }
      });
      const accepted = await db.orderRescheduleRequest.update({
        where: { id: request.id },
        data: { status: "accepted", respondedAt: now, respondedByUserId: userId }
      });
      await db.orderTimelineEvent.create({
        data: {
          orderId,
          type: "rescheduleAccepted",
          actorId: userId,
          actorRole: responderRole,
          rescheduleRequestId: accepted.id
        }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: request.requestedByUserId,
        type: "orderStatus",
        title: "改期请求已接受",
        body: "预约时间已更新，请在订单页查看新的服务时间。",
        data: {
          orderId,
          rescheduleRequestId: accepted.id,
          status: "accepted",
          scheduledAt: request.requestedScheduledAt.toISOString()
        },
        eventKey: `order:${orderId}:reschedule:${accepted.id}:accepted`,
        templateKey: "rescheduleAccepted"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.reschedule_accepted",
        resourceType: "orderRescheduleRequest",
        resourceId: accepted.id,
        metadata: {
          orderId,
          requesterRole: request.requestedByRole,
          responderRole,
          originalScheduledAt: request.originalScheduledAt.toISOString(),
          requestedScheduledAt: request.requestedScheduledAt.toISOString(),
          requestedAvailabilityWindowId: availabilityWindow?.id ?? null
        }
      });
      return { accepted, order: updatedOrder };
    }, { maxWait: 5_000, timeout: 10_000 });
    return { rescheduleRequest: this.toRescheduleRequestDto(result.accepted), order: this.toDto(result.order) };
  }

  async rejectReschedule(userId: string, orderId: string, requestId: string) {
    const rejected = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "OrderRescheduleRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const order: any = await db.order.findUnique({
        where: { id: orderId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!order || (order.userId !== userId && order.companion?.ownerUserId !== userId)) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      const request = await db.orderRescheduleRequest.findUnique({ where: { id: requestId } });
      if (!request || request.orderId !== orderId) {
        throw new AppException("RESCHEDULE_REQUEST_NOT_FOUND", "Reschedule request not found", HttpStatus.NOT_FOUND);
      }
      if (request.requestedByUserId === userId) {
        throw new AppException(
          "RESCHEDULE_REQUEST_SELF_RESPONSE_FORBIDDEN",
          "The participant who proposed a reschedule cannot reject it",
          HttpStatus.FORBIDDEN
        );
      }
      if (request.status !== "pending") {
        throw new AppException(
          "RESCHEDULE_REQUEST_INVALID_STATE",
          "Only a pending reschedule request can be rejected",
          HttpStatus.CONFLICT,
          { status: request.status }
        );
      }

      const now = new Date();
      if (
        request.expiresAt.getTime() <= now.getTime() ||
        order.scheduledAt.getTime() !== request.originalScheduledAt.getTime()
      ) {
        const expired = await db.orderRescheduleRequest.update({
          where: { id: request.id },
          data: { status: "expired", respondedAt: now }
        });
        await db.orderTimelineEvent.create({
          data: {
            orderId,
            type: "rescheduleExpired",
            actorId: null,
            actorRole: "system",
            rescheduleRequestId: expired.id
          }
        });
        throw new AppException(
          "RESCHEDULE_REQUEST_EXPIRED",
          "This reschedule request is no longer valid",
          HttpStatus.CONFLICT
        );
      }

      const responderRole = order.userId === userId ? "customer" : "companion";
      const resolved = await db.orderRescheduleRequest.update({
        where: { id: request.id },
        data: { status: "rejected", respondedAt: now, respondedByUserId: userId }
      });
      await db.orderTimelineEvent.create({
        data: {
          orderId,
          type: "rescheduleRejected",
          actorId: userId,
          actorRole: responderRole,
          rescheduleRequestId: resolved.id
        }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: request.requestedByUserId,
        type: "orderStatus",
        title: "改期请求已被拒绝",
        body: "对方暂时无法接受此次改期，原预约时间保持不变。",
        data: {
          orderId,
          rescheduleRequestId: resolved.id,
          status: "rejected",
          scheduledAt: order.scheduledAt.toISOString()
        },
        eventKey: `order:${orderId}:reschedule:${resolved.id}:rejected`,
        templateKey: "rescheduleRejected"
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.reschedule_rejected",
        resourceType: "orderRescheduleRequest",
        resourceId: resolved.id,
        metadata: {
          orderId,
          requesterRole: request.requestedByRole,
          responderRole,
          originalScheduledAt: request.originalScheduledAt.toISOString(),
          requestedScheduledAt: request.requestedScheduledAt.toISOString(),
          requestedAvailabilityWindowId: request.requestedAvailabilityWindowId
        }
      });
      return resolved;
    }, { maxWait: 5_000, timeout: 10_000 });
    return this.toRescheduleRequestDto(rejected);
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

  async confirmServiceGuidelines(userId: string, orderId: string) {
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
      if (!order) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      const actorRole = order.userId === userId
        ? "customer"
        : order.companion?.ownerUserId === userId
          ? "companion"
          : null;
      if (!actorRole) {
        // Match the rest of the order API: nonparticipants do not learn that
        // a particular order exists.
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "paid" || order.serviceStartedAt) {
        throw new AppException(
          "ORDER_SERVICE_GUIDELINES_INVALID_STATE",
          "Service guidelines can only be confirmed for a paid order before service starts",
          HttpStatus.CONFLICT
        );
      }
      const alreadyConfirmedAt = actorRole === "customer"
        ? order.customerServiceGuidelinesConfirmedAt
        : order.companionServiceGuidelinesConfirmedAt;
      // A successfully persisted acknowledgement stays idempotent even if a
      // refund starts before a client can retry a lost response. This returns
      // the existing fact; it never creates a new acknowledgement mid-refund.
      if (alreadyConfirmedAt) return order;

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
          "Service guidelines cannot be confirmed while a refund request is active",
          HttpStatus.CONFLICT
        );
      }
      const confirmedAt = new Date();
      const updated = await db.order.update({
        where: { id: orderId },
        data: actorRole === "customer"
          ? { customerServiceGuidelinesConfirmedAt: confirmedAt }
          : { companionServiceGuidelinesConfirmedAt: confirmedAt },
        include: { conversation: { select: { externalId: true } } }
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: `order.${actorRole}_confirmed_service_guidelines`,
        resourceType: "order",
        resourceId: orderId,
        metadata: { actorRole, confirmedAt: confirmedAt.toISOString() }
      });
      return updated;
    }, { maxWait: 5_000, timeout: 10_000 });

    return this.toDto(updated);
  }

  async submitExperienceFeedback(userId: string, orderId: string, dto: CreateOrderExperienceFeedbackDto) {
    const initialOrder = await this.findOwnedOrThrow(userId, orderId);
    if (initialOrder.status !== "completed") {
      throw new AppException(
        "ORDER_FEEDBACK_INVALID_STATE",
        "Experience feedback can only be submitted for a completed order",
        HttpStatus.CONFLICT
      );
    }
    if (initialOrder.experienceFeedback) return this.toDto(initialOrder);

    const tags = [...new Set(dto.tags ?? [])].sort();
    const note = dto.note?.trim() || null;
    if (note) await this.assertExperienceFeedbackNoteAllowed(userId, orderId, note);

    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          conversation: { select: { externalId: true } },
          experienceFeedback: true
        }
      });
      if (!order || order.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (order.status !== "completed") {
        throw new AppException(
          "ORDER_FEEDBACK_INVALID_STATE",
          "Experience feedback can only be submitted for a completed order",
          HttpStatus.CONFLICT
        );
      }
      // The order row lock serializes concurrent taps/retries. Returning the
      // original record makes a lost success response safe without allowing an
      // edited second submission.
      if (order.experienceFeedback) return order;

      const experienceFeedback = await db.orderExperienceFeedback.create({
        data: { orderId, rating: dto.rating, tags, note }
      });
      await this.recordAudit(db, {
        actorId: userId,
        action: "order.customer_submitted_experience_feedback",
        resourceType: "orderExperienceFeedback",
        resourceId: experienceFeedback.id,
        metadata: { orderId, rating: dto.rating, tags, hasNote: Boolean(note) }
      });
      return { ...order, experienceFeedback };
    }, { maxWait: 5_000, timeout: 10_000 });

    return this.toDto(updated);
  }

  private async assertExperienceFeedbackNoteAllowed(userId: string, orderId: string, note: string): Promise<void> {
    if (!this.moderation || !this.moderationCases) {
      throw new AppException(
        "CONTENT_MODERATION_UNAVAILABLE",
        "Feedback note review is temporarily unavailable; retry without changing your content",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const moderation = await this.moderation.moderateAsync(note, "profile");
    if (moderation.decision === "allow") return;
    const moderationCase = await this.moderationCases.createFromResult({
      result: moderation,
      source: "profile",
      content: note,
      targetId: orderId,
      subjectUserId: userId,
      actorId: userId,
      title: "服务反馈内容待处理",
      forceCreate: true
    });
    throw new AppException(
      "ORDER_FEEDBACK_NOTE_REQUIRES_REVISION",
      "Feedback note cannot be submitted; revise it and try again",
      HttpStatus.UNPROCESSABLE_ENTITY,
      { moderationCaseId: moderationCase?.id ?? null, decision: moderation.decision }
    );
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
      await this.cancelPendingRescheduleRequest(db, {
        order,
        actorId: userId,
        actorRole: "customer",
        reason: "order_cancelled"
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
      serviceOfferingId: order.serviceOfferingId ?? null,
      serviceOfferingSnapshot: order.serviceOfferingId || order.serviceOfferingTitleSnapshot ? {
        id: order.serviceOfferingId ?? null,
        code: order.serviceOfferingCodeSnapshot ?? "",
        title: order.serviceOfferingTitleSnapshot ?? "",
        deliveryMode: order.serviceOfferingDeliveryModeSnapshot ?? null,
        durationMinutes: order.serviceOfferingDurationSnapshot ?? order.durationMinutes,
        priceCents: order.serviceOfferingPriceCentsSnapshot ?? order.amountCents,
        currency: order.serviceOfferingCurrencySnapshot ?? order.currency
      } : null,
      availabilityWindowId: order.availabilityWindowId ?? null,
      availabilitySnapshot: order.availabilityWindowId || order.availabilityWindowStartsAtSnapshot ? {
        availabilityWindowId: order.availabilityWindowId ?? null,
        startsAt: order.availabilityWindowStartsAtSnapshot?.toISOString() ?? null,
        endsAt: order.availabilityWindowEndsAtSnapshot?.toISOString() ?? null,
        capacity: order.availabilityWindowCapacitySnapshot ?? null
      } : null,
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
      experienceFeedback: order.experienceFeedback ? {
        id: order.experienceFeedback.id,
        rating: order.experienceFeedback.rating,
        tags: order.experienceFeedback.tags,
        note: order.experienceFeedback.note,
        createdAt: order.experienceFeedback.createdAt.toISOString()
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
      customerServiceGuidelinesConfirmedAt: order.customerServiceGuidelinesConfirmedAt?.toISOString() ?? null,
      companionServiceGuidelinesConfirmedAt: order.companionServiceGuidelinesConfirmedAt?.toISOString() ?? null,
      refundRequestDeadlineAt: order.refundRequestDeadlineAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private toTimelineDto(event: any) {
    const request = event.rescheduleRequest;
    return {
      id: event.id,
      type: event.type,
      actorRole: event.actorRole,
      occurredAt: event.createdAt.toISOString(),
      rescheduleRequest: request ? this.toRescheduleRequestDto(request) : null
    };
  }

  private toRescheduleRequestDto(request: any) {
    return {
      id: request.id,
      requestedByRole: request.requestedByRole,
      originalScheduledAt: request.originalScheduledAt.toISOString(),
      requestedScheduledAt: request.requestedScheduledAt.toISOString(),
      requestedAvailabilitySnapshot: request.requestedAvailabilityWindowId ? {
        availabilityWindowId: request.requestedAvailabilityWindowId,
        startsAt: request.requestedAvailabilityWindowStartsAtSnapshot?.toISOString() ?? null,
        endsAt: request.requestedAvailabilityWindowEndsAtSnapshot?.toISOString() ?? null,
        capacity: request.requestedAvailabilityWindowCapacitySnapshot ?? null
      } : null,
      status: request.status,
      expiresAt: request.expiresAt.toISOString(),
      respondedAt: request.respondedAt?.toISOString() ?? null
    };
  }

  private assertRescheduleEligible(order: any, now: Date): void {
    const isUnconfirmedPending = order.status === "pending" && !order.companionConfirmedAt;
    if (!isUnconfirmedPending && order.status !== "paid") {
      throw new AppException(
        "RESCHEDULE_ORDER_INVALID_STATE",
        "Only an unconfirmed pending or paid order can be rescheduled",
        HttpStatus.CONFLICT
      );
    }
    if (isUnconfirmedPending && order.companionResponseDeadlineAt?.getTime() <= now.getTime()) {
      throw new AppException(
        "ORDER_RESPONSE_WINDOW_EXPIRED",
        "This booking request has reached its companion response deadline",
        HttpStatus.CONFLICT
      );
    }
    if (order.refunds?.length) {
      throw new AppException(
        "ORDER_REFUND_IN_PROGRESS",
        "An order with an active refund cannot be rescheduled",
        HttpStatus.CONFLICT
      );
    }
  }

  private parseRescheduleRequestedAt(value: string, now: Date): Date {
    const requestedScheduledAt = new Date(value);
    if (Number.isNaN(requestedScheduledAt.getTime())) {
      throw new AppException(
        "RESCHEDULE_SCHEDULE_INVALID",
        "requestedScheduledAt must be a valid ISO date-time",
        HttpStatus.BAD_REQUEST
      );
    }
    if (requestedScheduledAt.getTime() <= now.getTime() + SERVICE_EARLY_START_MS) {
      throw new AppException(
        "RESCHEDULE_SCHEDULE_TOO_SOON",
        "The requested appointment must leave at least 15 minutes before service can start",
        HttpStatus.CONFLICT
      );
    }
    const maxScheduleDays = this.config?.get<number>("ORDER_MAX_SCHEDULE_DAYS") ?? 30;
    if (requestedScheduledAt.getTime() > now.getTime() + maxScheduleDays * 24 * 60 * 60_000) {
      throw new AppException(
        "RESCHEDULE_SCHEDULE_TOO_FAR",
        `requestedScheduledAt must be within ${maxScheduleDays} days`,
        HttpStatus.BAD_REQUEST,
        { maxScheduleDays }
      );
    }
    return requestedScheduledAt;
  }

  private rescheduleRequestExpiresAt(order: any, now: Date): Date {
    const responseWindowMinutes = this.config?.get<number>("ORDER_RESCHEDULE_RESPONSE_WINDOW_MINUTES")
      ?? DEFAULT_RESCHEDULE_RESPONSE_WINDOW_MINUTES;
    const latestResponseAt = Math.min(
      order.scheduledAt.getTime() - SERVICE_EARLY_START_MS,
      order.companionResponseDeadlineAt?.getTime() ?? Number.POSITIVE_INFINITY
    );
    const expiresAt = new Date(Math.min(
      now.getTime() + responseWindowMinutes * 60_000,
      latestResponseAt
    ));
    if (expiresAt.getTime() <= now.getTime() + MIN_RESCHEDULE_RESPONSE_WINDOW_MS) {
      throw new AppException(
        "RESCHEDULE_RESPONSE_WINDOW_TOO_SHORT",
        "The current appointment is too close to allow a meaningful reschedule response window",
        HttpStatus.CONFLICT
      );
    }
    return expiresAt;
  }

  private async findEligibleCompanionForWorkbench(userId: string): Promise<{ id: string }> {
    const companion: any = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId },
      select: {
        id: true,
        isVerified: true,
        owner: {
          select: {
            accountStatus: true,
            profile: { select: { isVerified: true } }
          }
        }
      }
    } as any);
    if (!companion) {
      throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    if (
      companion.isVerified !== true
      || companion.owner?.accountStatus !== "active"
      || companion.owner?.profile?.isVerified !== true
    ) {
      throw new AppException(
        "COMPANION_OWNER_NOT_ELIGIBLE",
        "An active identity-verified companion profile and owner are required",
        HttpStatus.FORBIDDEN
      );
    }
    return { id: companion.id };
  }

  private async findOwnedOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        conversation: { select: { externalId: true } },
        refunds: { orderBy: { createdAt: "desc" }, take: 1 },
        experienceFeedback: true
      }
    } as any);

    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    return order;
  }

  private async findOrderParticipantOrThrow(userId: string, orderId: string): Promise<OrderRecord> {
    const order: any = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { companion: { select: { ownerUserId: true } } }
    } as any);
    if (!order || (order.userId !== userId && order.companion?.ownerUserId !== userId)) {
      // Deliberately indistinguishable from a nonexistent id to avoid exposing
      // appointment existence or scheduling information to other users.
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
        await this.recordAudit(db, {
          actorId: null,
          action: "order.payment_reservation_expired",
          resourceType: "order",
          resourceId: candidate.id,
          metadata: {
            paymentReservationExpiresAt: candidate.paymentReservationExpiresAt?.toISOString() ?? null,
            expiredAt: now.toISOString()
          }
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
    const candidates: Array<{ id: string; userId: string; companionResponseDeadlineAt: Date | null }> = await this.prisma.order.findMany({
      where: {
        status: "pending",
        companionConfirmedAt: null,
        companionResponseDeadlineAt: { lte: now }
      },
      select: { id: true, userId: true, companionResponseDeadlineAt: true },
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
        await this.recordAudit(db, {
          actorId: null,
          action: "order.companion_response_expired",
          resourceType: "order",
          resourceId: candidate.id,
          metadata: {
            companionResponseDeadlineAt: candidate.companionResponseDeadlineAt?.toISOString() ?? null,
            expiredAt: now.toISOString()
          }
        });
        return true;
      });
      if (changed) expired += 1;
    }
    return expired;
  }

  /**
   * Expire unresolved reschedule negotiations in small, independently locked
   * batches. The initial scan is only a hint: every candidate is locked with
   * its order and rechecked inside the transaction, so concurrent API replicas
   * cannot emit duplicate timeline events or transactional notifications.
   */
  async expirePendingRescheduleRequests(limit = 100): Promise<number> {
    const scanStartedAt = new Date();
    const candidates: Array<{ id: string; orderId: string }> = await this.prisma.orderRescheduleRequest.findMany({
      where: { status: "pending", expiresAt: { lte: scanStartedAt } },
      select: { id: true, orderId: true },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 200)
    } as any);

    let expired = 0;
    for (const candidate of candidates) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        // Keep the same lock ordering as accept/reject. That makes a racing
        // response wait for this transaction instead of producing a lock-order
        // inversion across replicas.
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
        await db.$queryRaw`SELECT "id" FROM "OrderRescheduleRequest" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const request: any = await db.orderRescheduleRequest.findUnique({ where: { id: candidate.id } });
        const now = new Date();
        if (
          !request ||
          request.orderId !== candidate.orderId ||
          request.status !== "pending" ||
          request.expiresAt.getTime() > now.getTime()
        ) {
          return false;
        }
        const order: any = await db.order.findUnique({
          where: { id: candidate.orderId },
          include: { companion: { select: { ownerUserId: true } } }
        });
        if (!order) return false;

        const resolved = await db.orderRescheduleRequest.update({
          where: { id: request.id },
          data: { status: "expired", respondedAt: now, respondedByUserId: null }
        });
        await db.orderTimelineEvent.create({
          data: {
            orderId: order.id,
            type: "rescheduleExpired",
            actorId: null,
            actorRole: "system",
            rescheduleRequestId: resolved.id
          }
        });
        const recipientUserIds = [...new Set(
          [order.userId, order.companion?.ownerUserId]
            .filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
        )];
        for (const recipientUserId of recipientUserIds) {
          await this.enqueueTransactionalNotification(db, {
            userId: recipientUserId,
            type: "orderStatus",
            title: "改期请求已超时",
            body: "双方未在响应时限内确认改期，原预约时间保持不变。",
            data: {
              orderId: order.id,
              rescheduleRequestId: resolved.id,
              status: "expired",
              scheduledAt: order.scheduledAt.toISOString(),
              expiresAt: resolved.expiresAt.toISOString()
            },
            eventKey: `order:${order.id}:reschedule:${resolved.id}:expired:${recipientUserId}`,
            templateKey: "rescheduleExpired"
          });
        }
        await this.recordAudit(db, {
          actorId: null,
          action: "order.reschedule_expired",
          resourceType: "orderRescheduleRequest",
          resourceId: resolved.id,
          metadata: {
            orderId: order.id,
            originalScheduledAt: request.originalScheduledAt.toISOString(),
            requestedScheduledAt: request.requestedScheduledAt.toISOString(),
            expiresAt: resolved.expiresAt.toISOString(),
            notifiedUserIds: recipientUserIds
          }
        });
        return true;
      }, { maxWait: 5_000, timeout: 10_000 });
      if (changed) expired += 1;
    }
    return expired;
  }

  /**
   * Close the one live reschedule negotiation when a parent-order lifecycle
   * transition makes it ineligible. Callers already hold the parent order
   * lock; locking the request as well preserves the same order/request sequence
   * used by accept, reject, and expiry so a concurrent participant response
   * cannot revive it.
   */
  async cancelPendingRescheduleRequest(
    db: any,
    input: {
      order: any;
      actorId: string | null;
      actorRole: "customer" | "companion" | "system";
      reason: "order_cancelled" | "order_rejected" | "refund_requested" | "service_started" | "service_completed";
    }
  ): Promise<void> {
    const candidate = await db.orderRescheduleRequest.findFirst({
      where: { orderId: input.order.id, status: "pending" },
      orderBy: { createdAt: "asc" }
    });
    if (!candidate) return;

    await db.$queryRaw`SELECT "id" FROM "OrderRescheduleRequest" WHERE "id" = ${candidate.id} FOR UPDATE`;
    const request: any = await db.orderRescheduleRequest.findUnique({ where: { id: candidate.id } });
    if (!request || request.orderId !== input.order.id || request.status !== "pending") return;

    const now = new Date();
    const resolved = await db.orderRescheduleRequest.update({
      where: { id: request.id },
      data: { status: "cancelled", respondedAt: now, respondedByUserId: input.actorId }
    });
    await db.orderTimelineEvent.create({
      data: {
        orderId: input.order.id,
        type: "rescheduleCancelled",
        actorId: input.actorId,
        actorRole: input.actorRole,
        rescheduleRequestId: resolved.id
      }
    });
    const recipientUserIds = [...new Set(
      [input.order.userId, input.order.companion?.ownerUserId]
        .filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
    )];
    const message = input.reason === "order_cancelled"
      ? "订单已取消，原改期协商已自动关闭。"
      : input.reason === "order_rejected"
        ? "陪伴者已拒绝本次预约，原改期协商已自动关闭。"
        : input.reason === "refund_requested"
          ? "退款申请已发起，原改期协商已自动关闭。"
          : input.reason === "service_started"
            ? "服务已开始，原改期协商已自动关闭。"
            : "服务已完成，原改期协商已自动关闭。";
    for (const recipientUserId of recipientUserIds) {
      await this.enqueueTransactionalNotification(db, {
        userId: recipientUserId,
        type: "orderStatus",
        title: "改期请求已取消",
        body: message,
        data: {
          orderId: input.order.id,
          rescheduleRequestId: resolved.id,
          status: "cancelled",
          reason: input.reason
        },
        eventKey: `order:${input.order.id}:reschedule:${resolved.id}:cancelled:${recipientUserId}`,
        templateKey: "rescheduleCancelled"
      });
    }
    await this.recordAudit(db, {
      actorId: input.actorId,
      action: "order.reschedule_cancelled",
      resourceType: "orderRescheduleRequest",
      resourceId: resolved.id,
      metadata: {
        orderId: input.order.id,
        reason: input.reason,
        requesterRole: request.requestedByRole,
        actorRole: input.actorRole,
        originalScheduledAt: request.originalScheduledAt.toISOString(),
        requestedScheduledAt: request.requestedScheduledAt.toISOString(),
        notifiedUserIds: recipientUserIds
      }
    });
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
    const hasStructuredAvailability = Boolean(
      order.availabilityWindowId ||
      order.availabilityWindowStartsAtSnapshot ||
      order.availabilityWindowEndsAtSnapshot
    );
    if (hasStructuredAvailability) {
      if (!order.availabilityWindowId) {
        throw new AppException(
          "AVAILABILITY_WINDOW_UNAVAILABLE",
          "The selected availability window is no longer available",
          HttpStatus.CONFLICT
        );
      }
      const availabilityWindow = await this.lockActiveAvailabilityWindow(db, {
        availabilityWindowId: order.availabilityWindowId,
        companionId: order.companionId,
        scheduledAt: order.scheduledAt,
        durationMinutes: order.durationMinutes
      });
      await this.assertStructuredAvailabilityCapacity(db, {
        companionId: order.companionId,
        scheduledAt: order.scheduledAt,
        durationMinutes: order.durationMinutes,
        availabilityWindow,
        excludeOrderId: order.id
      }, now);
      return;
    }

    await this.assertSlotCapacity(db, {
      companionId: order.companionId,
      scheduledAt: order.scheduledAt,
      durationMinutes: order.durationMinutes,
      capacity: 1,
      availabilityWindowId: null,
      excludeOrderId: order.id
    }, now);
  }

  private throwCompanionSlotUnavailable(details?: Record<string, unknown>): never {
    throw new AppException(
      "COMPANION_SLOT_UNAVAILABLE",
      "The companion already has a reservation, payment, or service for this time slot",
      HttpStatus.CONFLICT,
      details
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
