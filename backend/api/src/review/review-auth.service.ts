import { createHash, randomUUID } from "node:crypto";

import { HttpStatus, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import Redis from "ioredis";

import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { decryptTotpSecret, matchTotpCounter } from "../auth/staff-auth.crypto";
import {
  AuthenticatedReviewer,
  REVIEW_TOKEN_AUDIENCE,
  REVIEW_TOKEN_KIND,
  ReviewAuthTokens,
  ReviewStaffRole
} from "./review-auth.types";

const DUMMY_REVIEW_PASSWORD_HASH = bcrypt.hashSync("invalid-review-credential-padding", 12);

@Injectable()
export class ReviewAuthService implements OnModuleDestroy {
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
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

  async login(
    username: string,
    password: string,
    totpCode: string,
    ip?: string
  ): Promise<ReviewAuthTokens & { reviewer: AuthenticatedReviewer }> {
    const normalizedUsername = username.trim().toLowerCase();
    const usernameKey = createHash("sha256").update(normalizedUsername).digest("hex");
    const redis = this.getRedis();
    const rateKeys = [`review-login:user:${usernameKey}`];
    if (ip) rateKeys.push(`review-login:ip:${createHash("sha256").update(ip).digest("hex")}`);

    for (const key of rateKeys) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 900);
      if (count > 10) {
        throw new AppException("REVIEW_LOGIN_RATE_LIMITED", "Too many review login attempts", HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const reviewer = await this.prisma.reviewStaff.findUnique({ where: { username: normalizedUsername } });
    const now = new Date();
    const passwordMatches = reviewer
      ? await bcrypt.compare(password, reviewer.passwordHash)
      : await bcrypt.compare(password, DUMMY_REVIEW_PASSWORD_HASH);
    let totpMatches = false;
    if (reviewer && passwordMatches) {
      try {
        const secret = decryptTotpSecret(
          reviewer.totpSecretCiphertext,
          this.config.getOrThrow<string>("REVIEW_TOTP_ENCRYPTION_KEY")
        );
        const counter = matchTotpCounter(secret, totpCode);
        if (counter !== null) {
          const replayClaim = await redis.set(`review-totp:${reviewer.id}:${counter}`, "1", "EX", 90, "NX");
          totpMatches = replayClaim === "OK";
        }
      } catch {
        totpMatches = false;
      }
    }

    const lockExpired = reviewer?.lockedUntil ? reviewer.lockedUntil <= now : true;
    const eligible = reviewer?.status === "active";
    if (!reviewer || !passwordMatches || !totpMatches || !lockExpired || !eligible) {
      if (reviewer) {
        await this.prisma.$transaction(async (tx) => {
          // Concurrent password guesses must not both observe the same count
          // and miss the five-attempt lockout threshold.
          await tx.$executeRaw`
            UPDATE "ReviewStaff"
            SET "failedAttempts" = "failedAttempts" + 1,
                "lockedUntil" = CASE
                  WHEN "failedAttempts" + 1 >= 5 THEN ${new Date(now.getTime() + 15 * 60_000)}
                  ELSE "lockedUntil"
                END,
                "updatedAt" = ${now}
            WHERE "id" = ${reviewer.id}
          `;
          await tx.reviewAuditLog.create({
            data: {
              reviewerId: reviewer.id,
              action: "review.login_failed",
              resourceType: "review_auth",
              resourceId: reviewer.id,
              metadata: { ip: ip ?? null }
            }
          });
        });
      }
      throw new AppException("REVIEW_LOGIN_FAILED", "Invalid review credentials", HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reviewStaff.update({
        where: { id: reviewer.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now }
      });
      await tx.reviewAuditLog.create({
        data: {
          reviewerId: reviewer.id,
          action: "review.login",
          resourceType: "review_auth",
          resourceId: reviewer.id,
          metadata: { ip: ip ?? null }
        }
      });
    });

    const identity = this.toIdentity(reviewer);
    const tokens = await this.issueTokens(identity);
    return { ...tokens, reviewer: identity };
  }

  async refresh(refreshToken: string): Promise<ReviewAuthTokens & { reviewer: AuthenticatedReviewer }> {
    let payload: { sub?: string; kind?: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow<string>("REVIEW_JWT_REFRESH_SECRET"),
        audience: REVIEW_TOKEN_AUDIENCE
      }) as { sub?: string; kind?: string };
    } catch {
      throw new AppException("REVIEW_UNAUTHORIZED", "Invalid review refresh token", HttpStatus.UNAUTHORIZED);
    }
    if (!payload.sub || payload.kind !== REVIEW_TOKEN_KIND) {
      throw new AppException("REVIEW_UNAUTHORIZED", "Invalid review refresh token", HttpStatus.UNAUTHORIZED);
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.reviewSession.findUnique({ where: { tokenHash } });
    if (!stored || stored.reviewerId !== payload.sub || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppException("REVIEW_UNAUTHORIZED", "Review refresh token has been revoked or expired", HttpStatus.UNAUTHORIZED);
    }
    const revoked = await this.prisma.reviewSession.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (revoked.count !== 1) {
      throw new AppException("REVIEW_UNAUTHORIZED", "Review refresh token has already been used", HttpStatus.UNAUTHORIZED);
    }

    const reviewer = await this.prisma.reviewStaff.findUnique({ where: { id: payload.sub } });
    if (!reviewer || reviewer.status !== "active") {
      throw new AppException("REVIEW_ACCOUNT_UNAVAILABLE", "Review account is unavailable", HttpStatus.FORBIDDEN);
    }
    const identity = this.toIdentity(reviewer);
    return { ...(await this.issueTokens(identity)), reviewer: identity };
  }

  async logout(reviewerId: string, refreshToken: string): Promise<void> {
    await this.prisma.reviewSession.updateMany({
      where: { reviewerId, tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  private async issueTokens(reviewer: AuthenticatedReviewer): Promise<ReviewAuthTokens> {
    const accessTtl = this.config.get<string>("REVIEW_JWT_ACCESS_TTL", "15m");
    const refreshTtl = this.config.get<string>("REVIEW_JWT_REFRESH_TTL", "8h");
    const accessToken = this.jwt.sign(
      { sub: reviewer.id, role: reviewer.role, kind: REVIEW_TOKEN_KIND, jti: randomUUID() },
      {
        secret: this.config.getOrThrow<string>("REVIEW_JWT_ACCESS_SECRET"),
        expiresIn: accessTtl as any,
        audience: REVIEW_TOKEN_AUDIENCE
      }
    );
    const refreshToken = this.jwt.sign(
      { sub: reviewer.id, kind: REVIEW_TOKEN_KIND, jti: randomUUID() },
      {
        secret: this.config.getOrThrow<string>("REVIEW_JWT_REFRESH_SECRET"),
        expiresIn: refreshTtl as any,
        audience: REVIEW_TOKEN_AUDIENCE
      }
    );
    const refreshTtlMs = this.parseTtlToMs(refreshTtl);
    await this.prisma.reviewSession.create({
      data: {
        reviewerId: reviewer.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs)
      }
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(this.parseTtlToMs(accessTtl) / 1000)
    };
  }

  private toIdentity(reviewer: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  }): AuthenticatedReviewer {
    return {
      id: reviewer.id,
      username: reviewer.username,
      displayName: reviewer.displayName,
      role: reviewer.role as ReviewStaffRole
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private parseTtlToMs(ttl: string): number {
    const match = ttl.match(/^(\d+)(s|m|h|d)$/);
    if (!match) {
      throw new Error("Review JWT TTL must use a positive integer followed by s, m, h, or d");
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return amount * multiplier;
  }
}
