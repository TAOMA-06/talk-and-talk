import { IsString, IsNotEmpty } from "class-validator";

export class PhoneLoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
