import { IsInt, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";

/** Evidence for an already-completed, out-of-band manual payout. */
export class SubmitPayoutDto {
  @IsString()
  @MinLength(4)
  @MaxLength(160)
  paidReference!: string;

  @IsInt()
  @Min(1)
  paidAmountCents!: number;

  @IsString()
  @MinLength(6)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  paidRecipientRef!: string;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  payoutEvidenceDigest!: string;
}
