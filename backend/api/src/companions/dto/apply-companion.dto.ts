import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
  @IsIn(["online", "available", "busy"])
  availability?: "online" | "available" | "busy";
}
