import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class ApplyCompanionDto {
  @IsString()
  role!: string;

  @IsString()
  bio!: string;

  @IsInt()
  @Min(1)
  pricePerHalfHour!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  tags!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  availableTimes!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  languages!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  specialties!: string[];

  @IsString()
  cityDistrict!: string;
}

export class UpdateOwnCompanionDto {
  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  availableTimes?: string[];

  @IsOptional()
  @IsIn(["online", "available", "busy"])
  availability?: "online" | "available" | "busy";
}
