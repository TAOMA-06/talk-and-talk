import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SkipLegalConsent } from "../auth/decorators/skip-legal-consent.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AccountGovernanceService } from "./account-governance.service";
import { AddDataRightsFollowUpDto } from "./dto/add-data-rights-follow-up.dto";
import { CreateDataRightsRequestDto } from "./dto/create-data-rights-request.dto";
import { CreateInvoiceRequestDto } from "./dto/create-invoice-request.dto";
import { ListAccountSessionsDto } from "./dto/list-account-sessions.dto";
import {
  ListDataRightsRequestsDto,
  ListInvoiceEligibleOrdersDto,
  ListInvoiceRequestsDto
} from "./dto/list-governance-requests.dto";
import {
  CreateUserAccountAppealDto,
  ListUserAccountAppealsDto
} from "./dto/user-account-appeal.dto";
import { UserAccountActionsService } from "./user-account-actions.service";

@Controller("me")
@UseGuards(JwtAuthGuard)
export class AccountGovernanceController {
  constructor(
    private readonly governance: AccountGovernanceService,
    private readonly accountActions: UserAccountActionsService
  ) {}

  @Get("account-actions")
  @SkipLegalConsent()
  accountActionHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUserAccountAppealsDto = new ListUserAccountAppealsDto()
  ) {
    return this.accountActions.listMy(user.id, query);
  }

  @Post("account-actions/:id/appeals")
  @SkipLegalConsent()
  createAccountActionAppeal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") actionId: string,
    @Body() dto: CreateUserAccountAppealDto
  ) {
    return this.accountActions.createAppeal(user.id, actionId, dto);
  }

  @Get("sessions")
  @SkipLegalConsent()
  sessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAccountSessionsDto
  ) {
    return this.governance.listSessions(user.id, user.sessionId, query.page, query.pageSize);
  }

  @Delete("sessions")
  @SkipLegalConsent()
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.governance.revokeOtherSessions(user.id, user.sessionId);
  }

  @Delete("sessions/:id")
  @SkipLegalConsent()
  revokeSession(@CurrentUser() user: AuthenticatedUser, @Param("id") sessionId: string) {
    return this.governance.revokeSession(user.id, sessionId);
  }

  @Get("data-rights")
  @SkipLegalConsent()
  dataRights(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDataRightsRequestsDto = new ListDataRightsRequestsDto()
  ) {
    return this.governance.listMyDataRightsRequests(user.id, query);
  }

  @Post("data-rights")
  @SkipLegalConsent()
  createDataRights(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDataRightsRequestDto
  ) {
    return this.governance.createDataRightsRequest(user.id, dto);
  }

  @Post("data-rights/:id/follow-ups")
  @SkipLegalConsent()
  addDataRightsFollowUp(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: AddDataRightsFollowUpDto
  ) {
    return this.governance.addDataRightsFollowUp(user.id, requestId, dto);
  }

  @Get("invoice-requests")
  invoices(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvoiceRequestsDto = new ListInvoiceRequestsDto()
  ) {
    return this.governance.listMyInvoiceRequests(user.id, query);
  }

  @Get("invoice-requests/eligible-orders")
  invoiceEligibleOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvoiceEligibleOrdersDto = new ListInvoiceEligibleOrdersDto()
  ) {
    return this.governance.listInvoiceCandidateOrders(user.id, query);
  }

  @Post("invoice-requests")
  createInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceRequestDto
  ) {
    return this.governance.createInvoiceRequest(user.id, dto);
  }

  @Post("invoice-requests/:id/cancel")
  @SkipLegalConsent()
  cancelInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") requestId: string
  ) {
    return this.governance.cancelInvoiceRequest(user.id, requestId);
  }
}
