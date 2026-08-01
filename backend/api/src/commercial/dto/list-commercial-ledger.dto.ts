import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListCompanionEarningsDto {
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
  @IsIn(["pending", "available", "held", "paid", "void"])
  status?: "pending" | "available" | "held" | "paid" | "void";
}

export class ListCompanionRecoveriesDto {
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
  @IsIn(["due", "pendingVerification", "recovered"])
  status?: "due" | "pendingVerification" | "recovered";
}
