import { Controller, Get } from "@nestjs/common";

@Controller("auth")
export class AuthController {
  @Get("status")
  status() {
    return { module: "auth", status: "planned" };
  }
}
