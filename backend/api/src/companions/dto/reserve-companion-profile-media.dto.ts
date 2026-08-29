import { IsInt, IsString, Matches, Max, Min } from "class-validator";

export class ReserveCompanionProfileMediaDto {
  @IsString()
  @Matches(/^image\/(?:jpeg|png|webp)$/i)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(4 * 1024 * 1024)
  sizeBytes!: number;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256!: string;
}
