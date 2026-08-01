import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListConversationsDto {
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
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  blockedByYou?: boolean;
}
