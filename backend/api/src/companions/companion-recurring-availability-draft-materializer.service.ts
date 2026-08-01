import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE } from "./companion-availability-schedule-rule.service";

export const COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS = 14;
export const COMPANION_MAX_INACTIVE_AVAILABILITY_WINDOWS = 500;

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

export type CompanionRecurringAvailabilityDraftMaterializationResult = {
  evaluatedRules: number;
  consideredOccurrences: number;
  created: number;
  alreadyMaterialized: number;
  skippedByBlackout: number;
  skippedByExistingWindow: number;
  skippedByOrder: number;
  skippedOutsideHorizon: number;
  skippedByDraftLimit: number;
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

      const [rules, inactiveWindowCount] = await Promise.all([
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
        db.companionAvailabilityWindow.count({
          where: { companionId: normalizedCompanionId, isActive: false }
        }) as Promise<number>
      ]);

      const result: CompanionRecurringAvailabilityDraftMaterializationResult = {
        evaluatedRules: rules.length,
        consideredOccurrences: 0,
        created: 0,
        alreadyMaterialized: 0,
        skippedByBlackout: 0,
        skippedByExistingWindow: 0,
        skippedByOrder: 0,
        skippedOutsideHorizon: 0,
        skippedByDraftLimit: 0
      };
      let remainingDraftCapacity = Math.max(
        0,
        COMPANION_MAX_INACTIVE_AVAILABILITY_WINDOWS - inactiveWindowCount
      );

      for (const rule of rules) {
        for (const occurrence of this.occurrencesWithinHorizon(rule, evaluatedAt)) {
          result.consideredOccurrences += 1;
          if (occurrence.startsAt <= evaluatedAt || occurrence.endsAt > rangeEnd) {
            result.skippedOutsideHorizon += 1;
            continue;
          }
          if (remainingDraftCapacity === 0) {
            result.skippedByDraftLimit += 1;
            continue;
          }
          const conflicts = await this.findOccurrenceConflicts(
            db,
            normalizedCompanionId,
            occurrence.startsAt,
            occurrence.endsAt
          );
          if (conflicts.blackout) {
            result.skippedByBlackout += 1;
            continue;
          }
          if (conflicts.window) {
            result.skippedByExistingWindow += 1;
            continue;
          }
          if (conflicts.order) {
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
            result.created += 1;
            remainingDraftCapacity -= 1;
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

  private async findOccurrenceConflicts(
    db: any,
    companionId: string,
    startsAt: Date,
    endsAt: Date
  ): Promise<{ blackout: boolean; window: boolean; order: boolean }> {
    // Each predicate is an indexed EXISTS against one bounded occurrence. No
    // growing schedule/order collection is materialized in the application.
    const rows = await db.$queryRaw<Array<{ blackout: boolean; window: boolean; order: boolean }>>`
      SELECT
        EXISTS (
          SELECT 1 FROM "CompanionAvailabilityBlackout" blackout
          WHERE blackout."companionId" = ${companionId}
            AND blackout."isActive" = TRUE
            AND blackout."startsAt" < ${endsAt}
            AND blackout."endsAt" > ${startsAt}
        ) AS "blackout",
        EXISTS (
          SELECT 1 FROM "CompanionAvailabilityWindow" availability_window
          WHERE availability_window."companionId" = ${companionId}
            AND availability_window."startsAt" < ${endsAt}
            AND availability_window."endsAt" > ${startsAt}
        ) AS "window",
        EXISTS (
          SELECT 1 FROM "Order" reservation
          WHERE reservation."companionId" = ${companionId}
            AND reservation."status"::text IN ('pending', 'paying', 'paid', 'inService', 'completed')
            AND reservation."durationMinutes" > 0
            AND reservation."scheduledAt" < ${endsAt}
            AND reservation."scheduledAt"
                + (reservation."durationMinutes" * INTERVAL '1 minute') > ${startsAt}
        ) AS "order"
    `;
    return rows[0] ?? { blackout: false, window: false, order: false };
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
