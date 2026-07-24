import { IsString, MaxLength, MinLength } from "class-validator";

export class AddOrderSupportFactDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1200)
  statement!: string;
}
