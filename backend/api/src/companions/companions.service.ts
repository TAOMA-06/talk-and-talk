import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateCompanionDto, UpdateCompanionDto } from "./dto/companion-profile.dto";
import { ListCompanionsQueryDto } from "./dto/list-companions.dto";
import { ApplyCompanionDto, UpdateOwnCompanionDto } from "./dto/apply-companion.dto";
import { deriveTopicIds, normalizeTopicIds } from "../recommendations/recommendation-topics";

type CompanionRecord = Awaited<ReturnType<CompanionsService["findRecordOrThrow"]>>;

@Injectable()
export class CompanionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(query: ListCompanionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildPublicWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.companionProfile.findMany({
        where,
        include: this.includeTags(),
        orderBy: [
          { isOnline: "desc" },
          { rating: "desc" },
          { reviewCount: "desc" },
          { pricePerHalfHour: "asc" }
        ],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.companionProfile.count({ where })
    ]);

    return {
      items: items.map((item) => this.toDto(item)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  async getPublished(id: string) {
    const item = await this.prisma.companionProfile.findFirst({
      where: {
        id,
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: { status: "verified" }
      },
      include: this.includeTags()
    });

    if (!item) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    return this.toDto(item as CompanionRecord);
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
    const where: any = {
      isPublished: true,
      isVerified: true,
      ownerUserId: { not: null },
      owner: { accountStatus: "active", profile: { isVerified: true } },
      commercialProfile: { status: "verified" }
    };
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
    return where;
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
      "rating",
      "reviewCount",
      "pricePerHalfHour",
      "isOnline",
      "isVerified",
      "bio",
      "availableTimes",
      "languages",
      "specialties",
      "topicIds",
      "completedOrders",
      "responseTime",
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
      "COMPANION_PROFILE_CONTENT_REQUIRES_REVISION",
      "Public companion profile content cannot be published; revise it and try again",
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

  private toDto(item: CompanionRecord) {
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
      isPublished: item.isPublished,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }
}
