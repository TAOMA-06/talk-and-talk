import { IsBoolean } from "class-validator";

export class SetConversationBlockDto {
  @IsBoolean()
  blocked!: boolean;
}
