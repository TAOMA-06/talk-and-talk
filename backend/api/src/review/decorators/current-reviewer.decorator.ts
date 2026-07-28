import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { AuthenticatedReviewer } from "../review-auth.types";

export const CurrentReviewer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedReviewer => {
    return ctx.switchToHttp().getRequest().reviewer;
  }
);
