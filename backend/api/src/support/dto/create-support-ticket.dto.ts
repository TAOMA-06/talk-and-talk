import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateSupportTicketDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsIn(["orderIssue", "refund", "safety", "privacy", "general"])
  category!: "orderIssue" | "refund" | "safety" | "privacy" | "general";

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  subject!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(3000)
  body!: string;
}
