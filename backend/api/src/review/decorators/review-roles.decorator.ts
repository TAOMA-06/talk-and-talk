import { SetMetadata } from "@nestjs/common";

import { ReviewStaffRole } from "../review-auth.types";

export const REVIEW_ROLES_KEY = "reviewRoles";
export const ReviewRoles = (...roles: ReviewStaffRole[]) => SetMetadata(REVIEW_ROLES_KEY, roles);
