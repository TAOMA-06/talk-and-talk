import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

import { IsSafeOperationalText } from "../../common/validation/sensitive-free-text";

export class AddOrderSupportFactDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1200)
  @IsSafeOperationalText()
  statement!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  evidenceAssetIds?: string[];
}
