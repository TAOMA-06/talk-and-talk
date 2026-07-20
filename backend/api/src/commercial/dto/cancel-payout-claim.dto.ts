import { IsString, Matches, MaxLength, MinLength } from "class-validator";

/** Independent evidence that a claimed manual payout was never transferred. */
export class CancelPayoutClaimDto {
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  noTransferEvidenceReference!: string;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  evidenceDigest!: string;
}
