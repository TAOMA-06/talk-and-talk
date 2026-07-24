import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

export class CreateOwnServiceOfferingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(["text", "voice"])
  deliveryMode!: "text" | "voice";

  @IsInt()
  @Min(30)
  @Max(240)
  durationMinutes!: number;

  @IsInt()
  @Min(100)
  @Max(2_000_000)
  priceCents!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  topicIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999)
  sortOrder?: number;
}

export class UpdateOwnServiceOfferingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(["text", "voice"])
  deliveryMode?: "text" | "voice";

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(240)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(2_000_000)
  priceCents?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  topicIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999)
  sortOrder?: number;
}
