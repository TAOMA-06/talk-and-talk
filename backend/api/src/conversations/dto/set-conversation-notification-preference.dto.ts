import { IsBoolean } from "class-validator";

/**
 * A conversation participant may change only their own future message-reminder
 * preference. This is not a blocking, reporting, or relationship action.
 */
export class SetConversationNotificationPreferenceDto {
  @IsBoolean()
  muted!: boolean;
}
