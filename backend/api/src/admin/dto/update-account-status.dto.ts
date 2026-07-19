import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const ACCOUNT_STATUSES = ["active", "restricted", "banned"] as const;
export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];

export class UpdateAccountStatusDto {
  @IsIn([...ACCOUNT_STATUSES])
  status!: AccountStatusValue;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
