import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const AVAILABILITY_REMINDER_RESOLUTION_CODES = [
  "failedBeforeSendReviewed",
  "providerRejectedReviewed",
  "uncertainProviderStateReconciled"
] as const;

export type AvailabilityReminderResolutionCode = typeof AVAILABILITY_REMINDER_RESOLUTION_CODES[number];

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

export class ResolveAvailabilityReminderTerminalDto {
  @IsIn(AVAILABILITY_REMINDER_RESOLUTION_CODES)
  resolutionCode!: AvailabilityReminderResolutionCode;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @IsSafeOperationalText()
  @MaxLength(500)
  @Matches(/^[^\u0000-\u001F\u007F]*$/u)
  note?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(300)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9:/._-]*$/)
  evidenceRef?: string;
}
