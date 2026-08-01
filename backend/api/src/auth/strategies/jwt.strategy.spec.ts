import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue("access-secret")
  } as unknown as ConfigService;
  const prisma = {
    user: { findUnique: jest.fn() },
    refreshToken: { findUnique: jest.fn(), updateMany: jest.fn() }
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.refreshToken.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({
      id: where.id,
      userId: where.id.startsWith("support") ? "support-1" : "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date()
    }));
  });

  it("uses current database status and role instead of stale token claims", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "active" });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate({
      sub: "user-1",
      role: "admin",
      sid: "session-1",
      kind: "consumer"
    })).resolves.toEqual({
      id: "user-1",
      role: "user",
      sessionId: "session-1"
    });
  });

  it("passes current account status to the application guard but rejects a removed account", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "restricted" });
    await expect(strategy.validate({
      sub: "user-1",
      role: "user",
      sid: "session-1",
      kind: "consumer"
    })).resolves.toEqual({
      id: "user-1",
      role: "user",
      sessionId: "session-1"
    });

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate({
      sub: "user-1",
      role: "user",
      sid: "session-1",
      kind: "consumer"
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("binds new access tokens to an active, matching session", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "active" });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date()
    });

    await expect(strategy.validate({
      sub: "user-1",
      role: "user",
      sid: "session-1",
      kind: "consumer"
    })).resolves.toEqual({
      id: "user-1",
      role: "user",
      sessionId: "session-1"
    });
  });

  it("throttles persisted last-used updates for an active session", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "active" });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date(Date.now() - 10 * 60_000)
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await strategy.validate({
      sub: "user-1",
      role: "user",
      sid: "session-1",
      kind: "consumer"
    });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: "session-1", userId: "user-1", revokedAt: null },
      data: { lastUsedAt: expect.any(Date) }
    });
  });

  it("rejects revoked sessions and legacy access tokens without session assurance", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user", accountStatus: "active" });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date()
    });

    await expect(strategy.validate({
      sub: "user-1",
      role: "user",
      sid: "session-1",
      kind: "consumer"
    }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: "user-1", role: "user" }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("requires staff authentication assurance for every current staff role", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({
      id: "support-1",
      role: "support",
      accountStatus: "active",
      staffCredential: { status: "active" }
    });

    await expect(strategy.validate({
      sub: "support-1",
      role: "support",
      kind: "consumer",
      sid: "support-session-1"
    })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({
      sub: "support-1",
      role: "support",
      kind: "staff",
      sid: "support-session-1"
    })).resolves.toEqual({
      id: "support-1",
      role: "support",
      sessionId: "support-session-1"
    });
  });

  it("invalidates a staff-authenticated token after the account is no longer a staff role", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      role: "user",
      accountStatus: "active"
    });

    await expect(strategy.validate({
      sub: "user-1",
      role: "admin",
      kind: "staff",
      sid: "session-1"
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("invalidates an existing access token immediately after StaffCredential suspension", async () => {
    const strategy = new JwtStrategy(config, prisma);
    prisma.user.findUnique.mockResolvedValue({
      id: "support-1",
      role: "support",
      accountStatus: "active",
      staffCredential: { status: "suspended" }
    });

    await expect(strategy.validate({
      sub: "support-1",
      role: "support",
      kind: "staff",
      sid: "support-session-1"
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it("rejects access tokens without an explicit authentication kind", async () => {
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate({
      sub: "user-1",
      role: "user",
      sid: "session-1"
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
