import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength
} from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";
import { AdminPaginationQueryDto } from "./admin-operations-query.dto";

export const STAFF_CREDENTIAL_STATUSES = ["active", "suspended"] as const;
export const COMMERCIAL_STAFF_ROLES = [
  "moderator",
  "support",
  "finance",
  "supply",
  "operations",
  "admin"
] as const;

export class ListStaffCredentialsDto extends AdminPaginationQueryDto {
  @IsOptional()
  @IsIn([...STAFF_CREDENTIAL_STATUSES])
  status?: (typeof STAFF_CREDENTIAL_STATUSES)[number];

  @IsOptional()
  @IsIn([...COMMERCIAL_STAFF_ROLES])
  role?: (typeof COMMERCIAL_STAFF_ROLES)[number];

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "keyword must contain a non-whitespace character" })
  @MaxLength(120)
  keyword?: string;
}

export class ListEligibleStaffSuccessorsDto extends AdminPaginationQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "keyword must contain a non-whitespace character" })
  @MaxLength(120)
  keyword?: string;

  @IsOptional()
  @IsUUID()
  excludeUserId?: string;
}

export class SuspendStaffCredentialDto {
  @IsString()
  @IsSafeOperationalText()
  @Length(10, 500)
  reason!: string;

  @IsOptional()
  @IsUUID()
  replacementUserId?: string;

  @IsUUID()
  operationId!: string;

  @IsString()
  @Matches(/^[A-Z0-9]{1,6}$/)
  confirmationCode!: string;
}
