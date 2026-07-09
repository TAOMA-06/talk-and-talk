import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CheckModerationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsIn(["chat", "community", "report", "profile"])
  source?: "chat" | "community" | "report" | "profile";

  @IsOptional()
  @IsString()
  conversationId?: string;
}
