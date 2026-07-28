import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { PrismaService } from "../../database/prisma.service";
import { REVIEW_TOKEN_KIND } from "../review-auth.types";
import { ReviewJwtAuthGuard } from "./review-jwt-auth.guard";

describe("ReviewJwtAuthGuard", () => {
  const jwt = { verify: jest.fn() };
  const config = { getOrThrow: jest.fn().mockReturnValue("review-access-secret") };
  const prisma = { reviewStaff: { findUnique: jest.fn() } };
  let guard: ReviewJwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ReviewJwtAuthGuard(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as unknown as PrismaService
    );
  });

  function contextFor(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request })
    } as unknown as ExecutionContext;
  }

  it("accepts an active ReviewStaff session and attaches only review identity", async () => {
    const request: Record<string, any> = { headers: { authorization: "Bearer review-token" } };
    jwt.verify.mockReturnValue({ sub: "reviewer-1", kind: REVIEW_TOKEN_KIND, role: "reviewer" });
    prisma.reviewStaff.findUnique.mockResolvedValue({
      id: "reviewer-1", username: "reviewer.liu", displayName: "刘审核", role: "reviewer", status: "active"
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.reviewer).toEqual({
      id: "reviewer-1", username: "reviewer.liu", displayName: "刘审核", role: "reviewer"
    });
    expect(prisma.reviewStaff.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "reviewer-1" }
    }));
  });

  it("rejects a consumer JWT before it can query review staff data", async () => {
    jwt.verify.mockReturnValue({ sub: "user-1", kind: "user", role: "admin" });

    await expect(guard.canActivate(contextFor({ headers: { authorization: "Bearer consumer-token" } })))
      .rejects.toMatchObject({ code: "REVIEW_UNAUTHORIZED" });
    expect(prisma.reviewStaff.findUnique).not.toHaveBeenCalled();
  });
});
