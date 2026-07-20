import { IsString, Matches, MaxLength, MinLength } from "class-validator";

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export class UpsertCompanionCommercialProfileDto {
  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(REFERENCE)
  settlementRecipientRef!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  settlementRecipientMasked!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(REFERENCE)
  taxProfileRef!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(REFERENCE)
  identityEvidenceRef!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  serviceAgreementVersion!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(REFERENCE)
  serviceAgreementEvidenceRef!: string;
}
