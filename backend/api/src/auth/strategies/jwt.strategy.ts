import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedUser } from "../auth.service";
import { isStaffUserRole } from "../staff-roles";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET")
    });
  }

  async validate(payload: {
    sub: string;
    role: string;
    sid?: string;
    kind?: string;
  }): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.sid || (payload.kind !== "consumer" && payload.kind !== "staff")) {
      throw new UnauthorizedException("Access token is missing required session assurance");
    }
    const user: any = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        staffCredential: { select: { status: true } }
      }
    } as any);
    if (!user) {
      // Deleted accounts must lose access immediately. Restricted and banned
      // states continue to the application guard, which applies read-only or
      // legal-self-service exceptions while blocking ordinary business routes.
      throw new UnauthorizedException("Account is unavailable");
    }
    const authenticationKind = payload.kind;
    if ((authenticationKind === "staff") !== isStaffUserRole(user.role)) {
      throw new UnauthorizedException("Authentication method is no longer valid for this account");
    }
    if (
      authenticationKind === "staff"
      && (user.accountStatus !== "active" || user.staffCredential?.status !== "active")
    ) {
      throw new UnauthorizedException("Staff credential has been suspended");
    }
    const now = new Date();
    const session = await this.prisma.refreshToken.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true
      }
    });
    if (
      !session
      || session.userId !== user.id
      || session.revokedAt
      || session.expiresAt <= now
    ) {
      throw new UnauthorizedException("Session has been revoked or expired");
    }
    if (session.lastUsedAt.getTime() < now.getTime() - 5 * 60_000) {
      await this.prisma.refreshToken.updateMany({
        where: { id: session.id, userId: user.id, revokedAt: null },
        data: { lastUsedAt: now }
      });
    }
    // Always use the current database role so a stale token cannot retain
    // administrator or moderator privileges after an operational change.
    return { id: user.id, role: user.role, sessionId: payload.sid };
  }
}
