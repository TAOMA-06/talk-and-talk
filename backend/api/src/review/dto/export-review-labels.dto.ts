import { Type } from "class-transformer";
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ExportReviewLabelsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 500;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  snapshotAt?: string;
}
