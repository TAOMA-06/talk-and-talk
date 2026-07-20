import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { Request, Response } from "express";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { PaymentsService } from "./payments.service";

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get("status")
  status() {
    return this.paymentsService.status();
  }

  @Post("wechat/notify")
  @HttpCode(200)
  async wechatNotify(
    @Req() req: RequestWithRawBody,
    @Headers() headers: Record<string, string>,
    @Res() response: Response
  ) {
    const rawBody =
      req.rawBody?.toString("utf8") ??
      (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

    const result = await this.paymentsService.handleWechatNotify(headers, rawBody);
    response.status(200).json({ code: result.code, message: result.message });
  }

  @Post("wechat/refund-notify")
  @HttpCode(200)
  async refundNotify(
    @Req() req: RequestWithRawBody,
    @Headers() headers: Record<string, string>,
    @Res() response: Response
  ) {
    const rawBody = req.rawBody?.toString("utf8") ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    const result = await this.paymentsService.handleWechatRefundNotify(headers, rawBody);
    response.status(200).json(result);
  }

  @Post("refunds/:id/approve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  approveRefund(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.paymentsService.approveRefund(user.id, id, body.note);
  }

  @Get("refunds/review-queue")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  refundReviewQueue() {
    return this.paymentsService.listRefundsAwaitingReview();
  }

  @Post("refunds/:id/reject")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  rejectRefund(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.paymentsService.rejectRefund(user.id, id, body.note);
  }

  @Post("refunds/:id/retry")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("moderator", "admin")
  retryRefund(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { note?: string }) {
    return this.paymentsService.retryRefund(user.id, id, body.note);
  }

  @Post("wechat/mock-notify")
  @UseGuards(JwtAuthGuard)
  mockNotify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { outTradeNo: string; amountCents?: number; transactionId?: string }
  ) {
    return this.paymentsService.mockNotify(user.id, body);
  }
}
