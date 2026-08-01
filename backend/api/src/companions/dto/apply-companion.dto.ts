import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

export class ApplyCompanionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  role!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  bio!: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  pricePerHalfHour!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  availableTimes!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  languages!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  specialties!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  topicIds?: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  cityDistrict!: string;
}

export class UpdateOwnCompanionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  role?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  availableTimes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  specialties?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  cityDistrict?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  livedExperience?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serviceBoundaries?: string[];

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  voiceIntroAssetRef?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  voiceIntroDurationSeconds?: number;

  @IsOptional()
  @IsIn(["online", "available", "busy"])
  availability?: "online" | "available" | "busy";
}
