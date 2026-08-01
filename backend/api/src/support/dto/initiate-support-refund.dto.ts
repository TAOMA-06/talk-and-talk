import { IsString, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class InitiateSupportRefundDto {
  @IsString()
  @IsSafeOperationalText()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
