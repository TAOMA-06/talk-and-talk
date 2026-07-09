import { performance } from "node:perf_hooks";

import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import type { RequestWithId } from "../common/middleware/request-with-id";
import { MetricsService } from "./metrics.service";

@Injectable()
export class RequestMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: RequestWithId, res: Response, next: NextFunction) {
    const start = performance.now();

    res.on("finish", () => {
      const durationMs = Math.max(0, Math.round(performance.now() - start));
      this.metrics.recordRequest(durationMs, res.statusCode);
      const payload = {
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        type: "http_request",
        requestId: req.requestId ?? "unknown",
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs
      };
      console.log(JSON.stringify(payload));
    });

    next();
  }
}