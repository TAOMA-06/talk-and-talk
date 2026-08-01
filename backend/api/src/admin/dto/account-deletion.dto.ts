import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const ACTIVE_DELETION_REQUEST_STATUSES = ["pending", "processing"] as const;
export type ActiveDeletionRequestStatus = (typeof ACTIVE_DELETION_REQUEST_STATUSES)[number];

export class ListAccountDeletionRequestsDto {
  @IsOptional()
  @IsIn([...ACTIVE_DELETION_REQUEST_STATUSES])
  status?: ActiveDeletionRequestStatus;

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

export class ListAccountDeletionSettlementOrdersDto {
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

export class CompleteAccountDeletionDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}

export class RetryAccountDeletionDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
