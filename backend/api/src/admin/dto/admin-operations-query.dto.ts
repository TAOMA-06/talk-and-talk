import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
  Min
} from "class-validator";

const ORDER_STATUSES = [
  "pending",
  "paying",
  "paid",
  "inService",
  "completed",
  "cancelled",
  "refunded"
] as const;

const ACCOUNT_STATUSES = ["active", "restricted", "banned"] as const;
const USER_ROLES = [
  "user",
  "companion",
  "moderator",
  "support",
  "finance",
  "supply",
  "operations",
  "admin"
] as const;

export class AdminPaginationQueryDto {
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

export class ListAdminOrdersDto extends AdminPaginationQueryDto {
  @IsOptional()
  @IsIn([...ORDER_STATUSES])
  status?: (typeof ORDER_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;
}

export class ListAdminUsersDto extends AdminPaginationQueryDto {
  @IsOptional()
  @IsIn([...ACCOUNT_STATUSES])
  accountStatus?: (typeof ACCOUNT_STATUSES)[number];

  @IsOptional()
  @IsIn([...USER_ROLES])
  role?: (typeof USER_ROLES)[number];

  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  })
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  keyword?: string;
}

export class ListSupportAssigneesDto extends AdminPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  keyword?: string;
}

export class ListAdminAuditLogsDto extends AdminPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  actorId?: string;
}
