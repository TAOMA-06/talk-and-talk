import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateReviewDto {
  @IsString()
  orderId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @MaxLength(1000)
  content!: string;
}
