import { createHash } from "node:crypto";

import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "../../generated/prisma/client";

import { AuditService } from "../common/audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { AuthIdentityTombstoneService } from "./auth-identity-tombstone.service";
import { AuthService } from "./auth.service";
import { encryptTotpSecret } from "./staff-auth.crypto";
import { SMS_PROVIDER } from "./sms/sms-provider.interface";
import { MockSmsProvider } from "./sms/mock-sms.provider";

const mockPrisma: any = {
  verificationCode: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  authIdentity: { findUnique: jest.fn() },
  staffCredential: { findUnique: jest.fn(), update: jest.fn() },
  user: { create: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(mockPrisma))
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  disconnect: jest.fn()
};

const mockTombstones = {
  findBlockingStateTx: jest.fn().mockResolvedValue(null),
  findUserBlockingStateTx: jest.fn().mockResolvedValue(null),
  throwAuthState: jest.fn((state: unknown) => { throw state; })
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
    mockRedis.set.mockResolvedValue("OK");
    mockPrisma.verificationCode.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
    mockTombstones.findBlockingStateTx.mockResolvedValue(null);
    mockTombstones.findUserBlockingStateTx.mockResolvedValue(null);

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
                JWT_REFRESH_SECRET: "test-refresh",
                JWT_ACCESS_TTL: "15m",
                JWT_REFRESH_TTL: "30d",
                STAFF_TOTP_ENCRYPTION_KEY: "test-staff-totp-key-at-least-32-characters"
              };
              return vals[key];
            })
          }
        },
        { provide: SMS_PROVIDER, useClass: MockSmsProvider },
        { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } }
        ,{ provide: AuthIdentityTombstoneService, useValue: mockTombstones }
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
      expect(mockRedis.set).toHaveBeenCalledWith(
        "sms:phone:+8613800138000",
        "1",
        "EX",
        60,
        "NX"
      );
      expect(mockPrisma.verificationCode.updateMany).toHaveBeenCalledWith({
        where: {
          phone: "+8613800138000",
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) }
        },
        data: { consumedAt: expect.any(Date) }
      });
      expect(mockPrisma.verificationCode.create).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith("sms:verify:+8613800138000");
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
      mockRedis.set.mockResolvedValue(null);

      await expect(service.sendCode("13800138000")).rejects.toThrow("too frequently");
      expect(mockPrisma.verificationCode.create).not.toHaveBeenCalled();
    });

    it("should reject invalid phone", async () => {
      await expect(service.sendCode("123")).rejects.toThrow("Invalid phone");
    });
  });

  it("disconnects the Redis client during application shutdown", async () => {
    mockPrisma.verificationCode.create.mockResolvedValue({ id: "vc-1" });
    await service.sendCode("13800138000");

    service.onModuleDestroy();

    expect(mockRedis.disconnect).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of issuing a session when a JWT TTL bypasses startup validation", async () => {
    const config = (service as any).config as { getOrThrow: jest.Mock };
    config.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: "test-access",
        JWT_REFRESH_SECRET: "test-refresh",
        JWT_ACCESS_TTL: "not-a-duration",
        JWT_REFRESH_TTL: "30d"
      };
      return values[key];
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user" });

    await expect((service as any).issueTokens({ id: "user-1", role: "user" }))
      .rejects.toThrow("JWT_ACCESS_TTL");
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
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
      mockPrisma.authIdentity.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: "user-1", role: "user" });
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        role: "user",
        profile: { displayName: null, phone: "+8613800138000", gender: null, isVerified: false, safetyScore: 80 }
      });

      const result = await service.loginWithPhone("13800138000", "123456", {
        sessionLabel: "  WeChat \n Mini  ",
        clientPlatform: "wechat"
      });
      expect(result.accessToken).toBe("mock-token");
      expect(result.user.id).toBe("user-1");
      const sessionData = mockPrisma.refreshToken.create.mock.calls[0][0].data;
      expect(sessionData).toEqual(expect.objectContaining({
        id: expect.any(String),
        sessionLabel: "WeChat Mini",
        clientPlatform: "wechat",
        lastUsedAt: expect.any(Date)
      }));
      const jwt = (service as any).jwt as { sign: jest.Mock };
      expect(jwt.sign.mock.calls[0][0].sid).toBe(sessionData.id);
      expect(jwt.sign.mock.calls[1][0].sid).toBe(sessionData.id);
      expect(jwt.sign.mock.calls[0][0].kind).toBe("consumer");
      expect(jwt.sign.mock.calls[1][0].kind).toBe("consumer");
      expect(mockPrisma.verificationCode.updateMany).toHaveBeenCalledWith({
        where: {
          id: "vc-1",
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) }
        },
        data: { consumedAt: expect.any(Date) }
      });
      expect(mockRedis.del).toHaveBeenCalledWith("sms:verify:+8613800138000");
    });

    it("should reject invalid code", async () => {
      mockPrisma.verificationCode.findFirst.mockResolvedValue(null);

      await expect(service.loginWithPhone("13800138000", "000000"))
        .rejects.toThrow("invalid or expired");
      expect(mockRedis.incr).toHaveBeenCalledWith("sms:verify:+8613800138000");
      expect(mockRedis.expire).toHaveBeenCalledWith("sms:verify:+8613800138000", 600);
    });

    it("invalidates the active code after five failed verification attempts", async () => {
      const bcrypt = require("bcrypt");
      mockPrisma.verificationCode.findFirst.mockResolvedValue({
        id: "vc-locked",
        phone: "+8613800138000",
        codeHash: await bcrypt.hash("123456", 4),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null
      });
      mockRedis.incr.mockResolvedValue(5);

      await expect(service.loginWithPhone("13800138000", "000000"))
        .rejects.toMatchObject({ code: "INVALID_VERIFICATION_CODE" });
      expect(mockPrisma.verificationCode.updateMany).toHaveBeenCalledWith({
        where: {
          phone: "+8613800138000",
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) }
        },
        data: { consumedAt: expect.any(Date) }
      });
      expect(mockPrisma.authIdentity.findUnique).not.toHaveBeenCalled();
    });

    it("rejects a valid code when another login consumed it first", async () => {
      const bcrypt = require("bcrypt");
      mockPrisma.verificationCode.findFirst.mockResolvedValue({
        id: "vc-raced",
        phone: "+8613800138000",
        codeHash: await bcrypt.hash("123456", 4),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null
      });
      mockPrisma.verificationCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.loginWithPhone("13800138000", "123456"))
        .rejects.toMatchObject({ code: "INVALID_VERIFICATION_CODE" });
      expect(mockPrisma.authIdentity.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("does not issue a session when the verified identity is being deleted", async () => {
      const state = { status: "processing" };
      mockPrisma.authIdentity.findUnique
        .mockResolvedValueOnce({ userId: "user-deleting" })
        .mockResolvedValueOnce({ userId: "user-deleting" });
      mockTombstones.findUserBlockingStateTx.mockResolvedValue(state);

      await expect((service as any).resolveConsumerIdentityAndIssueSession(
        "phone",
        "+8613800138000",
        { phone: "+8613800138000" }
      )).rejects.toBe(state);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("does not create a second user while an active identity tombstone exists", async () => {
      const state = { status: "completed" };
      mockPrisma.authIdentity.findUnique.mockResolvedValue(null);
      mockTombstones.findBlockingStateTx.mockResolvedValue(state);

      await expect((service as any).resolveConsumerIdentityAndIssueSession(
        "phone",
        "+8613800138000",
        { phone: "+8613800138000" }
      )).rejects.toBe(state);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("retries the whole transaction exactly once for the AuthIdentity provider composite", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("identity won the race", {
        code: "P2002",
        clientVersion: "test",
        meta: { modelName: "AuthIdentity", target: ["provider", "providerId"] }
      });
      mockPrisma.$transaction
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce(async (callback: (tx: any) => Promise<unknown>) => callback(mockPrisma));
      mockPrisma.authIdentity.findUnique
        .mockResolvedValueOnce({ userId: "race-winner" })
        .mockResolvedValueOnce({ userId: "race-winner" });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "race-winner",
        role: "user",
        profile: null
      });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      await expect((service as any).resolveConsumerIdentityAndIssueSession(
        "phone",
        "+8613800138000",
        { phone: "+8613800138000" }
      )).resolves.toMatchObject({ user: { id: "race-winner" } });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it("does not retry an unrelated P2002 unique conflict", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("unrelated unique conflict", {
        code: "P2002",
        clientVersion: "test",
        meta: { modelName: "User", target: ["id"] }
      });
      mockPrisma.$transaction.mockRejectedValueOnce(conflict);

      await expect((service as any).resolveConsumerIdentityAndIssueSession(
        "phone",
        "+8613800138000",
        { phone: "+8613800138000" }
      )).rejects.toBe(conflict);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("loginStaff", () => {
    it("requires both the password and TOTP before issuing staff tokens", async () => {
      const bcrypt = require("bcrypt");
      const passwordHash = await bcrypt.hash("Correct-Horse-Battery-9!", 4);
      const key = "test-staff-totp-key-at-least-32-characters";
      const totpSecretCiphertext = encryptTotpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", key);
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(59_000);
      mockPrisma.staffCredential.findUnique.mockResolvedValue({
        id: "staff-credential-1",
        userId: "staff-1",
        username: "ops-admin",
        status: "active",
        passwordHash,
        totpSecretCiphertext,
        failedAttempts: 0,
        lockedUntil: null,
        user: { id: "staff-1", role: "admin", accountStatus: "active" }
      });
      mockPrisma.staffCredential.update.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "staff-1",
        role: "admin",
        profile: { displayName: "Ops", phone: null, age: null, gender: null, isVerified: true, safetyScore: 100 }
      });

      const result = await service.loginStaff("OPS-ADMIN", "Correct-Horse-Battery-9!", "287082", "127.0.0.1");

      expect(result.user.role).toBe("admin");
      expect(result.accessToken).toBe("mock-token");
      const jwt = (service as any).jwt as { sign: jest.Mock };
      expect(jwt.sign.mock.calls[0][0].kind).toBe("staff");
      expect(jwt.sign.mock.calls[1][0].kind).toBe("staff");
      expect(mockPrisma.staffCredential.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ failedAttempts: 0, lockedUntil: null })
      }));
      dateSpy.mockRestore();
    });

    it("records a failed attempt without revealing which factor was wrong", async () => {
      const bcrypt = require("bcrypt");
      mockPrisma.staffCredential.findUnique.mockResolvedValue({
        id: "staff-credential-2",
        userId: "staff-2",
        username: "reviewer",
        status: "active",
        passwordHash: await bcrypt.hash("Correct-Horse-Battery-9!", 4),
        totpSecretCiphertext: "invalid",
        failedAttempts: 0,
        lockedUntil: null,
        user: { id: "staff-2", role: "moderator", accountStatus: "active" }
      });

      await expect(service.loginStaff("reviewer", "wrong-password-long", "000000"))
        .rejects.toMatchObject({ code: "STAFF_LOGIN_FAILED" });
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("fails closed for a suspended StaffCredential even when both factors are valid", async () => {
      const bcrypt = require("bcrypt");
      const passwordHash = await bcrypt.hash("Correct-Horse-Battery-9!", 4);
      const key = "test-staff-totp-key-at-least-32-characters";
      const totpSecretCiphertext = encryptTotpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", key);
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(59_000);
      mockPrisma.staffCredential.findUnique.mockResolvedValue({
        id: "staff-credential-suspended",
        userId: "staff-suspended",
        username: "departed-admin",
        status: "suspended",
        passwordHash,
        totpSecretCiphertext,
        failedAttempts: 0,
        lockedUntil: null,
        user: { id: "staff-suspended", role: "admin", accountStatus: "active" }
      });

      await expect(service.loginStaff(
        "departed-admin",
        "Correct-Horse-Battery-9!",
        "287082",
        "127.0.0.1"
      )).rejects.toMatchObject({ code: "STAFF_LOGIN_FAILED" });
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
      dateSpy.mockRestore();
    });

    it("recognizes all four commercial staff roles as staff sessions", async () => {
      const bcrypt = require("bcrypt");
      const passwordHash = await bcrypt.hash("Correct-Horse-Battery-9!", 4);
      const key = "test-staff-totp-key-at-least-32-characters";
      const totpSecretCiphertext = encryptTotpSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", key);
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(59_000);
      mockPrisma.staffCredential.update.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      for (const role of ["support", "finance", "supply", "operations"]) {
        mockPrisma.staffCredential.findUnique.mockResolvedValue({
          id: `staff-credential-${role}`,
          userId: `staff-${role}`,
          username: role,
          status: "active",
          passwordHash,
          totpSecretCiphertext,
          failedAttempts: 0,
          lockedUntil: null,
          user: { id: `staff-${role}`, role, accountStatus: "active" }
        });
        mockPrisma.user.findUnique.mockResolvedValue({
          id: `staff-${role}`,
          role,
          profile: {
            displayName: role,
            phone: null,
            age: null,
            gender: null,
            isVerified: true,
            safetyScore: 100
          }
        });

        const result = await service.loginStaff(
          role,
          "Correct-Horse-Battery-9!",
          "287082",
          "127.0.0.1"
        );

        expect(result.user.role).toBe(role);
        expect((service as any).audit.record).toHaveBeenCalledWith(expect.objectContaining({
          action: "admin.login",
          metadata: expect.objectContaining({ role })
        }));
      }
      dateSpy.mockRestore();
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

    it("rejects consumer login when the external identity belongs to a staff account", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ openid: "staff-openid" })
      }) as unknown as typeof fetch;
      mockPrisma.authIdentity.findUnique.mockResolvedValue({
        userId: "staff-1",
        provider: "wechatMiniProgram",
        providerId: "staff-openid",
        user: { id: "staff-1", role: "support" }
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: "staff-1", role: "support", profile: null });

      await expect(service.loginWithWechatMiniProgram("mini-code")).rejects.toMatchObject({
        code: "AUTHENTICATION_METHOD_NOT_ALLOWED"
      });
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
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

    it("aborts a stalled WeChat code exchange after the upstream timeout", async () => {
      jest.useFakeTimers();
      global.fetch = jest.fn((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

      const login = service.loginWithWechatMiniProgram("stalled-code");
      const expectation = expect(login).rejects.toMatchObject({ code: "WECHAT_LOGIN_UNAVAILABLE" });
      await jest.advanceTimersByTimeAsync(8_000);
      await expectation;
      jest.useRealTimers();
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
              getOrThrow: jest.fn((key: string) => {
                const values: Record<string, string> = {
                  JWT_ACCESS_SECRET: "test-access",
                  JWT_REFRESH_SECRET: "test-refresh",
                  JWT_ACCESS_TTL: "15m",
                  JWT_REFRESH_TTL: "30d"
                };
                return values[key] ?? "secret";
              })
            }
          },
          { provide: SMS_PROVIDER, useValue: new MockSmsProvider() },
          { provide: AuditService, useValue: { record: jest.fn().mockResolvedValue({}) } }
          ,{ provide: AuthIdentityTombstoneService, useValue: mockTombstones }
        ]
      }).compile();

      const svc = module.get(AuthService);
      const tokenHash = createHash("sha256").update("old-refresh").digest("hex");

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-1",
        userId: "user-1",
        tokenHash,
        sessionLabel: "微信小程序",
        clientPlatform: "wechat",
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null
      });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user" });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await svc.refresh("old-refresh");
      expect(result.accessToken).toBe("new-token");
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "rt-1", revokedAt: null } })
      );
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          sessionLabel: "微信小程序",
          clientPlatform: "wechat"
        })
      });
    });

    it("rejects a concurrent refresh after another request consumes the token", async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-race",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null
      });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh("raced-refresh")).rejects.toMatchObject({
        code: "UNAUTHORIZED"
      });
    });

    it("rejects an old authenticated refresh with 401 before rotating it", async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt-deleting",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", role: "user" });
      mockTombstones.findUserBlockingStateTx.mockResolvedValue({ status: "processing" });

      await expect(service.refresh("deleting-refresh")).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        status: 401
      });
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("rejects a new refresh token whose sid does not match its persisted session", async () => {
      const jwt = (service as any).jwt as { verify: jest.Mock };
      jwt.verify.mockReturnValue({ sub: "user-1", sid: "session-other" });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null
      });

      await expect(service.refresh("mismatched-refresh")).rejects.toMatchObject({
        code: "UNAUTHORIZED"
      });
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
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

      await service.logout("user-1", "some-token");
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: expect.any(String),
          userId: "user-1",
          revokedAt: null
        },
        data: { revokedAt: expect.any(Date) }
      });
    });
  });
});
