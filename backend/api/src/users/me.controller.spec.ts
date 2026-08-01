import { SKIP_LEGAL_CONSENT_KEY } from "../auth/decorators/skip-legal-consent.decorator";
import { MeController } from "./me.controller";

describe("MeController account deletion status", () => {
  it("allows status lookup before current legal consent and scopes it to the caller", async () => {
    const usersService = {
      getMyDeletionRequest: jest.fn().mockResolvedValue({
        request: null,
        policy: { version: "2026.1", businessDays: 15 }
      }),
      cancelMyDeletionRequest: jest.fn().mockResolvedValue({
        id: "deletion-1",
        status: "cancelled"
      })
    };
    const controller = new MeController(usersService as any, {} as any);

    expect(Reflect.getMetadata(
      SKIP_LEGAL_CONSENT_KEY,
      MeController.prototype.getDeletionRequest
    )).toBe(true);
    await expect(controller.getDeletionRequest({ id: "user-1", role: "user" } as any))
      .resolves.toEqual(expect.objectContaining({ request: null }));
    expect(usersService.getMyDeletionRequest).toHaveBeenCalledWith("user-1");

    expect(Reflect.getMetadata(
      SKIP_LEGAL_CONSENT_KEY,
      MeController.prototype.cancelDeletionRequest
    )).toBe(true);
    await expect(controller.cancelDeletionRequest({ id: "user-1", role: "user" } as any))
      .resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
    expect(usersService.cancelMyDeletionRequest).toHaveBeenCalledWith("user-1");
  });

  it("keeps deletion submission available before current legal consent", () => {
    expect(Reflect.getMetadata(
      SKIP_LEGAL_CONSENT_KEY,
      MeController.prototype.requestDeletion
    )).toBe(true);
  });
});
