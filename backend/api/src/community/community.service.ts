import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateCommunityPostDto } from "./dto/community.dto";

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(userId?: string) {
    const items = await this.prisma.communityPost.findMany({
      where: this.publicPostWhere(),
      include: { author: { include: { profile: true, companionProfile: true } }, likes: true },
      orderBy: { createdAt: "desc" },
      take: 100
    } as any);
    return { items: items.map((item: any) => this.toDto(item, userId)) };
  }

  async create(userId: string, dto: CreateCommunityPostDto) {
    if (dto.coverImageUrl?.trim()) {
      throw new AppException(
        "COMMUNITY_MEDIA_UNAVAILABLE",
        "Community cover images are unavailable until the approved media review pipeline is enabled",
        HttpStatus.CONFLICT
      );
    }
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, companionProfile: { include: { commercialProfile: true } } }
    } as any);
    if (!user) throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    if (
      dto.kind === "malePromotion" &&
      (user.accountStatus !== "active" ||
        !user.profile?.isVerified ||
        !user.companionProfile?.isVerified ||
        !user.companionProfile?.isPublished ||
        user.companionProfile?.commercialProfile?.status !== "verified")
    ) {
      throw new AppException("COMPANION_PROFILE_REQUIRED", "Approved companion profile is required", HttpStatus.FORBIDDEN);
    }
    const result = await this.moderation.moderateAsync(`${dto.topic} ${dto.content}`, "community");
    // Public posts follow the same safe delivery principle as chat: only an
    // allow decision is published. Warn/review awaits a staff decision; block
    // remains private and is never inserted into the public feed.
    const status = result.decision === "allow"
      ? "approved"
      : result.decision === "block"
        ? "rejected"
        : "pending";
    const item = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const created = await db.communityPost.create({
        data: {
          authorId: userId, kind: dto.kind, topic: dto.topic.trim(), content: dto.content.trim(),
          // Never persist a client-supplied external URL. The production media
          // feature is fail-closed until an approved storage + moderation adapter
          // can bind a reviewed asset rather than a mutable third-party resource.
          coverImageUrl: null,
          status
        },
        include: { author: { include: { profile: true, companionProfile: true } }, likes: true }
      } as any);
      if (status !== "approved") {
        await this.moderationCases.createFromResult({
          result,
          source: "community",
          content: `${created.topic}\n${created.content}`,
          targetId: created.id,
          subjectUserId: userId,
          actorId: userId,
          forceCreate: true,
          db
        });
      }
      return created;
    });
    return this.toDto(item, userId);
  }

  async setLike(userId: string, postId: string, liked: boolean) {
    const post = await this.prisma.communityPost.findFirst({ where: this.publicPostWhere(postId) } as any);
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

  private publicPostWhere(id?: string) {
    return {
      ...(id ? { id } : {}),
      status: "approved",
      OR: [
        { kind: "femaleRequest" },
        {
          kind: "malePromotion",
          author: {
            accountStatus: "active",
            profile: { isVerified: true },
            companionProfile: {
              isPublished: true,
              isVerified: true,
              commercialProfile: { status: "verified" }
            }
          }
        }
      ]
    };
  }
}
