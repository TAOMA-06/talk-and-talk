import { IsBoolean, IsString, Matches } from "class-validator";

/**
 * The Mini Program submits this only after wx.requestSubscribeMessage returns
 * `accept` for a specific template. It is an auditable record of the user's
 * one-time authorization, not a permanent marketing preference.
 */
export class CreateSubscriptionGrantDto {
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/)
  templateKey!: string;

  @IsBoolean()
  granted!: boolean;
}
