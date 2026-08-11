import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";
import { Transform } from "class-transformer";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class ListPaymentDisputesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(["pendingSync", "open", "processing", "resolved", "syncFailed"])
  status?: "pendingSync" | "open" | "processing" | "resolved" | "syncFailed";

  @IsOptional()
  @IsIn(["overdue", "dueSoon", "all"])
  sla?: "overdue" | "dueSoon" | "all";
}

export class ListPaymentDisputeEvidenceDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}

export class ReplyPaymentDisputeDto {
  @IsUUID()
  clientRequestId!: string;

  @IsString()
  @IsSafeOperationalText()
  @MinLength(1)
  @MaxLength(200)
  content!: string;

}

export class CompletePaymentDisputeDto {
  @IsUUID()
  clientRequestId!: string;
}

export class AssignPaymentDisputeDto {
  @IsUUID()
  assignedToUserId!: string;
}
