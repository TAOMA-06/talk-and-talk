import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from "class-validator";

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  companionId!: string;

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
}
