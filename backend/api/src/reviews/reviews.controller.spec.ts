import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ReviewsController } from "./reviews.controller";

describe("ReviewsController", () => {
  const reviews = {
    list: jest.fn(),
    findOwnForOrder: jest.fn(),
    create: jest.fn()
  } as any;
  const controller = new ReviewsController(reviews);
  const customer = { id: "customer-1", role: "user" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("guards the order-scoped review lookup with consumer JWT authentication", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.findOwnForOrder)).toContain(JwtAuthGuard);
  });

  it("forwards only the authenticated caller and requested order id", async () => {
    reviews.findOwnForOrder.mockResolvedValue({ review: null });

    await expect(controller.findOwnForOrder(customer, "order-1")).resolves.toEqual({ review: null });
    expect(reviews.findOwnForOrder).toHaveBeenCalledWith("customer-1", "order-1");
  });
});
