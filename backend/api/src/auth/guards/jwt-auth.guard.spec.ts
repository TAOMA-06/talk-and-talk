import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";

import { PrismaService } from "../../database/prisma.service";
import { AuthIdentityTombstoneService } from "../auth-identity-tombstone.service";
import { isAcceptedLegalConsentSource, isStaffRole, JwtAuthGuard } from "./jwt-auth.guard";

jest.mock("@nestjs/passport", () => ({
  AuthGuard: () => class {
    canActivate() {
      return true;
    }
  }
}));

describe("isAcceptedLegalConsentSource", () => {
  it.each(["wechatMiniProgram", "web"])("accepts the supported %s receipt source", (source) => {
    expect(isAcceptedLegalConsentSource(source)).toBe(true);
  });

  it.each([undefined, null, "", "app", "admin"])("rejects unsupported receipt source %p", (source) => {
    expect(isAcceptedLegalConsentSource(source)).toBe(false);
  });
});

describe("isStaffRole", () => {
  it.each(["admin", "moderator", "support", "finance", "supply", "operations"])(
    "recognizes %s as an internal staff role",
    (role) => {
      expect(isStaffRole(role)).toBe(true);
    }
  );

  it.each(["user", "companion", "", null, undefined])("does not elevate %p", (role) => {
    expect(isStaffRole(role)).toBe(false);
  });
});

describe("JwtAuthGuard account deletion boundary", () => {
  it("rejects every old authenticated route before SkipLegalConsent can bypass checks", async () => {
    const request = { user: { id: "user-deleting", role: "user" }, method: "GET" };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {}
    } as unknown as ExecutionContext;
    const legalConsentReceipt = { findFirst: jest.fn() };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: "user", accountStatus: "active" })
      },
      legalConsentReceipt
    } as unknown as PrismaService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true)
    } as unknown as Reflector;
    const tombstones = {
      findUserBlockingStateTx: jest.fn().mockResolvedValue({ status: "processing" })
    } as unknown as AuthIdentityTombstoneService;
    const guard = new JwtAuthGuard(
      prisma,
      {} as ConfigService,
      reflector,
      tombstones
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401
    });
    expect(legalConsentReceipt.findFirst).not.toHaveBeenCalled();
  });
});
