import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class CreateRefundDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @IsSafeOperationalText()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}
