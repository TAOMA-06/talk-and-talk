import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateReviewDto } from "./dto/review.dto";
import { ListReviewsDto } from "./dto/list-reviews.dto";

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(companionId: string, query: ListReviewsDto = new ListReviewsDto()) {
    const companion = await this.prisma.companionProfile.findFirst({
      where: {
        id: companionId,
        isPublished: true,
        isVerified: true,
        ownerUserId: { not: null },
        owner: { accountStatus: "active", profile: { isVerified: true } },
        commercialProfile: { status: "verified" }
      },
      select: { id: true }
    } as any);
    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion not found", HttpStatus.NOT_FOUND);
    }
    const where = { companionId };
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        include: { user: { include: { profile: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.review.count({ where } as any)
    ]);
    return {
      items: items.map((item: any) => this.toDto(item)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  async findOwnForOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true }
    } as any);
    if (!order || order.userId !== userId) {
      // Keep missing and non-owned orders indistinguishable so this endpoint
      // cannot be used to discover another customer's order or review.
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }

    const review = await this.prisma.review.findFirst({
      where: { orderId, userId },
      select: {
        id: true,
        orderId: true,
        companionId: true,
        rating: true,
        content: true,
        createdAt: true,
        user: { select: { profile: { select: { displayName: true } } } }
      }
    } as any);
    return { review: review ? this.toDto(review) : null };
  }

  async create(userId: string, dto: CreateReviewDto) {
    const content = dto.content.trim();
    if (!content) {
      throw new AppException("REVIEW_CONTENT_REQUIRED", "Review content is required", HttpStatus.BAD_REQUEST);
    }
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      select: { id: true, userId: true, companionId: true, status: true }
    } as any);
    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    if (order.status !== "completed") {
      throw new AppException("ORDER_INVALID_STATE", "Only completed orders can be reviewed", HttpStatus.CONFLICT);
    }
    const moderation = await this.moderation.moderateAsync(content, "profile");
    if (moderation.decision !== "allow") {
      const moderationCase = await this.moderationCases.createFromResult({
        result: moderation,
        source: "profile",
        content,
        targetId: order.id,
        subjectUserId: userId,
        actorId: userId,
        title: "评价内容待处理",
        forceCreate: true
      });
      throw new AppException(
        "REVIEW_CONTENT_REQUIRES_REVISION",
        "Review content cannot be published; revise it and try again",
        HttpStatus.UNPROCESSABLE_ENTITY,
        { moderationCaseId: moderationCase?.id ?? null, decision: moderation.decision }
      );
    }
    const review = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Lock and re-read the eligibility source before inserting. The
      // statement-level Review trigger is the only rating projection writer
      // and acquires affected CompanionProfile rows in global id order. Taking
      // a profile lock here would invert the common Order -> CompanionProfile
      // order/refund lock path and reintroduce a deadlock cycle.
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      const currentOrder = await db.order.findUnique({ where: { id: order.id } });
      if (!currentOrder || currentOrder.userId !== userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (currentOrder.status !== "completed") {
        throw new AppException("ORDER_INVALID_STATE", "Only completed orders can be reviewed", HttpStatus.CONFLICT);
      }
      const created = await db.review.create({
        data: {
          orderId: currentOrder.id,
          userId,
          companionId: currentOrder.companionId,
          rating: dto.rating,
          content
        },
        include: { user: { include: { profile: true } } }
      });
      // The statement-level Review trigger advances ratingSum/reviewCount/rating
      // in this same transaction for INSERT, DELETE and UPDATE. Application
      // code must not scan Review or write the projection a second time.
      return created;
    });
    return this.toDto(review);
  }

  private toDto(item: any) {
    return {
      id: item.id, orderId: item.orderId, companionId: item.companionId,
      userName: item.user.profile?.displayName ?? "用户", rating: item.rating,
      content: item.content, createdAt: item.createdAt.toISOString()
    };
  }
}
