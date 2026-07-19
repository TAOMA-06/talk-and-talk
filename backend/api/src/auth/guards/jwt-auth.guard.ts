import { ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";

import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../database/prisma.service";
import { SKIP_LEGAL_CONSENT_KEY } from "../decorators/skip-legal-consent.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = await super.canActivate(context);
    if (!authenticated) {
      return false;
    }

    const request = context.switchToHttp().getRequest<{ user?: { id?: string; role?: string } }>();
    const userId = request.user?.id;
    if (!userId) {
      throw new AppException("UNAUTHORIZED", "Authentication required", HttpStatus.UNAUTHORIZED);
    }
    const skipConsent = this.reflector.getAllAndOverride<boolean>(SKIP_LEGAL_CONSENT_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, accountStatus: true }
    });
    if (!currentUser) {
      throw new AppException("UNAUTHORIZED", "User no longer exists", HttpStatus.UNAUTHORIZED);
    }
    request.user!.role = currentUser.role;
    if (!skipConsent && currentUser.accountStatus === "banned") {
      throw new AppException("ACCOUNT_BANNED", "Account has been banned", HttpStatus.FORBIDDEN);
    }
    const method = context.switchToHttp().getRequest<{ method?: string }>().method?.toUpperCase();
    if (
      !skipConsent &&
      currentUser.accountStatus === "restricted" &&
      method !== "GET" && method !== "HEAD" && method !== "OPTIONS"
    ) {
      throw new AppException("ACCOUNT_RESTRICTED", "Account is restricted", HttpStatus.FORBIDDEN);
    }
    if (skipConsent) {
      return true;
    }
    if (currentUser.role === "admin" || currentUser.role === "moderator") {
      return true;
    }

    const version = this.config.getOrThrow<string>("LEGAL_CONSENT_VERSION");
    const privacyUrl = this.config.getOrThrow<string>("LEGAL_PRIVACY_URL");
    const termsUrl = this.config.getOrThrow<string>("LEGAL_TERMS_URL");
    const receipt = await this.prisma.legalConsentReceipt.findFirst({
      where: { userId, version, withdrawnAt: null },
      orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
    });
    const valid =
      receipt?.privacyAccepted === true &&
      receipt?.termsAccepted === true &&
      receipt?.adultConfirmed === true &&
      receipt?.source === "wechatMiniProgram" &&
      receipt?.privacyVersion === version &&
      receipt?.termsVersion === version &&
      receipt?.privacyUrl === privacyUrl &&
      receipt?.termsUrl === termsUrl;
    if (!valid) {
      throw new AppException(
        "LEGAL_CONSENT_REQUIRED",
        "Current user agreement and privacy policy consent is required",
        HttpStatus.FORBIDDEN
      );
    }
    return true;
  }
}
