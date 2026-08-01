import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested
} from "class-validator";

export const recommendationPlacements = ["discoverHome", "communityRelated", "orderFollowup"] as const;
export type RecommendationPlacementValue = typeof recommendationPlacements[number];

export class ListRecommendedCompanionsDto {
  @IsOptional()
  @IsIn(recommendationPlacements)
  placement?: RecommendationPlacementValue;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  themeId?: string;
}

export class ListCompanionRecommendationExclusionsDto {
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
}

export class UpdateRecommendationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  personalizationEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  topicIds?: string[];

  @IsOptional()
  @IsString()
  city?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxPricePerHalfHour?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  preferredTimeSlots?: string[];
}

export class RecommendationEventDto {
  @IsUUID()
  impressionId!: string;

  @IsIn(["view", "click"])
  type!: "view" | "click";
}

export class RecordRecommendationEventsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecommendationEventDto)
  events!: RecommendationEventDto[];
}

export class UpdateRecommendationPolicyDto {
  @IsOptional()
  @IsIn(["active", "paused"])
  status?: "active" | "paused";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1000)
  @Max(1000)
  boostBps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  dailyCap?: number | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class RecommendationMetricsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
