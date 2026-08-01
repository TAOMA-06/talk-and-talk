import { Controller, Get, Header } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Login-independent support discovery.
 *
 * This endpoint deliberately contains no ticket or user data. It stays
 * reachable when a consumer cannot complete login, legal-consent refresh, or
 * an authenticated support request, so account/payment complaints never depend
 * on the path that is being reported as broken.
 */
@Controller("support")
export class PublicSupportController {
  constructor(private readonly config: ConfigService) {}

  @Get("public-info")
  @Header("Cache-Control", "public, max-age=300, stale-while-revalidate=600")
  info() {
    const responseHours = this.config.getOrThrow<number>("SUPPORT_RESPONSE_HOURS");
    return {
      operatorName: this.config.getOrThrow<string>("LEGAL_OPERATOR_NAME"),
      channel: this.config.getOrThrow<string>("LEGAL_COMPLAINT_CHANNEL"),
      email: this.config.getOrThrow<string>("LEGAL_CONTACT_EMAIL"),
      phone: this.config.getOrThrow<string>("LEGAL_CONTACT_PHONE"),
      serviceHours: this.config.getOrThrow<string>("SUPPORT_PUBLIC_SERVICE_HOURS"),
      expectedFirstResponseHours: responseHours,
      statusUrl: this.config.get<string>("SUPPORT_PUBLIC_STATUS_URL") || null,
      authenticatedTicketPath: "/support/tickets",
      ticketAccessRequiresLogin: true,
      emergencyBoundary:
        "本服务不是急救、医疗诊断或心理治疗服务；如存在人身危险、急性医疗或自伤风险，请立即联系所在地紧急服务或专业机构。"
    };
  }
}
