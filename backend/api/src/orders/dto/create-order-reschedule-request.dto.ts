import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * This describes a proposal only. The server never changes Order.scheduledAt
 * while accepting this payload; the other participant must respond in a
 * separate, transactionally revalidated operation.
 */
export class CreateOrderRescheduleRequestDto {
  @IsDateString()
  requestedScheduledAt!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  availabilityWindowId?: string;
}
