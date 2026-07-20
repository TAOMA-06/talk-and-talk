import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateReviewDto } from "./dto/review.dto";

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async list(companionId: string) {
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
    const items = await this.prisma.review.findMany({
      where: { companionId }, include: { user: { include: { profile: true } } },
      orderBy: { createdAt: "desc" }, take: 100
    } as any);
    return { items: items.map((item: any) => this.toDto(item)) };
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
      // Serialize the aggregate by companion and re-check the order under lock.
      // This prevents two simultaneous reviews from overwriting rating/count,
      // and prevents a refund transition between eligibility check and insert.
      await db.$queryRaw`SELECT "id" FROM "CompanionProfile" WHERE "id" = ${order.companionId} FOR UPDATE`;
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
      const aggregate = await db.review.aggregate({
        where: { companionId: currentOrder.companionId },
        _avg: { rating: true },
        _count: true
      });
      await db.companionProfile.update({
        where: { id: currentOrder.companionId },
        data: { rating: aggregate._avg.rating ?? 0, reviewCount: aggregate._count }
      });
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
