import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { FavoritesController } from "./favorites.controller";

describe("FavoritesController", () => {
  const favorites = {
    listCompanions: jest.fn(),
    companionStatus: jest.fn(),
    saveCompanion: jest.fn(),
    removeCompanion: jest.fn(),
    setAvailabilityReminder: jest.fn()
  } as any;
  const controller = new FavoritesController(favorites);
  const customer = { id: "customer-1", role: "user" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("declares the entire bookmark surface as customer-only", () => {
    expect(Reflect.getMetadata(ROLES_KEY, FavoritesController)).toEqual(["user"]);
  });

  it("forwards only the authenticated caller identity to the private service", async () => {
    favorites.listCompanions.mockResolvedValue({ items: [] });
    favorites.companionStatus.mockResolvedValue({ companionId: "companion-1", favorited: true });
    favorites.saveCompanion.mockResolvedValue({ favorited: true, companion: { id: "companion-1" } });
    favorites.removeCompanion.mockResolvedValue({ favorited: false, removed: true });
    favorites.setAvailabilityReminder.mockResolvedValue({
      companionId: "companion-1", enabled: true, updatedAt: "2026-07-21T00:00:00.000Z", minimumIntervalHours: 24
    });

    await expect(controller.list(customer, { page: 2, pageSize: 10 })).resolves.toEqual({ items: [] });
    await expect(controller.status(customer, "companion-1")).resolves.toEqual({
      companionId: "companion-1",
      favorited: true
    });
    await expect(controller.save(customer, "companion-1")).resolves.toEqual({
      favorited: true,
      companion: { id: "companion-1" }
    });
    await expect(controller.remove(customer, "companion-1")).resolves.toEqual({ favorited: false, removed: true });
    await expect(controller.setAvailabilityReminder(customer, "companion-1", {
      enabled: true,
      subscriptionGrantId: "00000000-0000-4000-8000-000000000010"
    })).resolves.toEqual(expect.objectContaining({ enabled: true, minimumIntervalHours: 24 }));

    expect(favorites.listCompanions).toHaveBeenCalledWith("customer-1", { page: 2, pageSize: 10 });
    expect(favorites.companionStatus).toHaveBeenCalledWith("customer-1", "companion-1");
    expect(favorites.saveCompanion).toHaveBeenCalledWith("customer-1", "companion-1");
    expect(favorites.removeCompanion).toHaveBeenCalledWith("customer-1", "companion-1");
    expect(favorites.setAvailabilityReminder).toHaveBeenCalledWith("customer-1", "companion-1", {
      enabled: true,
      subscriptionGrantId: "00000000-0000-4000-8000-000000000010"
    });
  });
});
