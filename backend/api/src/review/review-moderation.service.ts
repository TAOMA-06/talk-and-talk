import { HttpStatus, Injectable } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";
import { AuthenticatedReviewer } from "./review-auth.types";
import { CreateReviewLabelDto } from "./dto/create-review-label.dto";
import { ExportReviewLabelsDto } from "./dto/export-review-labels.dto";
import { ReviewCaseAction } from "./dto/review-case-action.dto";
import { ListReviewCasesQueryDto } from "./dto/list-review-cases.dto";
import { ListReviewConversationEvidenceDto } from "./dto/list-review-conversation-evidence.dto";
import { ListActiveReviewStaffQueryDto } from "./dto/list-review-staff.dto";
import { ReviewCaseService, ReviewDecisionActor } from "./review-case.service";

const LEAD_ONLY_ACTIONS = new Set<ReviewCaseAction>(["restrict24h", "restrict7d", "liftRestriction"]);
const NOTE_REQUIRED_ACTIONS = new Set<ReviewCaseAction>([
  "confirmViolation",
  "rejectMessage",
  "restrict24h",
  "restrict7d",
  "upholdAppeal",
  "overturnAppeal"
]);

@Injectable()
export class ReviewModerationService {
  constructor(private readonly moderation: ReviewCaseService) {}

  overview() {
    return this.moderation.overview();
  }

  listCases(query: ListReviewCasesQueryDto) {
    return this.moderation.listCases(query);
  }

  getCase(id: string) {
    return this.moderation.getCase(id);
  }

  conversationEvidence(id: string, query: ListReviewConversationEvidenceDto) {
    return this.moderation.conversationEvidence(id, query);
  }

  claimCase(caseId: string, reviewer: AuthenticatedReviewer) {
    return this.moderation.claimCase(caseId, this.actor(reviewer));
  }

  assignCase(caseId: string, reviewer: AuthenticatedReviewer, assignedToReviewerId?: string) {
    if (reviewer.role !== "lead") {
      throw new AppException("REVIEW_LEAD_REQUIRED", "Case assignment requires a review lead", HttpStatus.FORBIDDEN);
    }
    return this.moderation.assignCase(caseId, this.actor(reviewer), assignedToReviewerId);
  }

  listActiveReviewers(reviewer: AuthenticatedReviewer, query: ListActiveReviewStaffQueryDto) {
    if (reviewer.role !== "lead") {
      throw new AppException("REVIEW_LEAD_REQUIRED", "Review staff visibility requires a review lead", HttpStatus.FORBIDDEN);
    }
    return this.moderation.listActiveReviewers(query);
  }

  async applyAction(
    caseId: string,
    reviewer: AuthenticatedReviewer,
    action: ReviewCaseAction,
    note?: string
  ) {
    if (LEAD_ONLY_ACTIONS.has(action) && reviewer.role !== "lead") {
      throw new AppException("REVIEW_LEAD_REQUIRED", "This review decision requires a review lead", HttpStatus.FORBIDDEN);
    }
    if (NOTE_REQUIRED_ACTIONS.has(action) && !note?.trim()) {
      throw new AppException("REVIEW_DECISION_NOTE_REQUIRED", "A decision note is required for this review action", HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return this.moderation.applyAction(caseId, this.actor(reviewer), action, note);
  }

  createLabel(reviewer: AuthenticatedReviewer, dto: CreateReviewLabelDto) {
    return this.moderation.createLabel(this.actor(reviewer), dto);
  }

  exportLabels(reviewer: AuthenticatedReviewer, query: ExportReviewLabelsDto) {
    if (reviewer.role !== "lead") {
      throw new AppException("REVIEW_LEAD_REQUIRED", "Label export requires a review lead", HttpStatus.FORBIDDEN);
    }
    return this.moderation.exportLabels(this.actor(reviewer), query);
  }

  private actor(reviewer: AuthenticatedReviewer): ReviewDecisionActor {
    return {
      id: reviewer.id,
      kind: "reviewStaff",
      displayName: reviewer.displayName,
      role: reviewer.role
    };
  }
}
