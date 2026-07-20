import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateAppealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  caseId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
