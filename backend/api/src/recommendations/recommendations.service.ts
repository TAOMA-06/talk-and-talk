import { createHash } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
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
const HALF_LIFE_DAYS = 30;
const MAX_CANDIDATES = 200;

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
  constructor(private readonly prisma: PrismaService) {}

  topics() {
    return {
      algorithmVersion: ALGORITHM_VERSION,
      items: RECOMMENDATION_TOPICS.map(({ id, name }) => ({ id, name }))
    };
  }

  async getPreferences(userId: string) {
    const [stored, tags, orders] = await Promise.all([
      this.prisma.userRecommendationPreference.findUnique({ where: { userId } }),
      this.prisma.userRecommendationTag.findMany({
        where: { userId, source: "behavioral" as any },
        orderBy: [{ updatedAt: "desc" }]
      } as any),
      this.prisma.order.findMany({
        where: {
          userId,
          createdAt: { gte: this.daysAgo(BEHAVIOR_LOOKBACK_DAYS) },
          status: { in: ["pending", "paying", "paid", "inService", "completed"] }
        },
        select: { themeId: true, status: true, createdAt: true }
      } as any)
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
      behavioralTags: [...activeTags, ...inferredTags]
    };
  }

  async updatePreferences(userId: string, dto: UpdateRecommendationPreferencesDto) {
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
        personalizationEnabled: dto.personalizationEnabled ?? true,
        topicIds: normalizedTopics ?? [],
        city: city ?? null,
        maxPricePerHalfHour: maxPricePerHalfHour ?? null,
        preferredTimeSlots: preferredTimeSlots ?? []
      },
      update: {
        ...(dto.personalizationEnabled !== undefined ? { personalizationEnabled: dto.personalizationEnabled } : {}),
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

  async listCompanions(userId: string, query: ListRecommendedCompanionsDto) {
    const pageSize = query.pageSize ?? 20;
    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      return this.getRequestPage(userId, cursor.requestId, cursor.offset, pageSize);
    }

    const placement = query.placement ?? "discoverHome";
    const preferenceRecord = await this.prisma.userRecommendationPreference.findUnique({ where: { userId } });
    const preference = this.asPreference(preferenceRecord);
    const personalized = preference.personalizationEnabled;
    const now = new Date();
    const candidates = await this.loadEligibleCandidates(placement);
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
            select: { themeId: true, status: true, createdAt: true }
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

    const request = await this.prisma.recommendationRequest.create({
      data: {
        userId,
        placement: placement as any,
        context: { themeId: query.themeId ?? null },
        algorithmVersion: ALGORITHM_VERSION,
        personalized,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_MS)
      }
    } as any);
    await this.prisma.recommendationImpression.createMany({
      data: ranked.map((item, index) => ({
        requestId: request.id,
        companionId: item.companion.id,
        position: index + 1,
        score: item.score,
        reasonCodes: item.reasonCodes
      }))
    } as any);

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
    const personalizationEnabled = this.asPreference(preference).personalizationEnabled;
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
    const preference = await this.prisma.userRecommendationPreference.findUnique({ where: { userId } });
    if (!this.asPreference(preference).personalizationEnabled) return;
    await this.addBehavioralSignal(userId, topicIds, 3);
  }

  async updatePolicy(companionId: string, placement: string, dto: UpdateRecommendationPolicyDto) {
    if (!(["discoverHome", "communityRelated", "orderFollowup"] as string[]).includes(placement)) {
      throw new AppException("INVALID_RECOMMENDATION_PLACEMENT", "Invalid recommendation placement", HttpStatus.BAD_REQUEST);
    }
    const companion = await this.prisma.companionProfile.findUnique({ where: { id: companionId }, select: { id: true } });
    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
    const startsAt = dto.startsAt === undefined ? undefined : (dto.startsAt ? new Date(dto.startsAt) : null);
    const endsAt = dto.endsAt === undefined ? undefined : (dto.endsAt ? new Date(dto.endsAt) : null);
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new AppException("INVALID_RECOMMENDATION_WINDOW", "endsAt must be after startsAt", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.companionRecommendationPolicy.upsert({
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
        order: { select: { id: true, status: true } }
      },
      orderBy: { servedAt: "desc" },
      take: 5001
    } as any);
    const truncated = impressions.length > 5000;
    const buckets = new Map<string, any>();
    for (const impression of impressions.slice(0, 5000) as any[]) {
      const placement = impression.request.placement;
      const key = `${placement}:${impression.companionId}`;
      const bucket = buckets.get(key) ?? {
        placement,
        companion: impression.companion,
        served: 0,
        viewed: 0,
        clicked: 0,
        orderCreated: 0,
        paid: 0
      };
      bucket.served += 1;
      if (impression.viewedAt) bucket.viewed += 1;
      if (impression.clickedAt) bucket.clicked += 1;
      if (impression.order) {
        bucket.orderCreated += 1;
        if (["paid", "inService", "completed"].includes(impression.order.status)) bucket.paid += 1;
      }
      buckets.set(key, bucket);
    }
    const items = [...buckets.values()]
      .map((bucket) => ({
        ...bucket,
        viewRate: this.rate(bucket.viewed, bucket.served),
        clickRate: this.rate(bucket.clicked, bucket.served),
        orderRate: this.rate(bucket.orderCreated, bucket.served),
        paidRate: this.rate(bucket.paid, bucket.served)
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
    const [impressions, total] = await Promise.all([
      this.prisma.recommendationImpression.findMany({
        where: { requestId },
        include: {
          companion: {
            include: { serviceTags: { include: { tag: true }, orderBy: { tag: { name: "asc" } } } }
          }
        },
        orderBy: { position: "asc" },
        skip: offset,
        take: pageSize
      } as any),
      this.prisma.recommendationImpression.count({ where: { requestId } })
    ]);
    const nextOffset = offset + impressions.length;
    const themeId = typeof (request as any).context?.themeId === "string" ? (request as any).context.themeId : undefined;
    return {
      algorithmVersion: request.algorithmVersion,
      personalized: request.personalized,
      items: (impressions as any[]).map((impression) => ({
        ...this.toCompanionDto(impression.companion),
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

  private async loadEligibleCandidates(placement: string): Promise<CompanionCandidate[]> {
    return this.prisma.companionProfile.findMany({
      where: {
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } }
      },
      include: {
        serviceTags: { include: { tag: true }, orderBy: { tag: { name: "asc" } } },
        recommendationPolicies: { where: { placement: placement as any } }
      },
      orderBy: [{ isOnline: "desc" }, { rating: "desc" }, { reviewCount: "desc" }],
      take: MAX_CANDIDATES
    } as any) as any;
  }

  private async collectExposure(userId: string, companionIds: string[], now: Date): Promise<Map<string, Exposure>> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const [views, servedToday] = await Promise.all([
      this.prisma.recommendationImpression.findMany({
        where: {
          companionId: { in: companionIds },
          viewedAt: { gte: sevenDaysAgo },
          request: { userId }
        },
        select: { companionId: true, viewedAt: true }
      } as any),
      this.prisma.recommendationImpression.findMany({
        where: { companionId: { in: companionIds }, servedAt: { gte: dayStart } },
        select: { companionId: true }
      } as any)
    ]);
    const exposure = new Map<string, Exposure>(companionIds.map((id) => [id, {
      views24Hours: 0,
      views7Days: 0,
      servedToday: 0
    }]));
    for (const view of views as any[]) {
      const entry = exposure.get(view.companionId);
      if (!entry) continue;
      entry.views7Days += 1;
      if (view.viewedAt && view.viewedAt.getTime() >= twentyFourHoursAgo.getTime()) entry.views24Hours += 1;
    }
    for (const served of servedToday as any[]) {
      const entry = exposure.get(served.companionId);
      if (entry) entry.servedToday += 1;
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
      factors.push({
        code: "budget",
        score: this.budgetScore(candidate.pricePerHalfHour, input.preference.maxPricePerHalfHour),
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
      personalizationEnabled: value?.personalizationEnabled !== false,
      topicIds: normalizeTopicIds(value?.topicIds),
      city: value?.city ?? null,
      maxPricePerHalfHour: value?.maxPricePerHalfHour ?? null,
      preferredTimeSlots: value?.preferredTimeSlots ?? []
    };
  }

  private toCompanionDto(companion: any) {
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
