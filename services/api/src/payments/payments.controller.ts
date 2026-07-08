import { Controller, Get } from "@nestjs/common";

@Controller("payments")
export class PaymentsController {
  @Get("status")
  status() {
    return { module: "payments", status: "planned" };
  }
}
