import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ReviewRefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectRefundDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}
