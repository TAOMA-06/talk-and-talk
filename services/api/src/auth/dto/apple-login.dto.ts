import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class AppleLoginDto {
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  @IsString()
  @IsOptional()
  authorizationCode?: string;
}
