import { IsString, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class SuspendCompanionCommercialProfileDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
