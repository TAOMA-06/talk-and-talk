import { Transform } from "class-transformer";
import { IsBoolean, IsString, Matches, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class UpdateUserVerificationDto {
  @IsBoolean()
  isVerified!: boolean;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  evidenceReference!: string;
}
