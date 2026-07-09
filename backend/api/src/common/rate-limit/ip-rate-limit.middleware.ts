import { Injectable, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Request, Response } from "express";
import Redis from "ioredis";

import { AppException } from "../errors/app.exception";
import { HttpStatus } from "@nestjs/common";

/**
 * Simple IP rate limit using Redis. Fail-open if Redis is unavailable so health checks still work.
 */
@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware {
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
          next();
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
      // Fail open
    }
    next();
  }
}

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}
