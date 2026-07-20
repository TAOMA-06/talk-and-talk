import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue("access-secret")
  } as unknown as ConfigService;
  const prisma = {
    user: { findUnique: jest.fn() }
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it("uses current database status and role instead of stale token claims", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "active" });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate({ sub: "user-1", role: "admin" })).resolves.toEqual({
      id: "user-1",
      role: "user"
    });
  });

  it("passes current account status to the application guard but rejects a removed account", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "restricted" });
    await expect(strategy.validate({ sub: "user-1", role: "user" })).resolves.toEqual({
      id: "user-1",
      role: "user"
    });

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate({ sub: "user-1", role: "user" })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
