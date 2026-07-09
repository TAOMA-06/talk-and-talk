import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const DECISIONS = ["allow", "warn", "block", "review"] as const;
const SOURCES = ["chat", "community", "report", "profile"] as const;

export class CreateLabelDto {
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
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  caseId?: string;

  @IsOptional()
  @IsIn([...SOURCES])
  source?: (typeof SOURCES)[number];
}
