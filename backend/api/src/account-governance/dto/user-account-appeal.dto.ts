import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export const USER_ACCOUNT_APPEAL_STATUSES = [
  "pending",
  "upheld",
  "overturned",
  "dismissed"
] as const;

export type UserAccountAppealStatusValue =
  (typeof USER_ACCOUNT_APPEAL_STATUSES)[number];

export class CreateUserAccountAppealDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  statement!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  evidenceAssetIds?: string[];
}

export class ListUserAccountAppealsDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  actionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  appealId?: string;

  @IsOptional()
  @IsIn([...USER_ACCOUNT_APPEAL_STATUSES])
  status?: UserAccountAppealStatusValue;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export class AssignUserAccountAppealDto {
  @IsUUID("4")
  assignedToUserId!: string;
}

export class ResolveUserAccountAppealDto {
  @IsIn(["upheld", "overturned", "dismissed"])
  status!: Exclude<UserAccountAppealStatusValue, "pending">;

  @IsString()
  @IsSafeOperationalText()
  @MinLength(10)
  @MaxLength(1000)
  resolution!: string;
}
