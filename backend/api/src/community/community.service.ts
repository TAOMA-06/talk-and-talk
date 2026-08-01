import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateCommunityPostDto, CreateCommunityPostReportDto, ListCommunityItemsDto } from "./dto/community.dto";

const REPORT_REASON_SENSITIVE_VALUE = /(?:1[3-9]\d{9}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\d{17}[\dX])/i;
const OPEN_COMMUNITY_REPORT_CASE_STATUSES = ["pending", "autoReviewing", "humanReview"] as const;
const COMMUNITY_WRITE_WINDOW_MS = 10 * 60 * 1_000;
const COMMUNITY_POST_LIMIT_PER_WINDOW = 3;
const COMMUNITY_REPORT_LIMIT_PER_WINDOW = 8;

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(userId: string | undefined, query: ListCommunityItemsDto = new ListCommunityItemsDto()) {
    const where = this.publicPostWhere();
    const [items, total] = await Promise.all([
      this.prisma.communityPost.findMany({
        where,
        include: {
          author: { include: { profile: true, companionProfile: true } },
          likes: userId
            ? { where: { userId }, select: { userId: true }, take: 1 }
            : false,
          _count: { select: { likes: true } }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.communityPost.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.toDto(item, userId)),
      pagination: this.pagination(query, total)
    };
  }

  async listMyReportReceipts(userId: string, query: ListCommunityItemsDto = new ListCommunityItemsDto()) {
    // This is deliberately not a case-status endpoint. Selecting only the
    // reporter-owned receipt and its time prevents this view from becoming a
    // side channel for post, author, staff, decision, or SLA information.
    const where = { reporterUserId: userId };
    const [items, total] = await Promise.all([
      this.prisma.communityPostReport.findMany({
        where,
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.communityPostReport.count({ where } as any)
    ]);
    return {
      items: items.map((item: { id: string; createdAt: Date }) => ({
        id: item.id,
        submittedAt: item.createdAt.toISOString(),
        status: "received" as const
      })),
      pagination: this.pagination(query, total)
    };
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
      await this.lockCommunityWriter(db, userId);
      await this.assertCommunityWriteAllowed(db, userId, "post");
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
      where: { id: postId },
      include: {
        author: { include: { profile: true, companionProfile: true } },
        likes: { where: { userId }, select: { userId: true }, take: 1 },
        _count: { select: { likes: true } }
      }
    } as any);
    return this.toDto(item, userId);
  }

  async reportPost(userId: string, postId: string, dto: CreateCommunityPostReportDto) {
    const reason = this.normalizeReportReason(dto.reason);
    const post = await this.findVisiblePostForReport(postId);
    this.assertNotOwnPost(post, userId);

    const existing = await this.prisma.communityPostReport.findUnique({
      where: { postId_reporterUserId: { postId, reporterUserId: userId } }
    } as any);
    if (existing) return this.toReportReceipt(existing, true);

    // Only a short reporter explanation plus the post that was already public
    // to that reporter becomes staff evidence. No chat, order, profile, or
    // client-supplied context is accepted here.
    const content = this.communityReportContent(post, reason);
    const result = await this.moderation.moderateAsync(content, "report");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        // Recheck publication inside the write transaction. A post that has
        // disappeared from the reporter's current view cannot be probed or
        // reported through a stale card.
        await this.lockCommunityWriter(db, userId);
        await this.lockCommunityPostReportBoundary(db, postId);
        const currentPost = await this.findVisiblePostForReport(postId, db);
        this.assertNotOwnPost(currentPost, userId);

        const alreadyReported = await db.communityPostReport.findUnique({
          where: { postId_reporterUserId: { postId, reporterUserId: userId } }
        });
        if (alreadyReported) return this.toReportReceipt(alreadyReported, true);

        // Count only a new reporter/post pair. A repeat remains an idempotent
        // private receipt even while the caller has otherwise hit the window.
        await this.assertCommunityWriteAllowed(db, userId, "report");
        const receipt = await db.communityPostReport.create({
          data: { postId: currentPost.id, reporterUserId: userId }
        });
        let openCase = await this.findOpenCommunityReportCase(db, currentPost.id);
        if (openCase) {
          // Admin decisions use the same case-row lock. Re-read after it so a
          // report never attaches to a case that was resolved while waiting.
          await this.lockModerationCase(db, openCase.id);
          const lockedCase = await db.moderationCase.findUnique({
            where: { id: openCase.id },
            select: { id: true, status: true }
          });
          openCase = lockedCase && this.isOpenCommunityReportCaseStatus(lockedCase.status)
            ? lockedCase
            : null;
        }

        if (openCase) {
          const saved = await db.communityPostReport.update({
            where: { id: receipt.id },
            data: { moderationCaseId: openCase.id }
          });
          await this.moderationCases.appendCommunityReportToCase({
            caseId: openCase.id,
            reportId: receipt.id,
            postId: currentPost.id,
            reporterUserId: userId,
            subjectUserId: currentPost.authorId,
            reason,
            result,
            db
          });
          return this.toReportReceipt(saved, false);
        }

        const moderationCase = await this.moderationCases.createReportCase({
          result,
          reason,
          content: this.communityReportContent(currentPost, reason),
          targetId: currentPost.id,
          subjectUserId: currentPost.authorId,
          actorId: userId,
          // A report is an intake signal, not a verdict. It intentionally
          // suppresses automatic subject notices and keeps the reporter's text
          // out of broadly searchable audit metadata.
          auditMetadata: {
            source: "community_post_report",
            targetType: "community_post",
            postId: currentPost.id,
            reportId: receipt.id
          },
          db
        });
        const saved = await db.communityPostReport.update({
          where: { id: receipt.id },
          data: { moderationCaseId: moderationCase.id }
        });
        return this.toReportReceipt(saved, false);
      });
    } catch (error: any) {
      // The unique key is the race-safe deduplication boundary. A concurrent
      // duplicate rolls its whole transaction back, including any case draft.
      if (error?.code === "P2002") {
        const duplicate = await this.prisma.communityPostReport.findUnique({
          where: { postId_reporterUserId: { postId, reporterUserId: userId } }
        } as any);
        if (duplicate) return this.toReportReceipt(duplicate, true);
      }
      throw error;
    }
  }

  private toDto(item: any, userId?: string) {
    const name = item.author.profile?.displayName ?? "用户";
    return {
      id: item.id, authorId: item.authorId, authorName: name, authorInitials: name.slice(0, 2),
      companionId: item.kind === "malePromotion" ? item.author.companionProfile?.id ?? null : null,
      kind: item.kind, topic: item.topic, content: item.content, coverImageUrl: item.coverImageUrl,
      likeCount: item._count?.likes ?? item.likes?.length ?? 0,
      isLiked: userId ? (item.likes ?? []).some((like: any) => like.userId === userId) : false,
      moderationStatus: item.status, createdAt: item.createdAt.toISOString()
    };
  }

  private async findVisiblePostForReport(postId: string, database: any = this.prisma) {
    const post = await database.communityPost.findFirst({
      where: this.publicPostWhere(postId),
      select: { id: true, authorId: true, topic: true, content: true }
    });
    if (!post) throw new AppException("POST_NOT_FOUND", "Post not found", HttpStatus.NOT_FOUND);
    return post;
  }

  private async findOpenCommunityReportCase(database: any, postId: string) {
    return database.moderationCase.findFirst({
      where: {
        source: "report",
        status: { in: [...OPEN_COMMUNITY_REPORT_CASE_STATUSES] },
        communityPostReports: { some: { postId } }
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true }
    });
  }

  private async lockCommunityPostReportBoundary(database: any, postId: string) {
    if (typeof database.$queryRaw === "function") {
      await database.$queryRaw`SELECT "id" FROM "CommunityPost" WHERE "id" = ${postId} FOR UPDATE`;
    }
  }

  private async lockCommunityWriter(database: any, userId: string) {
    if (typeof database.$queryRaw === "function") {
      await database.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    }
  }

  private async assertCommunityWriteAllowed(database: any, userId: string, type: "post" | "report") {
    const since = new Date(Date.now() - COMMUNITY_WRITE_WINDOW_MS);
    const count = type === "post"
      ? await database.communityPost.count({ where: { authorId: userId, createdAt: { gte: since } } })
      : await database.communityPostReport.count({ where: { reporterUserId: userId, createdAt: { gte: since } } });
    const limit = type === "post" ? COMMUNITY_POST_LIMIT_PER_WINDOW : COMMUNITY_REPORT_LIMIT_PER_WINDOW;
    if (count >= limit) {
      // No remaining count, reset time, target state, or other-user activity is
      // revealed. This is a temporary write throttle, not an account action.
      throw new AppException(
        "COMMUNITY_WRITE_RATE_LIMITED",
        "Community writing is temporarily unavailable; please try again later",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  private async lockModerationCase(database: any, caseId: string) {
    if (typeof database.$queryRaw === "function") {
      await database.$queryRaw`SELECT "id" FROM "ModerationCase" WHERE "id" = ${caseId} FOR UPDATE`;
    }
  }

  private isOpenCommunityReportCaseStatus(status: string) {
    return (OPEN_COMMUNITY_REPORT_CASE_STATUSES as readonly string[]).includes(status);
  }

  private assertNotOwnPost(post: { authorId: string }, userId: string) {
    if (post.authorId === userId) {
      throw new AppException(
        "CANNOT_REPORT_OWN_POST",
        "A post author cannot submit a report against their own post",
        HttpStatus.CONFLICT
      );
    }
  }

  private normalizeReportReason(value: string) {
    const reason = value.trim();
    if (reason.length < 2) {
      throw new AppException("REPORT_REASON_INVALID", "Report reason must contain at least two characters", HttpStatus.BAD_REQUEST);
    }
    if (REPORT_REASON_SENSITIVE_VALUE.test(reason)) {
      throw new AppException(
        "REPORT_REASON_SENSITIVE_DATA",
        "Do not include phone, email, or identity-document values in a report reason",
        HttpStatus.BAD_REQUEST
      );
    }
    return reason;
  }

  private communityReportContent(post: { topic: string; content: string }, reason: string) {
    return [
      `举报说明：${reason}`,
      `公开话题：${post.topic}`,
      `公开内容：${post.content}`
    ].join("\n").slice(0, 2_600);
  }

  private toReportReceipt(report: { id: string; createdAt: Date }, duplicate: boolean) {
    return {
      report: {
        id: report.id,
        submittedAt: report.createdAt.toISOString(),
        duplicate
      }
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

  private pagination(query: ListCommunityItemsDto, total: number) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    };
  }
}
