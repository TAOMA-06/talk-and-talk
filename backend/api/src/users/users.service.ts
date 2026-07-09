import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { maskPhone } from "../common/logging/redact";
import { PrismaService } from "../database/prisma.service";
import { UpdateMeDto } from "./dto/update-me.dto";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    return {
      id: user.id,
      role: user.role,
      profile: user.profile
        ? {
            displayName: user.profile.displayName,
            phone: user.profile.phone ? maskPhone(user.profile.phone) : null,
            age: user.profile.age,
            gender: user.profile.gender,
            isVerified: user.profile.isVerified,
            safetyScore: user.profile.safetyScore
          }
        : null
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    const profileData: {
      displayName?: string;
      gender?: string;
      age?: number;
    } = {};

    if (dto.displayName !== undefined) {
      profileData.displayName = dto.displayName;
    }
    if (dto.gender !== undefined) {
      profileData.gender = dto.gender;
    }
    if (dto.age !== undefined) {
      profileData.age = dto.age;
    }

    if (Object.keys(profileData).length > 0) {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...profileData
        },
        update: profileData
      });
    }

    return this.getMe(userId);
  }

  async requestDeletion(userId: string) {
    const existing = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: { in: ["pending", "processing"] } },
      orderBy: { createdAt: "desc" }
    } as any);

    if (existing) {
      return {
        id: existing.id,
        status: existing.status,
        message: "我们已收到你的注销申请，将在 15 个工作日内处理。"
      };
    }

    const created = await this.prisma.accountDeletionRequest.create({
      data: {
        userId,
        status: "pending"
      }
    } as any);

    await this.audit.record({
      actorId: userId,
      action: "account.deletion_requested",
      resourceType: "user",
      resourceId: userId,
      metadata: { requestId: created.id }
    });

    return {
      id: created.id,
      status: created.status,
      message: "我们已收到你的注销申请，将在 15 个工作日内处理。"
    };
  }
}
