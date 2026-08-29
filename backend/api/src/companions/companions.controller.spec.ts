import { CompanionsController } from "./companions.controller";

describe("CompanionsController owner schedule routes", () => {
  const companionsService = {
    listOwnRecurringAvailabilityRules: jest.fn(),
    createOwnRecurringAvailabilityRule: jest.fn(),
    deactivateOwnRecurringAvailabilityRule: jest.fn(),
    listOwnAvailabilityBlackouts: jest.fn(),
    createOwnAvailabilityBlackout: jest.fn(),
    deactivateOwnAvailabilityBlackout: jest.fn(),
    listOwnRecurringAvailabilityDrafts: jest.fn(),
    materializeOwnRecurringAvailabilityDrafts: jest.fn(),
    activateOwnRecurringAvailabilityDraft: jest.fn(),
    reserveOwnProfileMedia: jest.fn(),
    completeOwnProfileMedia: jest.fn(),
    ownProfileMediaStatus: jest.fn(),
    removeOwnProfileMedia: jest.fn(),
    publicProfileMediaReadUrl: jest.fn()
  } as any;
  const controller = new CompanionsController(companionsService, { getOrThrow: () => "development" } as any);
  const user = { id: "owner-1" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("forwards each private schedule operation with only the authenticated owner's id", async () => {
    companionsService.listOwnRecurringAvailabilityRules.mockResolvedValue({ items: [] });
    companionsService.createOwnRecurringAvailabilityRule.mockResolvedValue({ id: "rule-1" });
    companionsService.deactivateOwnRecurringAvailabilityRule.mockResolvedValue({ id: "rule-1", isActive: false });
    companionsService.listOwnAvailabilityBlackouts.mockResolvedValue({ items: [] });
    companionsService.createOwnAvailabilityBlackout.mockResolvedValue({ id: "blackout-1" });
    companionsService.deactivateOwnAvailabilityBlackout.mockResolvedValue({ id: "blackout-1", isActive: false });
    companionsService.listOwnRecurringAvailabilityDrafts.mockResolvedValue({ items: [] });
    companionsService.materializeOwnRecurringAvailabilityDrafts.mockResolvedValue({ created: 1 });
    companionsService.activateOwnRecurringAvailabilityDraft.mockResolvedValue({ id: "draft-1", isActive: true });
    const rule = { weekday: 1, startsAtMinute: 540, endsAtMinute: 720, capacity: 2 };
    const blackout = {
      startsAt: "2026-07-23T09:00:00+08:00",
      endsAt: "2026-07-23T12:00:00+08:00"
    };

    await controller.listOwnRecurringAvailabilityRules(user);
    await controller.createOwnRecurringAvailabilityRule(user, rule);
    await controller.deactivateOwnRecurringAvailabilityRule(user, "rule-1");
    await controller.listOwnAvailabilityBlackouts(user);
    await controller.createOwnAvailabilityBlackout(user, blackout);
    await controller.deactivateOwnAvailabilityBlackout(user, "blackout-1");
    await controller.listOwnRecurringAvailabilityDrafts(user);
    await controller.materializeOwnRecurringAvailabilityDrafts(user);
    await controller.activateOwnRecurringAvailabilityDraft(user, { id: "123e4567-e89b-42d3-a456-426614174000" });

    expect(companionsService.listOwnRecurringAvailabilityRules).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ page: 1, pageSize: 50 })
    );
    expect(companionsService.createOwnRecurringAvailabilityRule).toHaveBeenCalledWith("owner-1", rule);
    expect(companionsService.deactivateOwnRecurringAvailabilityRule).toHaveBeenCalledWith("owner-1", "rule-1");
    expect(companionsService.listOwnAvailabilityBlackouts).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ page: 1, pageSize: 50 })
    );
    expect(companionsService.createOwnAvailabilityBlackout).toHaveBeenCalledWith("owner-1", blackout);
    expect(companionsService.deactivateOwnAvailabilityBlackout).toHaveBeenCalledWith("owner-1", "blackout-1");
    expect(companionsService.listOwnRecurringAvailabilityDrafts).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ page: 1, pageSize: 50 })
    );
    expect(companionsService.materializeOwnRecurringAvailabilityDrafts).toHaveBeenCalledWith("owner-1");
    expect(companionsService.activateOwnRecurringAvailabilityDraft).toHaveBeenCalledWith("owner-1", {
      id: "123e4567-e89b-42d3-a456-426614174000"
    });
  });

  it("keeps profile media mutations owner-scoped and returns only the public redirect", async () => {
    companionsService.reserveOwnProfileMedia.mockResolvedValue({ asset: { id: "asset-1" } });
    companionsService.completeOwnProfileMedia.mockResolvedValue({ asset: { id: "asset-1", status: "approved" } });
    companionsService.ownProfileMediaStatus.mockResolvedValue({ asset: { id: "asset-1", status: "approved" } });
    companionsService.removeOwnProfileMedia.mockResolvedValue({ removed: true });
    companionsService.publicProfileMediaReadUrl.mockResolvedValue("https://media.example/avatar");
    const dto = { mimeType: "image/webp", sizeBytes: 120_000, sha256: "a".repeat(64) };

    await controller.reserveOwnProfileMedia(user, "avatar", dto);
    await controller.completeOwnProfileMedia(user, "avatar", "asset-1");
    await controller.ownProfileMediaStatus(user, "avatar", "asset-1");
    await controller.removeOwnProfileMedia(user, "avatar");
    await expect(controller.profileMedia("c1", "avatar")).resolves.toEqual({
      url: "https://media.example/avatar"
    });

    expect(companionsService.reserveOwnProfileMedia).toHaveBeenCalledWith("owner-1", "avatar", dto);
    expect(companionsService.completeOwnProfileMedia).toHaveBeenCalledWith("owner-1", "avatar", "asset-1");
    expect(companionsService.ownProfileMediaStatus).toHaveBeenCalledWith("owner-1", "avatar", "asset-1");
    expect(companionsService.removeOwnProfileMedia).toHaveBeenCalledWith("owner-1", "avatar");
    expect(companionsService.publicProfileMediaReadUrl).toHaveBeenCalledWith("c1", "avatar");
  });
});
