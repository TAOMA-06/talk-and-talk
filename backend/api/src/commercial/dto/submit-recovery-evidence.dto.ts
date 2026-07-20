import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class SubmitRecoveryEvidenceDto {
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  evidenceReference!: string;
}
