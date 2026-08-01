import { IsOptional, IsUUID } from "class-validator";

export class AssignReviewCaseDto {
  @IsOptional()
  @IsUUID()
  reviewerId?: string;
}
