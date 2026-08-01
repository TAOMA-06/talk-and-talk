import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class ListCommunityItemsDto {
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

export class CreateCommunityPostDto {
  @IsIn(["femaleRequest", "malePromotion"])
  kind!: "femaleRequest" | "malePromotion";

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  topic!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverImageUrl?: string;
}

export class SetCommunityLikeDto {
  @IsBoolean()
  liked!: boolean;
}

export class CreateCommunityPostReportDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
