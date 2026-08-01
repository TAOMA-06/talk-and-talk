import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export type UserGender = "female" | "male";
export const USER_GENDERS: UserGender[] = ["female", "male"];

export class UpdateMeDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  displayName?: string;

  @IsOptional()
  @IsIn(USER_GENDERS)
  gender?: UserGender | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(120)
  age?: number;
}
