import {
  Equals,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength
} from "class-validator";

const LEGAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class CreateLegalConsentDto {
  @IsString()
  @Matches(LEGAL_VERSION_PATTERN)
  version!: string;

  @IsDateString()
  acceptedAt!: string;

  @Equals(true)
  privacyAccepted!: true;

  @Equals(true)
  termsAccepted!: true;

  @Equals(true)
  adultConfirmed!: true;

  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  privacyUrl!: string;

  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  termsUrl!: string;

  @IsIn(["wechatMiniProgram", "web"])
  source!: "wechatMiniProgram" | "web";
}

export class GetLegalConsentDto {
  @IsOptional()
  @IsString()
  @Matches(LEGAL_VERSION_PATTERN)
  version?: string;
}
