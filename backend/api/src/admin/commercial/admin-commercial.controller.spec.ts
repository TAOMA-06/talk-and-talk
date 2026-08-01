import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { AdminCommercialController } from "./admin-commercial.controller";

describe("AdminCommercialController support boundaries", () => {
  const support = {
    listAdmin: jest.fn(),
    listClaimable: jest.fn(),
    claim: jest.fn(),
    assign: jest.fn(),
    resolve: jest.fn()
  };
  const payments = { requestSupportRefund: jest.fn() };
  const controller = new AdminCommercialController(
    {} as any,
    {} as any,
    support as any,
    payments as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes the authenticated operator into the scoped support queue", () => {
    const actor = { id: "support-1", role: "support" } as any;
    const query = { page: 1, pageSize: 50 } as any;

    controller.supportTickets(actor, query);

    expect(support.listAdmin).toHaveBeenCalledWith(actor, query);
    expect(Reflect.getMetadata(ROLES_KEY, controller.supportTickets)).toEqual([
      "support",
      "admin"
    ]);
  });

  it("routes anonymous self-claim separately from administrator assignment", () => {
    const supportActor = { id: "support-1", role: "support" } as any;
    const adminActor = { id: "admin-1", role: "admin" } as any;

    controller.claimableSupportTickets({ page: 1, pageSize: 50 });
    controller.claimSupportTicket(supportActor, "ticket-1");
    controller.assignSupportTicket(adminActor, "ticket-2", {
      assignedToUserId: "support-1"
    });

    expect(support.listClaimable).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    expect(support.claim).toHaveBeenCalledWith("support-1", "ticket-1");
    expect(support.assign).toHaveBeenCalledWith(adminActor, "ticket-2", "support-1");
    expect(Reflect.getMetadata(ROLES_KEY, controller.claimableSupportTickets)).toEqual(["support"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.claimSupportTicket)).toEqual(["support"]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.assignSupportTicket)).toEqual(["admin"]);
  });

  it("keeps resolve and refund assignee checks downstream", () => {
    const actor = { id: "support-1", role: "support" } as any;

    controller.resolveSupportTicket(actor, "ticket-1", {
      status: "resolved",
      resolution: "已处理",
      resolutionCode: "noRefund"
    });
    controller.initiateSupportRefund(actor, "ticket-1", { reason: "符合退款条件" });

    expect(support.resolve).toHaveBeenCalledWith(
      "support-1",
      "ticket-1",
      expect.objectContaining({ status: "resolved" })
    );
    expect(payments.requestSupportRefund).toHaveBeenCalledWith(
      "support-1",
      "ticket-1",
      "符合退款条件"
    );
  });

  it("returns the contract-declared 200 status for command-style POST routes", () => {
    const commandMethods = [
      controller.submitCommercialProfile,
      controller.verifyCommercialProfile,
      controller.suspendCommercialProfile,
      controller.claimPayout,
      controller.recordPayoutEvidence,
      controller.cancelPayoutClaim,
      controller.verifyPayout,
      controller.recordRecoveryEvidence,
      controller.verifyRecovery,
      controller.assignSupportTicket,
      controller.resolveSupportTicket,
      controller.initiateSupportRefund
    ];

    for (const method of commandMethods) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, method)).toBe(200);
    }
  });
});
