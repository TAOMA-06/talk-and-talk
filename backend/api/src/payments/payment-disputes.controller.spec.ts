import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { PaymentDisputesController } from "./payment-disputes.controller";

describe("PaymentDisputesController customer role boundary", () => {
  it("allows both customer-only and companion accounts to read their own linked status", () => {
    expect(Reflect.getMetadata(
      ROLES_KEY,
      PaymentDisputesController.prototype.listMine
    )).toEqual(["user", "companion"]);
  });

  it("always scopes the query to the authenticated account id", async () => {
    const disputes = {
      listMine: jest.fn().mockResolvedValue({ items: [] })
    };
    const controller = new PaymentDisputesController(disputes as any);
    const companionCustomer = { id: "companion-customer-1", role: "companion" } as any;

    await expect(controller.listMine(companionCustomer)).resolves.toEqual({ items: [] });
    expect(disputes.listMine).toHaveBeenCalledWith(
      "companion-customer-1",
      expect.any(Object)
    );
  });
});
