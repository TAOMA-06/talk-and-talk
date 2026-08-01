import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export const ORDER_LIST_STATUSES = [
  "pending",
  "paying",
  "paid",
  "inService",
  "completed",
  "cancelled",
  "refunded"
] as const;

export const ORDER_LIST_VIEWS = ["all", "active", "history"] as const;

export class ListOrdersDto {
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
  @IsIn(ORDER_LIST_STATUSES)
  status?: typeof ORDER_LIST_STATUSES[number];

  @IsOptional()
  @IsIn(ORDER_LIST_VIEWS)
  view?: typeof ORDER_LIST_VIEWS[number];
}
