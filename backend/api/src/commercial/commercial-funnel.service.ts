import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { loadAcceptedOrderIds } from "../orders/order-acceptance-facts";
import { CommercialFunnelQueryDto } from "./dto/commercial-funnel-query.dto";

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90;
const MAX_COHORT_ORDERS = 10_000;
const ON_TIME_START_GRACE_MS = 5 * 60_000;

@Injectable()
export class CommercialFunnelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cohort funnel for executive decisions. The cohort is fixed by order
   * creation time; later stages are read from authoritative order/payment/
   * refund/review facts. No chat content, profile text, or customer identity is
   * returned.
   */
  async get(query: CommercialFunnelQueryDto = {}) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    const to = query.to ? new Date(query.to) : now;
    if (
      Number.isNaN(from.getTime())
      || Number.isNaN(to.getTime())
      || to.getTime() < from.getTime()
      || to.getTime() > now.getTime() + 60_000
    ) {
      throw new AppException("COMMERCIAL_FUNNEL_RANGE_INVALID", "Invalid commercial funnel date range", HttpStatus.BAD_REQUEST);
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new AppException(
        "COMMERCIAL_FUNNEL_RANGE_TOO_LARGE",
        `Commercial funnel range may not exceed ${MAX_RANGE_DAYS} days`,
        HttpStatus.BAD_REQUEST
      );
    }

    const records = await this.prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        id: true,
        userId: true,
        amountCents: true,
        currency: true,
        createdAt: true,
        scheduledAt: true,
        durationMinutes: true,
        companionConfirmedAt: true,
        paidAt: true,
        serviceStartedAt: true,
        completedAt: true,
        recommendationImpressionId: true,
        serviceOfferingDeliveryModeSnapshot: true,
        reviews: { select: { id: true }, take: 1 },
        refunds: {
          where: { status: "success" },
          select: { amountCents: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: MAX_COHORT_ORDERS + 1
    } as any) as any[];
    const truncated = records.length > MAX_COHORT_ORDERS;
    const orders = records.slice(0, MAX_COHORT_ORDERS);
    const acceptedOrderIds = await loadAcceptedOrderIds(this.prisma, orders);
    const paidOrders = orders.filter((order) => Boolean(order.paidAt));
    const payingCustomerIds = [...new Set(paidOrders.map((order) => order.userId))];
    const priorPayingCustomers = payingCustomerIds.length === 0
      ? []
      : await this.prisma.order.findMany({
          where: {
            userId: { in: payingCustomerIds },
            paidAt: { not: null, lt: from }
          },
          select: { userId: true },
          distinct: ["userId"]
        } as any) as Array<{ userId: string }>;
    const priorPayingCustomerIds = new Set(priorPayingCustomers.map((order) => order.userId));
    const paidCountByCustomer = new Map<string, number>();
    for (const order of paidOrders) {
      paidCountByCustomer.set(order.userId, (paidCountByCustomer.get(order.userId) ?? 0) + 1);
    }

    const accepted = orders.filter((order) => acceptedOrderIds.has(order.id));
    const acceptedPaid = accepted.filter((order) => Boolean(order.paidAt));
    const started = paidOrders.filter((order) => Boolean(order.serviceStartedAt));
    const startEligible = paidOrders.filter((order) => new Date(order.scheduledAt).getTime() <= now.getTime());
    const eligibleStarted = startEligible.filter((order) => Boolean(order.serviceStartedAt));
    const onTimeStarted = startEligible.filter((order) =>
      order.serviceStartedAt
      && new Date(order.serviceStartedAt).getTime()
        <= new Date(order.scheduledAt).getTime() + ON_TIME_START_GRACE_MS
    );
    const completionEligible = paidOrders.filter((order) =>
      new Date(order.scheduledAt).getTime() + order.durationMinutes * 60_000 <= now.getTime()
    );
    const completed = paidOrders.filter((order) => Boolean(order.completedAt));
    const eligibleCompleted = completionEligible.filter((order) => Boolean(order.completedAt));
    const reviewed = completed.filter((order) => (order.reviews?.length ?? 0) > 0);
    const refunded = paidOrders.filter((order) => (order.refunds?.length ?? 0) > 0);
    const recommendationAttributed = orders.filter((order) => Boolean(order.recommendationImpressionId));
    const paidRecommendationAttributed = paidOrders.filter((order) => Boolean(order.recommendationImpressionId));
    const repeatPayingCustomers = payingCustomerIds.filter((userId) =>
      priorPayingCustomerIds.has(userId) || (paidCountByCustomer.get(userId) ?? 0) >= 2
    ).length;
    const grossPaidCents = paidOrders.reduce((sum, order) => sum + order.amountCents, 0);
    const refundedCents = paidOrders.reduce(
      (sum, order) => sum + (order.refunds ?? []).reduce(
        (refundSum: number, refund: { amountCents: number }) => refundSum + refund.amountCents,
        0
      ),
      0
    );
    const deliveryModes = { text: 0, voice: 0, legacy: 0 };
    for (const order of paidOrders) {
      const mode = order.serviceOfferingDeliveryModeSnapshot;
      if (mode === "text") deliveryModes.text += 1;
      else if (mode === "voice") deliveryModes.voice += 1;
      else deliveryModes.legacy += 1;
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString(), cohort: "orderCreatedAt" },
      generatedAt: now.toISOString(),
      truncated,
      definitions: {
        accepted: "current companionConfirmedAt or an immutable companion-confirmed audit fact is present",
        paid: "paidAt is present",
        startEligible: "paid order scheduledAt has passed",
        serviceStartRate: "started start-eligible orders divided by start-eligible orders",
        onTimeStarted: "serviceStartedAt is no later than scheduledAt plus 5 minutes",
        completionEligible: "paid order scheduled duration has elapsed",
        completionRate: "completed completion-eligible orders divided by completion-eligible orders",
        reviewed: "completed order has a public review",
        refunded: "paid order has at least one successful refund transaction",
        repeatCustomer: "paying customer has an earlier paid order or at least two paid cohort orders"
      },
      stages: {
        requested: orders.length,
        accepted: accepted.length,
        paid: paidOrders.length,
        startEligible: startEligible.length,
        started: started.length,
        onTimeStarted: onTimeStarted.length,
        completionEligible: completionEligible.length,
        completed: completed.length,
        reviewed: reviewed.length,
        refunded: refunded.length
      },
      rates: {
        acceptanceRate: this.rate(accepted.length, orders.length),
        paymentRateFromRequest: this.rate(paidOrders.length, orders.length),
        paymentRateFromAccepted: this.rate(acceptedPaid.length, accepted.length),
        serviceStartRate: this.rate(eligibleStarted.length, startEligible.length),
        onTimeStartRate: this.rate(onTimeStarted.length, startEligible.length),
        completionRate: this.rate(eligibleCompleted.length, completionEligible.length),
        reviewRate: this.rate(reviewed.length, completed.length),
        refundOrderRate: this.rate(refunded.length, paidOrders.length)
      },
      acquisition: {
        recommendationAttributedOrders: recommendationAttributed.length,
        orderAttributionCoverage: this.rate(recommendationAttributed.length, orders.length),
        recommendationAttributedPaidOrders: paidRecommendationAttributed.length,
        paidAttributionCoverage: this.rate(paidRecommendationAttributed.length, paidOrders.length)
      },
      customers: {
        payingCustomers: payingCustomerIds.length,
        repeatPayingCustomers,
        repeatCustomerRate: this.rate(repeatPayingCustomers, payingCustomerIds.length)
      },
      financials: {
        currency: "CNY",
        grossPaidCents,
        refundedCents,
        netCollectedCents: grossPaidCents - refundedCents,
        averagePaidOrderCents: paidOrders.length === 0 ? 0 : Math.round(grossPaidCents / paidOrders.length)
      },
      paidDeliveryModes: deliveryModes
    };
  }

  private rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : Math.round(numerator / denominator * 10_000) / 10_000;
  }
}
