import { Controller, Get } from "@nestjs/common";

@Controller("admin")
export class AdminController {
  @Get("status")
  status() {
    return { module: "admin", status: "planned" };
  }
}
