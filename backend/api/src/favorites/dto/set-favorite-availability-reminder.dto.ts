import { IsBoolean, IsUUID, ValidateIf } from "class-validator";

/**
 * Enabling the preference must be tied to a fresh, caller-owned one-time
 * WeChat subscription grant. Disabling never needs a prompt or a grant.
 */
export class SetFavoriteAvailabilityReminderDto {
  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((dto: SetFavoriteAvailabilityReminderDto) => dto.enabled === true)
  @IsUUID()
  subscriptionGrantId?: string;
}
