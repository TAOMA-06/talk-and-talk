import { IsNotEmpty, IsString, Length, Matches, MaxLength } from "class-validator";

export class StaffLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  username!: string;

  @IsString()
  @Length(16, 128)
  password!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  totpCode!: string;
}
