import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class ReserveMediaUploadDto {
  @IsIn(["image", "audio"])
  kind!: "image" | "audio";

  @IsString()
  @MaxLength(100)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  sizeBytes!: number;

  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  sha256!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60 * 1000)
  durationMs?: number;
}
