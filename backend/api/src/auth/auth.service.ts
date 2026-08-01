import { createHash, randomInt, randomUUID } from "node:crypto";

import { HttpStatus, Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import Redis from "ioredis";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import * as jose from "jose";
import { Prisma } from "../../generated/prisma/client";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { maskPhone as maskPhoneUtil } from "../common/logging/redact";
import { validateConsumerJwtTtls } from "../config/configuration";
import { PrismaService } from "../database/prisma.service";
import {
  AuthIdentityTombstoneService,
  ConsumerAuthProvider
} from "./auth-identity-tombstone.service";
import { decryptTotpSecret, matchTotpCounter } from "./staff-auth.crypto";
import { isStaffUserRole } from "./staff-roles";
import { SMS_PROVIDER, SmsProvider } from "./sms/sms-provider.interface";

const DUMMY_STAFF_PASSWORD_HASH = bcrypt.hashSync("invalid-staff-credential-padding", 12);

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthenticatedUser {
  id: string;
  role: string;
  sessionId?: string;
}

export interface SessionMetadata {
  sessionLabel?: string | null;
  clientPlatform?: string | null;
}

type AuthenticationKind = "consumer" | "staff";

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

class ConsumerIdentityResolutionChangedError extends Error {}

@Injectable()
export class AuthService implements OnModuleDestroy {
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly audit: AuditService,
    private readonly tombstones: AuthIdentityTombstoneService
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

  onModuleDestroy(): void {
    this.redis?.disconnect();
    this.redis = null;
  }

  wechatMiniProgramStatus() {
    const appId = this.config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "").trim();
    const appSecret = this.config.get<string>("WECHAT_MINIPROGRAM_APP_SECRET", "").trim();
    const configured = Boolean(appId && appSecret);
    return {
      module: "wechatMiniProgram",
      status: configured ? "configured" : "unconfigured",
      configured
    };
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
    const phoneRateLimitClaim = await redis.set(phoneKey, "1", "EX", 60, "NX");
    if (phoneRateLimitClaim !== "OK") {
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

    const code = String(randomInt(100000, 1_000_000));
    const ttl = this.config.get<number>("SMS_CODE_TTL_SECONDS", 300);
    const codeHash = await bcrypt.hash(code, 10);

    const issuedAt = new Date();
    await this.prisma.verificationCode.updateMany({
      where: {
        phone: e164,
        consumedAt: null,
        expiresAt: { gt: issuedAt }
      },
      data: { consumedAt: issuedAt }
    });
    await this.prisma.verificationCode.create({
      data: {
        phone: e164,
        codeHash,
        expiresAt: new Date(issuedAt.getTime() + ttl * 1000)
      }
    });

    await redis.del(`sms:verify:${e164}`);
    await this.sms.sendCode(e164, code);

    const appEnv = this.config.get<string>("APP_ENV", "development");
    if (appEnv !== "production" && smsProvider === "mock") {
      return { expiresInSeconds: ttl, devCode: code };
    }

    return { expiresInSeconds: ttl };
  }

  async loginWithPhone(
    phone: string,
    code: string,
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens & { user: UserWithProfile }> {
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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });

    if (!record) {
      return this.rejectPhoneVerificationAttempt(e164);
    }

    const matches = await bcrypt.compare(code, record.codeHash);
    if (!matches) {
      return this.rejectPhoneVerificationAttempt(e164);
    }

    const consumed = await this.prisma.verificationCode.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: { consumedAt: new Date() }
    });
    if (consumed.count !== 1) {
      throw new AppException("INVALID_VERIFICATION_CODE", "Verification code is invalid or expired", HttpStatus.UNAUTHORIZED);
    }
    await this.getRedis().del(`sms:verify:${e164}`);

    const result = await this.resolveConsumerIdentityAndIssueSession(
      "phone",
      e164,
      { phone: e164 },
      sessionMetadata
    );
    await this.recordLoginAudit(result.user.id, result.user.role, "phone");
    return result;
  }

  async loginStaff(
    username: string,
    password: string,
    totpCode: string,
    ip?: string,
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens & { user: UserWithProfile }> {
    const normalizedUsername = username.trim().toLowerCase();
    const usernameKey = createHash("sha256").update(normalizedUsername).digest("hex");
    const redis = this.getRedis();
    const rateKeys = [`staff-login:user:${usernameKey}`];
    if (ip) rateKeys.push(`staff-login:ip:${createHash("sha256").update(ip).digest("hex")}`);

    for (const key of rateKeys) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 900);
      if (count > 10) {
        throw new AppException("STAFF_LOGIN_RATE_LIMITED", "Too many login attempts", HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const credential = await this.prisma.staffCredential.findUnique({
      where: { username: normalizedUsername },
      include: { user: true }
    });

    const now = new Date();
    const passwordMatches = credential
      ? await bcrypt.compare(password, credential.passwordHash)
      : await bcrypt.compare(password, DUMMY_STAFF_PASSWORD_HASH);
    let totpMatches = false;
    if (credential && passwordMatches) {
      try {
        const secret = decryptTotpSecret(
          credential.totpSecretCiphertext,
          this.config.getOrThrow<string>("STAFF_TOTP_ENCRYPTION_KEY")
        );
        const counter = matchTotpCounter(secret, totpCode);
        if (counter !== null) {
          const replayClaim = await redis.set(`staff-totp:${credential.id}:${counter}`, "1", "EX", 90, "NX");
          totpMatches = replayClaim === "OK";
        }
      } catch {
        totpMatches = false;
      }
    }

    const eligible = credential &&
      (credential as any).status === "active" &&
      isStaffUserRole(credential.user.role) &&
      credential.user.accountStatus === "active";
    const lockExpired = credential?.lockedUntil ? credential.lockedUntil <= now : true;

    if (!credential || !passwordMatches || !totpMatches || !eligible || !lockExpired) {
      if (credential) {
        await this.prisma.$executeRaw`
          UPDATE "StaffCredential"
          SET "failedAttempts" = "failedAttempts" + 1,
              "lockedUntil" = CASE
                WHEN "failedAttempts" + 1 >= 5 THEN ${new Date(now.getTime() + 15 * 60_000)}
                ELSE "lockedUntil"
              END,
              "updatedAt" = ${now}
          WHERE "id" = ${credential.id}
        `;
        await this.audit.record({
          actorId: credential.userId,
          action: "admin.login_failed",
          resourceType: "auth",
          metadata: { provider: "staffPasswordTotp", ip: ip ?? null }
        });
      }
      throw new AppException("STAFF_LOGIN_FAILED", "Invalid staff credentials", HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.staffCredential.update({
      where: { id: credential.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now }
    });
    const tokens = await this.issueTokens(credential.user, sessionMetadata, "staff");
    const profile = await this.getUserWithProfile(credential.userId);
    await this.recordLoginAudit(credential.userId, credential.user.role, "staffPasswordTotp", { ip: ip ?? null });
    return { ...tokens, user: profile };
  }

  async loginWithApple(
    identityToken: string,
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens & { user: UserWithProfile }> {
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

    const result = await this.resolveConsumerIdentityAndIssueSession(
      "apple",
      sub,
      {},
      sessionMetadata
    );
    await this.recordLoginAudit(result.user.id, result.user.role, "apple");
    return result;
  }

  /**
   * Exchanges the short-lived wx.login code on the server. The returned session_key
   * deliberately never leaves this method and is not persisted by Talk&Talk.
   */
  async loginWithWechatMiniProgram(
    code: string,
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens & { user: UserWithProfile }> {
    const appId = this.config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "").trim();
    const appSecret = this.config.get<string>("WECHAT_MINIPROGRAM_APP_SECRET", "").trim();
    const trimmedCode = code.trim();

    if (!appId || !appSecret) {
      throw new AppException(
        "WECHAT_MINIPROGRAM_LOGIN_UNAVAILABLE",
        "WeChat Mini Program login is not configured",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    if (!trimmedCode) {
      throw new AppException("INVALID_WECHAT_CODE", "WeChat login code is required", HttpStatus.BAD_REQUEST);
    }

    const query = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: trimmedCode,
      grant_type: "authorization_code"
    });

    let payload: { openid?: unknown; errcode?: unknown; errmsg?: unknown };
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8_000);
    try {
      const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`, {
        signal: abortController.signal
      });
      payload = await response.json() as { openid?: unknown; errcode?: unknown; errmsg?: unknown };
      if (!response.ok) {
        throw new Error("WeChat login request failed");
      }
    } catch {
      throw new AppException(
        "WECHAT_LOGIN_UNAVAILABLE",
        "Unable to verify WeChat login at this time",
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      clearTimeout(timeout);
    }

    const openId = typeof payload.openid === "string" ? payload.openid.trim() : "";
    if (!openId) {
      throw new AppException(
        "INVALID_WECHAT_CODE",
        "WeChat login code is invalid or expired",
        HttpStatus.UNAUTHORIZED
      );
    }

    const result = await this.resolveConsumerIdentityAndIssueSession(
      "wechatMiniProgram",
      openId,
      {},
      sessionMetadata
    );
    await this.recordLoginAudit(result.user.id, result.user.role, "wechatMiniProgram");
    return result;
  }

  async refresh(refreshToken: string, sessionMetadata?: SessionMetadata): Promise<AuthTokens> {
    const refreshSecret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");

    let payload: { sub?: string; sid?: string; kind?: string };
    try {
      payload = this.jwt.verify(refreshToken, { secret: refreshSecret }) as {
        sub?: string;
        sid?: string;
        kind?: string;
      };
    } catch {
      throw new AppException("UNAUTHORIZED", "Invalid refresh token", HttpStatus.UNAUTHORIZED);
    }
    if (!payload.sub) {
      throw new AppException("UNAUTHORIZED", "Invalid refresh token", HttpStatus.UNAUTHORIZED);
    }

    const authenticationKind: AuthenticationKind = payload.kind === "staff" ? "staff" : "consumer";
    const tokenHash = this.hashToken(refreshToken);
    if (authenticationKind === "staff") {
      return this.refreshStaffToken(payload, tokenHash, sessionMetadata);
    }

    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const locked = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "User" WHERE "id" = ${payload.sub!} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
      }
      const stored = await db.refreshToken.findUnique({ where: { tokenHash } });
      const now = new Date();
      if (
        !stored
        || stored.revokedAt
        || stored.expiresAt < now
        || stored.userId !== payload.sub
        || (payload.sid && payload.sid !== stored.id)
      ) {
        throw new AppException(
          "UNAUTHORIZED",
          "Refresh token has been revoked or expired",
          HttpStatus.UNAUTHORIZED
        );
      }
      const user = await db.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
      }
      const deletionState = await this.tombstones.findUserBlockingStateTx(db, user.id, now);
      if (deletionState) {
        throw new AppException(
          "UNAUTHORIZED",
          "Refresh token is unavailable while account deletion is processing",
          HttpStatus.UNAUTHORIZED
        );
      }

      const revoked = await db.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now }
      });
      if (revoked.count !== 1) {
        throw new AppException(
          "UNAUTHORIZED",
          "Refresh token has already been used",
          HttpStatus.UNAUTHORIZED
        );
      }
      return this.issueConsumerTokensTx(db, user, {
        sessionLabel: stored.sessionLabel ?? sessionMetadata?.sessionLabel,
        clientPlatform: stored.clientPlatform ?? sessionMetadata?.clientPlatform
      });
    }, { maxWait: 5_000, timeout: 10_000 });
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, userId, revokedAt: null },
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
    const isStaff = isStaffUserRole(role);
    await this.audit.record({
      actorId: userId,
      action: isStaff ? "admin.login" : "user.login",
      resourceType: "auth",
      metadata: { role, provider, ...metadata }
    });
  }

  private async resolveConsumerIdentityAndIssueSession(
    provider: ConsumerAuthProvider,
    providerId: string,
    profile: { phone?: string },
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens & { user: UserWithProfile }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const db = tx as any;
          const now = new Date();
          const candidate = await db.authIdentity.findUnique({
            where: { provider_providerId: { provider, providerId } },
            select: { userId: true }
          });

          if (candidate) {
            const locked = await db.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE
            `;
            if (!locked.length) {
              throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
            }
            // Re-read after the canonical User lock. The deletion worker may
            // have erased the identity between the optimistic lookup and lock.
            const currentIdentity = await db.authIdentity.findUnique({
              where: { provider_providerId: { provider, providerId } },
              select: { userId: true }
            });
            const deletionState = await this.tombstones.findUserBlockingStateTx(
              db,
              candidate.userId,
              now
            );
            if (deletionState) this.tombstones.throwAuthState(deletionState);
            if (!currentIdentity || currentIdentity.userId !== candidate.userId) {
              const tombstoneState = await this.tombstones.findBlockingStateTx(
                db,
                provider,
                providerId,
                now
              );
              if (tombstoneState) this.tombstones.throwAuthState(tombstoneState);
              throw new ConsumerIdentityResolutionChangedError();
            }
            const user = await db.user.findUnique({
              where: { id: candidate.userId },
              include: { profile: true }
            });
            if (!user) {
              throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
            }
            this.assertAuthenticationKind(user, "consumer");
            const tokens = await this.issueConsumerTokensTx(db, user, sessionMetadata);
            return { ...tokens, user: this.toUserWithProfile(user) };
          }

          const tombstoneState = await this.tombstones.findBlockingStateTx(
            db,
            provider,
            providerId,
            now
          );
          if (tombstoneState) this.tombstones.throwAuthState(tombstoneState);

          const user = await db.user.create({
            data: {
              identities: { create: { provider, providerId } },
              profile: { create: profile }
            },
            include: { profile: true }
          });
          const tokens = await this.issueConsumerTokensTx(db, user, sessionMetadata);
          return { ...tokens, user: this.toUserWithProfile(user) };
        }, { maxWait: 5_000, timeout: 10_000 });
      } catch (error) {
        if (attempt === 0 && (
          error instanceof ConsumerIdentityResolutionChangedError
          || this.isAuthIdentityUniqueConflict(error)
        )) {
          continue;
        }
        throw error;
      }
    }
    throw new AppException("UNAUTHORIZED", "Unable to resolve login identity", HttpStatus.UNAUTHORIZED);
  }

  private async issueTokens(
    user: { id: string; role: string },
    sessionMetadata?: SessionMetadata,
    authenticationKind: AuthenticationKind = "consumer"
  ): Promise<AuthTokens> {
    this.assertAuthenticationKind(user, authenticationKind);
    if (authenticationKind === "consumer") {
      return this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const locked = await db.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE
        `;
        if (!locked.length) {
          throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
        }
        const current = await db.user.findUnique({ where: { id: user.id } });
        if (!current) {
          throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
        }
        const state = await this.tombstones.findUserBlockingStateTx(db, user.id, new Date());
        if (state) this.tombstones.throwAuthState(state);
        return this.issueConsumerTokensTx(db, current, sessionMetadata);
      }, { maxWait: 5_000, timeout: 10_000 });
    }

    return this.issueStaffTokens(user, sessionMetadata);
  }

  private async issueStaffTokens(
    user: { id: string; role: string },
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens> {
    const accessSecret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    const refreshSecret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");
    const accessTtl = this.config.getOrThrow<string>("JWT_ACCESS_TTL");
    const refreshTtl = this.config.getOrThrow<string>("JWT_REFRESH_TTL");
    const { accessTtlMs, refreshTtlMs } = validateConsumerJwtTtls(accessTtl, refreshTtl);
    const sessionId = randomUUID();
    const metadata = this.normalizeSessionMetadata(sessionMetadata);

    const accessToken = this.jwt.sign(
      {
        sub: user.id,
        role: user.role,
        sid: sessionId,
        kind: "staff",
        jti: randomUUID()
      } as Record<string, unknown>,
      { secret: accessSecret, expiresIn: accessTtl as any }
    );

    const refreshToken = this.jwt.sign(
      {
        sub: user.id,
        sid: sessionId,
        kind: "staff",
        jti: randomUUID()
      } as Record<string, unknown>,
      { secret: refreshSecret, expiresIn: refreshTtl as any }
    );

    const tokenHash = this.hashToken(refreshToken);
    const sessionData = {
      id: sessionId,
      userId: user.id,
      tokenHash,
      sessionLabel: metadata.sessionLabel,
      clientPlatform: metadata.clientPlatform,
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + refreshTtlMs)
    };
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Offboarding locks this same credential row before suspending access
      // and revoking sessions. Token issuance therefore either commits first
      // (and is included in the revocation) or observes the suspended state.
      await db.$queryRaw`SELECT "id" FROM "StaffCredential" WHERE "userId" = ${user.id} FOR UPDATE`;
      const credential = await db.staffCredential.findUnique({
        where: { userId: user.id },
        include: { user: true }
      });
      if (
        !credential
        || credential.status !== "active"
        || !isStaffUserRole(credential.user.role)
        || credential.user.accountStatus !== "active"
      ) {
        throw new AppException(
          "STAFF_LOGIN_FAILED",
          "Invalid staff credentials",
          HttpStatus.UNAUTHORIZED
        );
      }
      await db.refreshToken.create({ data: sessionData });
    });

    const accessTtlSeconds = Math.floor(accessTtlMs / 1000);
    return { accessToken, refreshToken, expiresIn: accessTtlSeconds };
  }

  private async issueConsumerTokensTx(
    tx: any,
    user: { id: string; role: string },
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens> {
    this.assertAuthenticationKind(user, "consumer");
    const accessSecret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    const refreshSecret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");
    const accessTtl = this.config.getOrThrow<string>("JWT_ACCESS_TTL");
    const refreshTtl = this.config.getOrThrow<string>("JWT_REFRESH_TTL");
    const { accessTtlMs, refreshTtlMs } = validateConsumerJwtTtls(accessTtl, refreshTtl);
    const sessionId = randomUUID();
    const metadata = this.normalizeSessionMetadata(sessionMetadata);
    const now = new Date();
    const accessToken = this.jwt.sign(
      {
        sub: user.id,
        role: user.role,
        sid: sessionId,
        kind: "consumer",
        jti: randomUUID()
      } as Record<string, unknown>,
      { secret: accessSecret, expiresIn: accessTtl as any }
    );
    const refreshToken = this.jwt.sign(
      {
        sub: user.id,
        sid: sessionId,
        kind: "consumer",
        jti: randomUUID()
      } as Record<string, unknown>,
      { secret: refreshSecret, expiresIn: refreshTtl as any }
    );
    await tx.refreshToken.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        sessionLabel: metadata.sessionLabel,
        clientPlatform: metadata.clientPlatform,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + refreshTtlMs)
      }
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(accessTtlMs / 1000)
    };
  }

  private async refreshStaffToken(
    payload: { sub?: string; sid?: string },
    tokenHash: string,
    sessionMetadata?: SessionMetadata
  ): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (
      !stored
      || stored.revokedAt
      || stored.expiresAt < now
      || stored.userId !== payload.sub
      || (payload.sid && payload.sid !== stored.id)
    ) {
      throw new AppException(
        "UNAUTHORIZED",
        "Refresh token has been revoked or expired",
        HttpStatus.UNAUTHORIZED
      );
    }
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now, lastUsedAt: now }
    });
    if (revoked.count !== 1) {
      throw new AppException(
        "UNAUTHORIZED",
        "Refresh token has already been used",
        HttpStatus.UNAUTHORIZED
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub! } });
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
    }
    return this.issueStaffTokens(user, {
      sessionLabel: stored.sessionLabel ?? sessionMetadata?.sessionLabel,
      clientPlatform: stored.clientPlatform ?? sessionMetadata?.clientPlatform
    });
  }

  private toUserWithProfile(user: {
    id: string;
    role: string;
    profile?: {
      displayName: string | null;
      phone: string | null;
      age: number | null;
      gender: string | null;
      isVerified: boolean;
      safetyScore: number;
    } | null;
  }): UserWithProfile {
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

  private isAuthIdentityUniqueConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return false;
    }
    const modelName = typeof error.meta?.modelName === "string" ? error.meta.modelName : "";
    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.map(String)
      : typeof error.meta?.target === "string"
        ? [error.meta.target]
        : [];
    return modelName === "AuthIdentity"
      && target.includes("provider")
      && target.includes("providerId");
  }

  private assertAuthenticationKind(
    user: { role: string },
    authenticationKind: AuthenticationKind
  ): void {
    const staffRole = isStaffUserRole(user.role);
    if ((authenticationKind === "staff") !== staffRole) {
      throw new AppException(
        "AUTHENTICATION_METHOD_NOT_ALLOWED",
        staffRole
          ? "Staff accounts must use the staff sign-in flow"
          : "This account cannot use the staff sign-in flow",
        HttpStatus.UNAUTHORIZED
      );
    }
  }

  private normalizeSessionMetadata(metadata?: SessionMetadata): Required<SessionMetadata> {
    const normalize = (value: string | null | undefined, maxLength: number) => {
      if (typeof value !== "string") return null;
      const cleaned = value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
      return cleaned || null;
    };
    return {
      sessionLabel: normalize(metadata?.sessionLabel, 80),
      clientPlatform: normalize(metadata?.clientPlatform, 32)
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private async rejectPhoneVerificationAttempt(e164: string): Promise<never> {
    const redis = this.getRedis();
    const key = `sms:verify:${e164}`;
    const attemptCount = await redis.incr(key);
    if (attemptCount === 1) {
      await redis.expire(key, 600);
    }
    if (attemptCount >= 5) {
      const now = new Date();
      await this.prisma.verificationCode.updateMany({
        where: {
          phone: e164,
          consumedAt: null,
          expiresAt: { gt: now }
        },
        data: { consumedAt: now }
      });
    }
    throw new AppException(
      "INVALID_VERIFICATION_CODE",
      "Verification code is invalid or expired",
      HttpStatus.UNAUTHORIZED
    );
  }

}
