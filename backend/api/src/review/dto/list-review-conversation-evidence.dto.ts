import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ListReviewConversationEvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  before?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  after?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(5)
  @Max(100)
  pageSize?: number;
}
