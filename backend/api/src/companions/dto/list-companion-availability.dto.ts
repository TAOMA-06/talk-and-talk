import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class ListCompanionAvailabilityQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceOfferingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(240)
  durationMinutes?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  days?: number = 7;
}
