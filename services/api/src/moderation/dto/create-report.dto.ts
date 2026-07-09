import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recentContext?: string;
}
