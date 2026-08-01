import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const IDENTITY_VERIFICATION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected"
] as const;

export type IdentityVerificationRequestStatusValue =
  (typeof IDENTITY_VERIFICATION_REQUEST_STATUSES)[number];

export class ListIdentityVerificationRequestsDto {
  @IsOptional()
  @IsIn(IDENTITY_VERIFICATION_REQUEST_STATUSES)
  status: IdentityVerificationRequestStatusValue = "pending";

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

export class ReviewIdentityVerificationRequestDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
