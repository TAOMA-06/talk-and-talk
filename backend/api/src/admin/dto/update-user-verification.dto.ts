import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateUserVerificationDto {
  @IsBoolean()
  isVerified!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
