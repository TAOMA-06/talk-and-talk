import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { Request } from "express";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AttendanceDisputesService } from "./attendance-disputes.service";
import {
  CreateAttendanceDisputeDto,
  DecideAttendanceDisputeDto,
  FinalizeAttendanceDisputeDto,
  ListAttendanceDisputesDto,
  ReportClientAttendanceEventDto,
  SubmitAttendanceStatementDto
} from "./dto/attendance-dispute.dto";

type RawRequest = Request & { rawBody?: Buffer };

@Controller()
export class AttendanceDisputesController {
  constructor(private readonly disputes: AttendanceDisputesService) {}

  @Get("attendance-disputes/policy")
  policy() {
    return this.disputes.policy();
  }

  @Post("callbacks/trtc/room-events")
  @HttpCode(HttpStatus.OK)
  trtcCallback(
    @Req() request: RawRequest,
    @Headers("sign") signature?: string,
    @Headers("sdkappid") sdkAppId?: string
  ) {
    return this.disputes.ingestTrtcCallback(request.rawBody, signature, sdkAppId);
  }

  @Post("orders/:orderId/attendance-events")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  reportClientEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId") orderId: string,
    @Body() dto: ReportClientAttendanceEventDto
  ) {
    return this.disputes.reportClientEvent(user.id, orderId, dto);
  }

  @Post("orders/:orderId/attendance-disputes")
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId") orderId: string,
    @Body() dto: CreateAttendanceDisputeDto
  ) {
    return this.disputes.create(user, orderId, dto);
  }

  @Get("orders/:orderId/attendance-disputes/me")
  @UseGuards(JwtAuthGuard)
  getMineByOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId") orderId: string
  ) {
    return this.disputes.getMineByOrder(user.id, orderId);
  }

  @Get("attendance-disputes/mine")
  @UseGuards(JwtAuthGuard)
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAttendanceDisputesDto
  ) {
    return this.disputes.listMine(user.id, query);
  }

  @Get("attendance-disputes/:id")
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.getForParticipant(user.id, id);
  }

  @Post("attendance-disputes/:id/evidence-completion")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  completeEvidence(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.completeEvidence(user.id, id);
  }

  @Post("attendance-disputes/:id/statements")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  submitStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SubmitAttendanceStatementDto
  ) {
    return this.disputes.submitStatement(user.id, id, dto);
  }

  @Post("attendance-disputes/:id/appeals")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  appeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: SubmitAttendanceStatementDto
  ) {
    return this.disputes.appeal(user.id, id, dto);
  }
}

@Controller("admin/commercial/attendance-disputes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("support", "admin")
export class AdminAttendanceDisputesController {
  constructor(private readonly disputes: AttendanceDisputesService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListAttendanceDisputesDto) {
    return this.disputes.listAdmin(actor, query);
  }

  @Get("claimable")
  claimable(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListAttendanceDisputesDto) {
    return this.disputes.listClaimable(actor, query);
  }

  @Get(":id")
  get(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.getForStaff(actor, id);
  }

  @Post(":id/claims")
  @HttpCode(HttpStatus.OK)
  claim(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.claim(actor, id);
  }

  @Post(":id/decisions")
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: DecideAttendanceDisputeDto
  ) {
    return this.disputes.decide(actor, id, dto);
  }

  @Post(":id/appeal-claims")
  @HttpCode(HttpStatus.OK)
  claimAppeal(@CurrentUser() actor: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.claimAppeal(actor, id);
  }

  @Post(":id/finalizations")
  @HttpCode(HttpStatus.OK)
  finalize(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: FinalizeAttendanceDisputeDto
  ) {
    return this.disputes.finalize(actor, id, dto);
  }
}
