import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min
} from "class-validator";

export class CreateOwnAvailabilityWindowDto {
  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  capacity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOwnAvailabilityWindowDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  capacity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
