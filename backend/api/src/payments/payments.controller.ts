import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Request } from "express";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PaymentsService } from "./payments.service";

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get("status")
  status() {
    return { module: "payments", status: "active" };
  }

  @Post("wechat/notify")
  @HttpCode(200)
  async wechatNotify(@Req() req: RequestWithRawBody, @Headers() headers: Record<string, string>) {
    const rawBody =
      req.rawBody?.toString("utf8") ??
      (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

    const result = await this.paymentsService.handleWechatNotify(headers, rawBody);
    // WeChat expects non-envelope style; global interceptor will still wrap.
    // Clients that need raw WeChat format can use code/message fields in data.
    return result;
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
