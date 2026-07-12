import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PaymentsService } from "../payments/payments.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService
  ) {}

  @Get("status")
  status() {
    return { module: "orders", status: "active" };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.id, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.list(user.id);
  }

  @Get("service")
  @UseGuards(JwtAuthGuard)
  listService(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.listForCompanion(user.id);
  }

  @Post("service/:id/start")
  @UseGuards(JwtAuthGuard)
  startService(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.startService(user.id, id);
  }

  @Post("service/:id/complete")
  @UseGuards(JwtAuthGuard)
  completeService(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.completeService(user.id, id);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.get(user.id, id);
  }

  @Post(":id/cancel")
  @UseGuards(JwtAuthGuard)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.cancel(user.id, id);
  }

  @Post(":id/prepay")
  @UseGuards(JwtAuthGuard)
  prepay(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.paymentsService.prepay(user.id, id);
  }

  @Post(":id/refund")
  @UseGuards(JwtAuthGuard)
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateRefundDto
  ) {
    return this.paymentsService.requestRefund(user.id, id, dto.reason);
  }

  @Post(":id/refund/sync")
  @UseGuards(JwtAuthGuard)
  syncRefund(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.paymentsService.syncRefund(user.id, id);
  }
}
