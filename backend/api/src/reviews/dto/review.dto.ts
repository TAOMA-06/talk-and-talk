import { IsInt, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateReviewDto {
  @IsString()
  orderId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content!: string;
}
