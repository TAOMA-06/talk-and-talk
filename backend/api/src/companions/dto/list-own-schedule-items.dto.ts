import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class ListOwnScheduleItemsDto {
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
}
