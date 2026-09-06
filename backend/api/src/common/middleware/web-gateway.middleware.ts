import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class WebGatewayMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const expected = this.config.get<string>("WEB_GATEWAY_SECRET", "");
    if (!expected) return next();
    const path = (req.originalUrl || req.url).split("?")[0].replace(/\/+$/, "");
    if (req.method === "GET" && path === "/api/v1/health") return next();
    const supplied = req.headers["x-talktalk-web-gateway"];
    const matches = typeof supplied === "string" && timingSafeEqual(
      createHash("sha256").update(supplied).digest(),
      createHash("sha256").update(expected).digest()
    );
    if (!matches || expected.length < 32) {
      return res.status(403).json({ error: { code: "GATEWAY_REQUIRED", message: "请从 Talk&Talk 网页入口访问" } });
    }
    // Public callers must never supply trusted WeChat platform identity.
    for (const key of Object.keys(req.headers)) {
      if (key.startsWith("x-wx-")) delete req.headers[key];
    }
    next();
  }
}
