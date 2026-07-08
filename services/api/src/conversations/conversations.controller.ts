import { Controller, Get } from "@nestjs/common";

@Controller("conversations")
export class ConversationsController {
  @Get("status")
  status() {
    return { module: "conversations", status: "planned" };
  }
}
