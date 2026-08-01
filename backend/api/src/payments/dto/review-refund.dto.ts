import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const REFUND_REVIEW_QUEUE_STATUSES = ["pendingReview", "pending", "processing", "failed"] as const;
export type RefundReviewQueueStatus = (typeof REFUND_REVIEW_QUEUE_STATUSES)[number];

export class ListRefundReviewQueueDto {
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

  @IsOptional()
  @IsIn([...REFUND_REVIEW_QUEUE_STATUSES])
  status?: RefundReviewQueueStatus;
}

export class ReviewRefundDto {
  @IsOptional()
  @IsString()
  @IsSafeOperationalText()
  @MaxLength(500)
  note?: string;
}

export class RejectRefundDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}
