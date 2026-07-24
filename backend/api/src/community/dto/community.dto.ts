import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

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
