import { IsIn, IsString, Length } from "class-validator";

export class PartnerLoginDto {
  @IsString()
  @Length(24, 128)
  accessCode!: string;

  @IsIn(["customer-a", "customer-b", "companion"])
  persona!: "customer-a" | "customer-b" | "companion";
}
