import "reflect-metadata";

import { validate } from "class-validator";

import { TransitionDataRightsRequestDto, TransitionInvoiceRequestDto } from "../../account-governance/dto/transition-governance-request.dto";
import { CompleteAccountDeletionDto } from "../../admin/dto/account-deletion.dto";
import { ReviewIdentityVerificationRequestDto } from "../../admin/dto/identity-verification-review.dto";
import { UpdateAccountStatusDto } from "../../admin/dto/update-account-status.dto";
import { UpdateUserVerificationDto } from "../../admin/dto/update-user-verification.dto";
import { CancelPayoutClaimDto } from "../../commercial/dto/cancel-payout-claim.dto";
import {
  CompleteCompanionReactivationDto,
  CreateCompanionAccountActionDto,
  ResolveCompanionAppealDto,
  ResolveCompanionIncidentDto,
  UpdateWithdrawalRequestDto
} from "../../commercial/dto/companion-lifecycle.dto";
import { SuspendCompanionCommercialProfileDto } from "../../commercial/dto/suspend-companion-commercial-profile.dto";
import { RejectRefundDto, ReviewRefundDto } from "../../payments/dto/review-refund.dto";
import { CreateReviewLabelDto } from "../../review/dto/create-review-label.dto";
import { ReviewCaseActionDto } from "../../review/dto/review-case-action.dto";
import { InitiateSupportRefundDto } from "../../support/dto/initiate-support-refund.dto";
import { ResolveSupportTicketDto } from "../../support/dto/resolve-support-ticket.dto";

type EmptyConstructor = new () => object;

const SAFE_TEXT = "已按流程处理，证据仅保存在受控系统中";
const RAW_CARD = "处理记录包含银行卡 4111 1111 1111 1111";

const dtoCases: Array<{
  name: string;
  Type: EmptyConstructor;
  field: string;
  input: Record<string, unknown>;
}> = [
  { name: "account status reason", Type: UpdateAccountStatusDto, field: "reason", input: { status: "restricted", reasonCode: "POLICY_BOUNDARY", reason: SAFE_TEXT, sourceType: "manualSafetyReview", sourceReference: "safety-review/case-1", evidenceReference: "evidence-vault/item-1" } },
  { name: "KYC submission reason", Type: UpdateUserVerificationDto, field: "reason", input: { isVerified: true, reason: SAFE_TEXT, evidenceReference: "kyc/case-123" } },
  { name: "KYC review reason", Type: ReviewIdentityVerificationRequestDto, field: "reason", input: { reason: SAFE_TEXT } },
  { name: "account deletion note", Type: CompleteAccountDeletionDto, field: "note", input: { note: SAFE_TEXT } },
  { name: "commercial suspension reason", Type: SuspendCompanionCommercialProfileDto, field: "reason", input: { reason: SAFE_TEXT } },
  { name: "payout cancellation reason", Type: CancelPayoutClaimDto, field: "reason", input: { reason: SAFE_TEXT, noTransferEvidenceReference: "payout/case-123", evidenceDigest: "a".repeat(64) } },
  { name: "support refund reason", Type: InitiateSupportRefundDto, field: "reason", input: { reason: SAFE_TEXT } },
  { name: "support resolution", Type: ResolveSupportTicketDto, field: "resolution", input: { status: "resolved", resolution: SAFE_TEXT, resolutionCode: "noRefund" } },
  { name: "data-rights transition reason", Type: TransitionDataRightsRequestDto, field: "reason", input: { expectedStatus: "submitted", nextStatus: "inReview", reason: SAFE_TEXT } },
  { name: "invoice transition reason", Type: TransitionInvoiceRequestDto, field: "reason", input: { expectedStatus: "submitted", nextStatus: "inReview", reason: SAFE_TEXT } },
  { name: "refund review note", Type: ReviewRefundDto, field: "note", input: { note: SAFE_TEXT } },
  { name: "refund rejection note", Type: RejectRefundDto, field: "note", input: { note: SAFE_TEXT } },
  { name: "independent review action note", Type: ReviewCaseActionDto, field: "note", input: { action: "dismiss", note: SAFE_TEXT } },
  { name: "review label note", Type: CreateReviewLabelDto, field: "note", input: { text: "synthetic example", expectedDecision: "allow", actualDecision: "allow", note: SAFE_TEXT } },
  { name: "companion account action message", Type: CreateCompanionAccountActionDto, field: "message", input: { companionId: "companion-1", kind: "warning", reasonCode: "policy-boundary", message: SAFE_TEXT } },
  { name: "companion appeal resolution", Type: ResolveCompanionAppealDto, field: "resolution", input: { status: "upheld", resolution: SAFE_TEXT } },
  { name: "companion reactivation resolution", Type: CompleteCompanionReactivationDto, field: "resolution", input: { resolution: SAFE_TEXT } },
  { name: "companion incident resolution", Type: ResolveCompanionIncidentDto, field: "resolution", input: { status: "resolved", resolution: SAFE_TEXT } },
  { name: "withdrawal rejection reason", Type: UpdateWithdrawalRequestDto, field: "rejectionReason", input: { status: "rejected", rejectionReason: SAFE_TEXT } }
];

describe("staff operational DTO sensitive-text coverage", () => {
  it.each(dtoCases)("rejects raw card data in $name", async ({ Type, field, input }) => {
    const dto = Object.assign(new Type(), input, { [field]: RAW_CARD });
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === field)?.constraints).toEqual(expect.objectContaining({
      isSafeOperationalText: expect.any(String)
    }));
  });

  it.each(dtoCases)("accepts safe operational text in $name", async ({ Type, field, input }) => {
    const dto = Object.assign(new Type(), input);
    const errors = await validate(dto);
    expect(errors.find((error) => error.property === field)?.constraints?.isSafeOperationalText).toBeUndefined();
  });

  it("keeps controlled references and masked payout references valid", async () => {
    const kyc = Object.assign(new UpdateUserVerificationDto(), {
      isVerified: true,
      reason: SAFE_TEXT,
      evidenceReference: "kyc/evidence-20260731"
    });
    const withdrawal = Object.assign(new UpdateWithdrawalRequestDto(), {
      status: "paid",
      payoutReferenceMasked: "wx****4242"
    });

    await expect(validate(kyc)).resolves.toEqual([]);
    await expect(validate(withdrawal)).resolves.toEqual([]);
  });
});
