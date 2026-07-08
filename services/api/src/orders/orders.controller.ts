import { Controller, Get } from "@nestjs/common";

@Controller("orders")
export class OrdersController {
  @Get("status")
  status() {
    return { module: "orders", status: "planned" };
  }
}
