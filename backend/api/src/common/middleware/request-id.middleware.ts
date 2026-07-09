import { randomUUID } from "node:crypto";

import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

import type { RequestWithId } from "./request-with-id";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    const header = req.header("x-request-id");
    const requestId = header && header.trim().length > 0 ? header.trim() : randomUUID();

    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  }
}
