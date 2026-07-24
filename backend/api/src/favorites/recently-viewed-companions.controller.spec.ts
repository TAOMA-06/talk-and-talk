import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { RecentlyViewedCompanionsController } from "./recently-viewed-companions.controller";

describe("RecentlyViewedCompanionsController", () => {
  const favorites = {
    listRecentlyViewedCompanions: jest.fn(),
    recordRecentlyViewedCompanion: jest.fn(),
    clearRecentlyViewedCompanions: jest.fn()
  } as any;
  const controller = new RecentlyViewedCompanionsController(favorites);
  const customer = { id: "customer-1", role: "user" } as any;

  beforeEach(() => jest.clearAllMocks());

  it("declares the entire recent-view surface as customer-only", () => {
    expect(Reflect.getMetadata(ROLES_KEY, RecentlyViewedCompanionsController)).toEqual(["user"]);
  });

  it("forwards only the authenticated caller identity to the private recall list", async () => {
    favorites.listRecentlyViewedCompanions.mockResolvedValue({ items: [] });
    favorites.recordRecentlyViewedCompanion.mockResolvedValue({ recorded: true });
    favorites.clearRecentlyViewedCompanions.mockResolvedValue({ cleared: 2 });

    await expect(controller.list(customer)).resolves.toEqual({ items: [] });
    await expect(controller.record(customer, "companion-1")).resolves.toEqual({ recorded: true });
    await expect(controller.clear(customer)).resolves.toEqual({ cleared: 2 });

    expect(favorites.listRecentlyViewedCompanions).toHaveBeenCalledWith("customer-1");
    expect(favorites.recordRecentlyViewedCompanion).toHaveBeenCalledWith("customer-1", "companion-1");
    expect(favorites.clearRecentlyViewedCompanions).toHaveBeenCalledWith("customer-1");
  });
});
