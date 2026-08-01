import { Transform } from "class-transformer";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateInvoiceRequestDto {
  @IsUUID()
  orderId!: string;

  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  invoiceTitle!: string;
}
