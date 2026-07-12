import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { CreateReviewDto } from "./dto/review.dto";

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companionId: string) {
    const items = await this.prisma.review.findMany({
      where: { companionId }, include: { user: { include: { profile: true } } },
      orderBy: { createdAt: "desc" }, take: 100
    } as any);
    return { items: items.map((item: any) => this.toDto(item)) };
  }

  async create(userId: string, dto: CreateReviewDto) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } } as any);
    if (!order || order.userId !== userId) {
      throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    }
    if (order.status !== "completed") {
      throw new AppException("ORDER_INVALID_STATE", "Only completed orders can be reviewed", HttpStatus.CONFLICT);
    }
    const review = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const created = await db.review.create({
        data: { orderId: order.id, userId, companionId: order.companionId, rating: dto.rating, content: dto.content.trim() },
        include: { user: { include: { profile: true } } }
      });
      const aggregate = await db.review.aggregate({ where: { companionId: order.companionId }, _avg: { rating: true }, _count: true });
      await db.companionProfile.update({
        where: { id: order.companionId }, data: { rating: aggregate._avg.rating ?? 0, reviewCount: aggregate._count }
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
