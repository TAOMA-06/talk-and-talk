import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmpty,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min
} from "class-validator";

export class CreateCompanionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsString()
  name!: string;

  @IsString()
  role!: string;

  @IsString()
  initials!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  tags!: string[];

  @IsOptional()
  @IsEmpty({ message: "rating is derived from verified reviews" })
  rating?: unknown;

  @IsOptional()
  @IsEmpty({ message: "reviewCount is derived from verified reviews" })
  reviewCount?: unknown;

  @IsInt()
  @Min(1)
  pricePerHalfHour!: number;

  @IsBoolean()
  isOnline!: boolean;

  @IsBoolean()
  isVerified!: boolean;

  @IsString()
  bio!: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicIds?: string[];

  @IsOptional()
  @IsEmpty({ message: "completedOrders is derived from completed orders" })
  completedOrders?: unknown;

  @IsOptional()
  @IsEmpty({ message: "responseTime is derived from order response facts" })
  responseTime?: unknown;

  @IsNumber()
  @Min(0)
  distanceKm!: number;

  @IsIn(["online", "available", "busy"])
  availability!: "online" | "available" | "busy";

  @IsString()
  cityDistrict!: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateCompanionDto {
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  initials?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEmpty({ message: "rating is derived from verified reviews" })
  rating?: unknown;

  @IsOptional()
  @IsEmpty({ message: "reviewCount is derived from verified reviews" })
  reviewCount?: unknown;

  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerHalfHour?: number;

  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  availableTimes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  specialties?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topicIds?: string[];

  @IsOptional()
  @IsEmpty({ message: "completedOrders is derived from completed orders" })
  completedOrders?: unknown;

  @IsOptional()
  @IsEmpty({ message: "responseTime is derived from order response facts" })
  responseTime?: unknown;

  @IsOptional()
  @IsNumber()
  @Min(0)
  distanceKm?: number;

  @IsOptional()
  @IsIn(["online", "available", "busy"])
  availability?: "online" | "available" | "busy";

  @IsOptional()
  @IsString()
  cityDistrict?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
