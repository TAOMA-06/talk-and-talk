import { Controller, Get } from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Get("status")
  status() {
    return { module: "users", status: "planned" };
  }
}
