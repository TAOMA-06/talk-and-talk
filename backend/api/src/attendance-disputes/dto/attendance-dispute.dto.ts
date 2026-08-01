import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
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

export const ATTENDANCE_ISSUES = [
  "companionAbsent",
  "customerAbsent",
  "lateArrival",
  "technicalFailure",
  "earlyExit",
  "serviceMismatch",
  "safetyBoundary",
  "other"
] as const;

export const ATTENDANCE_DECISIONS = ["noRefund", "fullRefund"] as const;
export const CLIENT_ATTENDANCE_EVENTS = ["join", "leave", "reconnect", "heartbeat"] as const;

export class CreateAttendanceDisputeDto {
  @IsEnum(ATTENDANCE_ISSUES)
  issue!: typeof ATTENDANCE_ISSUES[number];

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @IsSafeOperationalText()
  statement?: string;
}

export class SubmitAttendanceStatementDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @IsSafeOperationalText()
  statement!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  evidenceAssetIds?: string[];
}

export class ReportClientAttendanceEventDto {
  @IsEnum(CLIENT_ATTENDANCE_EVENTS)
  eventType!: typeof CLIENT_ATTENDANCE_EVENTS[number];

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/)
  clientEventId!: string;

  @IsISO8601({ strict: true })
  claimedAt!: string;
}

export class DecideAttendanceDisputeDto {
  @IsEnum(ATTENDANCE_DECISIONS)
  decision!: typeof ATTENDANCE_DECISIONS[number];

  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  @IsSafeOperationalText()
  reason!: string;
}

export class FinalizeAttendanceDisputeDto {
  @IsOptional()
  @IsEnum(ATTENDANCE_DECISIONS)
  decision?: typeof ATTENDANCE_DECISIONS[number];

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  @IsSafeOperationalText()
  reason?: string;
}

export class ListAttendanceDisputesDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @Matches(/^(evidenceCollection|counterpartyResponse|review|decided|appealed|final)$/)
  status?: string;
}
