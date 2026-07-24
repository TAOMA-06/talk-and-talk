import {
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min
} from "class-validator";

/**
 * The server owns the scheduling timezone and activation policy. These DTOs
 * intentionally expose only the planning inputs a companion needs to create.
 */
export class CreateOwnRecurringAvailabilityRuleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsInt()
  @Min(0)
  @Max(1410)
  startsAtMinute!: number;

  @IsInt()
  @Min(30)
  @Max(1440)
  endsAtMinute!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  capacity?: number;
}

export class CreateOwnAvailabilityBlackoutDto {
  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
