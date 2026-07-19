import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export type UserGender = "female" | "male";
export const USER_GENDERS: UserGender[] = ["female", "male"];

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(USER_GENDERS)
  gender?: UserGender;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(120)
  age?: number;
}
