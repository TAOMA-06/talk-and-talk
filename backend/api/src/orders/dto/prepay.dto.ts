import { IsIn, IsOptional } from "class-validator";

export class PrepayDto {
  /** Omitted by existing iOS clients; defaults to native App Pay. */
  @IsOptional()
  @IsIn(["app", "miniProgram", "native"])
  channel?: "app" | "miniProgram" | "native";
}
