import { HttpStatus, Injectable, NestMiddleware, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Request, Response } from "express";
import Redis from "ioredis";

import { AppException } from "../errors/app.exception";
/**
 * Simple IP rate limit using Redis. External environments fail closed on sensitive
 * write routes when Redis is unavailable; ordinary routes and health checks remain
 * available for diagnosis.
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
    // WeChat payment callbacks share egress IPs and may burst retries. Do not
    // share the generic client rate-limit bucket with them.
    if (isWeChatPaymentCallback(req)) {
      next();
      return;
    }
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
          "Service is temporarily unavailable, please try again later",
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
  if ((appEnv !== "production" && appEnv !== "staging") || req.method.toUpperCase() !== "POST") {
    return false;
  }
  const path = req.originalUrl || req.url || "";
  return SENSITIVE_POST_PATH.test(path);
}

export function isWeChatPaymentCallback(req: Request): boolean {
  if (req.method.toUpperCase() !== "POST") return false;
  const path = req.originalUrl || req.url || "";
  return WECHAT_PAYMENT_CALLBACK_PATH.test(path);
}

/**
 * Auth/login, order create/prepay/payment sync/refund, and upload reserve paths.
 * Keep review auth protection and extend commercial write paths.
 */
const SENSITIVE_POST_PATH =
  /(?:^|\/)(?:auth\/(?:sms\/send-code|phone\/login|wechat\/mini-program|refresh)|review\/auth\/(?:login|refresh)|orders(?:$|[/?])|conversations\/[^/]+\/media-uploads(?:$|[/?])|support\/tickets\/[^/]+\/evidence-uploads(?:$|[/?])|attendance-disputes\/[^/]+\/evidence-uploads(?:$|[/?])|commercial\/companion\/incident-evidence-uploads(?:$|[/?])|case-evidence\/uploads(?:$|[/?]))/;

/** Provider callbacks — bypass generic IP buckets; edge allowlists remain recommended. */
const WECHAT_PAYMENT_CALLBACK_PATH =
  /(?:^|\/)payments\/wechat\/(?:notify|refund-notify|complaints(?:$|[/?]))/;
