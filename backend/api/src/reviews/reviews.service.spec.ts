import { ReviewsService } from "./reviews.service";

describe("ReviewsService", () => {
  const prisma = {
    order: { findUnique: jest.fn() },
    $transaction: jest.fn()
  } as any;
  const service = new ReviewsService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it("creates a review only for the user's completed order and refreshes the companion aggregate", async () => {
    prisma.order.findUnique.mockResolvedValue({ id: "order-1", userId: "user-1", companionId: "companion-1", status: "completed" });
    const db = {
      review: {
        create: jest.fn().mockResolvedValue({
          id: "review-1", orderId: "order-1", companionId: "companion-1", rating: 5, content: "很耐心", createdAt: new Date(),
          user: { profile: { displayName: "小安" } }
        }),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 5 }, _count: 1 })
      },
      companionProfile: { update: jest.fn().mockResolvedValue({}) }
    };
    prisma.$transaction.mockImplementation((work: any) => work(db));

    const result = await service.create("user-1", { orderId: "order-1", rating: 5, content: "很耐心" });

    expect(result).toEqual(expect.objectContaining({ id: "review-1", userName: "小安", rating: 5 }));
    expect(db.companionProfile.update).toHaveBeenCalledWith({
      where: { id: "companion-1" }, data: { rating: 5, reviewCount: 1 }
    });
  });

  it("rejects reviews for incomplete orders", async () => {
    prisma.order.findUnique.mockResolvedValue({ id: "order-1", userId: "user-1", companionId: "companion-1", status: "paid" });

    await expect(service.create("user-1", { orderId: "order-1", rating: 5, content: "很耐心" }))
      .rejects.toMatchObject({ code: "ORDER_INVALID_STATE" });
  });
});
