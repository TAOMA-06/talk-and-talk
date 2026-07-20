import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsString()
  senderId?: string;
}
