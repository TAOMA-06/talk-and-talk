import { HttpStatus, Injectable } from "@nestjs/common";

import { AuthenticatedUser } from "../../auth/auth.service";
import { AppException } from "../../common/errors/app.exception";
import { PrismaService } from "../../database/prisma.service";
import { ControlledCaseEvidenceWorker } from "./controlled-case-evidence.worker";
import {
  ControlledEvidencePurpose,
  MediaAssetService
} from "./media-asset.service";

const MAX_ATTACHMENTS_PER_RECORD = 3;

type ReserveInput = {
  kind: "image" | "audio";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationMs?: number;
};

type EvidenceTarget =
  | { purpose: "orderSupportFact"; orderSupportFactId: string }
  | { purpose: "attendanceDisputeStatement"; attendanceDisputeStatementId: string }
  | { purpose: "companionIncidentReport"; companionIncidentReportId: string }
  | { purpose: "userAccountAppeal"; userAccountAppealId: string }
  | { purpose: "companionAccountAppeal"; companionAccountAppealId: string };

@Injectable()
export class ControlledCaseEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAssets: MediaAssetService,
    private readonly worker: ControlledCaseEvidenceWorker
  ) {}

  async reserveForSupport(user: AuthenticatedUser, ticketId: string, input: ReserveInput) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const ticket: any = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { order: { include: { companion: { select: { ownerUserId: true } } } } }
    } as any);
    const isCurrentParticipant = ticket?.order
      && (ticket.order.userId === user.id || ticket.order.companion.ownerUserId === user.id);
    if (
      !ticket
      || !ticket.orderId
      || !ticket.order
      || ticket.userId !== user.id
      || !isCurrentParticipant
      || !["orderIssue", "refund"].includes(ticket.category)
    ) {
      throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
    }
    if (["resolved", "closed"].includes(ticket.status)) {
      throw new AppException("SUPPORT_TICKET_CLOSED", "Resolved tickets cannot receive evidence", HttpStatus.CONFLICT);
    }
    return this.mediaAssets.reserveControlled({
      uploaderId: user.id,
      purpose: "orderSupportFact",
      scope: { supportTicketId: ticket.id },
      ...input
    });
  }

  async reserveForAttendance(userId: string, disputeId: string, input: ReserveInput) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const dispute: any = await this.prisma.attendanceDispute.findUnique({ where: { id: disputeId } } as any);
    if (!dispute || (dispute.openedByUserId !== userId && dispute.counterpartyUserId !== userId)) {
      throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
    }
    this.assertAttendanceAcceptingEvidence(dispute, userId);
    return this.mediaAssets.reserveControlled({
      uploaderId: userId,
      purpose: "attendanceDisputeStatement",
      scope: { attendanceDisputeId: dispute.id },
      ...input
    });
  }

  async reserveForCompanionIncident(userId: string, input: ReserveInput) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const companion: any = await this.prisma.companionProfile.findFirst({
      where: { ownerUserId: userId },
      select: { id: true }
    } as any);
    if (!companion) {
      throw new AppException("COMPANION_NOT_FOUND", "Companion profile not found", HttpStatus.NOT_FOUND);
    }
    return this.mediaAssets.reserveControlled({
      uploaderId: userId,
      purpose: "companionIncidentReport",
      scope: { companionId: companion.id },
      ...input
    });
  }

  async reserveForUserAccountAppeal(userId: string, actionId: string, input: ReserveInput) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const action: any = await this.prisma.userAccountAction.findFirst({
      where: { id: actionId, userId },
      include: { appeal: { select: { id: true } } }
    } as any);
    this.assertAppealUploadAllowed(
      action,
      "USER_ACCOUNT_ACTION_NOT_FOUND",
      "Account action not found",
      "USER_ACCOUNT_APPEAL_EXISTS",
      "An appeal already exists for this account action",
      "USER_ACCOUNT_ACTION_REVOKED",
      "A revoked account action no longer requires an appeal",
      "USER_ACCOUNT_APPEAL_WINDOW_CLOSED",
      "The appeal submission window has closed"
    );
    return this.mediaAssets.reserveControlled({
      uploaderId: userId,
      purpose: "userAccountAppeal",
      scope: { userAccountActionId: action.id },
      ...input
    });
  }

  async reserveForCompanionAccountAppeal(userId: string, actionId: string, input: ReserveInput) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const companion: any = await this.prisma.companionProfile.findFirst({
      where: { ownerUserId: userId },
      select: { id: true }
    } as any);
    const action: any = companion
      ? await this.prisma.companionAccountAction.findFirst({
          where: { id: actionId, companionId: companion.id },
          include: { appeals: { select: { id: true }, take: 1 } }
        } as any)
      : null;
    this.assertAppealUploadAllowed(
      action ? { ...action, appeal: action.appeals?.[0] ?? null } : null,
      "COMPANION_ACTION_NOT_FOUND",
      "Account action not found",
      "COMPANION_ACTION_APPEAL_EXISTS",
      "An appeal already exists for this account action",
      "COMPANION_ACTION_ALREADY_REVOKED",
      "A revoked account action no longer requires an appeal",
      "COMPANION_ACTION_APPEAL_WINDOW_CLOSED",
      "The appeal submission window has closed"
    );
    return this.mediaAssets.reserveControlled({
      uploaderId: userId,
      purpose: "companionAccountAppeal",
      scope: { companionAccountActionId: action.id },
      ...input
    });
  }

  async complete(userId: string, assetId: string) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const result = await this.mediaAssets.completeControlled(assetId, userId);
    if (result.asset.status === "scanning") this.worker.enqueue(assetId);
    return result;
  }

  status(userId: string, assetId: string) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    return this.mediaAssets.controlledStatus(assetId, userId);
  }

  completeUserAccountAppeal(userId: string, actionId: string, assetId: string) {
    return this.completeScoped(
      userId,
      assetId,
      "userAccountAppeal",
      { userAccountActionId: actionId }
    );
  }

  statusUserAccountAppeal(userId: string, actionId: string, assetId: string) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    return this.mediaAssets.controlledStatus(assetId, userId, {
      purpose: "userAccountAppeal",
      scope: { userAccountActionId: actionId }
    });
  }

  completeCompanionAccountAppeal(userId: string, actionId: string, assetId: string) {
    return this.completeScoped(
      userId,
      assetId,
      "companionAccountAppeal",
      { companionAccountActionId: actionId }
    );
  }

  statusCompanionAccountAppeal(userId: string, actionId: string, assetId: string) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    return this.mediaAssets.controlledStatus(assetId, userId, {
      purpose: "companionAccountAppeal",
      scope: { companionAccountActionId: actionId }
    });
  }

  bindSupportFact(
    db: any,
    input: { assetIds?: string[]; userId: string; supportTicketId: string; orderSupportFactId: string }
  ) {
    return this.bindApproved(db, {
      purpose: "orderSupportFact",
      scope: { supportTicketId: input.supportTicketId },
      assetIds: input.assetIds,
      userId: input.userId,
      target: { purpose: "orderSupportFact", orderSupportFactId: input.orderSupportFactId }
    });
  }

  /**
   * Lets business-record entry points reject non-empty evidence references
   * before they begin a transaction or create their parent record. Empty
   * arrays remain valid for text-only support and dispute flows.
   */
  assertAttachmentsAllowed(assetIds?: readonly string[]) {
    if (assetIds?.length) this.mediaAssets.assertCaseEvidenceMediaEnabled();
  }

  bindAttendanceStatement(
    db: any,
    input: { assetIds?: string[]; userId: string; disputeId: string; statementId: string }
  ) {
    return this.bindApproved(db, {
      purpose: "attendanceDisputeStatement",
      scope: { attendanceDisputeId: input.disputeId },
      assetIds: input.assetIds,
      userId: input.userId,
      target: {
        purpose: "attendanceDisputeStatement",
        attendanceDisputeStatementId: input.statementId
      }
    });
  }

  bindCompanionIncident(
    db: any,
    input: { assetIds?: string[]; userId: string; companionId: string; incidentId: string }
  ) {
    return this.bindApproved(db, {
      purpose: "companionIncidentReport",
      scope: { companionId: input.companionId },
      assetIds: input.assetIds,
      userId: input.userId,
      target: {
        purpose: "companionIncidentReport",
        companionIncidentReportId: input.incidentId
      }
    });
  }

  bindUserAccountAppeal(
    db: any,
    input: { assetIds?: string[]; userId: string; actionId: string; appealId: string }
  ) {
    return this.bindApproved(db, {
      purpose: "userAccountAppeal",
      scope: { userAccountActionId: input.actionId },
      assetIds: input.assetIds,
      userId: input.userId,
      target: { purpose: "userAccountAppeal", userAccountAppealId: input.appealId }
    });
  }

  bindCompanionAccountAppeal(
    db: any,
    input: { assetIds?: string[]; userId: string; actionId: string; appealId: string }
  ) {
    return this.bindApproved(db, {
      purpose: "companionAccountAppeal",
      scope: { companionAccountActionId: input.actionId },
      assetIds: input.assetIds,
      userId: input.userId,
      target: {
        purpose: "companionAccountAppeal",
        companionAccountAppealId: input.appealId
      }
    });
  }

  attachmentInclude() {
    return {
      evidenceAttachments: {
        include: { mediaAsset: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    } as const;
  }

  attachmentDtos(record: any) {
    if (!this.mediaAssets.isCaseEvidenceMediaEnabled()) return [];
    return (record?.evidenceAttachments ?? [])
      .filter((item: any) => item.mediaAsset?.status === "approved")
      .map((item: any) => this.mediaAssets.controlledAttachmentDto(item));
  }

  async createReadUrl(user: AuthenticatedUser, attachmentId: string) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const attachment: any = await this.prisma.controlledCaseEvidenceAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        mediaAsset: true,
        orderSupportFact: {
          include: { supportTicket: true }
        },
        attendanceDisputeStatement: {
          include: { dispute: true }
        },
        companionIncidentReport: {
          include: { companion: { select: { ownerUserId: true } } }
        },
        userAccountAppeal: {
          include: { action: { select: { createdById: true } } }
        },
        companionAccountAppeal: {
          include: {
            action: { select: { createdById: true } },
            companion: { select: { ownerUserId: true } }
          }
        }
      }
    } as any);
    if (!attachment || !this.canRead(user, attachment)) {
      throw new AppException("CASE_EVIDENCE_NOT_FOUND", "Evidence attachment was not found", HttpStatus.NOT_FOUND);
    }
    return this.readUrlResponse(attachment);
  }

  async createUserAccountAppealReadUrl(
    user: AuthenticatedUser,
    actionId: string,
    attachmentId: string
  ) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const attachment: any = await this.prisma.controlledCaseEvidenceAttachment.findFirst({
      where: {
        id: attachmentId,
        purpose: "userAccountAppeal",
        userAccountAppeal: { is: { actionId, userId: user.id } }
      },
      include: {
        mediaAsset: true,
        userAccountAppeal: {
          include: { action: { select: { createdById: true } } }
        }
      }
    } as any);
    if (!attachment || !this.canRead(user, attachment)) {
      throw new AppException("CASE_EVIDENCE_NOT_FOUND", "Evidence attachment was not found", HttpStatus.NOT_FOUND);
    }
    return this.readUrlResponse(attachment);
  }

  private async bindApproved(
    db: any,
    input: {
      purpose: ControlledEvidencePurpose;
      scope: Record<string, string>;
      assetIds?: string[];
      userId: string;
      target: EvidenceTarget;
    }
  ) {
    const assetIds = [...new Set(input.assetIds ?? [])];
    if (!assetIds.length) return [];
    this.assertAttachmentsAllowed(assetIds);
    if (assetIds.length > MAX_ATTACHMENTS_PER_RECORD) {
      throw new AppException(
        "CASE_EVIDENCE_ATTACHMENT_LIMIT_REACHED",
        "A record can include at most three evidence attachments",
        HttpStatus.BAD_REQUEST,
        { limit: MAX_ATTACHMENTS_PER_RECORD }
      );
    }
    for (const assetId of [...assetIds].sort()) {
      await db.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${assetId} FOR UPDATE`;
    }
    const assets = await db.mediaAsset.findMany({
      where: {
        id: { in: assetIds },
        uploaderId: input.userId,
        purpose: input.purpose,
        ...input.scope,
        status: "approved",
        storageDeletedAt: null,
        expiresAt: { gt: new Date() },
        controlledCaseAttachment: null
      }
    });
    if (assets.length !== assetIds.length) {
      throw new AppException(
        "CASE_EVIDENCE_ASSET_INVALID",
        "Every evidence attachment must be approved, unexpired, unused and owned by you",
        HttpStatus.UNPROCESSABLE_ENTITY
      );
    }
    const byId = new Map(assets.map((asset: any) => [asset.id, asset]));
    for (const assetId of assetIds) {
      if (!byId.has(assetId)) continue;
      await db.controlledCaseEvidenceAttachment.create({
        data: {
          mediaAssetId: assetId,
          purpose: input.purpose,
          boundByUserId: input.userId,
          ...(input.target.purpose === "orderSupportFact"
            ? { orderSupportFactId: input.target.orderSupportFactId }
            : input.target.purpose === "attendanceDisputeStatement"
              ? { attendanceDisputeStatementId: input.target.attendanceDisputeStatementId }
              : input.target.purpose === "companionIncidentReport"
                ? { companionIncidentReportId: input.target.companionIncidentReportId }
                : input.target.purpose === "userAccountAppeal"
                  ? { userAccountAppealId: input.target.userAccountAppealId }
                  : { companionAccountAppealId: input.target.companionAccountAppealId })
        }
      });
    }
    return assets;
  }

  private canRead(user: AuthenticatedUser, attachment: any): boolean {
    const supportTicket = attachment.orderSupportFact?.supportTicket;
    if (supportTicket) {
      return supportTicket.userId === user.id
        || user.role === "admin"
        || (user.role === "support" && supportTicket.assignedToUserId === user.id);
    }
    const attendance = attachment.attendanceDisputeStatement?.dispute;
    if (attendance) {
      return attendance.openedByUserId === user.id
        || attendance.counterpartyUserId === user.id
        || user.role === "admin"
        || (user.role === "support"
          && [attendance.assignedToUserId, attendance.appealAssignedToUserId].includes(user.id));
    }
    const incident = attachment.companionIncidentReport;
    if (incident) {
      return incident.companion?.ownerUserId === user.id
        || user.role === "admin"
        || (user.role === "supply" && incident.assignedToUserId === user.id);
    }
    const userAppeal = attachment.userAccountAppeal;
    if (userAppeal) {
      return userAppeal.userId === user.id
        || (user.role === "admin"
          && userAppeal.assignedToUserId === user.id
          && userAppeal.action?.createdById !== user.id);
    }
    const companionAppeal = attachment.companionAccountAppeal;
    if (companionAppeal) {
      return companionAppeal.companion?.ownerUserId === user.id
        || (["supply", "admin"].includes(user.role)
          && companionAppeal.assignedToUserId === user.id
          && companionAppeal.action?.createdById !== user.id);
    }
    return false;
  }

  private async completeScoped(
    userId: string,
    assetId: string,
    purpose: "userAccountAppeal" | "companionAccountAppeal",
    scope: { userAccountActionId: string } | { companionAccountActionId: string }
  ) {
    this.mediaAssets.assertCaseEvidenceMediaEnabled();
    const result = await this.mediaAssets.completeControlled(assetId, userId, {
      purpose,
      scope
    });
    if (result.asset.status === "scanning") this.worker.enqueue(assetId);
    return result;
  }

  private async readUrlResponse(attachment: any) {
    const url = await this.mediaAssets.approvedReadUrl(attachment.mediaAsset);
    return {
      attachmentId: attachment.id,
      kind: attachment.mediaAsset.kind,
      url,
      assetExpiresAt: attachment.mediaAsset.expiresAt.toISOString()
    };
  }

  private assertAppealUploadAllowed(
    action: any,
    notFoundCode: string,
    notFoundMessage: string,
    existsCode: string,
    existsMessage: string,
    revokedCode: string,
    revokedMessage: string,
    windowCode: string,
    windowMessage: string
  ) {
    if (!action) {
      throw new AppException(notFoundCode, notFoundMessage, HttpStatus.NOT_FOUND);
    }
    if (action.revokedAt) {
      throw new AppException(revokedCode, revokedMessage, HttpStatus.CONFLICT);
    }
    if (action.appeal) {
      throw new AppException(existsCode, existsMessage, HttpStatus.CONFLICT, {
        appealId: action.appeal.id
      });
    }
    if (!action.appealDeadlineAt || action.appealDeadlineAt.getTime() <= Date.now()) {
      throw new AppException(windowCode, windowMessage, HttpStatus.CONFLICT, {
        appealDeadlineAt: action.appealDeadlineAt?.toISOString?.() ?? null
      });
    }
  }

  private assertAttendanceAcceptingEvidence(dispute: any, userId: string) {
    const now = Date.now();
    const isOpener = dispute.openedByUserId === userId;
    const isCounterparty = dispute.counterpartyUserId === userId;
    const participantRole = isOpener
      ? dispute.openedByRole
      : (dispute.openedByRole === "customer" ? "companion" : "customer");
    const adverseRole = dispute.decision === "fullRefund" ? "companion" : "customer";
    const allowed = dispute.status === "evidenceCollection"
      ? isOpener && dispute.evidenceDueAt.getTime() > now
      : dispute.status === "counterpartyResponse"
        ? (isOpener && dispute.evidenceDueAt.getTime() > now)
          || (isCounterparty && dispute.counterpartyResponseDueAt.getTime() > now)
        : dispute.status === "decided"
          ? participantRole === adverseRole
            && Boolean(dispute.appealDeadlineAt?.getTime() > now)
          : dispute.status === "appealed"
            ? dispute.appealedByUserId === userId
              || Boolean(dispute.appealResponseDueAt?.getTime() > now)
            : false;
    if (!allowed) {
      throw new AppException(
        "ATTENDANCE_CASE_STATE_INVALID",
        "This case is not accepting evidence from you",
        HttpStatus.CONFLICT
      );
    }
  }
}
