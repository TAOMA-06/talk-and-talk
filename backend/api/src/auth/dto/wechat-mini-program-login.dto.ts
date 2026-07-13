import { IsString, MaxLength, MinLength } from "class-validator";

/** Temporary credential returned from wx.login; it is exchanged server-side only. */
export class WechatMiniProgramLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code!: string;
}
