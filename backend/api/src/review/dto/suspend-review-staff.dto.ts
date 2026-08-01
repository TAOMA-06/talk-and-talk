import { IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const REVIEW_STAFF_HANDOFF_MODES = ["reassign", "unassign"] as const;
export type ReviewStaffHandoffMode = (typeof REVIEW_STAFF_HANDOFF_MODES)[number];

export class SuspendReviewStaffDto {
  @IsIn([...REVIEW_STAFF_HANDOFF_MODES])
  handoffMode!: ReviewStaffHandoffMode;

  @ValidateIf((dto: SuspendReviewStaffDto) =>
    dto.handoffMode === "reassign" || dto.replacementReviewerId !== undefined
  )
  @IsUUID()
  replacementReviewerId?: string;

  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
