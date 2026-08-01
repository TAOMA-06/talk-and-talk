import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

export class AddDataRightsFollowUpDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  statement!: string;
}
