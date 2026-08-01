import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class ListFavoriteCompanionsDto {
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
}
