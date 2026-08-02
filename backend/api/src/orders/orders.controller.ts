import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { localOnlyModuleStatus } from "../common/status/local-only-module-status";
import { PaymentsService } from "../payments/payments.service";
import { VoiceService } from "../voice/voice.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CreateOrderExperienceFeedbackDto } from "./dto/create-order-experience-feedback.dto";
import { CreateOrderRescheduleRequestDto } from "./dto/create-order-reschedule-request.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";
import { ListOrderTimelineDto } from "./dto/list-order-timeline.dto";
import { ListOrdersDto } from "./dto/list-orders.dto";
import { PrepayDto } from "./dto/prepay.dto";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly voiceService: VoiceService,
    private readonly config: ConfigService
  ) {}

  @Get("status")
  status() {
    return localOnlyModuleStatus(this.config, "orders");
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(user.id, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOrdersDto) {
    return this.ordersService.list(user.id, query);
  }

  @Get("service")
  @UseGuards(JwtAuthGuard)
  listService(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOrdersDto) {
    return this.ordersService.listForCompanion(user.id, query);
  }

  @Get("service/today")
  @UseGuards(JwtAuthGuard)
  listTodayService(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.listTodayForCompanion(user.id);
  }

  @Get(":id/timeline")
  @UseGuards(JwtAuthGuard)
  timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query() query: ListOrderTimelineDto
  ) {
    return this.ordersService.timeline(user.id, id, query);
  }

  @Post(":id/voice-room/access")
  @UseGuards(JwtAuthGuard)
  voiceRoomAccess(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.voiceService.issueRoomAccess(user.id, id);
  }

  @Post(":id/reschedule-requests")
  @UseGuards(JwtAuthGuard)
  requestReschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateOrderRescheduleRequestDto
  ) {
    return this.ordersService.requestReschedule(user.id, id, dto);
  }

  @Post(":id/reschedule-requests/:requestId/accept")
  @UseGuards(JwtAuthGuard)
  acceptReschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string
  ) {
    return this.ordersService.acceptReschedule(user.id, id, requestId);
  }

  @Post(":id/reschedule-requests/:requestId/reject")
  @UseGuards(JwtAuthGuard)
  rejectReschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("requestId") requestId: string
  ) {
    return this.ordersService.rejectReschedule(user.id, id, requestId);
  }

  @Post("service/:id/start")
  @UseGuards(JwtAuthGuard)
  startService(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.startService(user.id, id);
  }

  @Post("service/:id/confirm")
  @UseGuards(JwtAuthGuard)
  confirmOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.confirmOrder(user.id, id);
  }

  @Post("service/:id/reject")
  @UseGuards(JwtAuthGuard)
  rejectOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.rejectOrder(user.id, id);
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

  @Post(":id/completion-confirmations")
  @UseGuards(JwtAuthGuard)
  confirmCompletion(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.confirmCompletion(user.id, id);
  }

  @Post(":id/service-guidelines-confirmations")
  @UseGuards(JwtAuthGuard)
  confirmServiceGuidelines(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.ordersService.confirmServiceGuidelines(user.id, id);
  }

  @Post(":id/experience-feedback")
  @UseGuards(JwtAuthGuard)
  submitExperienceFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateOrderExperienceFeedbackDto
  ) {
    return this.ordersService.submitExperienceFeedback(user.id, id, dto);
  }

  @Post(":id/prepay")
  @UseGuards(JwtAuthGuard)
  prepay(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: PrepayDto) {
    return this.paymentsService.prepay(user.id, id, dto.channel ?? "app");
  }

  @Post(":id/payment/sync")
  @UseGuards(JwtAuthGuard)
  syncPayment(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.paymentsService.syncPayment(user.id, id);
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
