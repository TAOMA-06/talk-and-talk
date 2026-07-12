import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { CreateCompanionDto, UpdateCompanionDto } from "./dto/companion-profile.dto";
import { ListCompanionsQueryDto } from "./dto/list-companions.dto";

type CompanionRecord = Awaited<ReturnType<CompanionsService["findRecordOrThrow"]>>;

@Injectable()
export class CompanionsService {
  constructor(private readonly prisma: PrismaService) {}

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
      where: { id, isPublished: true },
      include: this.includeTags()
    });

    if (!item) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }

    return this.toDto(item);
  }

  async create(dto: CreateCompanionDto) {
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
    await this.findRecordOrThrow(id);
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
    await this.findRecordOrThrow(id);
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
    const where: any = { isPublished: true };
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

  private profileData(dto: CreateCompanionDto | UpdateCompanionDto) {
    const data: any = {};
    for (const key of [
      "name",
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
      "completedOrders",
      "responseTime",
      "distanceKm",
      "availability",
      "cityDistrict",
      "isPublished"
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    return data;
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
