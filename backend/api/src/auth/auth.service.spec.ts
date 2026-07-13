import { createHash } from "node:crypto";

import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "./auth.service";
import { SMS_PROVIDER } from "./sms/sms-provider.interface";
import { MockSmsProvider } from "./sms/mock-sms.provider";

const mockPrisma = {
  verificationCode: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  authIdentity: { findUnique: jest.fn() },
  user: { create: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() }
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn()
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    ...mockRedis,
    on: jest.fn()
  }));
});

describe("AuthService", () => {
  let service: AuthService;
  let smsProvider: MockSmsProvider;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1);

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue("mock-token"),
            verify: jest.fn().mockReturnValue({ sub: "user-1" })
          }
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: any) => {
              const vals: Record<string, any> = {
                REDIS_URL: "redis://localhost:6379",
                SMS_CODE_TTL_SECONDS: 300,
                WECHAT_MINIPROGRAM_APP_ID: "wx-mini-app",
                WECHAT_MINIPROGRAM_APP_SECRET: "mini-secret",
                JWT_ACCESS_TTL: "15m",
                JWT_REFRESH_TTL: "30d"
              };
              return vals[key] ?? fallback;
            }),
            getOrThrow: jest.fn((key: string) => {
              const vals: Record<string, string> = {
                REDIS_URL: "redis://localhost:6379",
                JWT_ACCESS_SECRET: "test-access",
                JWT_REFRESH_SECRET: "test-refresh"
              };
              return vals[key];
            })
          }
        },
        { provide: SMS_PROVIDER, useClass: MockSmsProvider },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } }
      ]
    }).compile();

    service = module.get(AuthService);
    smsProvider = module.get(SMS_PROVIDER);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("reports Mini Program credentials as configured without returning them", () => {
    expect(service.wechatMiniProgramStatus()).toEqual({
      module: "wechatMiniProgram",
      status: "configured",
      configured: true
    });
  });

  describe("sendCode", () => {
    it("should send a code and return TTL", async () => {
      mockPrisma.verificationCode.create.mockResolvedValue({ id: "vc-1" });

      const result = await service.sendCode("13800138000");

      expect(result.expiresInSeconds).toBe(300);
      expect(mockPrisma.verificationCode.create).toHaveBeenCalled();
      const lastCode = smsProvider.getLastCode();
      expect(lastCode?.phone).toBe("+8613800138000");
      expect(lastCode?.code).toMatch(/^\d{6}$/);
    });

    it("should reject SMS when provider is none", async () => {
      const config = (service as any).config as {
        get: jest.Mock;
      };
      config.get.mockImplementation((key: string, fallback?: any) => {
        if (key === "SMS_PROVIDER") return "none";
        const vals: Record<string, any> = {
          REDIS_URL: "redis://localhost:6379",
          SMS_CODE_TTL_SECONDS: 300,
          JWT_ACCESS_TTL: "15m",
          JWT_REFRESH_TTL: "30d"
        };
        return vals[key] ?? fallback;
      });

      await expect(service.sendCode("13800138000")).rejects.toMatchObject({
        code: "SMS_UNAVAILABLE"
      });
      expect(mockPrisma.verificationCode.create).not.toHaveBeenCalled();
    });

    it("should reject rate-limited phone", async () => {
      mockRedis.get.mockResolvedValue("1");

      await expect(service.sendCode("13800138000")).rejects.toThrow("too frequently");
    });

    it("should reject invalid phone", async () => {
      await expect(service.sendCode("123")).rejects.toThrow("Invalid phone");
    });
  });

  describe("loginWithPhone", () => {
    it("should return tokens on valid code", async () => {
      const bcrypt = require("bcrypt");
      const codeHash = await bcrypt.hash("123456", 10);

      mockPrisma.verificationCode.findFirst.mockResolvedValue({
        id: "vc-1",
        phone: "+8613800138000",
        codeHash,
        expiresAt: new Date(Date.now() + 60000),
        consumedAt: null
      });
      mockPrisma.verificationCode.update.mockResolvedValue({});
      mockPrisma.authIdentity.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: "user-1", role: "user" });
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        role: "user",
        profile: { displayName: null, phone: "+8613800138000", gender: null, isVerified: false, safetyScore: 80 }
      });

      const result = await service.loginWithPhone("13800138000", "123456");
      expect(result.accessToken).toBe("mock-token");
      expect(result.user.id).toBe("user-1");
    });

    it("should reject invalid code", async () => {
      mockPrisma.verificationCode.findFirst.mockResolvedValue(null);

      await expect(service.loginWithPhone("13800138000", "000000"))
        .rejects.toThrow("invalid or expired");
    });
  });

  describe("loginWithWechatMiniProgram", () => {
    it("exchanges a code, creates an identity, and returns the normal session", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ openid: "openid-1", session_key: "not-persisted" })
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      mockPrisma.authIdentity.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: "wechat-user", role: "user" });
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "wechat-user",
        role: "user",
        profile: { displayName: null, phone: null, gender: null, isVerified: false, safetyScore: 80 }
      });

      const result = await service.loginWithWechatMiniProgram("mini-code");

      expect(result.user.id).toBe("wechat-user");
      expect(fetchMock.mock.calls[0][0]).toContain("js_code=mini-code");
      expect(mockPrisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          identities: { create: { provider: "wechatMiniProgram", providerId: "openid-1" } }
        })
      }));
    });

    it("rejects an invalid or expired WeChat code", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ errcode: 40029, errmsg: "invalid code" })
      }) as unknown as typeof fetch;

      await expect(service.loginWithWechatMiniProgram("expired-code")).rejects.toMatchObject({
        code: "INVALID_WECHAT_CODE"
      });
    });
  });

  describe("refresh", () => {
    it("should rotate tokens on valid refresh", async () => {
      const jwt = { verify: jest.fn().mockReturnValue({ sub: "user-1" }), sign: jest.fn().mockReturnValue("new-token") };
      const module = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: JwtService, useValue: jwt },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((_k: string, fb: any) => fb),
              getOrThrow: jest.fn(() => "secret")
            }
          },
          { provide: SMS_PROVIDER, useValue: new MockSmsProvider() },
          { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } }
        ]
      }).compile();

      const svc = module.get(AuthService);
      const tokenHash = createHash("sha256").update("old-refresh").digest("hex");

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        userId: "user-1",
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", role: "user" });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await svc.refresh("old-refresh");
      expect(result.accessToken).toBe("new-token");
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "rt-1" } })
      );
    });

    it("should reject revoked refresh token", async () => {
      const tokenHash = createHash("sha256").update("revoked-refresh").digest("hex");

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-2",
        userId: "user-1",
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date()
      });

      await expect(service.refresh("revoked-refresh")).rejects.toThrow("revoked or expired");
    });
  });

  describe("logout", () => {
    it("should revoke the refresh token", async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout("some-token");
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
    });
  });
});
