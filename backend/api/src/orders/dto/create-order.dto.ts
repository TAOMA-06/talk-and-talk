import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  companionId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  serviceOfferingId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  availabilityWindowId?: string;

  @IsString()
  @MinLength(1)
  themeId!: string;

  @IsInt()
  @Min(30)
  @Max(240)
  durationMinutes!: number;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsUUID()
  recommendationImpressionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  clientRequestId?: string;
}
