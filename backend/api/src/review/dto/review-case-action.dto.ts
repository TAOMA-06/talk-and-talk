import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const REVIEW_CASE_ACTIONS = [
  "confirmViolation",
  "dismiss",
  "escalate",
  "approveMessage",
  "rejectMessage",
  "restrict24h",
  "restrict7d",
  "liftRestriction",
  "upholdAppeal",
  "overturnAppeal"
] as const;
export type ReviewCaseAction = (typeof REVIEW_CASE_ACTIONS)[number];

export class ReviewCaseActionDto {
  @IsIn([...REVIEW_CASE_ACTIONS])
  action!: ReviewCaseAction;

  @IsOptional()
  @IsString()
  @IsSafeOperationalText()
  @MaxLength(1000)
  note?: string;
}
