import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedUser } from "../auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET")
    });
  }

  async validate(payload: { sub: string; role: string }): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, accountStatus: true }
    });
    if (!user) {
      // Deleted accounts must lose access immediately. Restricted and banned
      // states continue to the application guard, which applies read-only or
      // legal-self-service exceptions while blocking ordinary business routes.
      throw new UnauthorizedException("Account is unavailable");
    }
    // Always use the current database role so a stale token cannot retain
    // administrator or moderator privileges after an operational change.
    return { id: user.id, role: user.role };
  }
}
