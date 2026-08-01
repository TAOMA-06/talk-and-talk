import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export const DATA_RIGHTS_REQUEST_TYPES = ["access", "export", "correction", "deletion"] as const;
export type DataRightsRequestTypeValue = (typeof DATA_RIGHTS_REQUEST_TYPES)[number];

export class CreateDataRightsRequestDto {
  @IsIn(DATA_RIGHTS_REQUEST_TYPES)
  type!: DataRightsRequestTypeValue;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  description!: string;
}
