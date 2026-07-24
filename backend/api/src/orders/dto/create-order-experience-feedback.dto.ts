import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const ORDER_EXPERIENCE_FEEDBACK_TAGS = [
  "communicationClear",
  "boundaryRespected",
  "onTime",
  "asExpected",
  "needsImprovement"
] as const;

export type OrderExperienceFeedbackTag = (typeof ORDER_EXPERIENCE_FEEDBACK_TAGS)[number];

export class CreateOrderExperienceFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn([...ORDER_EXPERIENCE_FEEDBACK_TAGS], { each: true })
  tags?: OrderExperienceFeedbackTag[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
