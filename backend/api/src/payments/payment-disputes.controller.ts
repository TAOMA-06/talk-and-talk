import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { Request, Response } from "express";

import { AuthenticatedUser } from "../auth/auth.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PaymentDisputesService } from "./payment-disputes.service";
import { ListPaymentDisputesDto } from "./dto/payment-dispute.dto";

type RequestWithRawBody = Request & { rawBody?: Buffer };

@Controller("payments")
export class PaymentDisputesController {
  constructor(private readonly disputes: PaymentDisputesService) {}

  @Post("wechat/complaint-notify")
  @HttpCode(204)
  async wechatComplaintNotify(
    @Req() req: RequestWithRawBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() response: Response
  ) {
    const rawBody = req.rawBody?.toString("utf8")
      ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    await this.disputes.handleWechatComplaintNotify(headers, rawBody);
    response.status(204).send();
  }

  @Get("disputes/me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("user", "companion")
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPaymentDisputesDto = new ListPaymentDisputesDto()
  ) {
    return this.disputes.listMine(user.id, query);
  }

  @Get("disputes/by-order/:orderId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("user", "companion")
  getMineByOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId") orderId: string
  ) {
    return this.disputes.getMineByOrder(user.id, orderId);
  }

  @Get("disputes/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("user", "companion")
  getMine(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.disputes.getMine(user.id, id);
  }
}
