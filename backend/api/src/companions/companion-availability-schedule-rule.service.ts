import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";

export const COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE = "Asia/Shanghai";

const STEP_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;
const MAX_CAPACITY = 10;
const MAX_BLACKOUT_DURATION_MS = 31 * 24 * 60 * 60_000;
const MIN_FUTURE_LEAD_MS = 15 * 60_000;

export type CreateCompanionRecurringAvailabilityRuleInput = {
  weekday: number;
  startsAtMinute: number;
  endsAtMinute: number;
  capacity?: number;
  timezone?: string;
  isActive?: boolean;
};

export type CreateCompanionAvailabilityBlackoutInput = {
  startsAt: string;
  endsAt: string;
  timezone?: string;
  isActive?: boolean;
};

/**
 * Private scheduling foundation for future materialization. This service never
 * creates or updates CompanionAvailabilityWindow rows: recurring rules and
 * blackouts are only validated planning inputs until a separate materializer
 * deliberately consumes them.
 */
@Injectable()
export class CompanionAvailabilityScheduleRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async createRecurringRule(
    companionId: string,
    input: CreateCompanionRecurringAvailabilityRuleInput
  ) {
    const normalizedCompanionId = this.normalizeCompanionId(companionId);
    const data = this.normalizeRecurringRule(input);
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAndFindCompanion(db, normalizedCompanionId);
      if (data.isActive) {
        await this.assertNoOverlappingRecurringRule(db, normalizedCompanionId, data);
      }
      return db.companionRecurringAvailabilityRule.create({
        data: { companionId: normalizedCompanionId, ...data }
      });
    });
  }

  async createBlackout(companionId: string, input: CreateCompanionAvailabilityBlackoutInput) {
    const normalizedCompanionId = this.normalizeCompanionId(companionId);
    const data = this.normalizeBlackout(input);
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAndFindCompanion(db, normalizedCompanionId);
      if (data.isActive) {
        await this.assertNoOverlappingBlackout(db, normalizedCompanionId, data);
      }
      return db.companionAvailabilityBlackout.create({
        data: { companionId: normalizedCompanionId, ...data }
      });
    });
  }

  /**
   * Retirement is intentionally idempotent and does not delete a rule. Any
   * existing inactive drafts retain their source reference for owner review;
   * this operation neither creates, activates, nor changes a concrete window.
   */
  async deactivateRecurringRule(companionId: string, ruleId: string) {
    const normalizedCompanionId = this.normalizeCompanionId(companionId);
    const normalizedRuleId = this.normalizeOwnedRecordId(ruleId, "RECURRING_AVAILABILITY_RULE_NOT_FOUND");
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAndFindCompanion(db, normalizedCompanionId);
      const existing = await db.companionRecurringAvailabilityRule.findFirst({
        where: { id: normalizedRuleId, companionId: normalizedCompanionId }
      });
      if (!existing) {
        // Do not distinguish an unknown id from a different companion's rule.
        throw new AppException(
          "RECURRING_AVAILABILITY_RULE_NOT_FOUND",
          "Recurring availability rule not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (!existing.isActive) return existing;
      return db.companionRecurringAvailabilityRule.update({
        where: { id: existing.id },
        data: { isActive: false }
      });
    });
  }

  /**
   * An exception is retired rather than deleted so its owner can safely audit
   * their planning history. It does not rewrite an already-created window,
   * order, reminder candidate, or materialized draft.
   */
  async deactivateBlackout(companionId: string, blackoutId: string) {
    const normalizedCompanionId = this.normalizeCompanionId(companionId);
    const normalizedBlackoutId = this.normalizeOwnedRecordId(blackoutId, "AVAILABILITY_BLACKOUT_NOT_FOUND");
    return this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      await this.lockAndFindCompanion(db, normalizedCompanionId);
      const existing = await db.companionAvailabilityBlackout.findFirst({
        where: { id: normalizedBlackoutId, companionId: normalizedCompanionId }
      });
      if (!existing) {
        // Do not distinguish an unknown id from a different companion's exception.
        throw new AppException(
          "AVAILABILITY_BLACKOUT_NOT_FOUND",
          "Availability blackout not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (!existing.isActive) return existing;
      return db.companionAvailabilityBlackout.update({
        where: { id: existing.id },
        data: { isActive: false }
      });
    });
  }

  private normalizeRecurringRule(input: CreateCompanionRecurringAvailabilityRuleInput) {
    const weekday = input?.weekday;
    const startsAtMinute = input?.startsAtMinute;
    const endsAtMinute = input?.endsAtMinute;
    const capacity = input?.capacity ?? 1;
    const timezone = this.normalizeTimezone(input?.timezone);
    const isActive = this.normalizeIsActive(input?.isActive);

    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new AppException(
        "INVALID_RECURRING_AVAILABILITY_WEEKDAY",
        "weekday must be an integer from 0 (Sunday) through 6 (Saturday)",
        HttpStatus.BAD_REQUEST
      );
    }
    this.assertMinuteOfDay(startsAtMinute, "startsAtMinute", 0, MINUTES_PER_DAY - STEP_MINUTES);
    this.assertMinuteOfDay(endsAtMinute, "endsAtMinute", STEP_MINUTES, MINUTES_PER_DAY);
    if (endsAtMinute <= startsAtMinute) {
      throw new AppException(
        "INVALID_RECURRING_AVAILABILITY_RANGE",
        "A recurring availability rule must end later on the same local day",
        HttpStatus.BAD_REQUEST
      );
    }
    this.assertCapacity(capacity);
    return { weekday, startsAtMinute, endsAtMinute, capacity, timezone, isActive };
  }

  private normalizeBlackout(input: CreateCompanionAvailabilityBlackoutInput) {
    const startsAt = this.parseExplicitTimezoneDate(input?.startsAt, "startsAt");
    const endsAt = this.parseExplicitTimezoneDate(input?.endsAt, "endsAt");
    const timezone = this.normalizeTimezone(input?.timezone);
    const isActive = this.normalizeIsActive(input?.isActive);
    const startsAtMs = startsAt.getTime();
    const endsAtMs = endsAt.getTime();

    if (startsAtMs % (STEP_MINUTES * 60_000) !== 0 || endsAtMs % (STEP_MINUTES * 60_000) !== 0) {
      throw new AppException(
        "INVALID_AVAILABILITY_BLACKOUT_ALIGNMENT",
        "startsAt and endsAt must use a 30-minute boundary",
        HttpStatus.BAD_REQUEST
      );
    }
    if (endsAtMs <= startsAtMs || endsAtMs - startsAtMs > MAX_BLACKOUT_DURATION_MS) {
      throw new AppException(
        "INVALID_AVAILABILITY_BLACKOUT_RANGE",
        "A blackout must end after it starts and may not exceed 31 days",
        HttpStatus.BAD_REQUEST
      );
    }
    if (isActive && startsAtMs <= Date.now() + MIN_FUTURE_LEAD_MS) {
      throw new AppException(
        "AVAILABILITY_BLACKOUT_TOO_SOON",
        "An active blackout must start at least 15 minutes in the future",
        HttpStatus.CONFLICT
      );
    }
    return { startsAt, endsAt, timezone, isActive };
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

  private async assertNoOverlappingRecurringRule(
    db: any,
    companionId: string,
    input: { weekday: number; startsAtMinute: number; endsAtMinute: number }
  ) {
    const overlap = await db.companionRecurringAvailabilityRule.findFirst({
      where: {
        companionId,
        isActive: true,
        weekday: input.weekday,
        startsAtMinute: { lt: input.endsAtMinute },
        endsAtMinute: { gt: input.startsAtMinute }
      },
      select: { id: true }
    });
    if (overlap) {
      throw new AppException(
        "RECURRING_AVAILABILITY_RULE_OVERLAP",
        "This recurring availability rule overlaps another active rule",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertNoOverlappingBlackout(
    db: any,
    companionId: string,
    input: { startsAt: Date; endsAt: Date }
  ) {
    const overlap = await db.companionAvailabilityBlackout.findFirst({
      where: {
        companionId,
        isActive: true,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt }
      },
      select: { id: true }
    });
    if (overlap) {
      throw new AppException(
        "AVAILABILITY_BLACKOUT_OVERLAP",
        "This blackout overlaps another active blackout",
        HttpStatus.CONFLICT
      );
    }
  }

  private normalizeCompanionId(value: unknown) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
    return normalized;
  }

  private normalizeOwnedRecordId(value: unknown, errorCode: string) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new AppException(errorCode, "Availability schedule record not found", HttpStatus.NOT_FOUND);
    }
    return normalized;
  }

  private normalizeTimezone(value: unknown) {
    if (value === undefined) return COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE;
    if (typeof value !== "string" || value.trim() !== COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE) {
      throw new AppException(
        "INVALID_AVAILABILITY_SCHEDULE_TIMEZONE",
        `timezone must be ${COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE}`,
        HttpStatus.BAD_REQUEST
      );
    }
    return COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE;
  }

  private normalizeIsActive(value: unknown) {
    if (value === undefined) return true;
    if (typeof value !== "boolean") {
      throw new AppException("INVALID_AVAILABILITY_SCHEDULE", "isActive must be boolean", HttpStatus.BAD_REQUEST);
    }
    return value;
  }

  private assertMinuteOfDay(value: unknown, field: string, minimum: number, maximum: number) {
    if (
      typeof value !== "number"
      || !Number.isInteger(value)
      || value < minimum
      || value > maximum
      || value % STEP_MINUTES !== 0
    ) {
      throw new AppException(
        "INVALID_RECURRING_AVAILABILITY_TIME",
        `${field} must be a 30-minute boundary between ${minimum} and ${maximum}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private assertCapacity(value: unknown) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CAPACITY) {
      throw new AppException(
        "INVALID_RECURRING_AVAILABILITY_CAPACITY",
        `capacity must be an integer between 1 and ${MAX_CAPACITY}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private parseExplicitTimezoneDate(value: unknown, field: string) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
      throw new AppException(
        "INVALID_AVAILABILITY_BLACKOUT",
        `${field} must be an ISO-8601 date-time with an explicit timezone`,
        HttpStatus.BAD_REQUEST
      );
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new AppException("INVALID_AVAILABILITY_BLACKOUT", `${field} is invalid`, HttpStatus.BAD_REQUEST);
    }
    return parsed;
  }
}
