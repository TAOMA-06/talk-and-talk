import { Transform, Type } from "class-transformer";
import {
  Equals,
  IsBoolean,
  IsDateString,
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

export const CUSTOMER_ADULT_ELIGIBILITY_METHODS = [
  "externalProvider",
  "governmentNetworkIdentity",
  "secureManualReview"
] as const;

export const CUSTOMER_ADULT_ELIGIBILITY_STATUSES = [
  "pending",
  "adult",
  "ineligible"
] as const;

export type CustomerAdultEligibilityMethodValue =
  (typeof CUSTOMER_ADULT_ELIGIBILITY_METHODS)[number];
export type CustomerAdultEligibilityStatusValue =
  (typeof CUSTOMER_ADULT_ELIGIBILITY_STATUSES)[number];

export class SubmitCustomerAdultEligibilityDto {
  @IsIn(CUSTOMER_ADULT_ELIGIBILITY_METHODS)
  verificationMethod!: CustomerAdultEligibilityMethodValue;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(7)
  @MaxLength(160)
  @Matches(/^(?!.*\d{10,})[A-Za-z][A-Za-z0-9._-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{4,127}$/)
  evidenceReference!: string;

  @IsBoolean()
  @Equals(true)
  evidenceProcessingConfirmed!: true;
}

export class ListCustomerAdultEligibilityDto {
  @IsOptional()
  @IsIn(CUSTOMER_ADULT_ELIGIBILITY_STATUSES)
  status: CustomerAdultEligibilityStatusValue = "pending";

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

export class MarkCustomerAdultDto {
  @IsDateString({ strict: true })
  validUntil!: string;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class MarkCustomerIneligibleDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
