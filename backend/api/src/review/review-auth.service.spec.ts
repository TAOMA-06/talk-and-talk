import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { PrismaService } from "../database/prisma.service";
import { ReviewAuthService } from "./review-auth.service";
import { REVIEW_TOKEN_KIND } from "./review-auth.types";

describe("ReviewAuthService", () => {
  const prisma = {
    reviewSession: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn()
    },
    reviewStaff: {
      findUnique: jest.fn()
    }
  };
  const jwt = {
    verify: jest.fn(),
    sign: jest.fn()
  };
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        REVIEW_JWT_ACCESS_TTL: "15m",
        REVIEW_JWT_REFRESH_TTL: "8h"
      };
      return values[key] ?? fallback;
    }),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        REVIEW_JWT_ACCESS_SECRET: "review-access-secret",
        REVIEW_JWT_REFRESH_SECRET: "review-refresh-secret",
        REDIS_URL: "redis://localhost:6379",
        REVIEW_TOTP_ENCRYPTION_KEY: "review-totp-key"
      };
      return values[key];
    })
  };
  let service: ReviewAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReviewAuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService, config as unknown as ConfigService);
  });

  it("refreshes only an independent review session, never a User refresh token", async () => {
    const future = new Date(Date.now() + 60_000);
    jwt.verify.mockReturnValue({ sub: "reviewer-1", kind: REVIEW_TOKEN_KIND });
    jwt.sign.mockReturnValueOnce("review-access").mockReturnValueOnce("review-refresh");
    prisma.reviewSession.findUnique.mockResolvedValue({
      id: "session-1",
      reviewerId: "reviewer-1",
      tokenHash: "hash",
      revokedAt: null,
      expiresAt: future
    });
    prisma.reviewSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.reviewStaff.findUnique.mockResolvedValue({
      id: "reviewer-1",
      username: "reviewer.liu",
      displayName: "刘审核",
      role: "reviewer",
      status: "active"
    });
    prisma.reviewSession.create.mockResolvedValue({ id: "session-2" });

    const result = await service.refresh("review-refresh-token");

    expect(result.reviewer).toEqual({
      id: "reviewer-1",
      username: "reviewer.liu",
      displayName: "刘审核",
      role: "reviewer"
    });
    expect(prisma.reviewSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "session-1", revokedAt: null })
    }));
    expect(prisma.reviewSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewerId: "reviewer-1" })
    }));
    expect(jwt.verify).toHaveBeenCalledWith("review-refresh-token", expect.objectContaining({
      secret: "review-refresh-secret"
    }));
  });

  it("rejects a consumer token even if it has a subject", async () => {
    jwt.verify.mockReturnValue({ sub: "consumer-1", kind: "user" });

    await expect(service.refresh("consumer-token")).rejects.toMatchObject({
      code: "REVIEW_UNAUTHORIZED"
    });
    expect(prisma.reviewSession.findUnique).not.toHaveBeenCalled();
  });
});
