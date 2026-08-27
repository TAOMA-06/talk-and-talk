import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { SetFavoriteAvailabilityReminderDto } from "./dto/set-favorite-availability-reminder.dto";
import { ListFavoriteCompanionsDto } from "./dto/list-favorite-companions.dto";
import { publicFavoriteCompanionWhere } from "./favorite-companion-eligibility";

type FavoriteCompanionRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  role: string;
  initials: string;
  rating: number;
  reviewCount: number;
  pricePerHalfHour: number;
  isOnline: boolean;
  isVerified: boolean;
  bio: string;
  availableTimes: string[];
  languages: string[];
  specialties: string[];
  topicIds: string[];
  completedOrders: number;
  responseTime: string;
  distanceKm: number;
  availability: string;
  cityDistrict: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  serviceTags?: Array<{ tag: { name: string } }>;
};

const RECENT_VIEW_LIMIT = 20;
const AVAILABILITY_REMINDER_TEMPLATE_KEY = "availabilityReminder";
const AVAILABILITY_REMINDER_MINIMUM_INTERVAL_HOURS = 24;

type FavoriteCompanionPreferenceRecord = {
  companion: FavoriteCompanionRecord;
  availabilityReminderEnabled?: boolean;
  availabilityReminderUpdatedAt?: Date | null;
};

/**
 * Customer-owned companion bookmarks and recall records. Unlike a social
 * follow graph, this service never reads or writes through a companion owner,
 * never creates a notification delivery, and reapplies public-profile
 * eligibility on every read and reminder-preference write.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listCompanions(userId: string, query: ListFavoriteCompanionsDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
        userId,
        companion: { is: this.publicCompanionWhere() }
    };
    const [favorites, total] = await Promise.all([
      this.prisma.companionFavorite.findMany({
        where,
        include: {
          companion: { include: this.companionInclude() }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any) as unknown as FavoriteCompanionPreferenceRecord[],
      this.prisma.companionFavorite.count({ where } as any)
    ]);

    return {
      items: favorites.map((favorite) => ({
        ...this.toCompanionDto(favorite.companion),
        availabilityReminderEnabled: favorite.availabilityReminderEnabled === true,
        availabilityReminderUpdatedAt: favorite.availabilityReminderUpdatedAt?.toISOString() ?? null,
        availabilityReminderMinimumIntervalHours: AVAILABILITY_REMINDER_MINIMUM_INTERVAL_HOURS
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async companionStatus(userId: string, companionId: string) {
    const companion = await this.findPublicCompanionOrThrow(companionId);
    const favorite = await this.prisma.companionFavorite.findUnique({
      where: { userId_companionId: { userId, companionId: companion.id } },
      select: {
        availabilityReminderEnabled: true,
        availabilityReminderUpdatedAt: true
      }
    } as any);
    return {
      companionId: companion.id,
      favorited: Boolean(favorite),
      availabilityReminderEnabled: favorite?.availabilityReminderEnabled === true,
      availabilityReminderUpdatedAt: favorite?.availabilityReminderUpdatedAt?.toISOString() ?? null,
      availabilityReminderMinimumIntervalHours: AVAILABILITY_REMINDER_MINIMUM_INTERVAL_HOURS
    };
  }

  async saveCompanion(userId: string, companionId: string) {
    const companion = await this.findPublicCompanionOrThrow(companionId);
    const favorite = await this.prisma.companionFavorite.upsert({
      where: { userId_companionId: { userId, companionId: companion.id } },
      create: { userId, companionId: companion.id },
      update: {}
    } as any);

    // Repeated PUTs deliberately remain safe. The audit record captures a
    // customer-side save intent only; no companion-facing event is created.
    await this.audit.record({
      actorId: userId,
      subjectUserIds: [userId, companion.ownerUserId],
      action: "favorite.companion_saved",
      resourceType: "companionFavorite",
      resourceId: favorite.id,
      metadata: { companionId: companion.id }
    });

    return { favorited: true, companion: this.toCompanionDto(companion) };
  }

  async removeCompanion(userId: string, companionId: string) {
    const normalizedCompanionId = companionId.trim();
    if (!normalizedCompanionId) return { favorited: false, removed: false };
    const result = await this.prisma.companionFavorite.deleteMany({
      where: { userId, companionId: normalizedCompanionId }
    } as any);
    const removed = result.count > 0;
    if (removed) {
      const companion = await this.prisma.companionProfile.findUnique({
        where: { id: normalizedCompanionId },
        select: { ownerUserId: true }
      } as any);
      await this.audit.record({
        actorId: userId,
        subjectUserIds: [userId, companion?.ownerUserId].filter(
          (subjectUserId): subjectUserId is string => Boolean(subjectUserId)
        ),
        action: "favorite.companion_removed",
        resourceType: "companionFavorite",
        metadata: { companionId: normalizedCompanionId }
      });
    }
    return { favorited: false, removed };
  }

  /**
   * This is deliberately only an armed preference. It records no reminder,
   * performs no availability scan, and creates no notification or delivery.
   * A later, separately scoped delivery path must consume the exact grant
   * bound here before it can contact the customer.
   */
  async setAvailabilityReminder(
    userId: string,
    companionId: string,
    dto: SetFavoriteAvailabilityReminderDto
  ) {
    const normalizedCompanionId = companionId.trim();
    const now = new Date();
    let subscriptionGrantId: string | null = null;
    let result: { count: number };

    if (dto.enabled) {
      subscriptionGrantId = dto.subscriptionGrantId?.trim() || null;
      if (!subscriptionGrantId) {
        // Do not accept a client-only preference as permission to contact a
        // customer. The generic failure also reveals nothing about a profile.
        throw new AppException(
          "FAVORITE_REMINDER_AUTHORIZATION_REQUIRED",
          "A current reminder authorization is required",
          HttpStatus.CONFLICT
        );
      }

      try {
        const transition = await this.prisma.$transaction(async (transaction) => {
          const db = transaction as any;
          // Match the reservation path's favorite → grant portion of the lock
          // order. A grant cannot pass the unreserved check and then be bound
          // by an attempt before this preference write commits.
          await this.lockAvailabilityReminderFavorite(db, userId, normalizedCompanionId);
          await this.lockSubscriptionGrant(db, subscriptionGrantId!);
          const grant = await db.weChatSubscriptionGrant.findFirst({
            where: {
              id: subscriptionGrantId,
              userId,
              templateKey: AVAILABILITY_REMINDER_TEMPLATE_KEY,
              consumedAt: null,
              availabilityReminderAttempt: null
            },
            select: { id: true }
          });
          if (!grant) {
            throw new AppException(
              "FAVORITE_REMINDER_AUTHORIZATION_REQUIRED",
              "A current reminder authorization is required",
              HttpStatus.CONFLICT
            );
          }
          const updated = await db.companionFavorite.updateMany({
            where: {
              userId,
              companionId: normalizedCompanionId,
              companion: { is: this.publicCompanionWhere() }
            },
            data: {
              availabilityReminderEnabled: true,
              availabilityReminderGrantId: grant.id,
              availabilityReminderUpdatedAt: now
            }
          });
          return { result: updated, subscriptionGrantId: grant.id };
        });
        result = transition.result;
        subscriptionGrantId = transition.subscriptionGrantId;
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          // The one-time grant is already bound to another private preference.
          // Do not identify that favorite or surface a database detail.
          throw new AppException(
            "FAVORITE_REMINDER_AUTHORIZATION_UNAVAILABLE",
            "This reminder authorization is no longer available",
            HttpStatus.CONFLICT
          );
        }
        throw error;
      }
    } else {
      result = await this.prisma.companionFavorite.updateMany({
        where: {
          userId,
          companionId: normalizedCompanionId,
          companion: { is: this.publicCompanionWhere() }
        },
        data: {
          availabilityReminderEnabled: false,
          availabilityReminderGrantId: null,
          availabilityReminderUpdatedAt: now
        }
      } as any);
    }

    if (result.count !== 1) {
      // Missing, removed, unpublished, suspended, and otherwise ineligible
      // profiles intentionally share one response so this route is not a
      // private supply probe.
      throw new AppException(
        "FAVORITE_REMINDER_NOT_FOUND",
        "Favorite reminder target not found",
        HttpStatus.NOT_FOUND
      );
    }

    const companion = await this.prisma.companionProfile.findUnique({
      where: { id: normalizedCompanionId },
      select: { ownerUserId: true }
    } as any);
    await this.audit.record({
      actorId: userId,
      subjectUserIds: [userId, companion?.ownerUserId].filter(
        (subjectUserId): subjectUserId is string => Boolean(subjectUserId)
      ),
      action: dto.enabled
        ? "favorite.availability_reminder_enabled"
        : "favorite.availability_reminder_disabled",
      resourceType: "companionFavorite",
      metadata: {
        companionId: normalizedCompanionId,
        minimumIntervalHours: AVAILABILITY_REMINDER_MINIMUM_INTERVAL_HOURS
      }
    });

    return {
      companionId: normalizedCompanionId,
      enabled: dto.enabled,
      updatedAt: now.toISOString(),
      minimumIntervalHours: AVAILABILITY_REMINDER_MINIMUM_INTERVAL_HOURS
    };
  }

  async listRecentlyViewedCompanions(userId: string) {
    const views = await this.prisma.companionRecentView.findMany({
      where: {
        userId,
        companion: { is: this.publicCompanionWhere() }
      },
      include: {
        companion: { include: this.companionInclude() }
      },
      orderBy: [{ viewedAt: "desc" }, { id: "asc" }],
      take: RECENT_VIEW_LIMIT
    } as any) as unknown as Array<{ companion: FavoriteCompanionRecord }>;

    return { items: views.map((view) => this.toCompanionDto(view.companion)) };
  }

  async recordRecentlyViewedCompanion(userId: string, companionId: string) {
    const companion = await this.findPublicCompanionOrThrow(companionId);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.companionRecentView.upsert({
        where: { userId_companionId: { userId, companionId: companion.id } },
        create: { userId, companionId: companion.id },
        update: { viewedAt: new Date() }
      } as any);

      // Keep browsing data bounded even for customers who never clear it.
      // The list is private behavioral context, so it deliberately creates no
      // audit, recommendation, notification, companion, or marketing event.
      const staleViews = await transaction.companionRecentView.findMany({
        where: { userId },
        orderBy: [{ viewedAt: "desc" }, { id: "asc" }],
        skip: RECENT_VIEW_LIMIT,
        select: { id: true }
      } as any) as Array<{ id: string }>;
      if (staleViews.length) {
        await transaction.companionRecentView.deleteMany({
          where: { userId, id: { in: staleViews.map((view) => view.id) } }
        } as any);
      }
    });

    return { recorded: true };
  }

  async clearRecentlyViewedCompanions(userId: string) {
    const result = await this.prisma.companionRecentView.deleteMany({ where: { userId } } as any);
    return { cleared: result.count };
  }

  private async findPublicCompanionOrThrow(companionId: string): Promise<FavoriteCompanionRecord> {
    const normalizedCompanionId = companionId.trim();
    const companion = normalizedCompanionId
      ? await this.prisma.companionProfile.findFirst({
        where: { id: normalizedCompanionId, ...this.publicCompanionWhere() },
        include: this.companionInclude()
      } as any)
      : null;
    if (!companion) {
      // Keep unpublished, suspended, or nonexistent profiles indistinguishable
      // so a bookmark request cannot be used to probe private supply data.
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
    return companion as FavoriteCompanionRecord;
  }

  private publicCompanionWhere() {
    // This must stay aligned with CompanionsService.buildPublicWhere(): a saved
    // profile is never a bypass around the marketplace's live visibility gate.
    return publicFavoriteCompanionWhere();
  }

  private companionInclude() {
    return {
      serviceTags: {
        include: { tag: true },
        orderBy: { tag: { name: "asc" as const } }
      }
    };
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "P2002";
  }

  private async lockAvailabilityReminderFavorite(db: any, userId: string, companionId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`
      SELECT "id" FROM "CompanionFavorite"
      WHERE "userId" = ${userId} AND "companionId" = ${companionId}
      FOR UPDATE
    `;
  }

  private async lockSubscriptionGrant(db: any, grantId: string) {
    if (typeof db.$queryRaw !== "function") return;
    await db.$queryRaw`SELECT "id" FROM "WeChatSubscriptionGrant" WHERE "id" = ${grantId} FOR UPDATE`;
  }

  private toCompanionDto(companion: FavoriteCompanionRecord) {
    return {
      id: companion.id,
      name: companion.name,
      role: companion.role,
      initials: companion.initials,
      tags: (companion.serviceTags ?? []).map((entry) => entry.tag.name),
      rating: companion.rating,
      reviewCount: companion.reviewCount,
      pricePerHalfHour: companion.pricePerHalfHour,
      isOnline: companion.isOnline,
      isVerified: companion.isVerified,
      bio: companion.bio,
      availableTimes: companion.availableTimes,
      languages: companion.languages,
      specialties: companion.specialties,
      topicIds: companion.topicIds,
      completedOrders: companion.completedOrders,
      responseTime: companion.responseTime,
      distanceKm: companion.distanceKm,
      availability: companion.availability,
      cityDistrict: companion.cityDistrict,
      isPublished: companion.isPublished,
      createdAt: companion.createdAt.toISOString(),
      updatedAt: companion.updatedAt.toISOString()
    };
  }
}
