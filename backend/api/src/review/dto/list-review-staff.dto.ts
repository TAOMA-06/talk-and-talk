import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min
} from "class-validator";

export const REVIEW_STAFF_ROLES = ["reviewer", "lead"] as const;
export const REVIEW_STAFF_STATUSES = ["active", "suspended"] as const;

class ReviewStaffPaginationQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "keyword must contain a non-whitespace character" })
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsIn([...REVIEW_STAFF_ROLES])
  role?: (typeof REVIEW_STAFF_ROLES)[number];

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

export class ListActiveReviewStaffQueryDto extends ReviewStaffPaginationQueryDto {
  @IsOptional()
  @IsIn(["active"])
  status: "active" = "active";
}

export class ListReviewStaffOffboardingQueryDto extends ReviewStaffPaginationQueryDto {
  @IsOptional()
  @IsIn([...REVIEW_STAFF_STATUSES])
  status?: (typeof REVIEW_STAFF_STATUSES)[number];
}
