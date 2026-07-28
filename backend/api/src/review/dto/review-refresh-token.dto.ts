import { IsNotEmpty, IsString } from "class-validator";

export class ReviewRefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
