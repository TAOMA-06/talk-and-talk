import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AccountGovernanceService } from "./account-governance.service";
import {
  ListDataRightsRequestsDto,
  ListInvoiceRequestsDto
} from "./dto/list-governance-requests.dto";
import {
  TransitionDataRightsRequestDto,
  TransitionInvoiceRequestDto
} from "./dto/transition-governance-request.dto";
import {
  AssignUserAccountAppealDto,
  ListUserAccountAppealsDto,
  ResolveUserAccountAppealDto
} from "./dto/user-account-appeal.dto";
import { UserAccountActionsService } from "./user-account-actions.service";

@Controller("admin/account-governance")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountGovernanceAdminController {
  constructor(
    private readonly governance: AccountGovernanceService,
    private readonly accountActions: UserAccountActionsService
  ) {}

  @Get("account-appeals")
  @Roles("admin")
  accountAppeals(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListUserAccountAppealsDto
  ) {
    return this.accountActions.listAdmin(actor.id, query);
  }

  @Post("account-appeals/:id/claim")
  @Roles("admin")
  claimAccountAppeal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") appealId: string
  ) {
    return this.accountActions.claim(actor.id, appealId);
  }

  @Post("account-appeals/:id/assign")
  @Roles("admin")
  assignAccountAppeal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") appealId: string,
    @Body() dto: AssignUserAccountAppealDto
  ) {
    return this.accountActions.assign(actor.id, appealId, dto);
  }

  @Post("account-appeals/:id/resolve")
  @Roles("admin")
  resolveAccountAppeal(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") appealId: string,
    @Body() dto: ResolveUserAccountAppealDto
  ) {
    return this.accountActions.resolve(actor.id, appealId, dto);
  }

  @Get("data-rights")
  @Roles("support", "admin")
  dataRights(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListDataRightsRequestsDto
  ) {
    return this.governance.listDataRightsForAdmin(actor.id, actor.role, query);
  }

  @Get("data-rights/claimable")
  @Roles("support")
  claimableDataRights(@Query() query: ListDataRightsRequestsDto) {
    return this.governance.listClaimableDataRights(query);
  }

  @Patch("data-rights/:id/claim")
  @Roles("support", "admin")
  claimDataRights(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string
  ) {
    return this.governance.claimDataRightsRequest(actor.id, actor.role, requestId);
  }

  @Patch("data-rights/:id/status")
  @Roles("support", "admin")
  transitionDataRights(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: TransitionDataRightsRequestDto
  ) {
    return this.governance.transitionDataRightsRequest(
      actor.id,
      actor.role,
      requestId,
      dto
    );
  }

  @Get("invoice-requests")
  @Roles("finance", "admin")
  invoices(@Query() query: ListInvoiceRequestsDto) {
    return this.governance.listInvoicesForAdmin(query);
  }

  @Patch("invoice-requests/:id/status")
  @Roles("finance", "admin")
  transitionInvoice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") requestId: string,
    @Body() dto: TransitionInvoiceRequestDto
  ) {
    return this.governance.transitionInvoiceRequest(actor.id, requestId, dto);
  }
}
