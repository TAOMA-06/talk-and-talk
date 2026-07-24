import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE } from "./companion-availability-schedule-rule.service";

export const COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS = 14;

const DAY_MS = 24 * 60 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const OCCUPIED_ORDER_STATUSES = ["pending", "paying", "paid", "inService", "completed"];

type RecurringRule = {
  id: string;
  weekday: number;
  startsAtMinute: number;
  endsAtMinute: number;
  capacity: number;
};

type AvailabilityRange = { startsAt: Date; endsAt: Date };

export type CompanionRecurringAvailabilityDraftMaterializationResult = {
  evaluatedRules: number;
  consideredOccurrences: number;
  created: number;
  alreadyMaterialized: number;
  skippedByBlackout: number;
  skippedByExistingWindow: number;
  skippedByOrder: number;
  skippedOutsideHorizon: number;
};

/**
 * A manually-invoked, private draft materializer. Its fixed, short horizon is
 * intentionally separate from any runner or controller. It writes only new
 * inactive windows, never mutates an explicit window, and never records a
 * reminder candidate or external side effect.
 */
@Injectable()
export class CompanionRecurringAvailabilityDraftMaterializerService {
  constructor(private readonly prisma: PrismaService) {}

  async materialize(
    companionId: string,
    now = new Date()
  ): Promise<CompanionRecurringAvailabilityDraftMaterializationResult> {
    const normalizedCompanionId = this.normalizeCompanionId(companionId);
    const evaluatedAt = new Date(now.getTime());
    const rangeEnd = new Date(evaluatedAt.getTime() + COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS * DAY_MS);

    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAndFindCompanion(db, normalizedCompanionId);

      const [rules, blackouts, windows, orders] = await Promise.all([
        db.companionRecurringAvailabilityRule.findMany({
          where: {
            companionId: normalizedCompanionId,
            isActive: true,
            timezone: COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE
          },
          select: {
            id: true,
            weekday: true,
            startsAtMinute: true,
            endsAtMinute: true,
            capacity: true
          },
          orderBy: [{ weekday: "asc" }, { startsAtMinute: "asc" }, { id: "asc" }]
        }) as Promise<RecurringRule[]>,
        db.companionAvailabilityBlackout.findMany({
          where: {
            companionId: normalizedCompanionId,
            isActive: true,
            startsAt: { lt: rangeEnd },
            endsAt: { gt: evaluatedAt }
          },
          select: { startsAt: true, endsAt: true }
        }) as Promise<AvailabilityRange[]>,
        db.companionAvailabilityWindow.findMany({
          where: {
            companionId: normalizedCompanionId,
            startsAt: { lt: rangeEnd },
            endsAt: { gt: evaluatedAt }
          },
          select: {
            startsAt: true,
            endsAt: true,
            recurringAvailabilityRuleId: true,
            recurringOccurrenceStartsAt: true
          }
        }) as Promise<Array<AvailabilityRange & {
          recurringAvailabilityRuleId: string | null;
          recurringOccurrenceStartsAt: Date | null;
        }>>,
        db.order.findMany({
          where: {
            companionId: normalizedCompanionId,
            status: { in: OCCUPIED_ORDER_STATUSES },
            scheduledAt: { lt: rangeEnd }
          },
          select: { scheduledAt: true, durationMinutes: true }
        }) as Promise<Array<{ scheduledAt: Date; durationMinutes: number }>>
      ]);

      const result: CompanionRecurringAvailabilityDraftMaterializationResult = {
        evaluatedRules: rules.length,
        consideredOccurrences: 0,
        created: 0,
        alreadyMaterialized: 0,
        skippedByBlackout: 0,
        skippedByExistingWindow: 0,
        skippedByOrder: 0,
        skippedOutsideHorizon: 0
      };
      const occupiedOrders = orders.map((order) => ({
        startsAt: order.scheduledAt,
        endsAt: new Date(order.scheduledAt.getTime() + order.durationMinutes * 60_000)
      }));

      for (const rule of rules) {
        for (const occurrence of this.occurrencesWithinHorizon(rule, evaluatedAt)) {
          result.consideredOccurrences += 1;
          if (occurrence.startsAt <= evaluatedAt || occurrence.endsAt > rangeEnd) {
            result.skippedOutsideHorizon += 1;
            continue;
          }
          if (blackouts.some((blackout) => this.overlaps(blackout, occurrence))) {
            result.skippedByBlackout += 1;
            continue;
          }
          if (windows.some((window) => this.overlaps(window, occurrence))) {
            result.skippedByExistingWindow += 1;
            continue;
          }
          if (occupiedOrders.some((order) => this.overlaps(order, occurrence))) {
            result.skippedByOrder += 1;
            continue;
          }

          try {
            await db.companionAvailabilityWindow.create({
              data: {
                companionId: normalizedCompanionId,
                startsAt: occurrence.startsAt,
                endsAt: occurrence.endsAt,
                capacity: rule.capacity,
                isActive: false,
                recurringAvailabilityRuleId: rule.id,
                recurringOccurrenceStartsAt: occurrence.startsAt
              }
            });
            windows.push({
              ...occurrence,
              recurringAvailabilityRuleId: rule.id,
              recurringOccurrenceStartsAt: occurrence.startsAt
            });
            result.created += 1;
          } catch (error) {
            if (!this.isUniqueConstraintError(error)) throw error;
            result.alreadyMaterialized += 1;
          }
        }
      }

      return result;
    });
  }

  private *occurrencesWithinHorizon(rule: RecurringRule, now: Date) {
    const firstShanghaiMidnight = Math.floor((now.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS;
    for (let offset = 0; offset < COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS; offset += 1) {
      const shanghaiMidnight = firstShanghaiMidnight + offset * DAY_MS;
      const weekday = new Date(shanghaiMidnight).getUTCDay();
      if (weekday !== rule.weekday) continue;

      const startsAt = new Date(shanghaiMidnight - SHANGHAI_OFFSET_MS + rule.startsAtMinute * 60_000);
      const endsAt = new Date(shanghaiMidnight - SHANGHAI_OFFSET_MS + rule.endsAtMinute * 60_000);
      yield { startsAt, endsAt };
    }
  }

  private async lockAndFindCompanion(db: any, companionId: string) {
    if (typeof db.$queryRaw === "function") {
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companionId} FOR UPDATE`;
    }
    const companion = await db.companionProfile.findUnique({
      where: { id: companionId },
      select: { id: true }
    });
    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
  }

  private overlaps(left: AvailabilityRange, right: AvailabilityRange) {
    return left.startsAt < right.endsAt && left.endsAt > right.startsAt;
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "P2002";
  }

  private normalizeCompanionId(value: unknown) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
    return normalized;
  }
}
