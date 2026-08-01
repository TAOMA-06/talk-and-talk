import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

const DECISIONS = ["allow", "warn", "block", "review"] as const;
const SOURCES = ["chat", "community", "report", "profile"] as const;

export class CreateReviewLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsIn([...DECISIONS])
  expectedDecision!: (typeof DECISIONS)[number];

  @IsIn([...DECISIONS])
  actualDecision!: (typeof DECISIONS)[number];

  @IsOptional()
  @IsString()
  @IsSafeOperationalText()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  caseId?: string;

  @IsOptional()
  @IsIn([...SOURCES])
  source?: (typeof SOURCES)[number];
}
