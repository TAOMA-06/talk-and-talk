import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class ListServiceOfferingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;
}
