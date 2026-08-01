import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AdminController } from "./admin.controller";

describe("AdminController account-deletion role boundaries", () => {
  it("keeps deletion enumeration and the state-changing start action admin-only", () => {
    expect(Reflect.getMetadata(
      ROLES_KEY,
      AdminController.prototype.listAccountDeletions
    )).toEqual(["admin"]);
    expect(Reflect.getMetadata(
      ROLES_KEY,
      AdminController.prototype.startAccountDeletion
    )).toEqual(["admin"]);
  });

  it("passes the validated deletion page and filter to the service", async () => {
    const usersService = {
      listDeletionRequests: jest.fn().mockResolvedValue({
        items: [],
        pagination: { page: 2, pageSize: 25, total: 0, totalPages: 0 }
      })
    };
    const controller = new AdminController(
      {} as any,
      {} as any,
      {} as any,
      usersService as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(controller.listAccountDeletions({
      status: "processing",
      page: 2,
      pageSize: 25
    })).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(usersService.listDeletionRequests).toHaveBeenCalledWith("processing", 2, 25);
  });

  it("allows finance to inspect settlement facts without granting queue enumeration", () => {
    expect(Reflect.getMetadata(
      ROLES_KEY,
      AdminController.prototype.deletionSettlement
    )).toEqual(["finance", "admin"]);
    expect(Reflect.getMetadata(
      ROLES_KEY,
      AdminController.prototype.initiateDeletionRefund
    )).toEqual(["finance", "admin"]);
  });

  it("delegates consumer account-status changes to the formal action workflow", async () => {
    const accountActions = {
      setAccountStatus: jest.fn().mockResolvedValue({
        userId: "user-1",
        accountStatus: "restricted",
        action: { id: "action-1" }
      })
    };
    const controller = new AdminController(
      {} as any,
      {} as any,
      accountActions as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const actor = { id: "admin-1", role: "admin" };
    const dto = {
      status: "restricted" as const,
      reasonCode: "POLICY_BOUNDARY",
      reason: "多次违反平台安全边界，账号暂时受限。",
      sourceType: "moderationCase" as const,
      sourceReference: "case/moderation-100",
      evidenceReference: "evidence-vault/item-100"
    };

    await expect(controller.updateAccountStatus(actor, "user-1", dto))
      .resolves.toEqual(expect.objectContaining({ accountStatus: "restricted" }));
    expect(accountActions.setAccountStatus).toHaveBeenCalledWith("admin-1", "user-1", dto);
  });

  it("keeps KYC submission and second-person decisions inside supply/admin", () => {
    for (const method of [
      AdminController.prototype.updateUserVerification,
      AdminController.prototype.listIdentityVerificationRequests,
      AdminController.prototype.approveIdentityVerificationRequest,
      AdminController.prototype.rejectIdentityVerificationRequest
    ]) {
      expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual(["supply", "admin"]);
    }
  });

  it("keeps the compatibility KYC route as submission-only delegation", async () => {
    const identityVerification = { submitRequest: jest.fn().mockResolvedValue({ status: "pending" }) };
    const controller = new AdminController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      identityVerification as any,
      {} as any
    );
    const actor = { id: "supply-1", role: "supply" };
    const dto = {
      isVerified: true,
      reason: "外部实名核验已完成",
      evidenceReference: "kyc:case-001"
    };

    await expect(controller.updateUserVerification(actor, "user-1", dto))
      .resolves.toEqual({ status: "pending" });
    expect(identityVerification.submitRequest).toHaveBeenCalledWith(actor, "user-1", dto);
  });
});
