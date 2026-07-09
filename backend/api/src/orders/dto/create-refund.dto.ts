import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
