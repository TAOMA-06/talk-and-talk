import { HttpStatus, Injectable, NestMiddleware, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Request, Response } from "express";
import Redis from "ioredis";

import { AppException } from "../errors/app.exception";
/**
 * Simple IP rate limit using Redis. Production authentication routes fail closed when Redis is
 * unavailable; ordinary routes and health checks remain available for diagnosis.
 */
@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware, OnModuleDestroy {
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(this.config.getOrThrow<string>("REDIS_URL"), {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false
      });
      this.redis.on("error", () => undefined);
    }
    return this.redis;
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
    this.redis = null;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const limit = this.config.get<number>("RATE_LIMIT_PER_MINUTE") ?? 120;
    const windowSeconds = 60;
    const ip = clientIp(req);
    const key = `rl:ip:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

    try {
      const redis = this.getRedis();
      if (redis.status !== "ready") {
        try {
          await redis.connect();
        } catch {
          this.handleRedisUnavailable(req, next);
          return;
        }
      }
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
      if (count > limit) {
        next(
          new AppException(
            "RATE_LIMITED",
            "Too many requests, please try again later",
            HttpStatus.TOO_MANY_REQUESTS
          )
        );
        return;
      }
    } catch {
      this.handleRedisUnavailable(req, next);
      return;
    }
    next();
  }

  private handleRedisUnavailable(req: Request, next: NextFunction): void {
    const appEnv = this.config.get<string>("APP_ENV", "development");
    if (shouldFailClosed(req, appEnv)) {
      next(
        new AppException(
          "RATE_LIMIT_UNAVAILABLE",
          "Authentication is temporarily unavailable, please try again later",
          HttpStatus.SERVICE_UNAVAILABLE
        )
      );
      return;
    }
    next();
  }
}

export function clientIp(req: Request): string {
  // Express computes req.ip from the configured trusted proxy chain. Reading X-Forwarded-For
  // directly would allow an internet client to choose its own rate-limit bucket.
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function shouldFailClosed(req: Request, appEnv: string): boolean {
  if (appEnv !== "production" || req.method.toUpperCase() !== "POST") {
    return false;
  }
  const path = req.originalUrl || req.url || "";
  return /(?:^|\/)auth\/(?:sms\/send-code|phone\/login|wechat\/mini-program|refresh)(?:[/?]|$)/.test(path);
}
