import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { AvailabilityReminderCandidateService } from "../favorites/availability-reminder-candidate.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateCompanionDto, UpdateCompanionDto } from "./dto/companion-profile.dto";
import { ListCompanionAvailabilityQueryDto } from "./dto/list-companion-availability.dto";
import { ListCompanionsQueryDto, PublicCompanionSort } from "./dto/list-companions.dto";
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
import { COMPANION_RECURRING_AVAILABILITY_DRAFT_HORIZON_DAYS } from "./companion-recurring-availability-draft-materializer.service";
import { deriveTopicIds, normalizeTopicIds } from "../recommendations/recommendation-topics";

type CompanionRecord = Awaited<ReturnType<CompanionsService["findRecordOrThrow"]>>;

const AVAILABILITY_TIMEZONE = "Asia/Shanghai";
const AVAILABILITY_STEP_MS = 30 * 60_000;
const MIN_PUBLIC_BOOKING_LEAD_TIME_MS = 15 * 60_000;
const MAX_PUBLIC_AVAILABILITY_CANDIDATES = 100;
const DEFAULT_PUBLIC_AVAILABILITY_PRIORITY_DAYS = 7;
const MAX_OWN_AVAILABILITY_WINDOW_DURATION_MS = 24 * 60 * 60_000;
const MAX_OWN_AVAILABILITY_CAPACITY = 10;
const DAY_MS = 24 * 60 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;

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
    @Optional() private readonly config?: ConfigService
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
    const where = this.buildPublicWhere(query);
    const capacityDays = query.availableWithinDays ?? DEFAULT_PUBLIC_AVAILABILITY_PRIORITY_DAYS;
    const capacityMatches = await this.findSellableCompanions(query, capacityDays);
    // Public discovery is a sellable catalog, not a directory of profiles.
    // Apply the capacity gate before pagination/counting so every returned card
    // has at least one matching current service and one structured candidate
    // with remaining capacity. Legacy free-text availability stays readable on
    // existing profiles, but cannot claim that a paid appointment is available.
    where.id = { in: capacityMatches.map((match) => match.id) };
    const catalogByCompanionId = new Map(capacityMatches.map((match) => [match.id, match]));

    if (query.sortBy === "soonestAvailable" || query.sortBy === "priceAsc") {
      // Availability is volatile, so this is deliberately a current ordering
      // pass rather than a booking claim. The DTO exposes the calculated time as
      // a discovery hint; detail and order creation each recheck capacity.
      const orderedMatches = [...capacityMatches].sort((left, right) =>
        query.sortBy === "priceAsc"
          ? left.startingPriceCents - right.startingPriceCents
            || left.startingDurationMinutes - right.startingDurationMinutes
            || left.id.localeCompare(right.id)
          : left.earliestStartsAt.getTime() - right.earliestStartsAt.getTime()
            || left.id.localeCompare(right.id)
      );
      const total = orderedMatches.length;
      const pageIds = orderedMatches
        .slice((page - 1) * pageSize, page * pageSize)
        .map((match) => match.id);
      if (!pageIds.length) {
        return {
          items: [],
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize)
          }
        };
      }
      const items = await this.prisma.companionProfile.findMany({
        // Reapply the public gate and every explicit condition after the
        // capacity snapshot, so a profile that loses public eligibility is
        // never leaked by the ordering pass.
        where: { ...where, id: { in: pageIds } },
        include: this.includeTags()
      });
      const pagePosition = new Map(pageIds.map((id, index) => [id, index]));
      items.sort((left, right) =>
        (pagePosition.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (pagePosition.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
      return {
        items: items.map((item) => this.toDto(item, catalogByCompanionId.get(item.id))),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.companionProfile.findMany({
        where,
        include: this.includeTags(),
        orderBy: this.publicCatalogOrderBy(query.sortBy),
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.companionProfile.count({ where })
    ]);

    return {
      items: items.map((item) => this.toDto(item, catalogByCompanionId.get(item.id))),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
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
          commercialProfile: { status: "verified" }
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
    companionIds?: string[]
  ): Promise<SellableCompanionMatch[]> {
    if (query.deliveryMode === "voice" && !this.isVoiceBookingEnabled()) return [];
    const boundedDays = Math.max(1, Math.min(7, Math.trunc(days)));
    const normalizedIds = companionIds
      ? [...new Set(companionIds.map((id) => id.trim()).filter(Boolean))]
      : undefined;
    if (normalizedIds && normalizedIds.length === 0) return [];
    return this.findCompanionsWithFutureCapacity(query, boundedDays, normalizedIds);
  }

  /**
   * Customer-facing service catalog. It deliberately uses the same public
   * visibility gate as the companion profile, so an unpublished or unverified
   * profile cannot leak its commercial configuration through this endpoint.
   */
  async listPublishedServiceOfferings(id: string) {
    const item = await this.prisma.companionProfile.findFirst({
      where: {
        ...this.buildPublicWhere({}),
        id
      },
      select: {
        serviceOfferings: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!item) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    return {
      items: item.serviceOfferings
        .filter((offering) => this.isPublicServiceOfferingEnabled(offering))
        .map((offering) => this.toServiceOfferingDto(offering))
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
    const [windows, reservations, structuredWindowCount] = await Promise.all([
      this.prisma.companionAvailabilityWindow.findMany({
        where: {
          companionId: companion.id,
          isActive: true,
          startsAt: { lt: until },
          endsAt: { gt: earliestStart }
        },
        orderBy: { startsAt: "asc" }
      }),
      this.prisma.order.findMany({
        where: {
          companionId: companion.id,
          scheduledAt: { lt: until },
          status: { in: ["pending", "paying", "paid", "inService", "completed"] }
        },
        select: {
          status: true,
          scheduledAt: true,
          durationMinutes: true,
          companionConfirmedAt: true,
          paymentReservationExpiresAt: true
        }
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
      items: source === "structured"
        ? this.expandAvailabilityCandidates(windows, reservations, service.durationMinutes, earliestStart, until, now)
        : []
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
  async listOwnServiceOfferings(userId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const items = await this.prisma.companionServiceOffering.findMany({
      where: { companionId: companion.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    } as any);
    return { items: items.map((item: any) => this.toOwnServiceOfferingDto(item)) };
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
    const created = await this.prisma.companionServiceOffering.create({
      data: {
        id,
        companionId: companion.id,
        // Codes are stable, server-owned identifiers. They are intentionally
        // not a self-service field, so ordinary edits cannot collide with or
        // rewrite historic order snapshots.
        code: `service-${id}`,
        ...data
      }
    } as any);
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
  async listOwnAvailabilityWindows(userId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const items = await this.prisma.companionAvailabilityWindow.findMany({
      // Generated inactive drafts have their own bounded owner-review endpoint.
      // Keep the ordinary window calendar focused on manual entries and already
      // activated windows, so an old draft cannot be mistaken for live supply.
      where: {
        companionId: companion.id,
        NOT: {
          isActive: false,
          recurringOccurrenceStartsAt: { not: null }
        }
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      take: 200
    } as any);
    return { items: items.map((item: any) => this.toOwnAvailabilityWindowDto(item)) };
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
  async listOwnRecurringAvailabilityRules(userId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const items = await this.prisma.companionRecurringAvailabilityRule.findMany({
      where: { companionId: companion.id },
      orderBy: [
        { isActive: "desc" },
        { weekday: "asc" },
        { startsAtMinute: "asc" },
        { createdAt: "asc" }
      ],
      take: 200
    } as any);
    return { items: items.map((item: any) => this.toOwnRecurringAvailabilityRuleDto(item)) };
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

  async listOwnAvailabilityBlackouts(userId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const items = await this.prisma.companionAvailabilityBlackout.findMany({
      where: { companionId: companion.id },
      orderBy: [
        { isActive: "desc" },
        { startsAt: "asc" },
        { createdAt: "asc" }
      ],
      take: 200
    } as any);
    return { items: items.map((item: any) => this.toOwnAvailabilityBlackoutDto(item)) };
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
  async listOwnRecurringAvailabilityDrafts(userId: string) {
    const companion = await this.findEligibleOwnCompanion(userId);
    const now = new Date();
    const horizonEndsAt = this.recurringAvailabilityDraftHorizonEndsAt(now);
    const items = await this.prisma.companionAvailabilityWindow.findMany({
      where: {
        companionId: companion.id,
        isActive: false,
        recurringAvailabilityRuleId: { not: null },
        recurringOccurrenceStartsAt: { not: null },
        startsAt: { gt: now },
        endsAt: { lte: horizonEndsAt }
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      take: 200
    } as any);
    return {
      horizonEndsAt: horizonEndsAt.toISOString(),
      items: items.map((item: any) => this.toOwnRecurringAvailabilityDraftDto(item))
    };
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
  async listAdmin(page = 1, pageSize = 50) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safePageSize = Math.min(Math.max(1, Math.floor(pageSize) || 50), 100);
    const [items, total] = await Promise.all([
      this.prisma.companionProfile.findMany({
        include: {
          ...this.includeTags(),
          owner: { include: { profile: true } },
          commercialProfile: true
        },
        orderBy: [{ isPublished: "asc" }, { createdAt: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      } as any),
      this.prisma.companionProfile.count()
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
        commercialStatus: item.commercialProfile?.status ?? "missing"
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
    await this.prisma.companionProfile.create({
      data: {
        id,
        ownerUserId: userId,
        name,
        role,
        initials: name.slice(0, 2),
        rating: 0,
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
    await this.replaceTags(id, tags);
    return this.getOwn(userId);
  }

  async updateOwn(userId: string, dto: UpdateOwnCompanionDto) {
    const existing = await this.prisma.companionProfile.findUnique({ where: { ownerUserId: userId } } as any);
    if (!existing) {
      throw new AppException("COMPANION_PROFILE_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    const bio = dto.bio?.trim();
    const availableTimes = dto.availableTimes === undefined
      ? undefined
      : this.normalizeRequiredList(dto.availableTimes, "availableTimes");
    if (bio !== undefined && !bio) {
      throw new AppException("INVALID_COMPANION_PROFILE", "Public profile text cannot be blank", HttpStatus.BAD_REQUEST);
    }
    if (bio !== undefined || availableTimes !== undefined) {
      const content = [
        bio ?? existing.bio,
        ...(availableTimes ?? existing.availableTimes)
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
        ...(availableTimes !== undefined ? { availableTimes } : {}),
        ...(dto.availability !== undefined ? {
          availability: dto.availability,
          isOnline: dto.availability === "online"
        } : {})
      }
    } as any);
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
      reviewCount: 0,
      completedOrders: 0,
      responseTime: "暂无履约数据",
      isPublished: dto.isPublished ?? false
    };
    await this.prisma.companionProfile.create({ data });

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
    if (
      dto.isPublished ||
      (existing.isPublished && (dto.ownerUserId !== undefined || dto.isVerified !== undefined))
    ) {
      await this.assertPublishable(
        id,
        dto.ownerUserId ?? existing.ownerUserId,
        dto.isVerified ?? existing.isVerified
      );
    }
    await this.prisma.companionProfile.update({
      where: { id },
      data: this.profileData(dto)
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
    await this.assertPublishable(id, existing.ownerUserId, existing.isVerified);
    await this.prisma.companionProfile.update({
      where: { id },
      data: { isPublished: true }
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
      commercialProfile: { status: "verified" }
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
          { pricePerHalfHour: "asc" as const }
        ];
      case "reviewCount":
        return [
          { reviewCount: "desc" as const },
          { rating: "desc" as const },
          { isOnline: "desc" as const },
          { pricePerHalfHour: "asc" as const }
        ];
      case "priceAsc":
        return [
          { pricePerHalfHour: "asc" as const },
          { isOnline: "desc" as const },
          { rating: "desc" as const },
          { reviewCount: "desc" as const }
        ];
      case "online":
      default:
        // Keep the established public-catalog order when the caller omits a
        // sort, and make the explicit "online" choice explain that same rule.
        return [
          { isOnline: "desc" as const },
          { rating: "desc" as const },
          { reviewCount: "desc" as const },
          { pricePerHalfHour: "asc" as const }
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
    companionIds?: string[]
  ): Promise<SellableCompanionMatch[]> {
    const now = new Date();
    const earliestStart = new Date(now.getTime() + MIN_PUBLIC_BOOKING_LEAD_TIME_MS);
    const until = new Date(now.getTime() + days * 24 * 60 * 60_000);
    const serviceWhere = this.activeServiceOfferingWhere(query);
    const publicCatalogWhere = this.buildPublicWhere(query);
    const candidates = (await this.prisma.companionProfile.findMany({
      where: {
        // Keep this pre-pagination capacity pass in the same public catalog
        // scope as the final list, including an explicit keyword. The later
        // list still re-applies every condition before returning a profile.
        ...publicCatalogWhere,
        ...(companionIds ? { id: { in: companionIds } } : {}),
        serviceOfferings: { some: serviceWhere },
        availabilityWindows: {
          some: {
            isActive: true,
            startsAt: { lt: until },
            endsAt: { gt: earliestStart }
          }
        }
      },
      select: {
        id: true,
        serviceOfferings: {
          where: serviceWhere,
          select: {
            id: true,
            durationMinutes: true,
            priceCents: true,
            currency: true,
            deliveryMode: true
          }
        },
        availabilityWindows: {
          where: {
            isActive: true,
            startsAt: { lt: until },
            endsAt: { gt: earliestStart }
          },
          select: { id: true, startsAt: true, endsAt: true, capacity: true },
          orderBy: { startsAt: "asc" }
        },
        orders: {
          // Only capacity metadata is selected here. Order body, chat,
          // bookmarks, recent views, recommendations, and relationship data
          // never participate in public discovery.
          where: {
            scheduledAt: { lt: until },
            status: { in: ["pending", "paying", "paid", "inService", "completed"] }
          },
          select: {
            status: true,
            scheduledAt: true,
            durationMinutes: true,
            companionConfirmedAt: true,
            paymentReservationExpiresAt: true
          }
        }
      }
    } as any) as unknown) as Array<{
      id: string;
      serviceOfferings: Array<{
        id: string;
        durationMinutes: number;
        priceCents: number;
        currency: string;
        deliveryMode: "text" | "voice";
      }>;
      availabilityWindows: Array<{ id: string; startsAt: Date; endsAt: Date; capacity: number }>;
      orders: AvailabilityReservation[];
    }>;

    const matches: SellableCompanionMatch[] = [];
    for (const companion of candidates) {
      let earliestStartsAt: Date | null = null;
      const sellableOfferings: typeof companion.serviceOfferings = [];
      for (const offering of companion.serviceOfferings) {
        // All explicitly selected service conditions are already present in
        // serviceWhere. When none is selected, each currently active offering
        // is eligible and the earliest real candidate among them wins.
        const candidate = this.expandAvailabilityCandidates(
          companion.availabilityWindows,
          companion.orders,
          offering.durationMinutes,
          earliestStart,
          until,
          now
        )[0];
        if (!candidate) continue;
        sellableOfferings.push(offering);
        const startsAt = new Date(candidate.startsAt);
        if (!earliestStartsAt || startsAt.getTime() < earliestStartsAt.getTime()) {
          earliestStartsAt = startsAt;
        }
      }
      if (earliestStartsAt && sellableOfferings.length > 0) {
        const startingOffering = [...sellableOfferings].sort((left, right) =>
          left.priceCents - right.priceCents
          || left.durationMinutes - right.durationMinutes
          || left.id.localeCompare(right.id)
        )[0];
        matches.push({
          id: companion.id,
          earliestStartsAt,
          startingPriceCents: startingOffering.priceCents,
          startingDurationMinutes: startingOffering.durationMinutes,
          currency: startingOffering.currency,
          deliveryModes: [...new Set(sellableOfferings.map((offering) => offering.deliveryMode))].sort()
        });
      }
    }
    return matches;
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
    if (
      companion.isVerified !== true ||
      companion.owner?.accountStatus !== "active" ||
      companion.owner?.profile?.isVerified !== true
    ) {
      throw new AppException(
        "COMPANION_OWNER_NOT_ELIGIBLE",
        "An active identity-verified companion profile and owner are required",
        HttpStatus.FORBIDDEN
      );
    }
    return companion as { id: string };
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
    if (value === "text" || value === "voice") return value;
    throw new AppException("INVALID_SERVICE_OFFERING", "deliveryMode must be text or voice", HttpStatus.BAD_REQUEST);
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
    this.normalizeOwnAvailabilityWindowCapacity(input.capacity);
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

  private async assertPublishable(
    companionId: string,
    ownerUserId: string | null | undefined,
    profileVerified: boolean
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
    const [owner, commercialProfile] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: ownerUserId }, include: { profile: true } }),
      this.prisma.companionCommercialProfile.findUnique({ where: { companionId } } as any)
    ]);
    if (!owner || owner.accountStatus !== "active" || owner.profile?.isVerified !== true) {
      throw new AppException(
        "COMPANION_OWNER_NOT_ELIGIBLE",
        "Companion owner must be active and identity-verified",
        HttpStatus.CONFLICT
      );
    }
    if (commercialProfile?.status !== "verified") {
      throw new AppException(
        "COMPANION_COMMERCIAL_PROFILE_NOT_VERIFIED",
        "Identity evidence, service agreement, tax profile and settlement recipient must pass commercial review",
        HttpStatus.CONFLICT
      );
    }
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
      topicIds: item.topicIds,
      completedOrders: item.completedOrders,
      responseTime: item.responseTime,
      distanceKm: item.distanceKm,
      availability: item.availability,
      cityDistrict: item.cityDistrict,
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
}
