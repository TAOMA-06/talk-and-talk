import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AdminPaymentDisputesController } from "./admin-payment-disputes.controller";

describe("AdminPaymentDisputesController", () => {
  const disputes = {
    listAdmin: jest.fn(),
    getAdmin: jest.fn(),
    claim: jest.fn(),
    assign: jest.fn(),
    reply: jest.fn(),
    complete: jest.fn(),
    sync: jest.fn()
  };
  const controller = new AdminPaymentDisputesController(disputes as any);

  beforeEach(() => jest.clearAllMocks());

  it("publishes the intended role boundary for queue, assignment, reply, and completion", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminPaymentDisputesController)).toEqual([
      "support",
      "finance",
      "admin"
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.claim)).toEqual(["support"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.assign)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.reply)).toEqual(["support", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.complete)).toEqual(["support", "admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.sync)).toBeUndefined();
  });

  it("passes the authenticated actor into scoped reads", async () => {
    const actor = { id: "support-1", role: "support" };
    const query = { page: 1, pageSize: 30 };
    disputes.listAdmin.mockResolvedValue({ items: [] });
    disputes.getAdmin.mockResolvedValue({ id: "dispute-1" });

    await controller.list(actor, query);
    await controller.get(actor, "dispute-1");

    expect(disputes.listAdmin).toHaveBeenCalledWith(actor, query);
    expect(disputes.getAdmin).toHaveBeenCalledWith("dispute-1", actor);
  });
});
