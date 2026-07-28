import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AppException } from "../../common/errors/app.exception";
import { REVIEW_ROLES_KEY } from "../decorators/review-roles.decorator";
import { AuthenticatedReviewer, ReviewStaffRole } from "../review-auth.types";

@Injectable()
export class ReviewRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<ReviewStaffRole[]>(REVIEW_ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!requiredRoles?.length) return true;

    const reviewer = context.switchToHttp().getRequest<{ reviewer?: AuthenticatedReviewer }>().reviewer;
    if (!reviewer || !requiredRoles.includes(reviewer.role)) {
      throw new AppException("REVIEW_FORBIDDEN", "Review department permission is required", 403);
    }
    return true;
  }
}
