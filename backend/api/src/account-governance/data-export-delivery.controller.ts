import { Controller, Get, Header, Param, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SkipLegalConsent } from "../auth/decorators/skip-legal-consent.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DataExportDeliveryService } from "./data-export-delivery.service";

@Controller("me/data-rights")
@UseGuards(JwtAuthGuard)
export class DataExportDeliveryController {
  constructor(private readonly delivery: DataExportDeliveryService) {}

  @Get(":id/export")
  @SkipLegalConsent()
  @Header("Cache-Control", "private, no-store")
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") requestId: string,
    @Res() response: Response
  ) {
    const exportFile = await this.delivery.deliver(user.id, requestId);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", exportFile.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFile.filename}"`
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.send(exportFile.bytes);
  }
}
