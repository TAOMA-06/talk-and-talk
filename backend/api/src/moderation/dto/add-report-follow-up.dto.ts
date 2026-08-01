import { IsString, MaxLength, MinLength } from "class-validator";

export class AddReportFollowUpDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  statement!: string;
}
