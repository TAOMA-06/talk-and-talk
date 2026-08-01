import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../../auth/auth.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { ControlledCaseEvidenceService } from "./controlled-case-evidence.service";
import { ReserveControlledCaseEvidenceDto } from "./dto/reserve-controlled-case-evidence.dto";

@Controller()
@UseGuards(JwtAuthGuard)
export class ControlledCaseEvidenceController {
  constructor(private readonly evidence: ControlledCaseEvidenceService) {}

  @Post("support/tickets/:id/evidence-uploads")
  reserveSupport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") ticketId: string,
    @Body() dto: ReserveControlledCaseEvidenceDto
  ) {
    return this.evidence.reserveForSupport(user, ticketId, dto);
  }

  @Post("attendance-disputes/:id/evidence-uploads")
  reserveAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") disputeId: string,
    @Body() dto: ReserveControlledCaseEvidenceDto
  ) {
    return this.evidence.reserveForAttendance(user.id, disputeId, dto);
  }

  @Post("commercial/companion/incident-evidence-uploads")
  reserveCompanionIncident(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReserveControlledCaseEvidenceDto
  ) {
    return this.evidence.reserveForCompanionIncident(user.id, dto);
  }

  @Post("case-evidence/uploads/:assetId/complete")
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string
  ) {
    return this.evidence.complete(user.id, assetId);
  }

  @Get("case-evidence/uploads/:assetId")
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string
  ) {
    return this.evidence.status(user.id, assetId);
  }

  @Get("case-evidence/attachments/:attachmentId/read-url")
  readUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param("attachmentId") attachmentId: string
  ) {
    return this.evidence.createReadUrl(user, attachmentId);
  }
}
