import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateCommunityPostDto } from "./dto/community.dto";

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService, private readonly moderation: ModerationService) {}

  async list(userId?: string) {
    const items = await this.prisma.communityPost.findMany({
      where: { status: "approved" },
      include: { author: { include: { profile: true, companionProfile: true } }, likes: true },
      orderBy: { createdAt: "desc" },
      take: 100
    } as any);
    return { items: items.map((item: any) => this.toDto(item, userId)) };
  }

  async create(userId: string, dto: CreateCommunityPostDto) {
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId }, include: { profile: true, companionProfile: true }
    } as any);
    if (!user) throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    if (dto.kind === "malePromotion" && (!user.profile?.isVerified || !user.companionProfile)) {
      throw new AppException("COMPANION_PROFILE_REQUIRED", "Approved companion profile is required", HttpStatus.FORBIDDEN);
    }
    const result = await this.moderation.moderateAsync(`${dto.topic} ${dto.content}`, "community");
    const status = result.decision === "allow" || result.decision === "warn" ? "approved" : "rejected";
    const item = await this.prisma.communityPost.create({
      data: {
        authorId: userId, kind: dto.kind, topic: dto.topic.trim(), content: dto.content.trim(),
        coverImageUrl: dto.kind === "malePromotion" ? dto.coverImageUrl?.trim() || null : null,
        status
      },
      include: { author: { include: { profile: true, companionProfile: true } }, likes: true }
    } as any);
    return this.toDto(item, userId);
  }

  async setLike(userId: string, postId: string, liked: boolean) {
    const post = await this.prisma.communityPost.findFirst({ where: { id: postId, status: "approved" } } as any);
    if (!post) throw new AppException("POST_NOT_FOUND", "Post not found", HttpStatus.NOT_FOUND);
    if (liked) {
      await this.prisma.communityLike.upsert({
        where: { postId_userId: { postId, userId } }, create: { postId, userId }, update: {}
      } as any);
    } else {
      await this.prisma.communityLike.deleteMany({ where: { postId, userId } } as any);
    }
    const item = await this.prisma.communityPost.findUnique({
      where: { id: postId }, include: { author: { include: { profile: true, companionProfile: true } }, likes: true }
    } as any);
    return this.toDto(item, userId);
  }

  private toDto(item: any, userId?: string) {
    const name = item.author.profile?.displayName ?? "用户";
    return {
      id: item.id, authorId: item.authorId, authorName: name, authorInitials: name.slice(0, 2),
      companionId: item.kind === "malePromotion" ? item.author.companionProfile?.id ?? null : null,
      kind: item.kind, topic: item.topic, content: item.content, coverImageUrl: item.coverImageUrl,
      likeCount: item.likes.length, isLiked: userId ? item.likes.some((like: any) => like.userId === userId) : false,
      moderationStatus: item.status, createdAt: item.createdAt.toISOString()
    };
  }
}
