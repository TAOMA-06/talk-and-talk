import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

const BILL_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const RUN_STATUSES = ["pending", "processing", "noStatement", "reconciled", "failed"] as const;
const ISSUE_STATUSES = ["open", "investigating", "resolved", "acceptedException"] as const;
const ISSUE_KINDS = [
  "providerStatementMissingWithLocalActivity",
  "providerPaymentMissingLocally",
  "paymentAmountMismatch",
  "paymentTransactionIdMismatch",
  "providerPaidLocalUnsettled",
  "localPaymentSuccessProviderNotPaid",
  "providerRefundMissingLocally",
  "refundAmountMismatch",
  "refundProviderIdMismatch",
  "providerRefundedLocalUnsettled",
  "localPaymentMissingProviderBill",
  "localRefundMissingProviderBill",
  "providerFundReferenceMissingLocally",
  "providerFundBusinessTypeUnreviewed",
  "providerFundAmountNotLocallyVerifiable",
  "providerFundBusinessBindingMismatch",
  "providerFundAccountMismatch",
  "providerFundDirectionMismatch",
  "providerFundAmountMismatch",
  "providerFundLocalUnsettled",
  "localPaymentMissingProviderFundBill",
  "localRefundMissingProviderFundBill",
  "localCashLedgerMissingProviderFundBill"
] as const;
const BILL_KINDS = ["tradeAll", "fundBasic", "fundOperation", "fundFees"] as const;

class ReconciliationPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export class CreateWeChatReconciliationRunsDto {
  @IsString()
  @Matches(BILL_DATE_PATTERN)
  billDate!: string;
}

export class SubmitWeChatMerchantBillImportDto {
  @IsString()
  @Matches(BILL_DATE_PATTERN)
  billDate!: string;

  @IsIn([...BILL_KINDS])
  kind!: (typeof BILL_KINDS)[number];

  /** Raw text exists only for this request and is never persisted or logged. */
  @IsString()
  @MinLength(1)
  @MaxLength(20 * 1024 * 1024)
  content!: string;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  contentSha256!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/)
  evidenceReference!: string;
}

export class ReviewWeChatMerchantBillImportDto {
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}

export class ListWeChatMerchantBillImportsDto extends ReconciliationPaginationDto {
  @IsOptional()
  @IsIn(["pending", "approved", "rejected"])
  status?: "pending" | "approved" | "rejected";
}

export class ListCashLedgerEntriesDto extends ReconciliationPaginationDto {
  @IsOptional()
  @IsIn(["unclassified", "classified"])
  classificationStatus?: "unclassified" | "classified";
}

export class SubmitCashLedgerClassificationDto {
  @IsIn(["BASIC", "OPERATION", "FEES"])
  accountType!: "BASIC" | "OPERATION" | "FEES";

  @IsString()
  @Matches(BILL_DATE_PATTERN)
  expectedStatementDate!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/)
  evidenceReference!: string;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  evidenceDigestSha256!: string;
}

export class ReviewCashLedgerClassificationDto {
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}

export class ListWeChatReconciliationRunsDto extends ReconciliationPaginationDto {
  @IsOptional()
  @IsIn([...RUN_STATUSES])
  status?: (typeof RUN_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Matches(BILL_DATE_PATTERN)
  billDate?: string;
}

export class ListWeChatReconciliationIssuesDto extends ReconciliationPaginationDto {
  @IsOptional()
  @IsIn([...ISSUE_STATUSES])
  status?: (typeof ISSUE_STATUSES)[number];

  @IsOptional()
  @IsIn([...ISSUE_KINDS])
  kind?: (typeof ISSUE_KINDS)[number];

  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  runId?: string;
}

export class SubmitWeChatReconciliationResolutionDto {
  @IsIn(["resolved", "acceptedException"])
  outcome!: "resolved" | "acceptedException";

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[A-Z][A-Z0-9_]{2,79}$/)
  resolutionCode!: string;

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/)
  evidenceReference!: string;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  evidenceDigestSha256!: string;
}

export class ReviewWeChatReconciliationResolutionDto {
  @IsIn(["approve", "reject"])
  decision!: "approve" | "reject";

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}
