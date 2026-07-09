import { IsString, IsNotEmpty } from "class-validator";

export class SendCodeDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;
}
