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
  | { purpose: "companionIncidentReport"; companionIncidentReportId: string };

@Injectable()
export class ControlledCaseEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAssets: MediaAssetService,
    private readonly worker: ControlledCaseEvidenceWorker
  ) {}

  async reserveForSupport(user: AuthenticatedUser, ticketId: string, input: ReserveInput) {
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

  async complete(userId: string, assetId: string) {
    const result = await this.mediaAssets.completeControlled(assetId, userId);
    if (result.asset.status === "scanning") this.worker.enqueue(assetId);
    return result;
  }

  status(userId: string, assetId: string) {
    return this.mediaAssets.controlledStatus(assetId, userId);
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

  attachmentInclude() {
    return {
      evidenceAttachments: {
        include: { mediaAsset: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }
    } as const;
  }

  attachmentDtos(record: any) {
    return (record?.evidenceAttachments ?? [])
      .filter((item: any) => item.mediaAsset?.status === "approved")
      .map((item: any) => this.mediaAssets.controlledAttachmentDto(item));
  }

  async createReadUrl(user: AuthenticatedUser, attachmentId: string) {
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
        }
      }
    } as any);
    if (!attachment || !this.canRead(user, attachment)) {
      throw new AppException("CASE_EVIDENCE_NOT_FOUND", "Evidence attachment was not found", HttpStatus.NOT_FOUND);
    }
    const url = await this.mediaAssets.approvedReadUrl(attachment.mediaAsset);
    return {
      attachmentId: attachment.id,
      kind: attachment.mediaAsset.kind,
      url,
      assetExpiresAt: attachment.mediaAsset.expiresAt.toISOString()
    };
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
              : { companionIncidentReportId: input.target.companionIncidentReportId })
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
        || user.role === "supply";
    }
    return false;
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
