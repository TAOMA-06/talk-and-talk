import { IsString, MaxLength, MinLength } from "class-validator";

export class SuspendCompanionCommercialProfileDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
