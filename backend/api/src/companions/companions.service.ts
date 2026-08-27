import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppException } from "../common/errors/app.exception";
import { isCommercialTextOnlySurface } from "../config/commercial-surface";
import { isFirstReleaseCapabilityEnabled } from "../config/first-release-capability-matrix";
import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderCandidateService } from "../favorites/availability-reminder-candidate.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateCompanionDto, UpdateCompanionDto } from "./dto/companion-profile.dto";
import { ListCompanionAvailabilityQueryDto } from "./dto/list-companion-availability.dto";
import { ListCompanionsQueryDto, PublicCompanionSort } from "./dto/list-companions.dto";
import { ListOwnScheduleItemsDto } from "./dto/list-own-schedule-items.dto";
import { ListServiceOfferingsDto } from "./dto/list-service-offerings.dto";
import { CreateOwnAvailabilityWindowDto, UpdateOwnAvailabilityWindowDto } from "./dto/manage-availability-window.dto";
import {
  CreateOwnAvailabilityBlackoutDto,
  CreateOwnRecurringAvailabilityRuleDto
} from "./dto/manage-availability-schedule.dto";
import { ApplyCompanionDto, UpdateOwnCompanionDto } from "./dto/apply-companion.dto";
import { CreateOwnServiceOfferingDto, UpdateOwnServiceOfferingDto } from "./dto/manage-service-offering.dto";
import { OwnRecurringAvailabilityDraftParamsDto } from "./dto/manage-recurring-availability-draft.dto";
import {
  CompanionAvailabilityScheduleRuleService,
  COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE
} from "./companion-availability-schedule-rule.service";
import {
  CompanionRecurringAvailabilityDraftMaterializerService,
  COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS,
  COMPANION_MAX_INACTIVE_AVAILABILITY_WINDOWS
} from "./companion-recurring-availability-draft-materializer.service";
import { deriveTopicIds, normalizeTopicIds } from "../recommendations/recommendation-topics";
import {
  findCompanionCapacityMatches,
  findPublicAvailabilitySlots
} from "./companion-capacity-query";

type CompanionRecord = Awaited<ReturnType<CompanionsService["findRecordOrThrow"]>>;

const AVAILABILITY_TIMEZONE = "Asia/Shanghai";
const AVAILABILITY_STEP_MS = 30 * 60_000;
const MIN_PUBLIC_BOOKING_LEAD_TIME_MS = 15 * 60_000;
const MAX_PUBLIC_AVAILABILITY_CANDIDATES = 100;
export const PUBLIC_CAPACITY_SCAN_BATCH_SIZE = 100;
export const MAX_BOUNDED_SELLABLE_COMPANIONS = 500;
export const MAX_SERVICE_OFFERINGS_PER_COMPANION = 50;
const DEFAULT_PUBLIC_AVAILABILITY_PRIORITY_DAYS = 7;
const MAX_OWN_AVAILABILITY_WINDOW_DURATION_MS = 24 * 60 * 60_000;
const MAX_INACTIVE_AVAILABILITY_WINDOW_HORIZON_MS = 90 * 24 * 60 * 60_000;
const MAX_OWN_AVAILABILITY_CAPACITY = 10;
const DAY_MS = 24 * 60 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const PUBLIC_REQUIRED_TRAINING = [
  { moduleCode: "service-boundaries", moduleVersion: "2026.1" },
  { moduleCode: "safety-escalation", moduleVersion: "2026.1" },
  { moduleCode: "privacy-refresh", moduleVersion: "2026.1" }
] as const;

type AvailabilityReservation = {
  status: string;
  scheduledAt: Date;
  durationMinutes: number;
  companionConfirmedAt: Date | null;
  paymentReservationExpiresAt: Date | null;
};

export type SellableCompanionMatch = {
  id: string;
  earliestStartsAt: Date;
  startingPriceCents: number;
  startingDurationMinutes: number;
  currency: string;
  deliveryModes: Array<"text" | "voice">;
};

@Injectable()
export class CompanionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService,
    private readonly availabilityReminderCandidates: AvailabilityReminderCandidateService,
    private readonly availabilityScheduleRules: CompanionAvailabilityScheduleRuleService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly recurringAvailabilityDraftMaterializer?: CompanionRecurringAvailabilityDraftMaterializerService
  ) {}

  async list(query: ListCompanionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // A disabled real-time provider must not leave a public voice discovery
    // entry that can lead to an unfulfillable paid order. Owner catalog data is
    // deliberately unaffected, and OrdersService still enforces this boundary
    // under its transaction for stale clients and direct API attempts.
    if (query.deliveryMode === "voice" && !this.isVoiceBookingEnabled()) {
      return {
        items: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 }
      };
    }
    const capacityDays = query.availableWithinDays ?? DEFAULT_PUBLIC_AVAILABILITY_PRIORITY_DAYS;
    const catalogPage = await this.findSellableCatalogPage(query, capacityDays, page, pageSize);
    const pageIds = catalogPage.matches.map((match) => match.id);
    if (pageIds.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          pageSize,
          total: catalogPage.total,
          totalPages: Math.ceil(catalogPage.total / pageSize)
        }
      };
    }
    const items = await this.prisma.companionProfile.findMany({
      // Reapply the public gate after the volatile capacity snapshot. Only one
      // bounded response-page id set crosses back into Prisma.
      where: { ...this.buildPublicWhere(query), id: { in: pageIds } },
      include: this.includeTags()
    });
    const pagePosition = new Map(pageIds.map((id, index) => [id, index]));
    const catalogByCompanionId = new Map(catalogPage.matches.map((match) => [match.id, match]));
    items.sort((left, right) =>
      (pagePosition.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (pagePosition.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );

    return {
      items: items.map((item) => this.toDto(item, catalogByCompanionId.get(item.id))),
      pagination: {
        page,
        pageSize,
        total: catalogPage.total,
        totalPages: Math.ceil(catalogPage.total / pageSize)
      }
    };
  }

  async getPublished(id: string) {
    const [item, sellableMatches] = await Promise.all([
      this.prisma.companionProfile.findFirst({
        where: {
          id,
          isPublished: true,
          isVerified: true,
          ownerUserId: { not: null },
          owner: { accountStatus: "active", profile: { isVerified: true } },
          commercialProfile: {
            status: "verified",
            adultEligibilityVerdict: "adult",
            adultEligibilityValidUntil: { gt: new Date() }
          }
        },
        include: this.includeTags()
      }),
      this.findSellableCompanions({}, DEFAULT_PUBLIC_AVAILABILITY_PRIORITY_DAYS, [id])
    ]);

    if (!item) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    return this.toDto(item as CompanionRecord, sellableMatches[0]);
  }

  /**
   * Shared public sellability read model. Recommendations and catalog listings
   * must use this boundary instead of independently guessing from profile flags,
   * free-text availability, or an active offering alone.
   */
  async findSellableCompanions(
    query: ListCompanionsQueryDto = {},
    days = DEFAULT_PUBLIC_AVAILABILITY_PRIORITY_DAYS,
    companionIds?: string[],
    limit = 200
  ): Promise<SellableCompanionMatch[]> {
    if (query.deliveryMode === "voice" && !this.isVoiceBookingEnabled()) return [];
    const boundedDays = Math.max(1, Math.min(7, Math.trunc(days)));
    const normalizedIds = companionIds
      ? [...new Set(companionIds.map((id) => id.trim()).filter(Boolean))]
      : undefined;
    if (normalizedIds && normalizedIds.length === 0) return [];
    return this.findCompanionsWithFutureCapacity(
      query,
      boundedDays,
      normalizedIds,
      Math.min(MAX_BOUNDED_SELLABLE_COMPANIONS, Math.max(1, Math.trunc(limit)))
    );
  }

  /**
   * Customer-facing service catalog. It deliberately uses the same public
   * visibility gate as the companion profile, so an unpublished or unverified
   * profile cannot leak its commercial configuration through this endpoint.
   */
  async listPublishedServiceOfferings(
    id: string,
    query: ListServiceOfferingsDto = new ListServiceOfferingsDto()
  ) {
    const serviceWhere = this.activeServiceOfferingWhere({});
    const item = await this.prisma.companionProfile.findFirst({
      where: {
        ...this.buildPublicWhere({}),
        id
      },
      select: {
        serviceOfferings: {
          where: serviceWhere,
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize
        },
        _count: {
          select: { serviceOfferings: { where: serviceWhere } }
        }
      }
    });

    if (!item) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    const total = item._count.serviceOfferings;
    return {
      items: item.serviceOfferings
        .filter((offering) => this.isPublicServiceOfferingEnabled(offering))
        .map((offering) => this.toServiceOfferingDto(offering)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  /**
   * Converts explicit availability windows into booking candidates. Existing
   * profiles with no structured window retain legacy availableTimes only for
   * historical/internal compatibility. Commercial discovery and order intake
   * fail closed unless a structured candidate exists.
   */
  async listPublishedAvailability(id: string, query: ListCompanionAvailabilityQueryDto) {
    const now = new Date();
    const requestedFrom = query.from ? new Date(query.from) : now;
    const from = new Date(Math.max(requestedFrom.getTime(), now.getTime()));
    const earliestStart = new Date(Math.max(from.getTime(), now.getTime() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS));
    const days = query.days ?? 7;
    const until = new Date(from.getTime() + days * 24 * 60 * 60_000);
    const companion = await this.prisma.companionProfile.findFirst({
      where: {
        ...this.buildPublicWhere({}),
        id
      },
      select: {
        id: true,
        availableTimes: true,
        serviceOfferings: {
          where: { isActive: true },
          select: {
            id: true,
            durationMinutes: true,
            topicIds: true
          }
        }
      }
    });
    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    const service = this.resolveAvailabilityService(
      companion.serviceOfferings.filter((offering) => this.isPublicServiceOfferingEnabled(offering)),
      query
    );
    const [slots, structuredWindowCount] = await Promise.all([
      findPublicAvailabilitySlots(this.prisma, {
        companionId: companion.id,
        durationMinutes: service.durationMinutes,
        earliestStart,
        until,
        evaluatedAt: now,
        limit: MAX_PUBLIC_AVAILABILITY_CANDIDATES
      }),
      this.prisma.companionAvailabilityWindow.count({
        where: {
          companionId: companion.id,
          isActive: true,
          endsAt: { gt: now }
        }
      })
    ]);

    const source = structuredWindowCount > 0 ? "structured" : "legacy";
    return {
      source,
      timezone: AVAILABILITY_TIMEZONE,
      serviceOfferingId: service.serviceOfferingId,
      durationMinutes: service.durationMinutes,
      legacyAvailableTimes: source === "legacy" ? companion.availableTimes : [],
      items: source === "structured" ? slots.map((slot) => ({
        id: `${slot.availabilityWindowId}:${slot.startsAt.toISOString()}`,
        availabilityWindowId: slot.availabilityWindowId,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        capacity: slot.capacity,
        reservedCount: slot.reservedCount,
        availableCapacity: slot.capacity - slot.reservedCount
      })) : []
    };
  }

  async getOwn(userId: string) {
    const item = await this.prisma.companionProfile.findUnique({
      where: { ownerUserId: userId },
      include: this.includeTags()
    } as any);
    if (!item) {
      throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    return this.toDto(item as CompanionRecord);
  }

  /**
   * The public catalog intentionally hides inactive offerings. Its owner needs
   * the complete list, including drafts and retired entries, to operate the
   * catalog without ever being able to inspect another companion's data.
   */
  async listOwnServiceOfferings(
    userId: string,
    query: ListServiceOfferingsDto = new ListServiceOfferingsDto()
  ) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const where = { companionId: companion.id };
    const [items, total, active] = await Promise.all([
      this.prisma.companionServiceOffering.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.companionServiceOffering.count({ where } as any),
      this.prisma.companionServiceOffering.count({
        where: { ...where, isActive: true }
      } as any)
    ]);
    return {
      items: items.map((item: any) => this.toOwnServiceOfferingDto(item)),
      summary: { total, active },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async createOwnServiceOffering(userId: string, dto: CreateOwnServiceOfferingDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const data = this.normalizeOwnServiceOfferingCreate(dto);
    const id = randomUUID();
    await this.assertPublicServiceOfferingContentAllowed({
      title: data.title,
      description: data.description,
      targetId: id,
      subjectUserId: userId,
      actorId: userId,
      action: "创建"
    });
    const created = await this.prisma.$transaction(async (transaction) => {
      const db = transaction as any;
      // Concurrent creates for one catalog serialize on its profile row, so
      // both requests cannot observe the same pre-limit count and overfill it.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companion.id} FOR UPDATE`;
      const lockedCompanion = await db.companionProfile.findUnique({
        where: { id: companion.id },
        select: {
          id: true,
          ownerUserId: true,
          isVerified: true,
          owner: {
            select: {
              accountStatus: true,
              profile: { select: { isVerified: true } }
            }
          }
        }
      });
      if (!lockedCompanion || lockedCompanion.ownerUserId !== userId) {
        throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
      }
      this.assertEligibleOwnCompanion(lockedCompanion);
      const currentCount = await db.companionServiceOffering.count({
        where: { companionId: lockedCompanion.id }
      });
      if (currentCount >= MAX_SERVICE_OFFERINGS_PER_COMPANION) {
        throw new AppException(
          "SERVICE_OFFERING_LIMIT_REACHED",
          `A companion may keep at most ${MAX_SERVICE_OFFERINGS_PER_COMPANION} service offerings`,
          HttpStatus.CONFLICT,
          { limit: MAX_SERVICE_OFFERINGS_PER_COMPANION }
        );
      }
      return db.companionServiceOffering.create({
        data: {
          id,
          companionId: lockedCompanion.id,
          // Codes are stable, server-owned identifiers. They are intentionally
          // not a self-service field, so ordinary edits cannot collide with or
          // rewrite historic order snapshots.
          code: `service-${id}`,
          ...data
        }
      });
    });
    return this.toOwnServiceOfferingDto(created as any);
  }

  async updateOwnServiceOffering(userId: string, serviceOfferingId: string, dto: UpdateOwnServiceOfferingDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const normalizedId = serviceOfferingId.trim();
    if (!normalizedId) {
      throw new AppException("INVALID_SERVICE_OFFERING", "service offering id cannot be blank", HttpStatus.BAD_REQUEST);
    }
    const existing = await this.prisma.companionServiceOffering.findFirst({
      where: { id: normalizedId, companionId: companion.id }
    } as any);
    if (!existing) {
      // Do not distinguish another companion's offering from a missing one.
      throw new AppException("SERVICE_OFFERING_NOT_FOUND", "Service offering not found", HttpStatus.NOT_FOUND);
    }
    const update = this.normalizeOwnServiceOfferingUpdate(dto);
    if (Object.keys(update).length === 0) {
      throw new AppException("INVALID_SERVICE_OFFERING", "At least one service offering field is required", HttpStatus.BAD_REQUEST);
    }
    // Legacy voice offerings can remain in the owner catalog so they can be
    // retired, but a partial `{ isActive: true }` update must not bypass the
    // delivery-mode validation that guards new voice offerings.
    if (existing.deliveryMode === "voice" && update.isActive === true) {
      this.assertVoiceServiceOfferingEnabled();
    }

    const next = { ...existing, ...update };
    const contentChanged = update.title !== undefined || update.description !== undefined;
    const isBecomingPublic = update.isActive === true && !existing.isActive;
    if (contentChanged || isBecomingPublic) {
      await this.assertPublicServiceOfferingContentAllowed({
        title: next.title,
        description: next.description,
        targetId: existing.id,
        subjectUserId: userId,
        actorId: userId,
        action: isBecomingPublic ? "上架" : "编辑"
      });
    }
    const updated = await this.prisma.companionServiceOffering.update({
      where: { id: existing.id },
      data: update
    } as any);
    return this.toOwnServiceOfferingDto(updated as any);
  }

  /**
   * Owner-facing windows deliberately return retired entries too. A window is
   * never deleted by this API because orders retain a restrictive reference to
   * it; retirement is the reversible and auditable way to stop new bookings.
   */
  async listOwnAvailabilityWindows(
    userId: string,
    query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const where = {
      // Generated inactive drafts have their own bounded owner-review endpoint.
      // Keep the ordinary window calendar focused on manual entries and already
      // activated windows, so an old draft cannot be mistaken for live supply.
      companionId: companion.id,
      NOT: {
        isActive: false,
        recurringOccurrenceStartsAt: { not: null }
      }
    };
    const now = new Date();
    const futureActiveWhere = {
      ...where,
      isActive: true,
      startsAt: { gt: now }
    };
    const [items, total, futureActiveCount, nextFutureActive] = await Promise.all([
      this.prisma.companionAvailabilityWindow.findMany({
        where,
        orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.companionAvailabilityWindow.count({ where } as any),
      this.prisma.companionAvailabilityWindow.count({ where: futureActiveWhere } as any),
      this.prisma.companionAvailabilityWindow.findFirst({
        where: futureActiveWhere,
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        select: { startsAt: true }
      } as any)
    ]);
    return {
      items: items.map((item: any) => this.toOwnAvailabilityWindowDto(item)),
      summary: {
        futureActiveCount,
        nextFutureActiveStartsAt: nextFutureActive?.startsAt?.toISOString() ?? null
      },
      pagination: this.ownerListPagination(query, total)
    };
  }

  async createOwnAvailabilityWindow(userId: string, dto: CreateOwnAvailabilityWindowDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const data = this.normalizeOwnAvailabilityWindowCreate(dto);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Serialize calendar writes for one companion. The customer order flow
      // locks the same profile before it locks a selected window, so a newly
      // configured range cannot race an order against an overlapping write.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companion.id} FOR UPDATE`;
      if (data.isActive) {
        await this.assertNoOverlappingActiveAvailabilityWindow(db, {
          companionId: companion.id,
          startsAt: data.startsAt,
          endsAt: data.endsAt
        });
      } else {
        await this.assertInactiveAvailabilityWindowCapacity(db, companion.id);
      }
      const created = await db.companionAvailabilityWindow.create({
        data: { companionId: companion.id, ...data }
      });
      if (this.isFutureActiveAvailabilityWindow(created)) {
        await this.availabilityReminderCandidates.recordWindowBecameAvailable(db, created);
      }
      return this.toOwnAvailabilityWindowDto(created);
    });
  }

  async updateOwnAvailabilityWindow(userId: string, availabilityWindowId: string, dto: UpdateOwnAvailabilityWindowDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const normalizedId = availabilityWindowId.trim();
    if (!normalizedId) {
      throw new AppException("INVALID_AVAILABILITY_WINDOW", "availability window id cannot be blank", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT "id" FROM "CompanionAvailabilityWindow"
        WHERE "id" = ${normalizedId} AND "companionId" = ${companion.id}
        FOR UPDATE
      `;
      const existing = await db.companionAvailabilityWindow.findFirst({
        where: { id: normalizedId, companionId: companion.id }
      });
      if (!existing) {
        // A caller cannot use this endpoint to learn another owner's window id.
        throw new AppException("AVAILABILITY_WINDOW_NOT_FOUND", "Availability window not found", HttpStatus.NOT_FOUND);
      }
      const update = this.normalizeOwnAvailabilityWindowUpdate(dto);
      if (Object.keys(update).length === 0) {
        throw new AppException("INVALID_AVAILABILITY_WINDOW", "At least one availability window field is required", HttpStatus.BAD_REQUEST);
      }

      // Every writable field changes customer-visible booking behavior. Keep a
      // pending request, paid booking, or service in progress immutable until
      // it resolves instead of invalidating it behind either participant.
      await this.assertAvailabilityWindowHasNoOpenOrders(db, existing.id);
      const next = { ...existing, ...update } as {
        id: string;
        startsAt: Date;
        endsAt: Date;
        capacity: number;
        isActive: boolean;
      };
      this.assertOwnAvailabilityWindowShape(next);
      if (next.isActive) {
        await this.assertNoOverlappingActiveAvailabilityWindow(db, {
          companionId: companion.id,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          excludedWindowId: existing.id
        });
      } else if (existing.isActive) {
        await this.assertInactiveAvailabilityWindowCapacity(db, companion.id);
      }
      const updated = await db.companionAvailabilityWindow.update({
        where: { id: existing.id },
        data: update
      });
      if (!existing.isActive && this.isFutureActiveAvailabilityWindow(updated)) {
        await this.availabilityReminderCandidates.recordWindowBecameAvailable(db, updated);
      }
      return this.toOwnAvailabilityWindowDto(updated);
    });
  }

  /**
   * These owner-only planning inputs are deliberately separate from concrete
   * availability windows. Reading or writing them does not materialize drafts,
   * publish capacity, create reminder candidates, or touch orders.
   */
  async listOwnRecurringAvailabilityRules(
    userId: string,
    query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const where = { companionId: companion.id };
    const [items, total] = await Promise.all([
      this.prisma.companionRecurringAvailabilityRule.findMany({
        where,
        orderBy: [
          { isActive: "desc" },
          { weekday: "asc" },
          { startsAtMinute: "asc" },
          { createdAt: "asc" },
          { id: "asc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.companionRecurringAvailabilityRule.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.toOwnRecurringAvailabilityRuleDto(item)),
      pagination: this.ownerListPagination(query, total)
    };
  }

  async createOwnRecurringAvailabilityRule(userId: string, dto: CreateOwnRecurringAvailabilityRuleDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const created = await this.availabilityScheduleRules.createRecurringRule(companion.id, {
      weekday: dto.weekday,
      startsAtMinute: dto.startsAtMinute,
      endsAtMinute: dto.endsAtMinute,
      ...(dto.capacity === undefined ? {} : { capacity: dto.capacity }),
      // The owner API intentionally creates a rule that can later be retired;
      // it does not expose draft activation or an arbitrary timezone setting.
      isActive: true
    });
    return this.toOwnRecurringAvailabilityRuleDto(created as any);
  }

  async deactivateOwnRecurringAvailabilityRule(userId: string, ruleId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const retired = await this.availabilityScheduleRules.deactivateRecurringRule(companion.id, ruleId);
    return this.toOwnRecurringAvailabilityRuleDto(retired as any);
  }

  async listOwnAvailabilityBlackouts(
    userId: string,
    query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const where = { companionId: companion.id };
    const [items, total] = await Promise.all([
      this.prisma.companionAvailabilityBlackout.findMany({
        where,
        orderBy: [
          { isActive: "desc" },
          { startsAt: "asc" },
          { createdAt: "asc" },
          { id: "asc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.companionAvailabilityBlackout.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.toOwnAvailabilityBlackoutDto(item)),
      pagination: this.ownerListPagination(query, total)
    };
  }

  async createOwnAvailabilityBlackout(userId: string, dto: CreateOwnAvailabilityBlackoutDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const created = await this.availabilityScheduleRules.createBlackout(companion.id, {
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      isActive: true
    });
    return this.toOwnAvailabilityBlackoutDto(created as any);
  }

  async deactivateOwnAvailabilityBlackout(userId: string, blackoutId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const retired = await this.availabilityScheduleRules.deactivateBlackout(companion.id, blackoutId);
    return this.toOwnAvailabilityBlackoutDto(retired as any);
  }

  /**
   * Drafts are generated planning records, not ordinary retired availability.
   * This deliberately exposes only a short, future review horizon and does not
   * include another companion's configuration, a customer, or a public result.
   */
  async listOwnRecurringAvailabilityDrafts(
    userId: string,
    query: ListOwnScheduleItemsDto = new ListOwnScheduleItemsDto()
  ) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const now = new Date();
    const horizonEndsAt = this.recurringAvailabilityDraftHorizonEndsAt(now);
    const where = {
      companionId: companion.id,
      isActive: false,
      recurringAvailabilityRuleId: { not: null },
      recurringOccurrenceStartsAt: { not: null },
      startsAt: { gt: now },
      endsAt: { lte: horizonEndsAt }
    };
    const [items, total] = await Promise.all([
      this.prisma.companionAvailabilityWindow.findMany({
        where,
        orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.companionAvailabilityWindow.count({ where } as any)
    ]);
    return {
      horizonEndsAt: horizonEndsAt.toISOString(),
      items: items.map((item: any) => this.toOwnRecurringAvailabilityDraftDto(item)),
      pagination: this.ownerListPagination(query, total)
    };
  }

  async materializeOwnRecurringAvailabilityDrafts(userId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    if (!this.recurringAvailabilityDraftMaterializer) {
      throw new AppException(
        "RECURRING_AVAILABILITY_MATERIALIZER_UNAVAILABLE",
        "Recurring availability draft generation is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return this.recurringAvailabilityDraftMaterializer.materialize(companion.id);
  }

  /**
   * This is intentionally not routed through updateOwnAvailabilityWindow(). A
   * manual reactivation may create a private reminder candidate; explicit
   * review of a generated draft must not. It only changes this one draft after
   * checking its current source rule, blackout, existing window, and orders.
   */
  async activateOwnRecurringAvailabilityDraft(userId: string, params: OwnRecurringAvailabilityDraftParamsDto) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const draftId = this.normalizeOwnRecurringAvailabilityDraftId(params?.id);
    const now = new Date();
    const horizonEndsAt = this.recurringAvailabilityDraftHorizonEndsAt(now);

    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Use the same profile-first lock order as order creation and schedule
      // writes before locking the individual draft row.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${companion.id} FOR UPDATE`;
      await db.$queryRaw`
        SELECT "id" FROM "CompanionAvailabilityWindow"
        WHERE "id" = ${draftId} AND "companionId" = ${companion.id}
        FOR UPDATE
      `;
      const draft = await db.companionAvailabilityWindow.findFirst({
        where: {
          id: draftId,
          companionId: companion.id,
          isActive: false,
          recurringAvailabilityRuleId: { not: null },
          recurringOccurrenceStartsAt: { not: null },
          startsAt: { gt: now },
          endsAt: { lte: horizonEndsAt }
        }
      });
      if (!draft) {
        // Do not distinguish a different owner's, an expired, a manual, or an
        // already-activated window from a missing reviewable draft.
        throw new AppException(
          "RECURRING_AVAILABILITY_DRAFT_NOT_FOUND",
          "Recurring availability draft not found",
          HttpStatus.NOT_FOUND
        );
      }

      const sourceRule = await db.companionRecurringAvailabilityRule.findFirst({
        where: {
          id: draft.recurringAvailabilityRuleId,
          companionId: companion.id,
          isActive: true,
          timezone: COMPANION_AVAILABILITY_SCHEDULE_TIMEZONE
        },
        select: {
          id: true,
          weekday: true,
          startsAtMinute: true,
          endsAtMinute: true,
          capacity: true
        }
      });
      if (!sourceRule) {
        throw new AppException(
          "RECURRING_AVAILABILITY_DRAFT_SOURCE_UNAVAILABLE",
          "The draft source rule is no longer active",
          HttpStatus.CONFLICT
        );
      }
      this.assertRecurringAvailabilityDraftMatchesRule(draft, sourceRule);

      const blackout = await db.companionAvailabilityBlackout.findFirst({
        where: {
          companionId: companion.id,
          isActive: true,
          startsAt: { lt: draft.endsAt },
          endsAt: { gt: draft.startsAt }
        },
        select: { id: true }
      });
      if (blackout) {
        throw new AppException(
          "RECURRING_AVAILABILITY_DRAFT_BLOCKED_BY_BLACKOUT",
          "The draft now overlaps an active availability blackout",
          HttpStatus.CONFLICT
        );
      }

      // Reuse the same single-window shape, direct-order, and active-window
      // protections as ordinary owner configuration, then add a range-order
      // recheck for an order that may have appeared since materialization.
      this.assertOwnAvailabilityWindowShape({ ...draft, isActive: true });
      await this.assertAvailabilityWindowHasNoOpenOrders(db, draft.id);
      await this.assertNoOverlappingOpenAvailabilityOrder(db, {
        companionId: companion.id,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt
      });
      await this.assertNoOverlappingActiveAvailabilityWindow(db, {
        companionId: companion.id,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        excludedWindowId: draft.id
      });

      const activated = await db.companionAvailabilityWindow.update({
        where: { id: draft.id },
        data: { isActive: true }
      });
      // No availabilityReminderCandidates call: this explicit private draft
      // review does not enter the reminder-preparation or delivery chain.
      return this.toOwnAvailabilityWindowDto(activated);
    });
  }

  /** Staff-only view: includes unpublished applications so they can be
   * approved or taken down without relying on a direct database/API call. */
  async listAdmin(page = 1, pageSize = 50, commercialStatus?: string) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safePageSize = Math.min(Math.max(1, Math.floor(pageSize) || 50), 100);
    if (commercialStatus && !["pendingReview", "verified", "suspended"].includes(commercialStatus)) {
      throw new AppException(
        "COMMERCIAL_PROFILE_STATUS_INVALID",
        "Unknown commercial profile status",
        HttpStatus.BAD_REQUEST
      );
    }
    const where = commercialStatus
      ? { commercialProfile: { is: { status: commercialStatus } } }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.companionProfile.findMany({
        where,
        include: {
          ...this.includeTags(),
          owner: { include: { profile: true } },
          commercialProfile: true
        },
        orderBy: [{ isPublished: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionProfile.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => ({
        ...this.toDto(item),
        owner: item.owner ? {
          id: item.owner.id,
          accountStatus: item.owner.accountStatus,
          isVerified: item.owner.profile?.isVerified === true,
          displayName: item.owner.profile?.displayName ?? null
        } : null,
        commercialStatus: item.commercialProfile?.status ?? "missing",
        commercialProfile: item.commercialProfile ? {
          companionId: item.commercialProfile.companionId,
          status: item.commercialProfile.status,
          settlementRecipientMasked: item.commercialProfile.settlementRecipientMasked,
          taxProfileRef: item.commercialProfile.taxProfileRef,
          identityEvidenceRef: item.commercialProfile.identityEvidenceRef,
          serviceAgreementVersion: item.commercialProfile.serviceAgreementVersion,
          serviceAgreementEvidenceRef: item.commercialProfile.serviceAgreementEvidenceRef,
          submittedAt: item.commercialProfile.submittedAt?.toISOString?.() ?? null,
          verifiedAt: item.commercialProfile.verifiedAt?.toISOString?.() ?? null,
          adultEligibility: {
            verdict: item.commercialProfile.adultEligibilityVerdict ?? "pending",
            verifiedAt: item.commercialProfile.adultEligibilityVerifiedAt?.toISOString?.() ?? null,
            validUntil: item.commercialProfile.adultEligibilityValidUntil?.toISOString?.() ?? null,
            evidenceAvailable: Boolean(item.commercialProfile.adultEligibilityEvidenceRef)
          },
          suspendedAt: item.commercialProfile.suspendedAt?.toISOString?.() ?? null,
          suspendedReason: item.commercialProfile.suspendedReason ?? null,
          nextReviewDueAt: item.commercialProfile.nextReviewDueAt?.toISOString?.() ?? null,
          createdAt: item.commercialProfile.createdAt?.toISOString?.() ?? null,
          updatedAt: item.commercialProfile.updatedAt?.toISOString?.() ?? null
        } : null
      })),
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / safePageSize))
      }
    };
  }

  async apply(userId: string, dto: ApplyCompanionDto) {
    const user: any = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user?.profile?.isVerified) {
      throw new AppException("VERIFICATION_REQUIRED", "Real-name verification is required", HttpStatus.FORBIDDEN);
    }
    const existing = await this.prisma.companionProfile.findUnique({ where: { ownerUserId: userId } } as any);
    if (existing) {
      throw new AppException("APPLICATION_EXISTS", "Companion application already exists", HttpStatus.CONFLICT);
    }
    const name = user.profile.displayName?.trim() || "待审核用户";
    const id = randomUUID();
    const role = dto.role.trim();
    const bio = dto.bio.trim();
    const cityDistrict = dto.cityDistrict.trim();
    if (!role || !bio || !cityDistrict) {
      throw new AppException("INVALID_COMPANION_PROFILE", "Public profile text cannot be blank", HttpStatus.BAD_REQUEST);
    }
    const tags = this.normalizeRequiredList(dto.tags, "tags");
    const availableTimes = this.normalizeRequiredList(dto.availableTimes, "availableTimes");
    const languages = this.normalizeRequiredList(dto.languages, "languages");
    const specialties = this.normalizeRequiredList(dto.specialties, "specialties");
    await this.assertPublicContentAllowed({
      content: this.publicProfileContent({
        name,
        role,
        bio,
        availableTimes,
        languages,
        specialties,
        cityDistrict
      }, tags),
      targetId: id,
      subjectUserId: userId,
      title: "陪伴者申请公开资料待处理"
    });
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await this.assertAssignableOwnerUnderLock(db, userId);
      const racedApplication = await db.companionProfile.findUnique({
        where: { ownerUserId: userId },
        select: { id: true }
      });
      if (racedApplication) {
        throw new AppException(
          "APPLICATION_EXISTS",
          "Companion application already exists",
          HttpStatus.CONFLICT
        );
      }
      await db.companionProfile.create({
        data: {
          id,
          ownerUserId: userId,
          name,
          role,
          initials: name.slice(0, 2),
          rating: 0,
          ratingSum: 0,
          reviewCount: 0,
          pricePerHalfHour: dto.pricePerHalfHour,
          isOnline: false,
          isVerified: true,
          bio,
          availableTimes,
          languages,
          specialties,
          topicIds: this.resolveTopicIds({ ...dto, specialties, tags }),
          completedOrders: 0,
          responseTime: "暂无数据",
          distanceKm: 0,
          availability: "busy",
          cityDistrict,
          isPublished: false
        }
      } as any);
    });
    await this.replaceTags(id, tags);
    return this.getOwn(userId);
  }

  async updateOwn(userId: string, dto: UpdateOwnCompanionDto) {
    const existing = await this.prisma.companionProfile.findUnique({ where: { ownerUserId: userId } } as any);
    if (!existing) {
      throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    const role = dto.role?.trim();
    const bio = dto.bio?.trim();
    const cityDistrict = dto.cityDistrict?.trim();
    const livedExperience = dto.livedExperience?.trim();
    const availableTimes = dto.availableTimes === undefined
      ? undefined
      : this.normalizeRequiredList(dto.availableTimes, "availableTimes");
    const tags = dto.tags === undefined ? undefined : this.normalizeRequiredList(dto.tags, "tags");
    const languages = dto.languages === undefined
      ? undefined
      : this.normalizeRequiredList(dto.languages, "languages");
    const specialties = dto.specialties === undefined
      ? undefined
      : this.normalizeRequiredList(dto.specialties, "specialties");
    const serviceBoundaries = dto.serviceBoundaries === undefined
      ? undefined
      : [...new Set(dto.serviceBoundaries.map((value) => value.trim()).filter(Boolean))];
    const voiceIntroAssetRef = dto.voiceIntroAssetRef?.trim();
    if ((role !== undefined && !role) || (bio !== undefined && !bio) || (cityDistrict !== undefined && !cityDistrict)) {
      throw new AppException("INVALID_COMPANION_PROFILE", "Public profile text cannot be blank", HttpStatus.BAD_REQUEST);
    }
    if (dto.serviceBoundaries !== undefined && serviceBoundaries?.length !== dto.serviceBoundaries.length) {
      throw new AppException(
        "INVALID_COMPANION_PROFILE",
        "Service boundaries cannot contain blank or duplicate entries",
        HttpStatus.BAD_REQUEST
      );
    }
    // MP-D05 first-release text-only: refuse voice-intro writes before any profile mutation.
    if (
      (voiceIntroAssetRef !== undefined || dto.voiceIntroDurationSeconds !== undefined)
      && !isFirstReleaseCapabilityEnabled("voiceIntro", this.config)
    ) {
      throw new AppException(
        "VOICE_INTRO_UNAVAILABLE",
        "Voice introductions are unavailable on the text-only first-release surface",
        HttpStatus.CONFLICT,
        {
          capability: "voiceIntro",
          commercialSurface: "text_only",
          publicInteractionBlocked: false
        }
      );
    }
    if ((voiceIntroAssetRef === undefined) !== (dto.voiceIntroDurationSeconds === undefined)) {
      throw new AppException(
        "VOICE_INTRO_METADATA_INCOMPLETE",
        "Voice introduction reference and duration must be submitted together",
        HttpStatus.BAD_REQUEST
      );
    }
    let currentTags: string[] = [];
    if (
      role !== undefined
      || bio !== undefined
      || cityDistrict !== undefined
      || livedExperience !== undefined
      || availableTimes !== undefined
      || languages !== undefined
      || specialties !== undefined
      || serviceBoundaries !== undefined
      || tags !== undefined
    ) {
      if (tags !== undefined || specialties !== undefined) {
        currentTags = (await this.prisma.companionServiceTag.findMany({
          where: { companionId: existing.id },
          include: { tag: true }
        } as any)).map((entry: any) => entry.tag.name);
      }
      const content = [
        role ?? existing.role,
        bio ?? existing.bio,
        cityDistrict ?? existing.cityDistrict,
        livedExperience ?? existing.livedExperience ?? "",
        ...(availableTimes ?? existing.availableTimes),
        ...(languages ?? existing.languages),
        ...(specialties ?? existing.specialties),
        ...(serviceBoundaries ?? existing.serviceBoundaries ?? []),
        ...(tags ?? currentTags)
      ].join("\n");
      await this.assertPublicContentAllowed({
        content,
        targetId: existing.id,
        subjectUserId: userId,
        actorId: userId,
        title: "陪伴者公开资料待处理"
      });
    }
    await this.prisma.companionProfile.update({
      where: { id: existing.id },
      data: {
        ...(bio !== undefined ? { bio } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(cityDistrict !== undefined ? { cityDistrict } : {}),
        ...(livedExperience !== undefined ? { livedExperience: livedExperience || null } : {}),
        ...(availableTimes !== undefined ? { availableTimes } : {}),
        ...(languages !== undefined ? { languages } : {}),
        ...(specialties !== undefined ? { specialties } : {}),
        ...(serviceBoundaries !== undefined ? { serviceBoundaries } : {}),
        ...(tags !== undefined || specialties !== undefined ? {
          topicIds: this.resolveTopicIds({
            specialties: specialties ?? existing.specialties,
            tags: tags ?? currentTags
          })
        } : {}),
        ...(voiceIntroAssetRef !== undefined ? {
          voiceIntroAssetRef,
          voiceIntroDurationSeconds: dto.voiceIntroDurationSeconds,
          voiceIntroStatus: "pendingReview"
        } : {}),
        ...(dto.availability !== undefined ? {
          availability: dto.availability,
          isOnline: dto.availability === "online"
        } : {})
      }
    } as any);
    if (tags !== undefined) {
      await this.replaceTags(existing.id, tags);
    }
    return this.getOwn(userId);
  }

  async create(dto: CreateCompanionDto) {
    if (dto.isPublished) {
      throw new AppException(
        "COMMERCIAL_PROFILE_REQUIRED",
        "Create the companion unpublished, verify its commercial profile, then publish it",
        HttpStatus.CONFLICT
      );
    }
    const id = dto.id ?? randomUUID();
    const data: any = {
      id,
      ...this.profileData(dto),
      rating: 0,
      ratingSum: 0,
      reviewCount: 0,
      completedOrders: 0,
      responseTime: "暂无履约数据",
      isPublished: dto.isPublished ?? false
    };
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // The retention worker locks the same User row before it verifies that no
      // companion can be attached to a deleted subject. Do the eligibility and
      // deletion checks after taking that lock so even an unpublished profile
      // cannot be assigned from a stale pre-deletion read.
      if (dto.ownerUserId !== undefined && dto.ownerUserId !== null) {
        await this.assertAssignableOwnerUnderLock(db, dto.ownerUserId);
      }
      await db.companionProfile.create({ data });
    });

    await this.replaceTags(id, dto.tags);
    return this.getAdmin(id);
  }

  async update(id: string, dto: UpdateCompanionDto) {
    const existing = await this.findRecordOrThrow(id);
    if (existing.isPublished || dto.isPublished) {
      await this.assertPublicContentAllowed({
        content: this.publicProfileContent({
          name: dto.name ?? existing.name,
          role: dto.role ?? existing.role,
          bio: dto.bio ?? existing.bio,
          availableTimes: dto.availableTimes ?? existing.availableTimes,
          languages: dto.languages ?? existing.languages,
          specialties: dto.specialties ?? existing.specialties,
          cityDistrict: dto.cityDistrict ?? existing.cityDistrict
        }, dto.tags ?? existing.serviceTags.map((entry) => entry.tag.name)),
        targetId: id,
        subjectUserId: dto.ownerUserId ?? existing.ownerUserId ?? undefined,
        title: "已发布陪伴者资料待处理"
      });
    }
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Every owner-sensitive path uses User(s, stable id order) ->
      // CompanionProfile. Explicit reassignment locks and revalidates both the
      // old and proposed owner, so an in-flight deletion of the old owner
      // cannot be converted into a cross-subject erasure.
      const mayRemainPublished = dto.isPublished ?? existing.isPublished;
      const explicitOwnerAssignment = dto.ownerUserId !== undefined;
      const ownerIdsToLock = [...new Set([
        ...(explicitOwnerAssignment && existing.ownerUserId ? [existing.ownerUserId] : []),
        ...(dto.ownerUserId ? [dto.ownerUserId] : []),
        ...(!explicitOwnerAssignment && mayRemainPublished && existing.ownerUserId
          ? [existing.ownerUserId]
          : [])
      ])].sort();
      const checkedOwners = new Map<string, any>();
      for (const ownerUserId of ownerIdsToLock) {
        checkedOwners.set(
          ownerUserId,
          await this.assertAssignableOwnerUnderLock(db, ownerUserId)
        );
      }
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${id} FOR UPDATE`;
      const current = await db.companionProfile.findUnique({
        where: { id },
        select: {
          id: true,
          ownerUserId: true,
          isVerified: true,
          isPublished: true,
          updatedAt: true
        }
      });
      if (!current) {
        throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
      }
      if (current.updatedAt.getTime() !== existing.updatedAt.getTime()) {
        throw new AppException(
          "COMPANION_PROFILE_CHANGED",
          "Companion profile changed while this update was being reviewed",
          HttpStatus.CONFLICT
        );
      }
      if (current.ownerUserId !== existing.ownerUserId) {
        throw new AppException(
          "COMPANION_PROFILE_CHANGED",
          "Companion owner changed while this update was being reviewed",
          HttpStatus.CONFLICT
        );
      }

      const nextOwnerUserId = dto.ownerUserId !== undefined ? dto.ownerUserId : current.ownerUserId;
      const nextProfileVerified = dto.isVerified ?? current.isVerified;
      const nextPublished = dto.isPublished ?? current.isPublished;
      if (nextPublished) {
        await this.assertPublishableUnderLock(
          db,
          id,
          nextOwnerUserId,
          nextProfileVerified,
          nextOwnerUserId ? checkedOwners.get(nextOwnerUserId) : undefined
        );
      }
      await db.companionProfile.update({
        where: { id },
        data: this.profileData(dto)
      });
    });

    if (dto.tags) {
      await this.replaceTags(id, dto.tags);
    }

    return this.getAdmin(id);
  }

  async publish(id: string) {
    const existing = await this.findRecordOrThrow(id);
    await this.assertPublicContentAllowed({
      content: this.publicProfileContent(
        existing,
        existing.serviceTags.map((entry) => entry.tag.name)
      ),
      targetId: id,
      subjectUserId: existing.ownerUserId ?? undefined,
      title: "陪伴者资料发布前待处理"
    });
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Publish shares the same User -> CompanionProfile order as owner
      // assignment and account-deletion finalization. The profile read below
      // then validates that the preflight owner did not change while content
      // review was running.
      const assignedOwner = existing.ownerUserId
        ? await this.assertAssignableOwnerUnderLock(db, existing.ownerUserId)
        : undefined;
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${id} FOR UPDATE`;
      const current = await db.companionProfile.findUnique({
        where: { id },
        select: {
          id: true,
          ownerUserId: true,
          isVerified: true,
          updatedAt: true
        }
      });
      if (!current) {
        throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
      }
      if (current.updatedAt.getTime() !== existing.updatedAt.getTime()) {
        throw new AppException(
          "COMPANION_PROFILE_CHANGED",
          "Companion profile changed while publication was being reviewed",
          HttpStatus.CONFLICT
        );
      }
      if (current.ownerUserId !== existing.ownerUserId) {
        throw new AppException(
          "COMPANION_PROFILE_CHANGED",
          "Companion owner changed while publication was being reviewed",
          HttpStatus.CONFLICT
        );
      }
      await this.assertPublishableUnderLock(
        db,
        id,
        current.ownerUserId,
        current.isVerified,
        assignedOwner
      );
      await db.companionProfile.update({
        where: { id },
        data: { isPublished: true }
      });
    });
    return this.getAdmin(id);
  }

  async unpublish(id: string) {
    await this.findRecordOrThrow(id);
    await this.prisma.companionProfile.update({
      where: { id },
      data: { isPublished: false }
    });
    return this.getAdmin(id);
  }

  async getAdmin(id: string) {
    const item = await this.findRecordOrThrow(id);
    return this.toDto(item);
  }

  async ownerUserIdForAudit(id: string): Promise<string | null> {
    const companion = await this.prisma.companionProfile.findUnique({
      where: { id },
      select: { ownerUserId: true }
    } as any);
    return companion?.ownerUserId ?? null;
  }

  private buildPublicWhere(query: ListCompanionsQueryDto) {
    const where: any = this.publicCompanionWhere();
    if (query.availability) where.availability = query.availability;
    if (query.isOnline !== undefined) where.isOnline = query.isOnline === "true";
    if (query.tag) {
      where.serviceTags = {
        some: {
          tag: {
            name: query.tag
          }
        }
      };
    }
    // These are exact, explicitly selected public-profile facets. They are
    // deliberately independent of private application/KYC material, review
    // notes, behavioral inference, conversations and historic orders.
    if (query.language) where.languages = { has: query.language };
    if (query.specialty) where.specialties = { has: query.specialty };
    const search = this.publicSearchWhere(query);
    if (search) where.AND = [search];
    if (this.hasExplicitServiceFilters(query)) {
      where.serviceOfferings = { some: this.activeServiceOfferingWhere(query) };
    }
    return where;
  }

  private publicCompanionWhere() {
    return {
      isPublished: true,
      isVerified: true,
      ownerUserId: { not: null },
      owner: { accountStatus: "active", profile: { isVerified: true } },
      commercialProfile: {
        status: "verified",
        adultEligibilityVerdict: "adult",
        adultEligibilityValidUntil: { gt: new Date() }
      }
    };
  }

  private publicCatalogOrderBy(sortBy?: PublicCompanionSort) {
    // These modes deliberately use only fields already returned in the public
    // profile. They neither infer availability nor read personal behavior,
    // orders, conversations, bookmarks, recent views, or recommendation data.
    switch (sortBy) {
      case "rating":
        return [
          { rating: "desc" as const },
          { reviewCount: "desc" as const },
          { isOnline: "desc" as const },
          { pricePerHalfHour: "asc" as const },
          { id: "asc" as const }
        ];
      case "reviewCount":
        return [
          { reviewCount: "desc" as const },
          { rating: "desc" as const },
          { isOnline: "desc" as const },
          { pricePerHalfHour: "asc" as const },
          { id: "asc" as const }
        ];
      case "priceAsc":
        return [
          { pricePerHalfHour: "asc" as const },
          { isOnline: "desc" as const },
          { rating: "desc" as const },
          { reviewCount: "desc" as const },
          { id: "asc" as const }
        ];
      case "online":
      default:
        // Keep the established public-catalog order when the caller omits a
        // sort, and make the explicit "online" choice explain that same rule.
        return [
          { isOnline: "desc" as const },
          { rating: "desc" as const },
          { reviewCount: "desc" as const },
          { pricePerHalfHour: "asc" as const },
          { id: "asc" as const }
        ];
    }
  }

  private hasExplicitServiceFilters(query: ListCompanionsQueryDto): boolean {
    return Boolean(query.topicId || query.deliveryMode || query.maxServicePriceCents !== undefined);
  }

  private activeServiceOfferingWhere(query: ListCompanionsQueryDto) {
    // Explicit discovery filters are intentionally evaluated only through a
    // currently active service offering. This keeps retired/draft catalog
    // data, historic order pricing, profile-only topic labels,
    // recommendations, and private user behavior out of the result set.
    const deliveryMode = query.deliveryMode
      ?? (this.isVoiceBookingEnabled() ? undefined : "text");
    return {
      isActive: true,
      ...(query.topicId ? { topicIds: { has: query.topicId } } : {}),
      ...(deliveryMode ? { deliveryMode } : {}),
      ...(query.maxServicePriceCents !== undefined ? { priceCents: { lte: query.maxServicePriceCents } } : {})
    };
  }

  private isPublicServiceOfferingEnabled(offering: { id?: string; deliveryMode?: string }): boolean {
    return offering.deliveryMode !== "voice" || this.isVoiceBookingEnabled();
  }

  private isVoiceBookingEnabled(): boolean {
    if (!isFirstReleaseCapabilityEnabled("voiceSkuActivation", this.config)) return false;
    if (isCommercialTextOnlySurface(this.config)) return false;
    return this.config?.get<boolean>("TRTC_ENABLED", false) === true
      && this.config?.get<boolean>("TRTC_EMERGENCY_STOP_ENABLED", false) !== true;
  }

  private publicSearchWhere(query: ListCompanionsQueryDto) {
    const keyword = query.keyword;
    if (!keyword) return null;
    const text = { contains: keyword, mode: "insensitive" as const };
    // Profile fields may match independently, but when the keyword is found in
    // a service title it must be the very same active offering that meets any
    // selected topic, delivery, or price filters. Public biography, chat,
    // order, bookmark, recent-view, and recommendation fields are excluded.
    return {
      OR: [
        { name: text },
        { role: text },
        { serviceTags: { some: { tag: { name: text } } } },
        {
          serviceOfferings: {
            some: { ...this.activeServiceOfferingWhere(query), title: text }
          }
        }
      ]
    };
  }

  private async findCompanionsWithFutureCapacity(
    query: ListCompanionsQueryDto,
    days: number,
    companionIds?: string[],
    limit = 200
  ): Promise<SellableCompanionMatch[]> {
    const now = new Date();
    const earliestStart = new Date(now.getTime() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS);
    const until = new Date(now.getTime() + days * 24 * 60 * 60_000);
    const serviceWhere = this.activeServiceOfferingWhere(query);
    const publicCatalogWhere = this.buildPublicWhere(query);
    const matches: SellableCompanionMatch[] = [];
    let afterId: string | undefined;
    while (true) {
      const idFilter = companionIds || afterId
        ? {
            ...(companionIds ? { in: companionIds } : {}),
            ...(afterId ? { gt: afterId } : {})
          }
        : undefined;
      const candidates = (await this.prisma.companionProfile.findMany({
        where: {
          // Keep this capacity pass in the same public catalog scope as the
          // final list, including an explicit keyword. The later list still
          // re-applies every condition before returning a profile.
          ...publicCatalogWhere,
          ...(idFilter ? { id: idFilter } : {}),
          serviceOfferings: { some: serviceWhere },
          availabilityWindows: {
            some: {
              isActive: true,
              startsAt: { lt: until },
              endsAt: { gt: earliestStart }
            }
          }
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: PUBLIC_CAPACITY_SCAN_BATCH_SIZE
      } as any) as unknown) as Array<{ id: string }>;

      const batchMatches = await findCompanionCapacityMatches(this.prisma, {
        companionIds: candidates.map((candidate) => candidate.id),
        earliestStart,
        until,
        evaluatedAt: now,
        topicId: query.topicId,
        deliveryMode: serviceWhere.deliveryMode as "text" | "voice" | undefined,
        maxServicePriceCents: query.maxServicePriceCents
      });
      matches.push(...batchMatches.slice(0, Math.max(0, limit - matches.length)));
      if (matches.length >= limit) break;

      if (candidates.length < PUBLIC_CAPACITY_SCAN_BATCH_SIZE) break;
      afterId = candidates[candidates.length - 1].id;
    }
    return matches;
  }

  /**
   * Exact public pagination without a full-catalog id/materialized-order set.
   * Stable profile sorts stream in database order; volatile slot/price sorts
   * retain only the requested top-K while an exact sellable count is computed.
   */
  private async findSellableCatalogPage(
    query: ListCompanionsQueryDto,
    days: number,
    page: number,
    pageSize: number
  ): Promise<{ matches: SellableCompanionMatch[]; total: number }> {
    const now = new Date();
    const earliestStart = new Date(now.getTime() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS);
    const until = new Date(now.getTime() + days * DAY_MS);
    const serviceWhere = this.activeServiceOfferingWhere(query);
    const volatileSort = query.sortBy === "soonestAvailable" || query.sortBy === "priceAsc";
    const start = (page - 1) * pageSize;
    const end = page * pageSize;
    const retained: SellableCompanionMatch[] = [];
    let total = 0;
    let offset = 0;

    while (true) {
      const candidates = await this.prisma.companionProfile.findMany({
        where: {
          ...this.buildPublicWhere(query),
          serviceOfferings: { some: serviceWhere },
          availabilityWindows: {
            some: { isActive: true, startsAt: { lt: until }, endsAt: { gt: earliestStart } }
          }
        },
        select: { id: true },
        orderBy: volatileSort ? { id: "asc" } : this.publicCatalogOrderBy(query.sortBy),
        skip: offset,
        take: PUBLIC_CAPACITY_SCAN_BATCH_SIZE
      } as any) as Array<{ id: string }>;
      if (candidates.length === 0) break;

      const batch = await findCompanionCapacityMatches(this.prisma, {
        companionIds: candidates.map((candidate) => candidate.id),
        earliestStart,
        until,
        evaluatedAt: now,
        topicId: query.topicId,
        deliveryMode: serviceWhere.deliveryMode as "text" | "voice" | undefined,
        maxServicePriceCents: query.maxServicePriceCents
      });
      const byId = new Map(batch.map((match) => [match.id, match]));
      const orderedBatch = volatileSort
        ? batch
        : candidates.flatMap((candidate) => {
            const match = byId.get(candidate.id);
            return match ? [match] : [];
          });
      if (volatileSort) {
        retained.push(...orderedBatch);
        retained.sort((left, right) => this.compareCapacityMatches(left, right, query.sortBy));
        if (retained.length > end) retained.length = end;
      } else {
        for (const match of orderedBatch) {
          if (total >= start && total < end) retained.push(match);
          total += 1;
        }
      }
      if (volatileSort) total += orderedBatch.length;
      offset += candidates.length;
      if (candidates.length < PUBLIC_CAPACITY_SCAN_BATCH_SIZE) break;
    }

    return {
      matches: volatileSort ? retained.slice(start, end) : retained,
      total
    };
  }

  private compareCapacityMatches(
    left: SellableCompanionMatch,
    right: SellableCompanionMatch,
    sortBy?: PublicCompanionSort
  ) {
    return sortBy === "priceAsc"
      ? left.startingPriceCents - right.startingPriceCents
        || left.startingDurationMinutes - right.startingDurationMinutes
        || left.id.localeCompare(right.id)
      : left.earliestStartsAt.getTime() - right.earliestStartsAt.getTime()
        || left.id.localeCompare(right.id);
  }

  private includeTags() {
    return {
      serviceTags: {
        include: {
          tag: true
        },
        orderBy: {
          tag: {
            name: "asc" as const
          }
        }
      },
      // Only the dates needed for a truthful public review badge are loaded.
      // Reviewer identities and every submitted KYC/evidence field stay out of
      // this read model by construction.
      commercialProfile: {
        select: {
          verifiedAt: true,
          nextReviewDueAt: true
        }
      },
      // Scores, attempt counts and answers are private. Public status is
      // derived solely from the current required version and its expiry.
      trainingRecords: {
        select: {
          moduleCode: true,
          moduleVersion: true,
          status: true,
          passedAt: true,
          expiresAt: true
        }
      }
    };
  }

  private async findRecordOrThrow(id: string) {
    const item = await this.prisma.companionProfile.findUnique({
      where: { id },
      include: this.includeTags()
    });

    if (!item) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    return item;
  }

  /**
   * A companion may prepare catalog entries before commercial publication, but
   * only a currently active, identity-verified owner may operate them. Public
   * visibility remains governed separately by buildPublicWhere().
   */
  private async findEligibleOwnCompanion(userId: string) {
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
    this.assertEligibleOwnCompanion(companion);
    return companion as { id: string };
  }

  private assertEligibleOwnCompanion(companion: any) {
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
  }

  private normalizeOwnServiceOfferingCreate(dto: CreateOwnServiceOfferingDto) {
    return {
      title: this.normalizeServiceOfferingTitle(dto.title),
      description: this.normalizeServiceOfferingDescription(dto.description),
      deliveryMode: this.normalizeServiceOfferingDeliveryMode(dto.deliveryMode),
      durationMinutes: this.normalizeServiceOfferingDuration(dto.durationMinutes),
      priceCents: this.normalizeServiceOfferingPrice(dto.priceCents),
      topicIds: this.resolveTopicIds({ topicIds: dto.topicIds }),
      isActive: dto.isActive ?? true,
      sortOrder: this.normalizeServiceOfferingSortOrder(dto.sortOrder ?? 0)
    };
  }

  private normalizeOwnServiceOfferingUpdate(dto: UpdateOwnServiceOfferingDto) {
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = this.normalizeServiceOfferingTitle(dto.title);
    if (dto.description !== undefined) data.description = this.normalizeServiceOfferingDescription(dto.description);
    if (dto.deliveryMode !== undefined) data.deliveryMode = this.normalizeServiceOfferingDeliveryMode(dto.deliveryMode);
    if (dto.durationMinutes !== undefined) data.durationMinutes = this.normalizeServiceOfferingDuration(dto.durationMinutes);
    if (dto.priceCents !== undefined) data.priceCents = this.normalizeServiceOfferingPrice(dto.priceCents);
    if (dto.topicIds !== undefined) data.topicIds = this.resolveTopicIds({ topicIds: dto.topicIds });
    if (dto.isActive !== undefined) {
      if (typeof dto.isActive !== "boolean") {
        throw new AppException("INVALID_SERVICE_OFFERING", "isActive must be boolean", HttpStatus.BAD_REQUEST);
      }
      data.isActive = dto.isActive;
    }
    if (dto.sortOrder !== undefined) data.sortOrder = this.normalizeServiceOfferingSortOrder(dto.sortOrder);
    return data;
  }

  private normalizeServiceOfferingTitle(value: unknown): string {
    if (typeof value !== "string") {
      throw new AppException("INVALID_SERVICE_OFFERING", "title must be text", HttpStatus.BAD_REQUEST);
    }
    const title = value.trim();
    if (!title || title.length > 80) {
      throw new AppException("INVALID_SERVICE_OFFERING", "title must be between 1 and 80 characters", HttpStatus.BAD_REQUEST);
    }
    return title;
  }

  private normalizeServiceOfferingDescription(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw new AppException("INVALID_SERVICE_OFFERING", "description must be text", HttpStatus.BAD_REQUEST);
    }
    const description = value.trim();
    if (description.length > 500) {
      throw new AppException("INVALID_SERVICE_OFFERING", "description may not exceed 500 characters", HttpStatus.BAD_REQUEST);
    }
    return description || null;
  }

  private normalizeServiceOfferingDeliveryMode(value: unknown): "text" | "voice" {
    if (value === "text" || value === "voice") {
      if (value === "voice") this.assertVoiceServiceOfferingEnabled();
      return value;
    }
    throw new AppException("INVALID_SERVICE_OFFERING", "deliveryMode must be text or voice", HttpStatus.BAD_REQUEST);
  }

  private assertVoiceServiceOfferingEnabled() {
    if (this.isVoiceBookingEnabled()) return;
    throw new AppException(
      "COMMERCIAL_SURFACE_TEXT_ONLY",
      "Voice service offerings are disabled for the current commercial surface",
      HttpStatus.UNPROCESSABLE_ENTITY
    );
  }

  private normalizeServiceOfferingDuration(value: unknown): number {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 30 ||
      value > 240 ||
      value % 30 !== 0
    ) {
      throw new AppException(
        "INVALID_SERVICE_OFFERING_DURATION",
        "durationMinutes must be a 30-minute increment between 30 and 240",
        HttpStatus.BAD_REQUEST
      );
    }
    return value;
  }

  private normalizeServiceOfferingPrice(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 2_000_000) {
      throw new AppException(
        "INVALID_SERVICE_OFFERING_PRICE",
        "priceCents must be an integer between 100 and 2000000",
        HttpStatus.BAD_REQUEST
      );
    }
    return value;
  }

  private normalizeServiceOfferingSortOrder(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 9_999) {
      throw new AppException(
        "INVALID_SERVICE_OFFERING_SORT_ORDER",
        "sortOrder must be an integer between 0 and 9999",
        HttpStatus.BAD_REQUEST
      );
    }
    return value;
  }

  private async assertPublicServiceOfferingContentAllowed(input: {
    title: string;
    description: string | null;
    targetId: string;
    subjectUserId: string;
    actorId: string;
    action: "创建" | "编辑" | "上架";
  }): Promise<void> {
    await this.assertPublicContentAllowed({
      content: [input.title, input.description].filter((value): value is string => Boolean(value)).join("\n"),
      targetId: input.targetId,
      subjectUserId: input.subjectUserId,
      actorId: input.actorId,
      title: `陪伴者服务商品${input.action}待处理`,
      errorCode: "SERVICE_OFFERING_CONTENT_REQUIRES_REVISION",
      errorMessage: "Public service offering content cannot be published; revise it and try again"
    });
  }

  private normalizeOwnAvailabilityWindowCreate(dto: CreateOwnAvailabilityWindowDto) {
    const data = {
      startsAt: this.parseOwnAvailabilityWindowDate(dto.startsAt, "startsAt"),
      endsAt: this.parseOwnAvailabilityWindowDate(dto.endsAt, "endsAt"),
      capacity: this.normalizeOwnAvailabilityWindowCapacity(dto.capacity ?? 1),
      isActive: dto.isActive ?? true
    };
    if (typeof data.isActive !== "boolean") {
      throw new AppException("INVALID_AVAILABILITY_WINDOW", "isActive must be boolean", HttpStatus.BAD_REQUEST);
    }
    this.assertOwnAvailabilityWindowShape(data);
    return data;
  }

  private normalizeOwnAvailabilityWindowUpdate(dto: UpdateOwnAvailabilityWindowDto) {
    const data: Record<string, unknown> = {};
    if (dto.startsAt !== undefined) data.startsAt = this.parseOwnAvailabilityWindowDate(dto.startsAt, "startsAt");
    if (dto.endsAt !== undefined) data.endsAt = this.parseOwnAvailabilityWindowDate(dto.endsAt, "endsAt");
    if (dto.capacity !== undefined) data.capacity = this.normalizeOwnAvailabilityWindowCapacity(dto.capacity);
    if (dto.isActive !== undefined) {
      if (typeof dto.isActive !== "boolean") {
        throw new AppException("INVALID_AVAILABILITY_WINDOW", "isActive must be boolean", HttpStatus.BAD_REQUEST);
      }
      data.isActive = dto.isActive;
    }
    return data;
  }

  private parseOwnAvailabilityWindowDate(value: unknown, field: "startsAt" | "endsAt"): Date {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    ) {
      throw new AppException(
        "INVALID_AVAILABILITY_WINDOW",
        `${field} must be an ISO-8601 date-time with an explicit timezone`,
        HttpStatus.BAD_REQUEST
      );
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw new AppException("INVALID_AVAILABILITY_WINDOW", `${field} is invalid`, HttpStatus.BAD_REQUEST);
    }
    return parsed;
  }

  private normalizeOwnAvailabilityWindowCapacity(value: unknown): number {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_OWN_AVAILABILITY_CAPACITY
    ) {
      throw new AppException(
        "INVALID_AVAILABILITY_WINDOW_CAPACITY",
        `capacity must be an integer between 1 and ${MAX_OWN_AVAILABILITY_CAPACITY}`,
        HttpStatus.BAD_REQUEST
      );
    }
    return value;
  }

  private assertOwnAvailabilityWindowShape(input: {
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    isActive: boolean;
  }): void {
    const startsAtMs = input.startsAt.getTime();
    const endsAtMs = input.endsAt.getTime();
    if (startsAtMs % AVAILABILITY_STEP_MS !== 0 || endsAtMs % AVAILABILITY_STEP_MS !== 0) {
      throw new AppException(
        "INVALID_AVAILABILITY_WINDOW_ALIGNMENT",
        "startsAt and endsAt must use a 30-minute boundary",
        HttpStatus.BAD_REQUEST
      );
    }
    if (endsAtMs <= startsAtMs || endsAtMs - startsAtMs > MAX_OWN_AVAILABILITY_WINDOW_DURATION_MS) {
      throw new AppException(
        "INVALID_AVAILABILITY_WINDOW_RANGE",
        "endsAt must be after startsAt and the window may not exceed 24 hours",
        HttpStatus.BAD_REQUEST
      );
    }
    if (input.isActive && startsAtMs <= Date.now() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS) {
      throw new AppException(
        "AVAILABILITY_WINDOW_TOO_SOON",
        "An active availability window must start at least 15 minutes in the future",
        HttpStatus.CONFLICT
      );
    }
    if (!input.isActive && endsAtMs > Date.now() + MAX_INACTIVE_AVAILABILITY_WINDOW_HORIZON_MS) {
      throw new AppException(
        "INACTIVE_AVAILABILITY_WINDOW_TOO_FAR",
        "An inactive availability window may not extend beyond the 90-day planning horizon",
        HttpStatus.CONFLICT
      );
    }
    this.normalizeOwnAvailabilityWindowCapacity(input.capacity);
  }

  private async assertInactiveAvailabilityWindowCapacity(db: any, companionId: string) {
    const count = await db.companionAvailabilityWindow.count({
      where: { companionId, isActive: false }
    });
    if (count >= COMPANION_MAX_INACTIVE_AVAILABILITY_WINDOWS) {
      throw new AppException(
        "INACTIVE_AVAILABILITY_WINDOW_LIMIT_REACHED",
        `At most ${COMPANION_MAX_INACTIVE_AVAILABILITY_WINDOWS} inactive availability windows may be retained`,
        HttpStatus.CONFLICT
      );
    }
  }

  private isFutureActiveAvailabilityWindow(input: {
    startsAt: Date;
    capacity: number;
    isActive: boolean;
  }) {
    return input.isActive && input.capacity > 0 && input.startsAt.getTime() > Date.now();
  }

  private recurringAvailabilityDraftHorizonEndsAt(now: Date) {
    return new Date(now.getTime() + COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS * DAY_MS);
  }

  private normalizeOwnRecurringAvailabilityDraftId(value: unknown) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new AppException(
        "INVALID_RECURRING_AVAILABILITY_DRAFT",
        "recurring availability draft id cannot be blank",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private assertRecurringAvailabilityDraftMatchesRule(
    draft: {
      startsAt: Date;
      endsAt: Date;
      capacity: number;
      recurringOccurrenceStartsAt: Date | null;
    },
    rule: {
      weekday: number;
      startsAtMinute: number;
      endsAtMinute: number;
      capacity: number;
    }
  ) {
    const occurrenceStartsAt = draft.recurringOccurrenceStartsAt;
    const localStartsAt = new Date(draft.startsAt.getTime() + SHANGHAI_OFFSET_MS);
    const startsAtMinute = localStartsAt.getUTCHours() * 60 + localStartsAt.getUTCMinutes();
    const expectedEndsAt = new Date(
      draft.startsAt.getTime() + (rule.endsAtMinute - rule.startsAtMinute) * 60_000
    );
    if (
      !occurrenceStartsAt
      || occurrenceStartsAt.getTime() !== draft.startsAt.getTime()
      || localStartsAt.getUTCDay() !== rule.weekday
      || startsAtMinute !== rule.startsAtMinute
      || draft.endsAt.getTime() !== expectedEndsAt.getTime()
      || draft.capacity !== rule.capacity
    ) {
      throw new AppException(
        "RECURRING_AVAILABILITY_DRAFT_SOURCE_STALE",
        "The draft no longer matches its active source rule",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertNoOverlappingActiveAvailabilityWindow(
    db: any,
    input: { companionId: string; startsAt: Date; endsAt: Date; excludedWindowId?: string }
  ): Promise<void> {
    const overlap = await db.companionAvailabilityWindow.findFirst({
      where: {
        companionId: input.companionId,
        isActive: true,
        ...(input.excludedWindowId ? { id: { not: input.excludedWindowId } } : {}),
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt }
      },
      select: { id: true, startsAt: true, endsAt: true }
    });
    if (overlap) {
      throw new AppException(
        "AVAILABILITY_WINDOW_OVERLAP",
        "This availability window overlaps another active window",
        HttpStatus.CONFLICT,
        {
          overlappingWindowId: overlap.id,
          startsAt: overlap.startsAt.toISOString(),
          endsAt: overlap.endsAt.toISOString()
        }
      );
    }
  }

  private async assertAvailabilityWindowHasNoOpenOrders(db: any, availabilityWindowId: string): Promise<void> {
    const order = await db.order.findFirst({
      where: {
        availabilityWindowId,
        status: { in: ["pending", "paying", "paid", "inService"] }
      },
      select: { id: true, status: true, scheduledAt: true }
    });
    if (order) {
      throw new AppException(
        "AVAILABILITY_WINDOW_HAS_ACTIVE_ORDERS",
        "This availability window has an active order and cannot be changed or retired",
        HttpStatus.CONFLICT,
        {
          orderId: order.id,
          orderStatus: order.status,
          scheduledAt: order.scheduledAt.toISOString()
        }
      );
    }
  }

  private async assertNoOverlappingOpenAvailabilityOrder(
    db: any,
    input: { companionId: string; startsAt: Date; endsAt: Date }
  ): Promise<void> {
    const openOrders = await db.order.findMany({
      where: {
        companionId: input.companionId,
        status: { in: ["pending", "paying", "paid", "inService"] },
        scheduledAt: { lt: input.endsAt }
      },
      select: { id: true, scheduledAt: true, durationMinutes: true }
    });
    const overlapping = openOrders.find((order: { scheduledAt: Date; durationMinutes: number }) =>
      new Date(order.scheduledAt.getTime() + order.durationMinutes * 60_000) > input.startsAt
    );
    if (overlapping) {
      throw new AppException(
        "RECURRING_AVAILABILITY_DRAFT_HAS_OPEN_ORDER",
        "The draft overlaps an open order and cannot be activated",
        HttpStatus.CONFLICT
      );
    }
  }

  private resolveAvailabilityService(
    offerings: Array<{ id: string; durationMinutes: number; topicIds: string[] }>,
    query: ListCompanionAvailabilityQueryDto
  ): { serviceOfferingId: string | null; durationMinutes: number } {
    const suppliedId = query.serviceOfferingId?.trim();
    if (query.serviceOfferingId !== undefined && !suppliedId) {
      throw new AppException("INVALID_SERVICE_OFFERING", "serviceOfferingId cannot be blank", HttpStatus.BAD_REQUEST);
    }
    if (suppliedId) {
      const offering = offerings.find((item) => item.id === suppliedId);
      if (!offering) {
        throw new AppException(
          "SERVICE_OFFERING_UNAVAILABLE",
          "This service offering is no longer available",
          HttpStatus.CONFLICT
        );
      }
      if (query.durationMinutes !== undefined && query.durationMinutes !== offering.durationMinutes) {
        throw new AppException(
          "SERVICE_OFFERING_DURATION_MISMATCH",
          "Requested duration does not match the selected service offering",
          HttpStatus.CONFLICT,
          { expectedDurationMinutes: offering.durationMinutes }
        );
      }
      return { serviceOfferingId: offering.id, durationMinutes: offering.durationMinutes };
    }

    const durationMinutes = query.durationMinutes ?? 30;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 240 || durationMinutes % 30 !== 0) {
      throw new AppException(
        "INVALID_DURATION",
        "durationMinutes must be a 30-minute increment between 30 and 240",
        HttpStatus.BAD_REQUEST
      );
    }
    return { serviceOfferingId: null, durationMinutes };
  }

  private expandAvailabilityCandidates(
    windows: Array<{ id: string; startsAt: Date; endsAt: Date; capacity: number }>,
    reservations: AvailabilityReservation[],
    durationMinutes: number,
    earliestStart: Date,
    until: Date,
    now: Date
  ) {
    const durationMs = durationMinutes * 60_000;
    const items: Array<{
      id: string;
      availabilityWindowId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
      reservedCount: number;
      availableCapacity: number;
    }> = [];

    for (const window of windows) {
      let startsAt = this.roundUpAvailabilityStart(new Date(Math.max(window.startsAt.getTime(), earliestStart.getTime())));
      while (startsAt.getTime() < until.getTime() && items.length < MAX_PUBLIC_AVAILABILITY_CANDIDATES) {
        const endsAt = new Date(startsAt.getTime() + durationMs);
        if (endsAt.getTime() > window.endsAt.getTime()) break;
        const reservedCount = reservations.filter((order) => this.reservesAvailability(order, startsAt, endsAt, now)).length;
        const availableCapacity = Math.max(0, window.capacity - reservedCount);
        if (availableCapacity > 0) {
          items.push({
            id: `${window.id}:${startsAt.toISOString()}`,
            availabilityWindowId: window.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            capacity: window.capacity,
            reservedCount,
            availableCapacity
          });
        }
        startsAt = new Date(startsAt.getTime() + AVAILABILITY_STEP_MS);
      }
      if (items.length >= MAX_PUBLIC_AVAILABILITY_CANDIDATES) break;
    }
    return items;
  }

  private roundUpAvailabilityStart(date: Date): Date {
    return new Date(Math.ceil(date.getTime() / AVAILABILITY_STEP_MS) * AVAILABILITY_STEP_MS);
  }

  private reservesAvailability(order: AvailabilityReservation, candidateStart: Date, candidateEnd: Date, now: Date): boolean {
    if (!this.orderReservesAvailability(order, now)) return false;
    const orderStart = new Date(order.scheduledAt).getTime();
    const orderEnd = orderStart + order.durationMinutes * 60_000;
    return orderStart < candidateEnd.getTime() && orderEnd > candidateStart.getTime();
  }

  private orderReservesAvailability(order: AvailabilityReservation, now: Date): boolean {
    if (["paying", "paid", "inService", "completed"].includes(order.status)) return true;
    return order.status === "pending"
      && Boolean(order.companionConfirmedAt)
      && (!order.paymentReservationExpiresAt || order.paymentReservationExpiresAt.getTime() > now.getTime());
  }

  private async assertPublishableUnderLock(
    db: any,
    companionId: string,
    ownerUserId: string | null | undefined,
    profileVerified: boolean,
    ownerAlreadyChecked?: any
  ) {
    if (!profileVerified) {
      throw new AppException(
        "COMPANION_PROFILE_NOT_VERIFIED",
        "Companion profile must be verified before publishing",
        HttpStatus.CONFLICT
      );
    }
    if (!ownerUserId) {
      throw new AppException(
        "COMPANION_OWNER_REQUIRED",
        "A verified owner account is required before publishing",
        HttpStatus.CONFLICT
      );
    }
    const owner = ownerAlreadyChecked
      ?? await this.assertAssignableOwnerUnderLock(db, ownerUserId);
    const now = new Date();
    const [
      commercialProfile,
      activeRestriction,
      pendingAppealReactivation,
      pendingExpiryReactivation
    ] = await Promise.all([
      db.companionCommercialProfile.findUnique({ where: { companionId } }),
      db.companionAccountAction.findFirst({
        where: {
          companionId,
          kind: { in: ["serviceRestriction", "suspension"] },
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }]
        },
        select: { id: true, kind: true }
      }),
      db.companionAccountAppeal.findFirst({
        where: { companionId, reactivationStatus: "required" },
        select: { id: true }
      }),
      db.companionAccountAction.findFirst({
        where: { companionId, reactivationStatus: "required" },
        select: { id: true }
      })
    ]);
    if (activeRestriction) {
      throw new AppException(
        "COMPANION_ACCOUNT_ACTION_ACTIVE",
        "An active service restriction or suspension prevents publication",
        HttpStatus.CONFLICT,
        { actionKind: activeRestriction.kind }
      );
    }
    if (pendingAppealReactivation || pendingExpiryReactivation) {
      throw new AppException(
        "COMPANION_REACTIVATION_REQUIRED",
        "Independent operational reactivation review must finish before publication",
        HttpStatus.CONFLICT
      );
    }
    if (owner.profile?.isVerified !== true) {
      throw new AppException(
        "COMPANION_OWNER_NOT_ELIGIBLE",
        "Companion owner must be active and identity-verified",
        HttpStatus.CONFLICT
      );
    }
    if (
      commercialProfile?.status !== "verified"
      || commercialProfile.adultEligibilityVerdict !== "adult"
      || !(commercialProfile.adultEligibilityValidUntil instanceof Date)
      || commercialProfile.adultEligibilityValidUntil.getTime() <= Date.now()
    ) {
      throw new AppException(
        "COMPANION_COMMERCIAL_PROFILE_NOT_VERIFIED",
        "Current adult eligibility, identity evidence, service agreement, tax profile and settlement recipient must pass commercial review",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertAssignableOwnerUnderLock(db: any, ownerUserId: string) {
    await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerUserId} FOR UPDATE`;
    const [owner, deletion] = await Promise.all([
      db.user.findUnique({ where: { id: ownerUserId }, include: { profile: true } }),
      db.accountDeletionRequest.findFirst({
        where: {
          userId: ownerUserId,
          status: { in: ["pending", "processing", "completed"] }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, status: true }
      })
    ]);
    if (deletion) {
      throw new AppException(
        deletion.status === "completed"
          ? "COMPANION_OWNER_ACCOUNT_DELETED"
          : "COMPANION_OWNER_DELETION_IN_PROGRESS",
        deletion.status === "completed"
          ? "A completed account deletion can never be assigned a companion profile"
          : "A companion profile cannot be assigned while account deletion is pending or processing",
        HttpStatus.CONFLICT,
        { deletionRequestId: deletion.id, deletionStatus: deletion.status }
      );
    }
    if (!owner || owner.accountStatus !== "active" || !["user", "companion"].includes(owner.role)) {
      throw new AppException(
        "COMPANION_OWNER_NOT_ELIGIBLE",
        "Companion owner must be an active consumer or companion account",
        HttpStatus.CONFLICT
      );
    }
    return owner;
  }

  private profileData(dto: CreateCompanionDto | UpdateCompanionDto) {
    const data: any = {};
    for (const key of [
      "name",
      "ownerUserId",
      "role",
      "initials",
      "pricePerHalfHour",
      "isOnline",
      "isVerified",
      "bio",
      "availableTimes",
      "languages",
      "specialties",
      "topicIds",
      "distanceKm",
      "availability",
      "cityDistrict",
      "isPublished"
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.topicIds !== undefined) {
      data.topicIds = this.resolveTopicIds(dto);
    } else if (dto.specialties !== undefined || dto.tags !== undefined) {
      data.topicIds = this.resolveTopicIds(dto);
    }
    return data;
  }

  private resolveTopicIds(dto: { topicIds?: string[]; specialties?: string[]; tags?: string[] }) {
    if (dto.topicIds !== undefined) {
      const supplied = [...new Set(dto.topicIds.map((topicId) => topicId.trim()).filter(Boolean))];
      const explicit = normalizeTopicIds(supplied);
      if (explicit.length !== supplied.length) {
        throw new AppException("INVALID_RECOMMENDATION_TOPIC", "One or more companion topics are invalid", HttpStatus.BAD_REQUEST);
      }
      return explicit;
    }
    return deriveTopicIds(dto.specialties, dto.tags);
  }

  private normalizeRequiredList(values: string[], field: string): string[] {
    const normalized = values.map((value) => value.trim());
    if (normalized.some((value) => !value)) {
      throw new AppException(
        "INVALID_COMPANION_PROFILE",
        `${field} cannot contain blank values`,
        HttpStatus.BAD_REQUEST
      );
    }
    return [...new Set(normalized)];
  }

  private publicProfileContent(
    profile: {
      name?: string | null;
      role?: string | null;
      bio?: string | null;
      availableTimes?: string[] | null;
      languages?: string[] | null;
      specialties?: string[] | null;
      cityDistrict?: string | null;
    },
    tags: string[] = []
  ): string {
    return [
      profile.name,
      profile.role,
      profile.bio,
      ...(profile.availableTimes ?? []),
      ...(profile.languages ?? []),
      ...(profile.specialties ?? []),
      profile.cityDistrict,
      ...tags
    ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)).join("\n");
  }

  private async assertPublicContentAllowed(input: {
    content: string;
    targetId: string;
    subjectUserId?: string;
    actorId?: string;
    title: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    const moderation = await this.moderation.moderateAsync(input.content, "profile");
    if (moderation.decision === "allow") return;

    const moderationCase = await this.moderationCases.createFromResult({
      result: moderation,
      source: "profile",
      content: input.content,
      targetId: input.targetId,
      subjectUserId: input.subjectUserId,
      actorId: input.actorId,
      title: input.title,
      forceCreate: true
    });
    throw new AppException(
      input.errorCode ?? "COMPANION_PROFILE_CONTENT_REQUIRES_REVISION",
      input.errorMessage ?? "Public companion profile content cannot be published; revise it and try again",
      HttpStatus.UNPROCESSABLE_ENTITY,
      { moderationCaseId: moderationCase?.id ?? null, decision: moderation.decision }
    );
  }

  private async replaceTags(companionId: string, tags: string[]) {
    await this.prisma.companionServiceTag.deleteMany({ where: { companionId } });
    for (const name of [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]) {
      const tag = await this.prisma.serviceTag.upsert({
        where: { name },
        create: { name },
        update: {}
      });
      await this.prisma.companionServiceTag.create({
        data: {
          companionId,
          tagId: tag.id
        }
      });
    }
  }

  private toDto(item: CompanionRecord, catalog?: SellableCompanionMatch) {
    const now = Date.now();
    const currentTraining = PUBLIC_REQUIRED_TRAINING.map((required) =>
      item.trainingRecords.find((record) =>
        record.moduleCode === required.moduleCode
        && record.moduleVersion === required.moduleVersion
        && record.status === "passed"
        && (!record.expiresAt || record.expiresAt.getTime() > now)
      )
    ).filter((record): record is NonNullable<typeof record> => Boolean(record));
    const trainingIsCurrent = currentTraining.length === PUBLIC_REQUIRED_TRAINING.length;
    const trainingExpiryTimes = currentTraining
      .map((record) => record.expiresAt?.getTime())
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const commercialReview = item.commercialProfile;
    const platformReviewIsCurrent = Boolean(
      commercialReview?.verifiedAt
      && commercialReview.nextReviewDueAt
      && commercialReview.nextReviewDueAt.getTime() > now
    );
    const voiceIntroCapabilityEnabled = isFirstReleaseCapabilityEnabled("voiceIntro", this.config);
    const voiceIntroApproved = voiceIntroCapabilityEnabled && item.voiceIntroStatus === "approved";
    return {
      id: item.id,
      name: item.name,
      role: item.role,
      initials: item.initials,
      tags: item.serviceTags.map((entry) => entry.tag.name),
      rating: item.rating,
      reviewCount: item.reviewCount,
      pricePerHalfHour: item.pricePerHalfHour,
      isOnline: item.isOnline,
      isVerified: item.isVerified,
      bio: item.bio,
      availableTimes: item.availableTimes,
      languages: item.languages,
      specialties: item.specialties,
      livedExperience: item.livedExperience ?? null,
      serviceBoundaries: item.serviceBoundaries ?? [],
      voiceIntro: {
        available: voiceIntroApproved,
        status: voiceIntroApproved ? "approved" : "unavailable",
        durationSeconds: voiceIntroApproved ? item.voiceIntroDurationSeconds ?? null : null,
        // A durable asset reference is never public. Playback stays disabled
        // until a customer-scoped, short-lived read URL can be issued safely.
        // Text-only first release also fail-closes historical approved intros.
        playbackStatus: voiceIntroApproved ? "secureShortLivedUrlRequired" : "notAvailable",
        playbackUrl: null
      },
      topicIds: item.topicIds,
      completedOrders: item.completedOrders,
      responseTime: item.responseTime,
      distanceKm: item.distanceKm,
      availability: item.availability,
      cityDistrict: item.cityDistrict,
      publicTrust: {
        training: {
          status: trainingIsCurrent ? "current" : "renewalDue",
          currentModules: currentTraining.length,
          requiredModules: PUBLIC_REQUIRED_TRAINING.length,
          validUntil: trainingIsCurrent && trainingExpiryTimes.length
            ? new Date(Math.min(...trainingExpiryTimes)).toISOString()
            : null
        },
        platformReview: {
          status: platformReviewIsCurrent ? "current" : "reviewDue",
          verifiedAt: commercialReview?.verifiedAt?.toISOString() ?? null,
          nextReviewDueAt: commercialReview?.nextReviewDueAt?.toISOString() ?? null
        }
      },
      catalog: catalog ? {
        sellable: true,
        startingPriceCents: catalog.startingPriceCents,
        startingDurationMinutes: catalog.startingDurationMinutes,
        currency: catalog.currency,
        deliveryModes: catalog.deliveryModes,
        nextAvailableAt: catalog.earliestStartsAt.toISOString()
      } : {
        sellable: false,
        startingPriceCents: null,
        startingDurationMinutes: null,
        currency: null,
        deliveryModes: [],
        nextAvailableAt: null
      },
      isPublished: item.isPublished,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toServiceOfferingDto(item: {
    id: string;
    code: string;
    title: string;
    description: string | null;
    deliveryMode: "text" | "voice";
    durationMinutes: number;
    priceCents: number;
    currency: string;
    topicIds: string[];
  }) {
    return {
      id: item.id,
      code: item.code,
      title: item.title,
      description: item.description,
      deliveryMode: item.deliveryMode,
      durationMinutes: item.durationMinutes,
      priceCents: item.priceCents,
      currency: item.currency,
      topicIds: item.topicIds
    };
  }

  private toOwnServiceOfferingDto(item: {
    id: string;
    code: string;
    title: string;
    description: string | null;
    deliveryMode: "text" | "voice";
    durationMinutes: number;
    priceCents: number;
    currency: string;
    topicIds: string[];
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...this.toServiceOfferingDto(item),
      isActive: item.isActive,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toOwnAvailabilityWindowDto(item: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      capacity: item.capacity,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toOwnRecurringAvailabilityRuleDto(item: {
    id: string;
    weekday: number;
    startsAtMinute: number;
    endsAtMinute: number;
    capacity: number;
    timezone: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      weekday: item.weekday,
      startsAtMinute: item.startsAtMinute,
      endsAtMinute: item.endsAtMinute,
      capacity: item.capacity,
      timezone: item.timezone,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toOwnAvailabilityBlackoutDto(item: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      timezone: item.timezone,
      isActive: item.isActive,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private toOwnRecurringAvailabilityDraftDto(item: {
    id: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    recurringAvailabilityRuleId: string;
    recurringOccurrenceStartsAt: Date;
    createdAt: Date;
  }) {
    return {
      id: item.id,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt.toISOString(),
      capacity: item.capacity,
      recurringAvailabilityRuleId: item.recurringAvailabilityRuleId,
      recurringOccurrenceStartsAt: item.recurringOccurrenceStartsAt.toISOString(),
      createdAt: item.createdAt.toISOString()
    };
  }

  private ownerListPagination(query: ListOwnScheduleItemsDto, total: number) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    };
  }
}
