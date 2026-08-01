import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";
import {
  DATA_RIGHTS_REQUEST_STATUSES,
  DataRightsRequestStatusValue,
  INVOICE_REQUEST_STATUSES,
  InvoiceRequestStatusValue
} from "./list-governance-requests.dto";

const EVIDENCE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export class TransitionDataRightsRequestDto {
  @IsIn(DATA_RIGHTS_REQUEST_STATUSES)
  expectedStatus!: DataRightsRequestStatusValue;

  @IsIn(DATA_RIGHTS_REQUEST_STATUSES)
  nextStatus!: DataRightsRequestStatusValue;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(EVIDENCE_REFERENCE)
  resolutionEvidenceReference?: string;
}

export class TransitionInvoiceRequestDto {
  @IsIn(INVOICE_REQUEST_STATUSES)
  expectedStatus!: InvoiceRequestStatusValue;

  @IsIn(INVOICE_REQUEST_STATUSES)
  nextStatus!: InvoiceRequestStatusValue;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(EVIDENCE_REFERENCE)
  evidenceReference?: string;
}
