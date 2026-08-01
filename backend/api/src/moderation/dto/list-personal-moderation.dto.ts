import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class ListPersonalModerationDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  caseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  appealId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  restrictionId?: string;

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
  pageSize: number = 20;

  @IsOptional()
  @IsIn(["pending", "upheld", "overturned", "dismissed"])
  status?: "pending" | "upheld" | "overturned" | "dismissed";
}

export class ListReporterCasesDto {
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
  pageSize: number = 20;
}
