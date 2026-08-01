import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";

import { AuthenticatedUser } from "../../auth/auth.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  CreateWeChatReconciliationRunsDto,
  ListCashLedgerEntriesDto,
  ListWeChatMerchantBillImportsDto,
  ListWeChatReconciliationIssuesDto,
  ListWeChatReconciliationRunsDto,
  ReviewWeChatMerchantBillImportDto,
  ReviewCashLedgerClassificationDto,
  ReviewWeChatReconciliationResolutionDto,
  SubmitWeChatMerchantBillImportDto,
  SubmitCashLedgerClassificationDto,
  SubmitWeChatReconciliationResolutionDto
} from "../../payments/dto/wechat-daily-reconciliation.dto";
import { WeChatDailyReconciliationService } from "../../payments/wechat-daily-reconciliation.service";

@Controller("admin/commercial/payment-reconciliation")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("finance", "admin")
export class AdminPaymentReconciliationController {
  constructor(private readonly reconciliation: WeChatDailyReconciliationService) {}

  @Get("readiness")
  readiness() {
    return this.reconciliation.readiness();
  }

  @Get("merchant-imports")
  merchantImports(@Query() query: ListWeChatMerchantBillImportsDto) {
    return this.reconciliation.listMerchantBillImports(query);
  }

  @Post("merchant-imports")
  @HttpCode(200)
  submitMerchantImport(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SubmitWeChatMerchantBillImportDto
  ) {
    return this.reconciliation.submitMerchantBillImport(actor, dto);
  }

  @Post("merchant-imports/text")
  @HttpCode(200)
  submitMerchantTextImport(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() content: string,
    @Headers("x-wechat-bill-date") billDate: string,
    @Headers("x-wechat-bill-kind") kind: string,
    @Headers("x-content-sha256") contentSha256: string,
    @Headers("x-evidence-reference") evidenceReference: string
  ) {
    return this.reconciliation.submitMerchantBillImport(actor, {
      billDate,
      kind: kind as any,
      content,
      contentSha256,
      evidenceReference
    });
  }

  @Post("merchant-imports/:id/reviews")
  @HttpCode(200)
  reviewMerchantImport(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: ReviewWeChatMerchantBillImportDto
  ) {
    return this.reconciliation.reviewMerchantBillImport(actor, id, dto);
  }

  @Get("cash-ledger")
  cashLedger(@Query() query: ListCashLedgerEntriesDto) {
    return this.reconciliation.listCashLedgerEntries(query);
  }

  @Post("cash-ledger/:id/classifications")
  @HttpCode(200)
  submitCashLedgerClassification(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: SubmitCashLedgerClassificationDto
  ) {
    return this.reconciliation.submitCashLedgerClassification(actor, id, dto);
  }

  @Post("cash-ledger/classifications/:id/reviews")
  @HttpCode(200)
  reviewCashLedgerClassification(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: ReviewCashLedgerClassificationDto
  ) {
    return this.reconciliation.reviewCashLedgerClassification(actor, id, dto);
  }

  @Get("runs")
  runs(@Query() query: ListWeChatReconciliationRunsDto) {
    return this.reconciliation.listRuns(query);
  }

  @Post("runs")
  @HttpCode(200)
  createRuns(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateWeChatReconciliationRunsDto
  ) {
    return this.reconciliation.createRuns(actor, dto.billDate);
  }

  @Post("runs/:id/retry")
  @HttpCode(200)
  retryRun(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string
  ) {
    return this.reconciliation.retryRun(actor, id);
  }

  @Get("issues")
  issues(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListWeChatReconciliationIssuesDto
  ) {
    return this.reconciliation.listIssues(actor, query);
  }

  @Post("issues/:id/claims")
  @HttpCode(200)
  claimIssue(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string
  ) {
    return this.reconciliation.claimIssue(actor, id);
  }

  @Post("issues/:id/resolutions")
  @HttpCode(200)
  submitResolution(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: SubmitWeChatReconciliationResolutionDto
  ) {
    return this.reconciliation.submitResolutionProposal(actor, id, dto);
  }

  @Post("issues/:id/resolution-reviews")
  @HttpCode(200)
  reviewResolution(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: ReviewWeChatReconciliationResolutionDto
  ) {
    return this.reconciliation.reviewResolutionProposal(actor, id, dto);
  }
}
