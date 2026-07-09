import { randomBytes, createHash } from "node:crypto";

import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import Redis from "ioredis";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import * as jose from "jose";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { maskPhone as maskPhoneUtil } from "../common/logging/redact";
import { PrismaService } from "../database/prisma.service";
import { SMS_PROVIDER, SmsProvider } from "./sms/sms-provider.interface";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthenticatedUser {
  id: string;
  role: string;
}

export interface UserWithProfile {
  id: string;
  role: string;
  profile: {
    displayName: string | null;
    phone: string | null;
    age: number | null;
    gender: string | null;
    isVerified: boolean;
    safetyScore: number;
  } | null;
}

function maskPhone(phone: string): string {
  return maskPhoneUtil(phone);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly audit: AuditService
  ) {}

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(this.config.getOrThrow<string>("REDIS_URL"), {
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
      this.redis.on("error", () => undefined);
    }
    return this.redis;
  }

  async sendCode(phone: string, ip?: string): Promise<{ expiresInSeconds: number; devCode?: string }> {
    const smsProvider = this.config.get<string>("SMS_PROVIDER", "mock");
    if (smsProvider === "none") {
      throw new AppException(
        "SMS_UNAVAILABLE",
        "SMS verification is not available in this environment. Use Sign in with Apple.",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const parsed = parsePhoneNumberFromString(phone, "CN");
    if (!parsed?.isValid()) {
      throw new AppException("INVALID_PHONE", "Invalid phone number", HttpStatus.BAD_REQUEST);
    }
    const e164 = parsed.format("E.164");

    const redis = this.getRedis();
    const phoneKey = `sms:phone:${e164}`;
    const existing = await redis.get(phoneKey);
    if (existing) {
      throw new AppException("RATE_LIMITED", "Verification code sent too frequently, please try later", HttpStatus.TOO_MANY_REQUESTS);
    }

    if (ip) {
      const ipKey = `sms:ip:${ip}`;
      const ipCount = await redis.incr(ipKey);
      if (ipCount === 1) await redis.expire(ipKey, 3600);
      if (ipCount > 5) {
        throw new AppException("RATE_LIMITED", "Too many requests from this IP", HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const ttl = this.config.get<number>("SMS_CODE_TTL_SECONDS", 300);
    const codeHash = await bcrypt.hash(code, 10);

    await this.prisma.verificationCode.create({
      data: {
        phone: e164,
        codeHash,
        expiresAt: new Date(Date.now() + ttl * 1000)
      }
    });

    await redis.set(phoneKey, "1", "EX", 60);
    await this.sms.sendCode(e164, code);

    const appEnv = this.config.get<string>("APP_ENV", "development");
    if (appEnv !== "production" && smsProvider === "mock") {
      return { expiresInSeconds: ttl, devCode: code };
    }

    return { expiresInSeconds: ttl };
  }

  async loginWithPhone(phone: string, code: string): Promise<AuthTokens & { user: UserWithProfile }> {
    const parsed = parsePhoneNumberFromString(phone, "CN");
    if (!parsed?.isValid()) {
      throw new AppException("INVALID_PHONE", "Invalid phone number", HttpStatus.BAD_REQUEST);
    }
    const e164 = parsed.format("E.164");

    const record = await this.prisma.verificationCode.findFirst({
      where: {
        phone: e164,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: "desc" }
    });

    if (!record) {
      throw new AppException("INVALID_VERIFICATION_CODE", "Verification code is invalid or expired", HttpStatus.UNAUTHORIZED);
    }

    const matches = await bcrypt.compare(code, record.codeHash);
    if (!matches) {
      throw new AppException("INVALID_VERIFICATION_CODE", "Verification code is invalid or expired", HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.verificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() }
    });

    const user = await this.findOrCreateByPhone(e164);
    const tokens = await this.issueTokens(user);
    const profile = await this.getUserWithProfile(user.id);
    await this.recordLoginAudit(user.id, user.role, "phone", { phone: e164 });

    return { ...tokens, user: profile };
  }

  async loginWithApple(identityToken: string): Promise<AuthTokens & { user: UserWithProfile }> {
    const bundleId = this.config.get<string>("APPLE_SIGN_IN_BUNDLE_ID");
    if (!bundleId) {
      throw new AppException("APPLE_LOGIN_UNAVAILABLE", "Apple Sign-In is not configured", HttpStatus.SERVICE_UNAVAILABLE);
    }

    let sub: string;
    try {
      const JWKS = jose.createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
      const { payload } = await jose.jwtVerify(identityToken, JWKS, {
        issuer: "https://appleid.apple.com",
        audience: bundleId
      });
      sub = payload.sub!;
    } catch {
      throw new AppException("INVALID_APPLE_TOKEN", "Apple identity token is invalid", HttpStatus.UNAUTHORIZED);
    }

    const user = await this.findOrCreateByApple(sub);
    const tokens = await this.issueTokens(user);
    const profile = await this.getUserWithProfile(user.id);
    await this.recordLoginAudit(user.id, user.role, "apple");

    return { ...tokens, user: profile };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const refreshSecret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");

    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, { secret: refreshSecret }) as { sub: string };
    } catch {
      throw new AppException("UNAUTHORIZED", "Invalid refresh token", HttpStatus.UNAUTHORIZED);
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
      throw new AppException("UNAUTHORIZED", "Refresh token has been revoked or expired", HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() }
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async getUserWithProfile(userId: string): Promise<UserWithProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    return {
      id: user.id,
      role: user.role,
      profile: user.profile
        ? {
            displayName: user.profile.displayName,
            phone: user.profile.phone ? maskPhone(user.profile.phone) : null,
            age: user.profile.age,
            gender: user.profile.gender,
            isVerified: user.profile.isVerified,
            safetyScore: user.profile.safetyScore
          }
        : null
    };
  }

  private async recordLoginAudit(
    userId: string,
    role: string,
    provider: string,
    metadata: Record<string, unknown> = {}
  ) {
    const isStaff = role === "admin" || role === "moderator";
    await this.audit.record({
      actorId: userId,
      action: isStaff ? "admin.login" : "user.login",
      resourceType: "auth",
      resourceId: userId,
      metadata: { role, provider, ...metadata }
    });
  }

  private async findOrCreateByPhone(phone: string) {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerId: { provider: "phone", providerId: phone } },
      include: { user: true }
    });

    if (identity) return identity.user;

    return this.prisma.user.create({
      data: {
        identities: {
          create: { provider: "phone", providerId: phone }
        },
        profile: {
          create: { phone }
        }
      }
    });
  }

  private async findOrCreateByApple(sub: string) {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerId: { provider: "apple", providerId: sub } },
      include: { user: true }
    });

    if (identity) return identity.user;

    return this.prisma.user.create({
      data: {
        identities: {
          create: { provider: "apple", providerId: sub }
        },
        profile: { create: {} }
      }
    });
  }

  private async issueTokens(user: { id: string; role: string }): Promise<AuthTokens> {
    const accessSecret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    const refreshSecret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL", "15m");
    const refreshTtl = this.config.get<string>("JWT_REFRESH_TTL", "30d");

    const accessToken = this.jwt.sign(
      { sub: user.id, role: user.role } as Record<string, unknown>,
      { secret: accessSecret, expiresIn: accessTtl as any }
    );

    const refreshToken = this.jwt.sign(
      { sub: user.id } as Record<string, unknown>,
      { secret: refreshSecret, expiresIn: refreshTtl as any }
    );

    const tokenHash = this.hashToken(refreshToken);
    const refreshTtlMs = this.parseTtlToMs(refreshTtl);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + refreshTtlMs)
      }
    });

    const accessTtlSeconds = Math.floor(this.parseTtlToMs(accessTtl) / 1000);
    return { accessToken, refreshToken, expiresIn: accessTtlSeconds };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private parseTtlToMs(ttl: string): number {
    const match = ttl.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 900_000; // default 15m
    const value = parseInt(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * (multipliers[unit] ?? 60_000);
  }
}
