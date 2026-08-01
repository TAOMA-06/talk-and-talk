import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SkipLegalConsent } from "../auth/decorators/skip-legal-consent.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CrisisInterventionService } from "./crisis-intervention.service";
import {
  CreateCrisisInterventionDto,
  CrisisResourcesQueryDto
} from "./dto/crisis-intervention.dto";

@Controller("crisis")
export class CrisisInterventionController {
  constructor(private readonly crisis: CrisisInterventionService) {}

  @Get("resources")
  resources(@Query() query: CrisisResourcesQueryDto) {
    return this.crisis.resources(query.region ?? "CN");
  }

  @Get("readiness")
  readiness(@Res({ passthrough: true }) response: Response) {
    const readiness = this.crisis.readiness();
    response.status(readiness.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return readiness;
  }

  @Post("interventions")
  @UseGuards(JwtAuthGuard)
  @SkipLegalConsent()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCrisisInterventionDto
  ) {
    return this.crisis.create(user.id, dto);
  }

  @Get("interventions/active")
  @UseGuards(JwtAuthGuard)
  @SkipLegalConsent()
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.crisis.active(user.id);
  }

  @Get("interventions/:id")
  @UseGuards(JwtAuthGuard)
  @SkipLegalConsent()
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.crisis.getOwned(user.id, id);
  }

  @Post("interventions/:id/resource-view-completions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @SkipLegalConsent()
  completeResourceView(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string
  ) {
    return this.crisis.completeResourceView(user.id, id);
  }
}
