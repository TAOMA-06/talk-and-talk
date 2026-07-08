import { Controller, Get } from "@nestjs/common";

@Controller("companions")
export class CompanionsController {
  @Get("status")
  status() {
    return { module: "companions", status: "planned" };
  }
}
