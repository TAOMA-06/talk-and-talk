import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderFanoutService } from "../favorites/availability-reminder-fanout.service";
import { AvailabilityReminderReservationService } from "../favorites/availability-reminder-reservation.service";
import { loadAcceptedOrderIds } from "../orders/order-acceptance-facts";
import { CommercialFunnelQueryDto } from "./dto/commercial-funnel-query.dto";

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90;
const MAX_COHORT_ORDERS = 10_000;
const MAX_REASON_BUCKETS = 40;
const OPEN_MODERATION_STATUSES = ["pending", "autoReviewing", "humanReview"] as const;

@Injectable()
export class CommercialOpsMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderFanout: AvailabilityReminderFanoutService,
    private readonly reminderPipeline: AvailabilityReminderReservationService
  ) {}

  /**
   * Read-only operating dashboard aggregates. Returns counts and rates only —
   * never chat content, openids, KYC payloads, or customer identity.
   */
  async get(query: CommercialFunnelQueryDto = {}) {
    const now = new Date();
    const { from, to } = this.parseRange(query, now);

    const [
      orders,
      supplyFunnel,
      slots,
      refundFacts,
      complaints,
      bookmarks,
      moderation,
      reminderFanout,
      reminderPipeline
    ] = await Promise.all([
      this.loadOrderCohort(from, to),
      this.supplyFunnel(now),
      this.slotUtilization(from, to, now),
      this.refundBreakdown(from, to),
      this.complaintSla(from, to, now),
      this.bookmarkConversion(from, to),
      this.moderationBacklog(now),
      this.reminderFanout.operationalReadiness(),
      this.reminderPipeline.operationalReadiness()
    ]);

    const truncated = orders.length > MAX_COHORT_ORDERS;
    const cohort = orders.slice(0, MAX_COHORT_ORDERS);
    const acceptedOrderIds = await loadAcceptedOrderIds(this.prisma, cohort);
    const orderIds = cohort.map((order) => order.id);

    const [rejectedOrderIds, timeoutOrderIds] = await Promise.all([
      this.auditResourceIds("order.companion_rejected", orderIds),
      this.auditResourceIds("order.companion_response_expired", orderIds)
    ]);

    const accepted = cohort.filter((order) => acceptedOrderIds.has(order.id));
    const rejected = cohort.filter((order) => rejectedOrderIds.has(order.id));
    const timedOut = cohort.filter((order) => timeoutOrderIds.has(order.id));
    const paidOrders = cohort.filter((order) => Boolean(order.paidAt));

    const repurchase = this.sameCompanionRepurchase(paidOrders);
    const refundedPaid = paidOrders.filter((order) => (order.refunds?.length ?? 0) > 0);

    const reminderStatus = [reminderFanout.status, reminderPipeline.status].includes("attentionRequired")
      ? "attentionRequired"
      : [reminderFanout.status, reminderPipeline.status].includes("processing")
        ? "processing"
        : "clear";

    return {
      range: { from: from.toISOString(), to: to.toISOString(), cohort: "orderCreatedAt" },
      generatedAt: now.toISOString(),
      truncated,
      definitions: {
        confirmationRate: "accepted cohort orders divided by requested cohort orders",
        rejectRate: "orders with order.companion_rejected audit fact divided by requested",
        responseTimeoutRate: "orders with order.companion_response_expired audit fact divided by requested",
        slotUtilization: "booked capacity units on active windows overlapping the range divided by released capacity",
        sameCompanionRepurchaseRate: "paying customer-companion pairs with two or more paid cohort orders divided by pairs with at least one",
        bookmarkConversionRate: "favorites created in range that later have a paid order for the same companion divided by favorites created in range",
        complaintFirstResponseHitRate: "disputes with firstRespondedAt on or before firstResponseDueAt divided by disputes with a due timestamp",
        complaintResolutionHitRate: "disputes with resolvedAt on or before resolutionDueAt divided by disputes with a due timestamp"
      },
      supplyFunnel,
      response: {
        requested: cohort.length,
        accepted: accepted.length,
        rejected: rejected.length,
        timedOut: timedOut.length,
        confirmationRate: this.rate(accepted.length, cohort.length),
        rejectRate: this.rate(rejected.length, cohort.length),
        responseTimeoutRate: this.rate(timedOut.length, cohort.length)
      },
      slots,
      refunds: {
        paidOrders: paidOrders.length,
        refundedOrders: refundedPaid.length,
        refundOrderRate: this.rate(refundedPaid.length, paidOrders.length),
        byReason: refundFacts.byReason,
        byExceptionReasonCode: refundFacts.byExceptionReasonCode
      },
      complaints,
      repurchase,
      bookmarks,
      moderation,
      availabilityReminders: {
        status: reminderStatus,
        fanout: {
          status: reminderFanout.status,
          failedJobs: reminderFanout.backlog?.failed ?? 0,
          expiredLeases: reminderFanout.backlog?.expiredLeases ?? 0,
          dueBacklog: reminderFanout.backlog?.due ?? 0
        },
        pipeline: {
          status: reminderPipeline.status,
          preparationRunnerEnabled: reminderPipeline.preparationRunnerEnabled === true,
          deliveryRunnerEnabled: reminderPipeline.deliveryRunnerEnabled === true,
          unresolvedTerminalAttempts: reminderPipeline.terminalAttempts?.unresolved ?? 0,
          resolvedTerminalAttempts: reminderPipeline.terminalAttempts?.resolved ?? 0,
          stageFailures:
            (reminderPipeline.failedPreparation ?? 0)
            + (reminderPipeline.failedReservation ?? 0)
            + (reminderPipeline.failedDelivery ?? 0),
          deliveryDueBacklog: reminderPipeline.dueAttempts ?? 0,
          preparationDueBacklog:
            (reminderPipeline.dueCandidates ?? 0) + (reminderPipeline.dueReservations ?? 0)
        }
      }
    };
  }

  private parseRange(query: CommercialFunnelQueryDto, now: Date) {
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    const to = query.to ? new Date(query.to) : now;
    if (
      Number.isNaN(from.getTime())
      || Number.isNaN(to.getTime())
      || to.getTime() < from.getTime()
      || to.getTime() > now.getTime() + 60_000
    ) {
      throw new AppException(
        "COMMERCIAL_OPS_METRICS_RANGE_INVALID",
        "Invalid commercial ops-metrics date range",
        HttpStatus.BAD_REQUEST
      );
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new AppException(
        "COMMERCIAL_OPS_METRICS_RANGE_TOO_LARGE",
        `Commercial ops-metrics range may not exceed ${MAX_RANGE_DAYS} days`,
        HttpStatus.BAD_REQUEST
      );
    }
    return { from, to };
  }

  private async loadOrderCohort(from: Date, to: Date) {
    const records = await this.prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        id: true,
        userId: true,
        companionId: true,
        createdAt: true,
        paidAt: true,
        companionConfirmedAt: true,
        refunds: {
          where: { status: "success" },
          select: { id: true }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_COHORT_ORDERS + 1
    } as any) as any[];
    return records;
  }

  private async supplyFunnel(now: Date) {
    const [
      profilesSubmitted,
      profilesVerified,
      trainingPassedCompanions,
      published,
      withFutureCapacity,
      firstAcceptedCompanions
    ] = await Promise.all([
      this.prisma.companionCommercialProfile.count(),
      this.prisma.companionCommercialProfile.count({ where: { status: "verified" } }),
      this.prisma.companionTrainingRecord.findMany({
        where: { status: "passed", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { companionId: true },
        distinct: ["companionId"]
      } as any),
      this.prisma.companionProfile.count({ where: { isPublished: true } }),
      this.prisma.companionAvailabilityWindow.findMany({
        where: {
          isActive: true,
          capacity: { gt: 0 },
          endsAt: { gt: now }
        },
        select: { companionId: true },
        distinct: ["companionId"]
      } as any),
      this.prisma.order.findMany({
        where: { companionConfirmedAt: { not: null } },
        select: { companionId: true },
        distinct: ["companionId"]
      } as any)
    ]);

    return {
      profilesSubmitted,
      profilesVerified,
      trainingCurrent: (trainingPassedCompanions as Array<{ companionId: string }>).length,
      published,
      withFutureCapacity: (withFutureCapacity as Array<{ companionId: string }>).length,
      firstAccepted: (firstAcceptedCompanions as Array<{ companionId: string }>).length
    };
  }

  private async slotUtilization(from: Date, to: Date, now: Date) {
    const windows = await this.prisma.companionAvailabilityWindow.findMany({
      where: {
        isActive: true,
        startsAt: { lte: to },
        endsAt: { gte: from }
      },
      select: {
        id: true,
        capacity: true,
        orders: {
          where: {
            status: { in: ["pending", "paying", "paid", "inService", "completed"] },
            createdAt: { lte: to }
          },
          select: { id: true }
        }
      },
      take: MAX_COHORT_ORDERS
    } as any) as any[];

    let releasedCapacity = 0;
    let bookedUnits = 0;
    for (const window of windows as Array<{ capacity: number; orders: Array<{ id: string }> }>) {
      releasedCapacity += window.capacity;
      bookedUnits += Math.min(window.capacity, window.orders?.length ?? 0);
    }
    const idleCapacity = Math.max(0, releasedCapacity - bookedUnits);

    return {
      windows: windows.length,
      releasedCapacity,
      bookedUnits,
      idleCapacity,
      utilizationRate: this.rate(bookedUnits, releasedCapacity),
      asOf: now.toISOString()
    };
  }

  private async refundBreakdown(from: Date, to: Date) {
    const refunds = await this.prisma.refundTransaction.findMany({
      where: {
        status: "success",
        createdAt: { gte: from, lte: to }
      },
      select: { reason: true, exceptionReasonCode: true },
      take: MAX_COHORT_ORDERS
    } as any) as Array<{ reason: string | null; exceptionReasonCode: string | null }>;

    return {
      byReason: this.bucketCounts(refunds.map((row) => this.sanitizeReason(row.reason))),
      byExceptionReasonCode: this.bucketCounts(
        refunds.map((row) => this.sanitizeReason(row.exceptionReasonCode))
      )
    };
  }

  private async complaintSla(from: Date, to: Date, now: Date) {
    const disputes = await this.prisma.paymentDispute.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        firstResponseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        resolvedAt: true
      },
      take: MAX_COHORT_ORDERS
    } as any) as Array<{
      firstResponseDueAt: Date | null;
      resolutionDueAt: Date | null;
      firstRespondedAt: Date | null;
      resolvedAt: Date | null;
    }>;

    const withFirstDue = disputes.filter((row) => row.firstResponseDueAt);
    const withResolutionDue = disputes.filter((row) => row.resolutionDueAt);
    const firstResponseHits = withFirstDue.filter((row) =>
      row.firstRespondedAt
      && row.firstResponseDueAt
      && row.firstRespondedAt.getTime() <= row.firstResponseDueAt.getTime()
    );
    const resolutionHits = withResolutionDue.filter((row) =>
      row.resolvedAt
      && row.resolutionDueAt
      && row.resolvedAt.getTime() <= row.resolutionDueAt.getTime()
    );
    const overdueFirstResponse = disputes.filter((row) =>
      row.firstResponseDueAt
      && !row.firstRespondedAt
      && row.firstResponseDueAt.getTime() < now.getTime()
    ).length;
    const overdueResolution = disputes.filter((row) =>
      row.resolutionDueAt
      && !row.resolvedAt
      && row.resolutionDueAt.getTime() < now.getTime()
    ).length;

    return {
      disputes: disputes.length,
      firstResponseDue: withFirstDue.length,
      firstResponseHits: firstResponseHits.length,
      firstResponseHitRate: this.rate(firstResponseHits.length, withFirstDue.length),
      resolutionDue: withResolutionDue.length,
      resolutionHits: resolutionHits.length,
      resolutionHitRate: this.rate(resolutionHits.length, withResolutionDue.length),
      overdueFirstResponse,
      overdueResolution
    };
  }

  private sameCompanionRepurchase(
    paidOrders: Array<{ userId: string; companionId: string }>
  ) {
    const pairCounts = new Map<string, number>();
    for (const order of paidOrders) {
      const key = `${order.userId}:${order.companionId}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    const pairs = pairCounts.size;
    const repeatPairs = [...pairCounts.values()].filter((count) => count >= 2).length;
    return {
      payingPairs: pairs,
      repeatPairs,
      sameCompanionRepurchaseRate: this.rate(repeatPairs, pairs)
    };
  }

  private async bookmarkConversion(from: Date, to: Date) {
    const favorites = await this.prisma.companionFavorite.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { userId: true, companionId: true, createdAt: true },
      take: MAX_COHORT_ORDERS
    } as any) as Array<{ userId: string; companionId: string; createdAt: Date }>;

    if (favorites.length === 0) {
      return { favoritesCreated: 0, convertedToPaid: 0, conversionRate: 0 };
    }

    const userIds = [...new Set(favorites.map((row) => row.userId))];
    const companionIds = [...new Set(favorites.map((row) => row.companionId))];
    const paidOrders = await this.prisma.order.findMany({
      where: {
        userId: { in: userIds },
        companionId: { in: companionIds },
        paidAt: { not: null, gte: from }
      },
      select: { userId: true, companionId: true, paidAt: true }
    } as any) as Array<{ userId: string; companionId: string; paidAt: Date }>;

    const paidByPair = new Map<string, Date[]>();
    for (const order of paidOrders) {
      const key = `${order.userId}:${order.companionId}`;
      const list = paidByPair.get(key) ?? [];
      list.push(order.paidAt);
      paidByPair.set(key, list);
    }

    let converted = 0;
    for (const favorite of favorites) {
      const paidAts = paidByPair.get(`${favorite.userId}:${favorite.companionId}`) ?? [];
      if (paidAts.some((paidAt) => paidAt.getTime() >= favorite.createdAt.getTime())) {
        converted += 1;
      }
    }

    return {
      favoritesCreated: favorites.length,
      convertedToPaid: converted,
      conversionRate: this.rate(converted, favorites.length)
    };
  }

  private async moderationBacklog(now: Date) {
    const [openCases, overdueCases, openAppeals, overdueAppeals] = await Promise.all([
      this.prisma.moderationCase.count({
        where: { status: { in: [...OPEN_MODERATION_STATUSES] } }
      }),
      this.prisma.moderationCase.count({
        where: {
          status: { in: [...OPEN_MODERATION_STATUSES] },
          dueAt: { not: null, lt: now }
        }
      }),
      this.prisma.moderationAppeal.count({ where: { status: "pending" } }),
      this.prisma.moderationAppeal.count({
        where: { status: "pending", reviewDueAt: { lt: now } }
      })
    ]);

    return { openCases, overdueCases, openAppeals, overdueAppeals };
  }

  private async auditResourceIds(action: string, orderIds: string[]) {
    if (orderIds.length === 0) {
      return new Set<string>();
    }
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action,
        resourceType: "order",
        resourceId: { in: orderIds }
      },
      select: { resourceId: true }
    } as any) as Array<{ resourceId: string | null }>;
    return new Set(rows.map((row) => row.resourceId).filter((id): id is string => Boolean(id)));
  }

  private bucketCounts(values: string[]) {
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_REASON_BUCKETS)
      .map(([key, count]) => ({ key, count }));
  }

  private sanitizeReason(value: string | null | undefined) {
    if (!value || !value.trim()) {
      return "unspecified";
    }
    // Keep short machine codes; collapse free-text to a stable bucket so PII
    // cannot leak through ops aggregates.
    const trimmed = value.trim();
    if (/^[a-zA-Z0-9._:-]{1,64}$/.test(trimmed)) {
      return trimmed.slice(0, 64);
    }
    return "free_text";
  }

  private rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 10_000;
  }
}
