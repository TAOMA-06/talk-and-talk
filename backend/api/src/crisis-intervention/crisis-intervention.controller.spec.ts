import { HttpStatus } from "@nestjs/common";

import { CrisisInterventionController } from "./crisis-intervention.controller";

describe("CrisisInterventionController", () => {
  it("keeps the public resource catalog reachable while readiness reports No-Go", () => {
    const service = {
      resources: jest.fn().mockReturnValue({ approved: false, resources: [{ code: "110" }, { code: "120" }] }),
      readiness: jest.fn().mockReturnValue({ ready: false, status: "noGo" })
    };
    const controller = new CrisisInterventionController(service as any);
    const response = { status: jest.fn() };

    expect(controller.resources({ region: "CN" })).toEqual(expect.objectContaining({ approved: false }));
    expect(controller.readiness(response as any)).toEqual({ ready: false, status: "noGo" });
    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it("always passes the authenticated owner to create/read/complete operations", async () => {
    const service = {
      create: jest.fn(),
      active: jest.fn(),
      getOwned: jest.fn(),
      completeResourceView: jest.fn()
    };
    const controller = new CrisisInterventionController(service as any);
    const user = { id: "user-1" } as any;
    const dto = { source: "discover", riskCode: "userRequested", region: "CN" } as any;

    await controller.create(user, dto);
    await controller.active(user);
    await controller.get(user, "crisis-1");
    await controller.completeResourceView(user, "crisis-1");
    expect(service.create).toHaveBeenCalledWith("user-1", dto);
    expect(service.active).toHaveBeenCalledWith("user-1");
    expect(service.getOwned).toHaveBeenCalledWith("user-1", "crisis-1");
    expect(service.completeResourceView).toHaveBeenCalledWith("user-1", "crisis-1");
  });
});
