export const REVIEW_TOKEN_KIND = "review-staff";
export const REVIEW_TOKEN_AUDIENCE = "talk-and-talk-review-department";

export type ReviewStaffRole = "reviewer" | "lead";

export type AuthenticatedReviewer = {
  id: string;
  username: string;
  displayName: string;
  role: ReviewStaffRole;
};

export type ReviewAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};
