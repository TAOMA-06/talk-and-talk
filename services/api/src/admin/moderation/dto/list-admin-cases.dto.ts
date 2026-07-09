import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ListAdminCasesQueryDto {
  @IsOptional()
  @IsIn(["pending", "autoReviewing", "humanReview", "resolved", "dismissed"])
  status?: "pending" | "autoReviewing" | "humanReview" | "resolved" | "dismissed";

  @IsOptional()
  @IsIn(["low", "medium", "high"])
  riskLevel?: "low" | "medium" | "high";

  @IsOptional()
  @IsIn(["chat", "community", "report", "profile"])
  source?: "chat" | "community" | "report" | "profile";

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

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
