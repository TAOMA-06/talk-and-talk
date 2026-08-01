import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Matches
} from "class-validator";

import { ACCOUNT_DELETION_RETENTION_CATEGORIES } from "../../common/account-deletion-retention-policy";

export const DATA_RETENTION_LEGAL_HOLD_ACTIONS = ["placement", "release"] as const;
export type DataRetentionLegalHoldAction =
  (typeof DATA_RETENTION_LEGAL_HOLD_ACTIONS)[number];

export const DATA_RETENTION_LEGAL_HOLD_ACTION_STATUSES = [
  "pending",
  "approved",
  "rejected"
] as const;
export type DataRetentionLegalHoldActionStatus =
  (typeof DATA_RETENTION_LEGAL_HOLD_ACTION_STATUSES)[number];

export const DATA_RETENTION_LEGAL_HOLD_STATES = [
  "none",
  "placementPending",
  "active",
  "releasePending",
  "released"
] as const;
export type DataRetentionLegalHoldState =
  (typeof DATA_RETENTION_LEGAL_HOLD_STATES)[number];

export const DATA_RETENTION_CATEGORIES = ACCOUNT_DELETION_RETENTION_CATEGORIES.map(
  (category) => category.code
);

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const AUTHORITY_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/;
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

export class DataRetentionLegalHoldPaginationDto {
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

export class ListDataRetentionLegalHoldRecordsDto extends DataRetentionLegalHoldPaginationDto {
  @IsOptional()
  @IsIn([...DATA_RETENTION_CATEGORIES])
  category?: (typeof DATA_RETENTION_CATEGORIES)[number];

  @IsOptional()
  @IsIn([...DATA_RETENTION_LEGAL_HOLD_STATES])
  holdState?: DataRetentionLegalHoldState;

  @IsOptional()
  @IsIn(["pending", "partiallyErased", "processed"])
  expiryState?: "pending" | "partiallyErased" | "processed";
}

export class ListDataRetentionLegalHoldHistoryDto extends DataRetentionLegalHoldPaginationDto {
  @IsOptional()
  @IsIn([...DATA_RETENTION_LEGAL_HOLD_ACTIONS])
  action?: DataRetentionLegalHoldAction;

  @IsOptional()
  @IsIn([...DATA_RETENTION_LEGAL_HOLD_ACTION_STATUSES])
  status?: DataRetentionLegalHoldActionStatus;
}

export class RequestDataRetentionLegalHoldActionDto {
  @IsString()
  @Matches(REASON_CODE_PATTERN)
  reasonCode!: string;

  @IsString()
  @Matches(AUTHORITY_REFERENCE_PATTERN)
  authorityReference!: string;

  @IsString()
  @Matches(CLIENT_REQUEST_ID_PATTERN)
  clientRequestId!: string;
}

export class ApproveDataRetentionLegalHoldActionDto {
  @IsString()
  @Matches(AUTHORITY_REFERENCE_PATTERN)
  decisionReference!: string;
}

export class RejectDataRetentionLegalHoldActionDto {
  @IsString()
  @Matches(AUTHORITY_REFERENCE_PATTERN)
  decisionReference!: string;

  @IsString()
  @Matches(REASON_CODE_PATTERN)
  decisionReasonCode!: string;
}
