import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedReviewer, REVIEW_TOKEN_AUDIENCE, REVIEW_TOKEN_KIND } from "../review-auth.types";

@Injectable()
export class ReviewJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined>; reviewer?: AuthenticatedReviewer }>();
    const header = request.headers?.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const token = value?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new AppException("REVIEW_UNAUTHORIZED", "Review authentication is required", HttpStatus.UNAUTHORIZED);
    }

    let payload: { sub?: string; role?: string; kind?: string };
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow<string>("REVIEW_JWT_ACCESS_SECRET"),
        audience: REVIEW_TOKEN_AUDIENCE
      }) as { sub?: string; role?: string; kind?: string };
    } catch {
      throw new AppException("REVIEW_UNAUTHORIZED", "Review session is invalid or expired", HttpStatus.UNAUTHORIZED);
    }

    if (!payload.sub || payload.kind !== REVIEW_TOKEN_KIND) {
      throw new AppException("REVIEW_UNAUTHORIZED", "Review session is invalid", HttpStatus.UNAUTHORIZED);
    }

    const reviewer = await this.prisma.reviewStaff.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, displayName: true, role: true, status: true }
    });
    if (!reviewer || reviewer.status !== "active") {
      throw new AppException("REVIEW_ACCOUNT_UNAVAILABLE", "Review account is unavailable", HttpStatus.FORBIDDEN);
    }

    request.reviewer = {
      id: reviewer.id,
      username: reviewer.username,
      displayName: reviewer.displayName,
      role: reviewer.role as AuthenticatedReviewer["role"]
    };
    return true;
  }
}
