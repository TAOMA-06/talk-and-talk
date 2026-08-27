import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import { Type } from "class-transformer";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

const EXTERNAL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const MASKED_REFERENCE = /^[A-Za-z0-9*._\-\s]{3,80}$/;

export class SubmitTrainingAttemptDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  moduleCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  moduleVersion!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsIn(["A", "B", "C", "D"], { each: true })
  answers!: string[];
}

export class CreateCompanionAppealDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  statement!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  evidenceAssetIds?: string[];
}

export class CreateCompanionIncidentDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsIn(["technicalIssue", "lateArrival", "noShow", "harassment", "safetyBoundary", "other"])
  category!: "technicalIssue" | "lateArrival" | "noShow" | "harassment" | "safetyBoundary" | "other";

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  summary!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  evidenceAssetIds?: string[];
}

export class CreateWithdrawalRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  earningIds!: string[];
}

export class CreateCompanionAccountActionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  @Matches(/^[^\u0000-\u001F\u007F]+$/)
  companionId!: string;

  @IsIn(["warning", "serviceRestriction", "suspension"])
  kind!: "warning" | "serviceRestriction" | "suspension";

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  reasonCode!: string;

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class ResolveCompanionAppealDto {
  @IsIn(["upheld", "overturned", "dismissed"])
  status!: "upheld" | "overturned" | "dismissed";

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  resolution!: string;
}

export class AssignCompanionAppealDto {
  @IsUUID("4")
  assignedToUserId!: string;
}

export class CompleteCompanionReactivationDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  resolution!: string;
}

export class ResolveCompanionIncidentDto {
  @IsIn(["inReview", "resolved", "closed"])
  status!: "inReview" | "resolved" | "closed";

  @IsOptional()
  @IsString()
  @IsSafeOperationalText()
  @MinLength(5)
  @MaxLength(1000)
  resolution?: string;
}

export class AssignCompanionIncidentDto {
  @IsUUID("4")
  assignedToUserId!: string;
}

export class ReviewCompanionVoiceIntroDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(EXTERNAL_REFERENCE)
  reviewedAssetReference!: string;
}

export class UpdateWithdrawalRequestDto {
  @IsIn(["reviewing", "approved", "processing", "paid", "rejected"])
  status!: "reviewing" | "approved" | "processing" | "paid" | "rejected";

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(MASKED_REFERENCE)
  payoutReferenceMasked?: string;

  @IsOptional()
  @IsString()
  @IsSafeOperationalText()
  @MinLength(5)
  @MaxLength(500)
  rejectionReason?: string;
}

export class ListCompanionLifecycleAdminDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  actionId?: string;

  @IsOptional()
  @IsIn(["open", "inReview", "resolved", "closed"])
  incidentStatus?: "open" | "inReview" | "resolved" | "closed";

  @IsOptional()
  @IsIn(["requested", "reviewing", "approved", "processing", "paid", "rejected", "cancelled"])
  withdrawalStatus?: "requested" | "reviewing" | "approved" | "processing" | "paid" | "rejected" | "cancelled";

  @IsOptional()
  @IsIn(["pending", "upheld", "overturned", "dismissed"])
  appealStatus?: "pending" | "upheld" | "overturned" | "dismissed";

  @IsOptional()
  @IsIn(["notSubmitted", "pendingReview", "approved", "rejected"])
  voiceIntroStatus?: "notSubmitted" | "pendingReview" | "approved" | "rejected";

  @IsOptional()
  @IsIn(["notRequired", "required", "completed"])
  reactivationStatus?: "notRequired" | "required" | "completed";

  @IsOptional()
  @IsIn(["inProgress", "passed", "expired"])
  trainingStatus?: "inProgress" | "passed" | "expired";

  @IsOptional()
  @IsIn(["true", "false"])
  active?: "true" | "false";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 50;
}
