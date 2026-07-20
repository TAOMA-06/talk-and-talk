import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export const ACCOUNT_STATUSES = ["active", "restricted", "banned"] as const;
export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];

export class UpdateAccountStatusDto {
  @IsIn([...ACCOUNT_STATUSES])
  status!: AccountStatusValue;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
