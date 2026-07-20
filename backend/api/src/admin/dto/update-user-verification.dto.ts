import { IsBoolean, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

export class UpdateUserVerificationDto {
  @IsBoolean()
  isVerified!: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ValidateIf((dto: UpdateUserVerificationDto) => dto.isVerified === true)
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  evidenceReference?: string;
}
