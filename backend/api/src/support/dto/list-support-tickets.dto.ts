import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListSupportTicketsDto {
  @IsOptional()
  @IsIn(["open", "inProgress", "resolved", "closed"])
  status?: "open" | "inProgress" | "resolved" | "closed";

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
  @Transform(({ value }) => value === true || value === "true" ? true : value === false || value === "false" ? false : value)
  @IsBoolean()
  assignedOnly?: boolean;
}
