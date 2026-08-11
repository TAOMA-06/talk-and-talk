import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { CompanionsService, SellableCompanionMatch } from "../companions/companions.service";
import { PrismaService } from "../database/prisma.service";
import { loadAcceptedOrderIds } from "../orders/order-acceptance-facts";
import {
  ListRecommendedCompanionsDto,
  RecommendationMetricsQueryDto,
  RecordRecommendationEventsDto,
  UpdateRecommendationPolicyDto,
  UpdateRecommendationPreferencesDto
} from "./dto/recommendation.dto";
import {
  RECOMMENDATION_TOPICS,
  deriveTopicIds,
  isRecommendationTopicId,
  normalizeTopicIds,
  topicName
} from "./recommendation-topics";

const ALGORITHM_VERSION = "companion-ranking-v1";
const REQUEST_TTL_MS = 15 * 60 * 1000;
const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const BEHAVIOR_LOOKBACK_DAYS = 90;
export const MAX_BEHAVIOR_ORDER_FACTS = 1_000;
const HALF_LIFE_DAYS = 30;
const MAX_CANDIDATES = 200;

/**
 * P0-14 / MP-D07: ranking personalization stays off until algorithm governance
 * explicitly enables it. Stored user preference alone cannot re-open behavioral
 * ranking for the first-release candidate.
 */
export function isRecommendationPersonalizationRankingAllowed(
  _env: NodeJS.ProcessEnv = process.env
): boolean {
  // R01 is the only authority that can define an auditable consent ledger and
  // future re-enablement. A process environment flag is not that authority,
  // so it must not restore behavioural/order ranking in the first release.
  return false;
}

type CompanionCandidate = {
  id: string;
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
  completedOrders: number;
  responseTime: string;
  distanceKm: number;
  availability: "online" | "available" | "busy";
  cityDistrict: string;
  topicIds: string[];
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  serviceTags: Array<{ tag: { name: string } }>;
  catalog: SellableCompanionMatch;
  recommendationPolicies: Array<{
    status: "active" | "paused";
    boostBps: number;
    dailyCap: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
  }>;
};

type Preference = {
  personalizationEnabled: boolean;
  topicIds: string[];
  city: string | null;
  maxPricePerHalfHour: number | null;
  preferredTimeSlots: string[];
};

type Exposure = {
  views24Hours: number;
  views7Days: number;
  servedToday: number;
};

type RankedCandidate = {
  companion: CompanionCandidate;
  score: number;
  reasonCodes: string[];
  reasonText: string;
};

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companions: CompanionsService
  ) {}

  topics() {
    return {
      algorithmVersion: ALGORITHM_VERSION,
      items: RECOMMENDATION_TOPICS.map(({ id, name }) => ({ id, name }))
    };
  }

  async getPreferences(userId: string) {
    const rankingAllowed = isRecommendationPersonalizationRankingAllowed();
    const [stored, tags, orders] = await Promise.all([
      this.prisma.userRecommendationPreference.findUnique({ where: { userId } }),
      rankingAllowed
        ? this.prisma.userRecommendationTag.findMany({
            where: { userId, source: "behavioral" as any },
            orderBy: [{ updatedAt: "desc" }]
          } as any)
        : Promise.resolve([]),
      rankingAllowed
        ? this.prisma.order.findMany({
            where: {
              userId,
              createdAt: { gte: this.daysAgo(BEHAVIOR_LOOKBACK_DAYS) },
              status: { in: ["pending", "paying", "paid", "inService", "completed"] }
            },
            select: { themeId: true, status: true, createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: MAX_BEHAVIOR_ORDER_FACTS
          } as any)
        : Promise.resolve([])
    ]);
    const preference = this.asPreference(stored);
    const disabledTopics = new Set(tags.filter((tag: any) => tag.disabledAt).map((tag: any) => tag.topicId));
    const activeTags = tags
      .filter((tag: any) => !tag.disabledAt)
      .map((tag: any) => ({
        id: tag.id,
        topicId: tag.topicId,
        name: topicName(tag.topicId),
        weight: this.round(tag.weight),
        source: tag.source,
        updatedAt: tag.updatedAt.toISOString()
      }));
    const persistedTopicIds = new Set(activeTags.map((tag) => tag.topicId));
    const inferredWeights = this.behaviorFromOrders(orders as any[], disabledTopics);
    const inferredTags = [...inferredWeights.entries()]
      .filter(([topicId]) => !persistedTopicIds.has(topicId))
      .sort(([, left], [, right]) => right - left)
      .map(([topicId, weight]) => ({
        id: `inferred:${topicId}`,
        topicId,
        name: topicName(topicId),
        weight: this.round(weight),
        source: "inferredOrder",
        updatedAt: null
      }));

    return {
      ...preference,
      // Effective ranking flag: stored opt-in cannot enable ranking while P0-14 is closed.
      personalizationEnabled: rankingAllowed && preference.personalizationEnabled,
      personalizationRankingAllowed: rankingAllowed,
      behavioralTags: rankingAllowed ? [...activeTags, ...inferredTags] : []
    };
  }

  async updatePreferences(userId: string, dto: UpdateRecommendationPreferencesDto) {
    if (dto.personalizationEnabled === true) {
      throw new AppException(
        "RECOMMENDATION_PERSONALIZATION_CLOSED",
        "Personalized ranking is unavailable until a new recorded opt-in authority is approved",
        HttpStatus.CONFLICT
      );
    }
    const normalizedTopics = dto.topicIds === undefined ? undefined : this.assertTopicIds(dto.topicIds);
    const preferredTimeSlots = dto.preferredTimeSlots === undefined
      ? undefined
      : this.assertTimeSlots(dto.preferredTimeSlots);
    const city = dto.city === undefined ? undefined : (dto.city?.trim() || null);
    const maxPricePerHalfHour = dto.maxPricePerHalfHour === undefined ? undefined : dto.maxPricePerHalfHour;
    await this.prisma.userRecommendationPreference.upsert({
      where: { userId },
      create: {
        userId,
        // PERSONALIZATION-R01-A: neither a stale row nor a request payload may
        // retain/recreate the historical opt-in without a new consent ledger.
        personalizationEnabled: false,
        topicIds: normalizedTopics ?? [],
        city: city ?? null,
        maxPricePerHalfHour: maxPricePerHalfHour ?? null,
        preferredTimeSlots: preferredTimeSlots ?? []
      },
      update: {
        personalizationEnabled: false,
        ...(normalizedTopics !== undefined ? { topicIds: normalizedTopics } : {}),
        ...(city !== undefined ? { city } : {}),
        ...(maxPricePerHalfHour !== undefined ? { maxPricePerHalfHour } : {}),
        ...(preferredTimeSlots !== undefined ? { preferredTimeSlots } : {})
      }
    } as any);

    return this.getPreferences(userId);
  }

  async deleteBehavioralTag(userId: string, tagId: string) {
    const now = new Date();
    if (tagId.startsWith("inferred:")) {
      const topicId = tagId.slice("inferred:".length);
      if (!isRecommendationTopicId(topicId)) {
        throw new AppException("RECOMMENDATION_TAG_NOT_FOUND", "Recommendation tag not found", HttpStatus.NOT_FOUND);
      }
      await this.prisma.userRecommendationTag.upsert({
        where: {
          userId_topicId_source: { userId, topicId, source: "behavioral" as any }
        },
        create: { userId, topicId, source: "behavioral" as any, weight: 0, disabledAt: now },
        update: { weight: 0, disabledAt: now }
      } as any);
      return { deleted: true, topicId };
    }

    const tag = await this.prisma.userRecommendationTag.findFirst({
      where: { id: tagId, userId, source: "behavioral" as any }
    } as any);
    if (!tag) {
      throw new AppException("RECOMMENDATION_TAG_NOT_FOUND", "Recommendation tag not found", HttpStatus.NOT_FOUND);
    }
    await this.prisma.userRecommendationTag.update({
      where: { id: tag.id },
      data: { weight: 0, disabledAt: now }
    });
    return { deleted: true, topicId: tag.topicId };
  }

  async listCompanionExclusions(userId: string, page = 1, pageSize = 20) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.userCompanionRecommendationExclusion.findMany({
        where,
        include: this.exclusionCompanionInclude(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.userCompanionRecommendationExclusion.count({ where })
    ]);
    return {
      items: (items as any[]).map((item) => this.companionExclusionDto(item)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async excludeCompanion(userId: string, companionId: string) {
    const normalizedId = this.normalizeCompanionId(companionId);
    // Creation is allowed only from a profile the caller could currently open.
    // This does not require a conversation, order, block, report, or reason.
    const publishedCompanion = await this.companions.getPublished(normalizedId);
    const item = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const expiredAt = new Date();
      const exclusion = await db.userCompanionRecommendationExclusion.upsert({
        where: { userId_companionId: { userId, companionId: normalizedId } },
        create: {
          userId,
          companionId: normalizedId,
          companionNameSnapshot: publishedCompanion.name,
          companionRoleSnapshot: publishedCompanion.role,
          companionInitialsSnapshot: publishedCompanion.initials
        },
        update: {},
        include: this.exclusionCompanionInclude()
      });
      // Existing cursor snapshots must not re-surface a companion after this
      // preference changes. Historic impressions and order attribution remain.
      await db.recommendationRequest.updateMany({
        where: { userId, expiresAt: { gt: expiredAt } },
        data: { expiresAt: expiredAt }
      });
      return exclusion;
    });
    return { excluded: true, item: this.companionExclusionDto(item) };
  }

  async restoreCompanionRecommendations(userId: string, companionId: string) {
    const normalizedId = this.normalizeCompanionId(companionId);
    const removed = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const expiredAt = new Date();
      const result = await db.userCompanionRecommendationExclusion.deleteMany({
        where: { userId, companionId: normalizedId }
      });
      await db.recommendationRequest.updateMany({
        where: { userId, expiresAt: { gt: expiredAt } },
        data: { expiresAt: expiredAt }
      });
      return result.count;
    });
    return { excluded: false, removed: removed > 0, companionId: normalizedId };
  }

  async listCompanions(userId: string, query: ListRecommendedCompanionsDto) {
    const pageSize = query.pageSize ?? 20;
    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      return this.getRequestPage(userId, cursor.requestId, cursor.offset, pageSize);
    }

    const placement = query.placement ?? "discoverHome";
    const preferenceRecord = await this.prisma.userRecommendationPreference.findUnique({ where: { userId } });
    const preference = this.asPreference(preferenceRecord);
    // Behavioral tags / order history must not rank until governance re-enables ranking.
    const personalized =
      isRecommendationPersonalizationRankingAllowed() && preference.personalizationEnabled;
    const now = new Date();
    const sellableMatches = await this.companions.findSellableCompanions(
      query.themeId ? { topicId: query.themeId } : {},
      7,
      undefined,
      MAX_CANDIDATES
    );
    const candidateIds = sellableMatches.map((match) => match.id);
    const excludedCompanionIds = await this.privateUnavailableCompanionIds(userId, candidateIds);
    const sellableById = new Map(
      sellableMatches
        .filter((match) => !excludedCompanionIds.has(match.id))
        .map((match) => [match.id, match])
    );
    const candidates = await this.loadEligibleCandidates(placement, sellableById);
    if (candidates.length === 0) {
      return this.emptyPage(personalized, pageSize);
    }

    const [exposure, behaviorTags, orders] = await Promise.all([
      this.collectExposure(userId, candidates.map((candidate) => candidate.id), now),
      personalized
        ? this.prisma.userRecommendationTag.findMany({ where: { userId, source: "behavioral" as any } } as any)
        : Promise.resolve([]),
      personalized
        ? this.prisma.order.findMany({
            where: {
              userId,
              createdAt: { gte: this.daysAgo(BEHAVIOR_LOOKBACK_DAYS) },
              status: { in: ["pending", "paying", "paid", "inService", "completed"] }
            },
            select: { themeId: true, status: true, createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: MAX_BEHAVIOR_ORDER_FACTS
          } as any)
        : Promise.resolve([])
    ]);
    const behavior = personalized ? this.behaviorScores(behaviorTags as any[], orders as any[]) : new Map<string, number>();
    const eligible = candidates.filter((candidate) => this.isEligible(candidate, exposure.get(candidate.id), now));
    const ranked = this.rankCandidates({
      candidates: eligible,
      placement,
      themeId: query.themeId,
      preference,
      personalized,
      behavior,
      exposure,
      userId,
      now
    });
    if (ranked.length === 0) {
      return this.emptyPage(personalized, pageSize);
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Serialize only the final private-boundary recheck and immutable request
      // snapshot. If the companion's change commits first, it is observed here;
      // if this snapshot commits first, that change expires it before later use.
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const unavailableNow = await this.privateUnavailableCompanionIds(
        userId,
        ranked.map((item) => item.companion.id),
        db
      );
      const snapshot = ranked.filter((item) => !unavailableNow.has(item.companion.id));
      if (snapshot.length === 0) return null;

      const created = await db.recommendationRequest.create({
        data: {
          userId,
          placement: placement as any,
          context: { themeId: query.themeId ?? null },
          algorithmVersion: ALGORITHM_VERSION,
          personalized,
          expiresAt: new Date(now.getTime() + REQUEST_TTL_MS)
        }
      });
      await db.recommendationImpression.createMany({
        data: snapshot.map((item, index) => ({
          requestId: created.id,
          companionId: item.companion.id,
          position: index + 1,
          score: item.score,
          reasonCodes: item.reasonCodes
        }))
      });
      return created;
    });
    if (!request) return this.emptyPage(personalized, pageSize);

    return this.getRequestPage(userId, request.id, 0, pageSize);
  }

  async recordEvents(userId: string, dto: RecordRecommendationEventsDto) {
    const uniqueIds = [...new Set(dto.events.map((event) => event.impressionId))];
    if (uniqueIds.length === 0) return { updated: 0 };
    const [impressions, preference] = await Promise.all([
      this.prisma.recommendationImpression.findMany({
        where: { id: { in: uniqueIds }, request: { userId } },
        include: { companion: { select: { topicIds: true, specialties: true, serviceTags: { include: { tag: true } } } } }
      } as any),
      this.prisma.userRecommendationPreference.findUnique({ where: { userId } })
    ]);
    const byId = new Map(impressions.map((impression: any) => [impression.id, impression]));
    const personalizationEnabled =
      isRecommendationPersonalizationRankingAllowed()
      && this.asPreference(preference).personalizationEnabled;
    const now = new Date();
    let updated = 0;

    for (const event of dto.events) {
      const impression: any = byId.get(event.impressionId);
      if (!impression) continue;
      if (event.type === "view") {
        const result = await this.prisma.recommendationImpression.updateMany({
          where: { id: impression.id, viewedAt: null },
          data: { viewedAt: now }
        });
        updated += result.count;
        continue;
      }

      const result = await this.prisma.recommendationImpression.updateMany({
        where: { id: impression.id, clickedAt: null },
        data: { clickedAt: now, viewedAt: impression.viewedAt ?? now }
      });
      updated += result.count;
      if (result.count > 0 && personalizationEnabled) {
        const topicIds = normalizeTopicIds(impression.companion.topicIds).length > 0
          ? normalizeTopicIds(impression.companion.topicIds)
          : deriveTopicIds(
              impression.companion.specialties,
              impression.companion.serviceTags.map((entry: any) => entry.tag.name)
            );
        await this.addBehavioralSignal(userId, topicIds, 1);
      }
    }
    return { updated };
  }

  /** Validates that an order can claim a recommendation impression without exposing its data. */
  async validateOrderAttribution(userId: string, impressionId: string, companionId: string): Promise<string> {
    const impression: any = await this.prisma.recommendationImpression.findFirst({
      where: {
        id: impressionId,
        companionId,
        servedAt: { gte: new Date(Date.now() - ATTRIBUTION_WINDOW_MS) },
        request: { userId }
      },
      include: { order: { select: { id: true } } }
    } as any);
    if (!impression || impression.order) {
      throw new AppException(
        "INVALID_RECOMMENDATION_ATTRIBUTION",
        "Recommendation attribution is invalid or expired",
        HttpStatus.BAD_REQUEST
      );
    }
    return impression.id;
  }

  /** A confirmed order is a stronger signal than a card click, unless the user removed that tag. */
  async recordOrderCreated(userId: string, topicIds: string[]) {
    if (!isRecommendationPersonalizationRankingAllowed()) return;
    const preference = await this.prisma.userRecommendationPreference.findUnique({ where: { userId } });
    if (!this.asPreference(preference).personalizationEnabled) return;
    await this.addBehavioralSignal(userId, topicIds, 3);
  }

  async updatePolicy(companionId: string, placement: string, dto: UpdateRecommendationPolicyDto) {
    if (!(["discoverHome", "communityRelated", "orderFollowup"] as string[]).includes(placement)) {
      throw new AppException("INVALID_RECOMMENDATION_PLACEMENT", "Invalid recommendation placement", HttpStatus.BAD_REQUEST);
    }
    const companion = await this.prisma.companionProfile.findUnique({
      where: { id: companionId },
      select: { id: true, ownerUserId: true }
    });
    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
    const startsAt = dto.startsAt === undefined ? undefined : (dto.startsAt ? new Date(dto.startsAt) : null);
    const endsAt = dto.endsAt === undefined ? undefined : (dto.endsAt ? new Date(dto.endsAt) : null);
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new AppException("INVALID_RECOMMENDATION_WINDOW", "endsAt must be after startsAt", HttpStatus.BAD_REQUEST);
    }
    const policy = await this.prisma.companionRecommendationPolicy.upsert({
      where: { companionId_placement: { companionId, placement: placement as any } },
      create: {
        companionId,
        placement: placement as any,
        status: dto.status ?? "active",
        boostBps: dto.boostBps ?? 0,
        dailyCap: dto.dailyCap ?? null,
        startsAt: startsAt ?? null,
        endsAt: endsAt ?? null
      },
      update: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.boostBps !== undefined ? { boostBps: dto.boostBps } : {}),
        ...(dto.dailyCap !== undefined ? { dailyCap: dto.dailyCap } : {}),
        ...(startsAt !== undefined ? { startsAt } : {}),
        ...(endsAt !== undefined ? { endsAt } : {})
      }
    } as any);
    return { policy, subjectUserId: companion.ownerUserId };
  }

  async metrics(query: RecommendationMetricsQueryDto) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : this.daysAgo(14);
    const to = query.to ? new Date(query.to) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() < from.getTime()) {
      throw new AppException("INVALID_RECOMMENDATION_METRICS_RANGE", "Invalid metrics date range", HttpStatus.BAD_REQUEST);
    }
    if (to.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
      throw new AppException("RECOMMENDATION_METRICS_RANGE_TOO_LARGE", "Metrics range may not exceed 90 days", HttpStatus.BAD_REQUEST);
    }
    const impressions = await this.prisma.recommendationImpression.findMany({
      where: { servedAt: { gte: from, lte: to } },
      include: {
        request: { select: { placement: true } },
        companion: { select: { id: true, name: true } },
        order: {
          select: {
            id: true,
            amountCents: true,
            companionConfirmedAt: true,
            paidAt: true,
            serviceStartedAt: true,
            completedAt: true,
            reviews: { select: { id: true }, take: 1 },
            refunds: { where: { status: "success" }, select: { id: true }, take: 1 }
          }
        }
      },
      orderBy: [{ servedAt: "desc" }, { id: "desc" }],
      take: 5001
    } as any);
    const truncated = impressions.length > 5000;
    const sampledImpressions = (impressions as any[]).slice(0, 5000);
    const attributedOrders = sampledImpressions.flatMap((impression) =>
      impression.order ? [impression.order] : []
    );
    const acceptedOrderIds = await loadAcceptedOrderIds(this.prisma, attributedOrders);
    const buckets = new Map<string, any>();
    for (const impression of sampledImpressions) {
      const placement = impression.request.placement;
      const key = `${placement}:${impression.companionId}`;
      const bucket = buckets.get(key) ?? {
        placement,
        companion: impression.companion,
        served: 0,
        viewed: 0,
        clicked: 0,
        orderCreated: 0,
        accepted: 0,
        paid: 0,
        started: 0,
        completed: 0,
        reviewed: 0,
        refunded: 0,
        grossPaidCents: 0
      };
      bucket.served += 1;
      if (impression.viewedAt) bucket.viewed += 1;
      if (impression.clickedAt) bucket.clicked += 1;
      if (impression.order) {
        bucket.orderCreated += 1;
        if (acceptedOrderIds.has(impression.order.id)) bucket.accepted += 1;
        if (impression.order.paidAt) {
          bucket.paid += 1;
          bucket.grossPaidCents += impression.order.amountCents;
        }
        if (impression.order.serviceStartedAt) bucket.started += 1;
        if (impression.order.completedAt) bucket.completed += 1;
        if ((impression.order.reviews?.length ?? 0) > 0) bucket.reviewed += 1;
        if ((impression.order.refunds?.length ?? 0) > 0) bucket.refunded += 1;
      }
      buckets.set(key, bucket);
    }
    const items = [...buckets.values()]
      .map((bucket) => ({
        ...bucket,
        viewRate: this.rate(bucket.viewed, bucket.served),
        clickRate: this.rate(bucket.clicked, bucket.served),
        orderRate: this.rate(bucket.orderCreated, bucket.served),
        acceptanceRate: this.rate(bucket.accepted, bucket.orderCreated),
        paidRate: this.rate(bucket.paid, bucket.orderCreated),
        startRate: this.rate(bucket.started, bucket.paid),
        completionRate: this.rate(bucket.completed, bucket.paid),
        reviewRate: this.rate(bucket.reviewed, bucket.completed),
        refundRate: this.rate(bucket.refunded, bucket.paid)
      }))
      .sort((left, right) => right.served - left.served || left.placement.localeCompare(right.placement));
    return {
      algorithmVersion: ALGORITHM_VERSION,
      range: { from: from.toISOString(), to: to.toISOString() },
      truncated,
      items
    };
  }

  private async getRequestPage(userId: string, requestId: string, offset: number, pageSize: number) {
    const request = await this.prisma.recommendationRequest.findFirst({
      where: { id: requestId, userId, expiresAt: { gt: new Date() } }
    });
    if (!request) {
      throw new AppException("RECOMMENDATION_CURSOR_EXPIRED", "Recommendation result has expired", HttpStatus.GONE);
    }
    const themeId = typeof (request as any).context?.themeId === "string" ? (request as any).context.themeId : undefined;
    const requestCompanions = await this.prisma.recommendationImpression.findMany({
      where: { requestId },
      select: { companionId: true },
      orderBy: { position: "asc" },
      take: MAX_CANDIDATES
    } as any) as Array<{ companionId: string }>;
    const requestCompanionIds = requestCompanions.map((item) => item.companionId);
    const sellableMatches = await this.companions.findSellableCompanions(
      themeId ? { topicId: themeId } : {},
      7,
      requestCompanionIds,
      MAX_CANDIDATES
    );
    const sellableIds = sellableMatches.map((match) => match.id);
    const excludedCompanionIds = await this.privateUnavailableCompanionIds(userId, sellableIds);
    const sellableById = new Map(
      sellableMatches
        .filter((match) => !excludedCompanionIds.has(match.id))
        .map((match) => [match.id, match])
    );
    const currentEligibility = this.eligibleCompanionWhere([...sellableById.keys()]);
    const [impressions, total] = await Promise.all([
      this.prisma.recommendationImpression.findMany({
        where: { requestId, companion: currentEligibility },
        include: {
          companion: {
            include: { serviceTags: { include: { tag: true }, orderBy: { tag: { name: "asc" } } } }
          }
        },
        orderBy: { position: "asc" },
        skip: offset,
        take: pageSize
      } as any),
      this.prisma.recommendationImpression.count({ where: { requestId, companion: currentEligibility } })
    ]);
    const nextOffset = offset + impressions.length;
    return {
      algorithmVersion: request.algorithmVersion,
      personalized: request.personalized,
      items: (impressions as any[]).map((impression) => ({
        ...this.toCompanionDto(impression.companion, sellableById.get(impression.companion.id)!),
        impressionId: impression.id,
        position: impression.position,
        score: this.round(impression.score),
        reasonCodes: impression.reasonCodes,
        reasonText: this.reasonText(impression.reasonCodes, themeId)
      })),
      pagination: {
        pageSize,
        total,
        nextCursor: nextOffset < total ? this.encodeCursor({ requestId, offset: nextOffset }) : null
      }
    };
  }

  private async loadEligibleCandidates(
    placement: string,
    sellableById: Map<string, SellableCompanionMatch>
  ): Promise<CompanionCandidate[]> {
    if (sellableById.size === 0) return [];
    const companions = await this.prisma.companionProfile.findMany({
      where: {
        ...this.eligibleCompanionWhere([...sellableById.keys()])
      },
      include: {
        serviceTags: { include: { tag: true }, orderBy: { tag: { name: "asc" } } },
        recommendationPolicies: { where: { placement: placement as any } }
      },
      orderBy: [
        { isOnline: "desc" },
        { rating: "desc" },
        { reviewCount: "desc" },
        { id: "asc" }
      ],
      take: MAX_CANDIDATES
    } as any) as any[];
    return companions.map((companion) => ({
      ...companion,
      catalog: sellableById.get(companion.id)!
    }));
  }

  private async privateUnavailableCompanionIds(
    userId: string,
    companionIds: string[],
    db: any = this.prisma
  ): Promise<Set<string>> {
    if (companionIds.length === 0) return new Set();
    const [customerExclusions, companionBoundaries] = await Promise.all([
      db.userCompanionRecommendationExclusion.findMany({
        // Both preference directions are private and potentially long-lived.
        // Restrict reads to this bounded candidate set and return only ids.
        where: { userId, companionId: { in: companionIds } },
        select: { companionId: true }
      } as any),
      db.companionCustomerFutureBoundary.findMany({
        where: { customerUserId: userId, companionId: { in: companionIds } },
        select: { companionId: true }
      } as any)
    ]);
    return new Set(
      [...customerExclusions, ...companionBoundaries]
        .map((item: { companionId: string }) => item.companionId)
    );
  }

  private eligibleCompanionWhere(companionIds?: string[]) {
    return {
      ...(companionIds ? { id: { in: companionIds } } : {}),
      isPublished: true,
      isVerified: true,
      ownerUserId: { not: null },
      owner: { accountStatus: "active", profile: { isVerified: true } },
      commercialProfile: {
        status: "verified",
        adultEligibilityVerdict: "adult",
        adultEligibilityValidUntil: { gt: new Date() }
      }
    } as const;
  }

  private async collectExposure(userId: string, companionIds: string[], now: Date): Promise<Map<string, Exposure>> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const [viewsSevenDays, viewsTwentyFourHours, servedToday] = await Promise.all([
      this.prisma.recommendationImpression.groupBy({
        by: ["companionId"],
        where: {
          companionId: { in: companionIds },
          viewedAt: { gte: sevenDaysAgo },
          request: { userId }
        },
        _count: { _all: true }
      } as any),
      this.prisma.recommendationImpression.groupBy({
        by: ["companionId"],
        where: {
          companionId: { in: companionIds },
          viewedAt: { gte: twentyFourHoursAgo },
          request: { userId }
        },
        _count: { _all: true }
      } as any),
      this.prisma.recommendationImpression.groupBy({
        by: ["companionId"],
        where: { companionId: { in: companionIds }, servedAt: { gte: dayStart } },
        _count: { _all: true }
      } as any)
    ]);
    const exposure = new Map<string, Exposure>(companionIds.map((id) => [id, {
      views24Hours: 0,
      views7Days: 0,
      servedToday: 0
    }]));
    for (const row of viewsSevenDays as any[]) {
      const entry = exposure.get(row.companionId);
      if (entry) entry.views7Days = Number(row._count?._all ?? 0);
    }
    for (const row of viewsTwentyFourHours as any[]) {
      const entry = exposure.get(row.companionId);
      if (entry) entry.views24Hours = Number(row._count?._all ?? 0);
    }
    for (const row of servedToday as any[]) {
      const entry = exposure.get(row.companionId);
      if (entry) entry.servedToday = Number(row._count?._all ?? 0);
    }
    return exposure;
  }

  private isEligible(candidate: CompanionCandidate, exposure: Exposure | undefined, now: Date): boolean {
    const policy = candidate.recommendationPolicies[0];
    if (policy?.status === "paused") return false;
    if ((exposure?.views24Hours ?? 0) >= 2 || (exposure?.views7Days ?? 0) >= 5) return false;
    if (!policy || !this.policyIsInWindow(policy, now)) return true;
    return policy.dailyCap === null || (exposure?.servedToday ?? 0) < policy.dailyCap;
  }

  private rankCandidates(input: {
    candidates: CompanionCandidate[];
    placement: string;
    themeId?: string;
    preference: Preference;
    personalized: boolean;
    behavior: Map<string, number>;
    exposure: Map<string, Exposure>;
    userId: string;
    now: Date;
  }): RankedCandidate[] {
    const maxBehavior = Math.max(0, ...input.behavior.values());
    const ranked = input.candidates.map((candidate) => {
      const scored = this.scoreCandidate(candidate, input, maxBehavior);
      const policy = candidate.recommendationPolicies[0];
      if (policy && this.policyIsInWindow(policy, input.now) && policy.boostBps !== 0) {
        scored.score *= 1 + policy.boostBps / 10000;
        scored.reasonCodes.push("policyBoost");
      }
      scored.score = this.round(Math.max(0, scored.score));
      scored.reasonCodes = [...new Set(scored.reasonCodes)];
      scored.reasonText = this.reasonText(scored.reasonCodes, input.themeId);
      return scored;
    }).sort((left, right) => right.score - left.score || left.companion.id.localeCompare(right.companion.id));
    return this.injectExploration(ranked, input.exposure, input.userId, input.now);
  }

  private scoreCandidate(
    candidate: CompanionCandidate,
    input: {
      themeId?: string;
      preference: Preference;
      personalized: boolean;
      behavior: Map<string, number>;
    },
    maxBehavior: number
  ): RankedCandidate {
    const topicIds = normalizeTopicIds(candidate.topicIds).length > 0
      ? normalizeTopicIds(candidate.topicIds)
      : deriveTopicIds(candidate.specialties, candidate.serviceTags.map((entry) => entry.tag.name));
    const factors: Array<{ code: string; score: number; weight: number; available: boolean }> = [];
    if (input.themeId) {
      factors.push({ code: "theme", score: topicIds.includes(input.themeId) ? 1 : 0, weight: 0.25, available: true });
    }
    if (input.personalized && (input.preference.topicIds.length > 0 || input.preference.city)) {
      const topicOverlap = this.overlapScore(topicIds, input.preference.topicIds);
      const cityScore = input.preference.city && candidate.cityDistrict.toLowerCase().includes(input.preference.city.toLowerCase()) ? 1 : 0;
      factors.push({ code: "preference", score: Math.max(topicOverlap, cityScore), weight: 0.2, available: true });
    }
    if (input.personalized && maxBehavior > 0) {
      const behavioralScore = Math.max(...topicIds.map((topicId) => input.behavior.get(topicId) ?? 0), 0) / maxBehavior;
      factors.push({ code: "behavior", score: behavioralScore, weight: 0.2, available: true });
    }
    factors.push({ code: "availability", score: this.availabilityScore(candidate, input.preference), weight: 0.15, available: true });
    if (input.personalized && input.preference.maxPricePerHalfHour) {
      const catalogPricePerHalfHour = candidate.catalog.startingPriceCents
        / 100
        * (30 / candidate.catalog.startingDurationMinutes);
      factors.push({
        code: "budget",
        score: this.budgetScore(catalogPricePerHalfHour, input.preference.maxPricePerHalfHour),
        weight: 0.1,
        available: true
      });
    }
    factors.push({ code: "quality", score: this.qualityScore(candidate), weight: 0.1, available: true });
    const denominator = factors.filter((factor) => factor.available).reduce((sum, factor) => sum + factor.weight, 0);
    const score = denominator === 0
      ? 0
      : factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / denominator;
    const reasonCodes = factors.filter((factor) => factor.score >= 0.6).map((factor) => factor.code);
    return { companion: candidate, score, reasonCodes, reasonText: "" };
  }

  private injectExploration(
    ranked: RankedCandidate[],
    exposure: Map<string, Exposure>,
    userId: string,
    now: Date
  ): RankedCandidate[] {
    const target = Math.floor(ranked.length * 0.15);
    if (target === 0) return ranked;
    const lowerRanked = ranked.slice(Math.min(3, ranked.length));
    const exploration = lowerRanked
      .slice()
      .sort((left, right) => {
        const leftExposure = exposure.get(left.companion.id)?.servedToday ?? 0;
        const rightExposure = exposure.get(right.companion.id)?.servedToday ?? 0;
        return leftExposure - rightExposure ||
          this.stableRank(`${userId}:${now.toDateString()}:${left.companion.id}`) -
            this.stableRank(`${userId}:${now.toDateString()}:${right.companion.id}`);
      })
      .slice(0, target)
      .map((item) => ({ ...item, reasonCodes: [...item.reasonCodes, "exploration"], reasonText: "更多新选择" }));
    if (exploration.length === 0) return ranked;
    const explorationIds = new Set(exploration.map((item) => item.companion.id));
    const relevance = ranked.filter((item) => !explorationIds.has(item.companion.id));
    const output: RankedCandidate[] = [];
    let explorationIndex = 0;
    for (const item of relevance) {
      output.push(item);
      if (output.length % 6 === 0 && explorationIndex < exploration.length) {
        output.push(exploration[explorationIndex++]);
      }
    }
    while (explorationIndex < exploration.length) output.push(exploration[explorationIndex++]);
    return output;
  }

  private behaviorScores(tags: any[], orders: any[]): Map<string, number> {
    const disabledTopics = new Set(tags.filter((tag) => tag.disabledAt).map((tag) => tag.topicId));
    const result = new Map<string, number>();
    const now = new Date();
    for (const tag of tags) {
      if (tag.disabledAt || !isRecommendationTopicId(tag.topicId)) continue;
      this.addScore(result, tag.topicId, tag.weight * this.decay(tag.updatedAt, now));
    }
    for (const [topicId, weight] of this.behaviorFromOrders(orders, disabledTopics, now)) {
      this.addScore(result, topicId, weight);
    }
    return result;
  }

  private behaviorFromOrders(orders: any[], disabledTopics: Set<string>, now = new Date()): Map<string, number> {
    const result = new Map<string, number>();
    for (const order of orders) {
      if (!isRecommendationTopicId(order.themeId) || disabledTopics.has(order.themeId)) continue;
      const statusWeight = ["paid", "inService", "completed"].includes(order.status) ? 6 : 3;
      this.addScore(result, order.themeId, statusWeight * this.decay(order.createdAt, now));
    }
    return result;
  }

  private async addBehavioralSignal(userId: string, topicIds: string[], increment: number) {
    for (const topicId of normalizeTopicIds(topicIds)) {
      const existing = await this.prisma.userRecommendationTag.findUnique({
        where: { userId_topicId_source: { userId, topicId, source: "behavioral" as any } }
      } as any);
      if (existing?.disabledAt) continue;
      await this.prisma.userRecommendationTag.upsert({
        where: { userId_topicId_source: { userId, topicId, source: "behavioral" as any } },
        create: { userId, topicId, source: "behavioral" as any, weight: increment },
        update: { weight: { increment } }
      } as any);
    }
  }

  private asPreference(value: any): Preference {
    return {
      // Missing preference rows and non-true values default to off so ranking
      // never uses behavior tags until the user explicitly enables personalization.
      personalizationEnabled: value?.personalizationEnabled === true,
      topicIds: normalizeTopicIds(value?.topicIds),
      city: value?.city ?? null,
      maxPricePerHalfHour: value?.maxPricePerHalfHour ?? null,
      preferredTimeSlots: value?.preferredTimeSlots ?? []
    };
  }

  private normalizeCompanionId(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new AppException("INVALID_COMPANION_ID", "Companion id is invalid", HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private exclusionCompanionInclude() {
    return {
      companion: {
        select: {
          id: true,
          isPublished: true,
          isVerified: true,
          ownerUserId: true,
          owner: {
            select: {
              accountStatus: true,
              profile: { select: { isVerified: true } }
            }
          },
          commercialProfile: {
            select: {
              status: true,
              adultEligibilityVerdict: true,
              adultEligibilityValidUntil: true
            }
          }
        }
      }
    } as const;
  }

  private companionExclusionDto(item: any) {
    const companion = item.companion;
    const currentlyPublic = Boolean(
      companion?.isPublished
      && companion.isVerified
      && companion.ownerUserId
      && companion.owner?.accountStatus === "active"
      && companion.owner?.profile?.isVerified === true
      && companion.commercialProfile?.status === "verified"
      && companion.commercialProfile.adultEligibilityVerdict === "adult"
      && companion.commercialProfile.adultEligibilityValidUntil instanceof Date
      && companion.commercialProfile.adultEligibilityValidUntil.getTime() > Date.now()
    );
    return {
      companionId: item.companionId,
      excludedAt: item.createdAt.toISOString(),
      companion: {
        id: companion.id,
        // These values were public when the user made the choice. Do not read
        // later unpublished edits into this private settings surface.
        name: item.companionNameSnapshot,
        role: item.companionRoleSnapshot,
        initials: item.companionInitialsSnapshot,
        currentlyPublic
      }
    };
  }

  private toCompanionDto(companion: any, catalog: SellableCompanionMatch) {
    const topicIds = normalizeTopicIds(companion.topicIds).length > 0
      ? normalizeTopicIds(companion.topicIds)
      : deriveTopicIds(companion.specialties, companion.serviceTags.map((entry: any) => entry.tag.name));
    return {
      id: companion.id,
      name: companion.name,
      role: companion.role,
      initials: companion.initials,
      tags: companion.serviceTags.map((entry: any) => entry.tag.name),
      topicIds,
      rating: companion.rating,
      reviewCount: companion.reviewCount,
      pricePerHalfHour: companion.pricePerHalfHour,
      isOnline: companion.isOnline,
      isVerified: companion.isVerified,
      bio: companion.bio,
      availableTimes: companion.availableTimes,
      languages: companion.languages,
      specialties: companion.specialties,
      completedOrders: companion.completedOrders,
      responseTime: companion.responseTime,
      distanceKm: companion.distanceKm,
      availability: companion.availability,
      cityDistrict: companion.cityDistrict,
      catalog: {
        sellable: true,
        startingPriceCents: catalog.startingPriceCents,
        startingDurationMinutes: catalog.startingDurationMinutes,
        currency: catalog.currency,
        deliveryModes: catalog.deliveryModes,
        nextAvailableAt: catalog.earliestStartsAt.toISOString()
      },
      isPublished: companion.isPublished,
      createdAt: companion.createdAt.toISOString(),
      updatedAt: companion.updatedAt.toISOString()
    };
  }

  private assertTopicIds(topicIds: string[]): string[] {
    const trimmed = [...new Set(topicIds.map((value) => value.trim()).filter(Boolean))];
    const normalized = normalizeTopicIds(trimmed);
    if (normalized.length !== trimmed.length) {
      throw new AppException("INVALID_RECOMMENDATION_TOPIC", "One or more recommendation topics are invalid", HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private assertTimeSlots(timeSlots: string[]): string[] {
    const normalized = [...new Set(timeSlots.map((value) => value.trim()).filter(Boolean))];
    if (normalized.some((value) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
      throw new AppException("INVALID_RECOMMENDATION_TIME_SLOT", "Time slots must use HH:mm format", HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private availabilityScore(candidate: CompanionCandidate, preference: Preference): number {
    const base = candidate.availability === "online" || candidate.isOnline
      ? 1
      : candidate.availability === "available"
        ? 0.65
        : 0.15;
    if (preference.preferredTimeSlots.length === 0) return base;
    const overlap = this.overlapScore(candidate.availableTimes, preference.preferredTimeSlots);
    return Math.min(1, base * 0.75 + overlap * 0.25);
  }

  private qualityScore(candidate: CompanionCandidate): number {
    const rating = Math.max(0, Math.min(1, candidate.rating / 5));
    const reviews = Math.min(1, Math.log1p(Math.max(0, candidate.reviewCount)) / Math.log(201));
    return rating * 0.7 + reviews * 0.3;
  }

  private budgetScore(price: number, maxPrice: number): number {
    if (price <= maxPrice) return 1;
    return Math.max(0, 1 - (price - maxPrice) / Math.max(1, maxPrice));
  }

  private overlapScore(left: readonly string[], right: readonly string[]): number {
    if (left.length === 0 || right.length === 0) return 0;
    const rightValues = new Set(right);
    return left.filter((value) => rightValues.has(value)).length / Math.max(1, Math.min(left.length, right.length));
  }

  private policyIsInWindow(policy: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
    return (!policy.startsAt || policy.startsAt.getTime() <= now.getTime()) &&
      (!policy.endsAt || policy.endsAt.getTime() >= now.getTime());
  }

  private reasonText(reasonCodes: string[], themeId?: string): string {
    if (reasonCodes.includes("exploration")) return "更多新选择";
    if (reasonCodes.includes("theme") && themeId) return `适合${topicName(themeId)}`;
    if (reasonCodes.includes("preference")) return "符合你的偏好";
    if (reasonCodes.includes("behavior")) return "与你最近关注的服务相关";
    if (reasonCodes.includes("availability")) return "当前可优先联系";
    if (reasonCodes.includes("quality")) return "口碑较好";
    return "为你推荐";
  }

  private encodeCursor(value: { requestId: string; offset: number }): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }

  private decodeCursor(cursor: string): { requestId: string; offset: number } {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (typeof decoded?.requestId !== "string" || !Number.isInteger(decoded.offset) || decoded.offset < 0) {
        throw new Error("invalid cursor");
      }
      return decoded;
    } catch {
      throw new AppException("INVALID_RECOMMENDATION_CURSOR", "Invalid recommendation cursor", HttpStatus.BAD_REQUEST);
    }
  }

  private emptyPage(personalized = false, pageSize = 0) {
    return {
      algorithmVersion: ALGORITHM_VERSION,
      personalized,
      items: [],
      pagination: { pageSize, total: 0, nextCursor: null }
    };
  }

  private daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private decay(date: Date, now: Date): number {
    const ageDays = Math.max(0, now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
    return 0.5 ** (ageDays / HALF_LIFE_DAYS);
  }

  private addScore(scores: Map<string, number>, topicId: string, amount: number) {
    scores.set(topicId, (scores.get(topicId) ?? 0) + amount);
  }

  private stableRank(value: string): number {
    return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
  }

  private rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : this.round(numerator / denominator);
  }

  private round(value: number): number {
    return Math.round(value * 10000) / 10000;
  }
}
