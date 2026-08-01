import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { DataRetentionLegalHoldService } from "./data-retention-legal-hold.service";
import {
  ApproveDataRetentionLegalHoldActionDto,
  ListDataRetentionLegalHoldHistoryDto,
  ListDataRetentionLegalHoldRecordsDto,
  RejectDataRetentionLegalHoldActionDto,
  RequestDataRetentionLegalHoldActionDto
} from "./dto/data-retention-legal-hold.dto";

@Controller("admin/data-retention")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class DataRetentionLegalHoldController {
  constructor(private readonly legalHolds: DataRetentionLegalHoldService) {}

  @Get("legal-hold-policy")
  policyStatus(@CurrentUser() actor: AuthenticatedUser) {
    return this.legalHolds.policyStatus(actor);
  }

  @Get("records")
  listRecords(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListDataRetentionLegalHoldRecordsDto
  ) {
    return this.legalHolds.listRetentionRecords(actor, query);
  }

  @Get("records/:retentionRecordId/legal-holds")
  listHistory(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("retentionRecordId") retentionRecordId: string,
    @Query() query: ListDataRetentionLegalHoldHistoryDto
  ) {
    return this.legalHolds.listLegalHoldHistory(actor, retentionRecordId, query);
  }

  @Post("records/:retentionRecordId/legal-hold-placement-requests")
  @HttpCode(HttpStatus.OK)
  requestPlacement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("retentionRecordId") retentionRecordId: string,
    @Body() dto: RequestDataRetentionLegalHoldActionDto
  ) {
    return this.legalHolds.requestPlacement(actor, retentionRecordId, dto);
  }

  @Post("legal-holds/:legalHoldId/release-requests")
  @HttpCode(HttpStatus.OK)
  requestRelease(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("legalHoldId") legalHoldId: string,
    @Body() dto: RequestDataRetentionLegalHoldActionDto
  ) {
    return this.legalHolds.requestRelease(actor, legalHoldId, dto);
  }

  @Post("legal-hold-actions/:actionId/approvals")
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("actionId") actionId: string,
    @Body() dto: ApproveDataRetentionLegalHoldActionDto
  ) {
    return this.legalHolds.approveAction(actor, actionId, dto);
  }

  @Post("legal-hold-actions/:actionId/rejections")
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("actionId") actionId: string,
    @Body() dto: RejectDataRetentionLegalHoldActionDto
  ) {
    return this.legalHolds.rejectAction(actor, actionId, dto);
  }
}
