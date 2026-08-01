import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

import {
  USER_ACCOUNT_ACTION_SOURCE_TYPES,
  UserAccountActionSourceType
} from "../../common/user-account-action-policy";
import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const ACCOUNT_STATUSES = ["active", "restricted", "banned"] as const;
export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];

export class UpdateAccountStatusDto {
  @IsIn([...ACCOUNT_STATUSES])
  status!: AccountStatusValue;

  @ValidateIf((dto: UpdateAccountStatusDto) => dto.status !== "active")
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  reasonCode?: string;

  @ValidateIf((dto: UpdateAccountStatusDto) =>
    dto.status !== "active" || dto.sourceType !== undefined
  )
  @IsIn([...USER_ACCOUNT_ACTION_SOURCE_TYPES])
  sourceType?: UserAccountActionSourceType;

  @ValidateIf((dto: UpdateAccountStatusDto) =>
    dto.status !== "active" || dto.sourceReference !== undefined
  )
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  sourceReference?: string;

  @ValidateIf((dto: UpdateAccountStatusDto) =>
    dto.status !== "active" || dto.evidenceReference !== undefined
  )
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  evidenceReference?: string;

  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
