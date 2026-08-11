import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import {
  ATTENDANCE_APPEAL_HOURS,
  ATTENDANCE_CASE_WINDOW_DAYS,
  ATTENDANCE_EVIDENCE_HOURS,
  ATTENDANCE_PUBLIC_POLICY,
  ATTENDANCE_RESPONSE_HOURS,
  ATTENDANCE_WAIT_MINUTES
} from "../common/fulfillment-policy";
import { CommercialService } from "../commercial/commercial.service";
import { isFirstReleaseCapabilityEnabled } from "../config/first-release-capability-matrix";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ControlledCaseEvidenceService } from "../moderation/media/controlled-case-evidence.service";
import { PaymentsService } from "../payments/payments.service";
import {
  CreateAttendanceDisputeDto,
  DecideAttendanceDisputeDto,
  FinalizeAttendanceDisputeDto,
  ListAttendanceDisputesDto,
  ReportClientAttendanceEventDto,
  SubmitAttendanceStatementDto
} from "./dto/attendance-dispute.dto";

type ParticipantRole = "customer" | "companion";
type AttendanceDecision = "noRefund" | "fullRefund";
type AttendanceParticipantSummary = {
  trustedProviderEvents: number;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  joinCount: number;
  leaveCount: number;
  reconnectCount: number;
  audioStartedCount: number;
  audioStoppedCount: number;
  auxiliaryClientEvents: number;
};
type AttendanceSummary = {
  providerEvidenceAvailable: boolean;
  providerRoomEvents: number;
  customer: AttendanceParticipantSummary;
  companion: AttendanceParticipantSummary;
  auxiliaryClientEvents: number;
  decisionConstraint: "clientEvidenceCannotDecideCaseAlone";
};

const PROVIDER_EVENT_TYPES: Record<number, string> = {
  101: "roomCreated",
  102: "roomDismissed",
  103: "join",
  104: "leave",
  203: "audioStarted",
  204: "audioStopped"
};
const MAX_PROVIDER_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_PROVIDER_EVENT_AGE_MS = 24 * 60 * 60_000;
const MAX_STATEMENTS_PER_PARTICIPANT = 10;
const CLIENT_ATTENDANCE_HEARTBEAT_SECONDS = 30;
const CLIENT_ATTENDANCE_EVENT_BURST_ALLOWANCE = 20;
const MAX_CLIENT_ATTENDANCE_EVENTS_PER_PARTICIPANT = 520;

@Injectable()
export class AttendanceDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly caseEvidence: ControlledCaseEvidenceService
  ) {}

  policy() {
    return ATTENDANCE_PUBLIC_POLICY;
  }

  async ingestTrtcCallback(rawBody: Buffer | undefined, signature: string | undefined, sdkAppIdHeader: string | undefined) {
    const { sdkAppId, callbackKey } = this.trtcCallbackRuntime();
    if (!rawBody?.length || rawBody.length > 64 * 1024 || !signature || !sdkAppIdHeader) {
      throw new AppException("TRTC_CALLBACK_INVALID", "Invalid TRTC callback", HttpStatus.BAD_REQUEST);
    }
    if (sdkAppIdHeader !== String(sdkAppId)) {
      throw new AppException("TRTC_CALLBACK_APP_MISMATCH", "Invalid TRTC callback", HttpStatus.FORBIDDEN);
    }
    const expected = createHmac("sha256", callbackKey).update(rawBody).digest("base64");
    const suppliedBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new AppException("TRTC_CALLBACK_SIGNATURE_INVALID", "Invalid TRTC callback", HttpStatus.FORBIDDEN);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new AppException("TRTC_CALLBACK_INVALID_JSON", "Invalid TRTC callback", HttpStatus.BAD_REQUEST);
    }
    const eventGroupId = this.safeInteger(payload?.EventGroupId);
    const eventTypeCode = this.safeInteger(payload?.EventType);
    const callbackTs = this.safeInteger(payload?.CallbackTs);
    const info = payload?.EventInfo;
    if (![1, 2].includes(eventGroupId) || !callbackTs || !info || typeof info !== "object" || Array.isArray(info)) {
      throw new AppException("TRTC_CALLBACK_INVALID", "Invalid TRTC callback", HttpStatus.BAD_REQUEST);
    }
    if (Math.abs(Date.now() - callbackTs) > MAX_PROVIDER_CLOCK_SKEW_MS) {
      throw new AppException("TRTC_CALLBACK_EXPIRED", "Expired TRTC callback", HttpStatus.FORBIDDEN);
    }
    let mappedType = PROVIDER_EVENT_TYPES[eventTypeCode];
    if (!mappedType || (eventGroupId === 1 && eventTypeCode >= 200) || (eventGroupId === 2 && eventTypeCode < 200)) {
      return { code: 0, accepted: false, reason: "event_not_allowlisted" };
    }
    const roomId = typeof info.RoomId === "string" || typeof info.RoomId === "number" ? String(info.RoomId) : "";
    if (!roomId || roomId.length > 191) {
      throw new AppException("TRTC_CALLBACK_ROOM_INVALID", "Invalid TRTC callback", HttpStatus.BAD_REQUEST);
    }
    const providerOccurredMs = this.safeInteger(info.EventMsTs)
      || (this.safeInteger(info.EventTs) ? this.safeInteger(info.EventTs) * 1000 : 0);
    if (!providerOccurredMs || Math.abs(callbackTs - providerOccurredMs) > MAX_PROVIDER_EVENT_AGE_MS) {
      throw new AppException("TRTC_CALLBACK_EVENT_TIME_INVALID", "Invalid TRTC callback", HttpStatus.BAD_REQUEST);
    }
    const session: any = await this.prisma.voiceSession.findUnique({
      where: { roomId },
      include: {
        order: { include: { companion: { select: { ownerUserId: true } } } }
      }
    } as any);
    // A correctly signed callback for an unknown room is acknowledged without
    // creating an orphan fact or exposing whether the room ever existed.
    if (!session) return { code: 0, accepted: false, reason: "room_not_managed" };

    let participantRole: "customer" | "companion" | "system" = "system";
    let participantUserId: string | null = null;
    const providerUserId = typeof info.UserId === "string" ? info.UserId : "";
    if ([103, 104, 203, 204].includes(eventTypeCode)) {
      if (!providerUserId || providerUserId.length > 128) {
        throw new AppException("TRTC_CALLBACK_USER_INVALID", "Invalid TRTC callback", HttpStatus.BAD_REQUEST);
      }
      if (providerUserId === this.trtcUserId(session.order.userId)) {
        participantRole = "customer";
        participantUserId = session.order.userId;
      } else if (
        session.order.companion.ownerUserId
        && providerUserId === this.trtcUserId(session.order.companion.ownerUserId)
      ) {
        participantRole = "companion";
        participantUserId = session.order.companion.ownerUserId;
      } else {
        return { code: 0, accepted: false, reason: "participant_not_managed" };
      }
    }
    const reasonCode = this.optionalSafeInteger(info.Reason);
    if (eventTypeCode === 103 && (reasonCode === 2 || reasonCode === 3)) mappedType = "reconnect";
    const providerUniqueId = info.UniqueId === undefined || info.UniqueId === null
      ? null
      : String(info.UniqueId).slice(0, 64);
    const providerEventId = `trtc_${createHash("sha256").update([
      roomId,
      eventGroupId,
      eventTypeCode,
      providerUserId,
      providerOccurredMs,
      providerUniqueId ?? ""
    ].join(":"), "utf8").digest("hex")}`;

    try {
      await this.prisma.voiceAttendanceEvent.create({
        data: {
          voiceSessionId: session.id,
          participantUserId,
          participantRole,
          type: mappedType,
          source: "provider",
          providerEventId,
          providerOccurredAt: new Date(providerOccurredMs),
          providerReasonCode: reasonCode,
          providerUniqueId
        }
      } as any);
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      return { code: 0, accepted: true, duplicate: true };
    }
    return { code: 0, accepted: true, duplicate: false };
  }

  async reportClientEvent(userId: string, orderId: string, dto: ReportClientAttendanceEventDto) {
    this.trtcCallbackRuntime();
    const claimedAt = new Date(dto.claimedAt);
    const now = Date.now();
    if (claimedAt.getTime() > now + 5 * 60_000 || claimedAt.getTime() < now - MAX_PROVIDER_EVENT_AGE_MS) {
      throw new AppException("ATTENDANCE_CLIENT_TIME_INVALID", "Client event time is outside the accepted window", HttpStatus.BAD_REQUEST);
    }
    const order: any = await this.prisma.order.findFirst({
      where: { id: orderId, OR: [{ userId }, { companion: { ownerUserId: userId } }] },
      include: { companion: { select: { ownerUserId: true } }, voiceSession: true }
    } as any);
    if (!order) throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
    if (!order.voiceSession) {
      throw new AppException("VOICE_SESSION_NOT_FOUND", "Voice session has not been created", HttpStatus.CONFLICT);
    }
    const participantRole: ParticipantRole = order.userId === userId ? "customer" : "companion";
    const event = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Every auxiliary event for one voice session shares this lock. A caller
      // therefore cannot race several requests past the bounded counter, while
      // an idempotent retry is still returned even after the cap is reached.
      await db.$queryRaw`SELECT "id" FROM "VoiceSession" WHERE "id" = ${order.voiceSession.id} FOR UPDATE`;
      const duplicate = await db.voiceAttendanceEvent.findFirst({
        where: {
          voiceSessionId: order.voiceSession.id,
          participantUserId: userId,
          clientEventId: dto.clientEventId
        }
      });
      if (duplicate) return duplicate;

      // The official provider callback remains authoritative and is never
      // subject to this client-only limit. Four-hour orders legitimately emit
      // about 480 half-minute heartbeats; the duration-derived allowance keeps
      // shorter sessions tighter while leaving room for joins and reconnects.
      const durationBound = Math.ceil(
        order.durationMinutes * 60 / CLIENT_ATTENDANCE_HEARTBEAT_SECONDS
      ) + CLIENT_ATTENDANCE_EVENT_BURST_ALLOWANCE;
      const eventLimit = Math.min(
        MAX_CLIENT_ATTENDANCE_EVENTS_PER_PARTICIPANT,
        Math.max(CLIENT_ATTENDANCE_EVENT_BURST_ALLOWANCE, durationBound)
      );
      const eventCount = await db.voiceAttendanceEvent.count({
        where: {
          voiceSessionId: order.voiceSession.id,
          participantUserId: userId,
          source: "client"
        }
      });
      if (eventCount >= eventLimit) {
        throw new AppException(
          "ATTENDANCE_CLIENT_EVENT_LIMIT_REACHED",
          "Auxiliary attendance event limit reached for this voice session",
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      return db.voiceAttendanceEvent.create({
        data: {
          voiceSessionId: order.voiceSession.id,
          participantUserId: userId,
          participantRole,
          type: dto.eventType,
          source: "client",
          clientEventId: dto.clientEventId,
          clientClaimedAt: claimedAt
        }
      });
    });
    return {
      id: event.id,
      eventType: event.type,
      source: "client",
      evidenceWeight: "auxiliaryOnly",
      serverReceivedAt: event.serverReceivedAt.toISOString()
    };
  }

  async create(user: AuthenticatedUser, orderId: string, dto: CreateAttendanceDisputeDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: { companion: { select: { ownerUserId: true } } }
      });
      if (!order || (order.userId !== user.id && order.companion.ownerUserId !== user.id)) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
      }
      if (!order.companion.ownerUserId) {
        throw new AppException("ATTENDANCE_COUNTERPARTY_UNAVAILABLE", "The order has no active counterparty", HttpStatus.CONFLICT);
      }
      if (!["paid", "inService", "completed", "refunded"].includes(order.status)) {
        throw new AppException("ATTENDANCE_CASE_ORDER_STATE_INVALID", "Only a paid service appointment can be disputed", HttpStatus.CONFLICT);
      }
      const now = new Date();
      const earliest = order.scheduledAt.getTime() + ATTENDANCE_WAIT_MINUTES * 60_000;
      const latest = order.scheduledAt.getTime()
        + order.durationMinutes * 60_000
        + ATTENDANCE_CASE_WINDOW_DAYS * 24 * 60 * 60_000;
      if (now.getTime() < earliest || now.getTime() > latest) {
        throw new AppException(
          "ATTENDANCE_CASE_WINDOW_CLOSED",
          "Attendance cases are available after the published waiting period and through the after-sales window",
          HttpStatus.CONFLICT,
          { opensAt: new Date(earliest).toISOString(), closesAt: new Date(latest).toISOString() }
        );
      }
      const existing = await db.attendanceDispute.findUnique({ where: { orderId } });
      if (existing) {
        if (existing.openedByUserId === user.id && existing.issue === dto.issue) return existing;
        throw new AppException("ATTENDANCE_CASE_ALREADY_EXISTS", "This order already has an attendance case", HttpStatus.CONFLICT);
      }
      const openedByRole: ParticipantRole = order.userId === user.id ? "customer" : "companion";
      const counterpartyUserId = openedByRole === "customer" ? order.companion.ownerUserId : order.userId;
      const hasInitialStatement = Boolean(dto.statement?.trim());
      const created = await db.attendanceDispute.create({
        data: {
          orderId,
          openedByUserId: user.id,
          openedByRole,
          counterpartyUserId,
          issue: dto.issue,
          status: hasInitialStatement ? "counterpartyResponse" : "evidenceCollection",
          policyVersionSnapshot: order.fulfillmentPolicyVersionSnapshot,
          timezoneSnapshot: order.fulfillmentTimezoneSnapshot,
          evidenceDueAt: new Date(now.getTime() + ATTENDANCE_EVIDENCE_HOURS * 60 * 60_000),
          counterpartyResponseDueAt: new Date(now.getTime() + ATTENDANCE_RESPONSE_HOURS * 60 * 60_000),
          ...(hasInitialStatement ? {
            statements: {
              create: { submittedByUserId: user.id, kind: "initial", statement: dto.statement!.trim() }
            }
          } : {})
        }
      });
      await this.commercial.holdForOrder(orderId, "attendance_dispute", db);
      await this.audit.record({
        actorId: user.id,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          order.userId,
          order.companion.ownerUserId
        ),
        action: "attendance.case_created",
        resourceType: "attendanceDispute",
        resourceId: created.id,
        metadata: {
          orderId,
          issue: dto.issue,
          openedByRole,
          openedByUserId: user.id,
          counterpartyUserId,
          settlementFrozen: true
        }
      }, db);
      await this.notifyAttendanceUsers(db, [counterpartyUserId], {
        disputeId: created.id,
        orderId,
        stage: "opened",
        title: "收到一项订单履约争议",
        body: hasInitialStatement
          ? "请在公开期限内查看出席摘要并提交答辩。"
          : "发起方正在补充事实；答辩窗口开放后可在订单中回应。"
      });
      return created;
    });
    return this.getForParticipant(user.id, result.id);
  }

  async listMine(userId: string, query: ListAttendanceDisputesDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      AND: [
        { OR: [{ openedByUserId: userId }, { counterpartyUserId: userId }] },
        ...(query.status ? [{ status: query.status }] : [])
      ]
    };
    const [items, total] = await Promise.all([
      this.prisma.attendanceDispute.findMany({
        where,
        include: this.caseInclude(),
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.attendanceDispute.count({ where } as any)
    ]);
    const summaries = await this.attendanceSummaries(items as any[]);
    return {
      items: await Promise.all((items as any[]).map(async (item) => ({
        ...(await this.toDto(item, false, summaries.get(item.id))),
        viewerRole: userId === item.openedByUserId
          ? item.openedByRole
          : (item.openedByRole === "customer" ? "companion" : "customer")
      }))),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async getMineByOrder(userId: string, orderId: string) {
    const item: any = await this.prisma.attendanceDispute.findFirst({
      where: {
        orderId,
        OR: [{ openedByUserId: userId }, { counterpartyUserId: userId }]
      },
      select: { id: true }
    } as any);
    return { item: item ? await this.getForParticipant(userId, item.id) : null };
  }

  async getForParticipant(userId: string, disputeId: string) {
    const dispute = await this.loadCase(disputeId);
    if (!dispute || (dispute.openedByUserId !== userId && dispute.counterpartyUserId !== userId)) {
      throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
    }
    const value = await this.toDto(dispute, false);
    return {
      ...value,
      viewerRole: userId === dispute.openedByUserId
        ? dispute.openedByRole
        : (dispute.openedByRole === "customer" ? "companion" : "customer")
    };
  }

  async completeEvidence(userId: string, disputeId: string) {
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute || dispute.openedByUserId !== userId) {
        throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      }
      if (dispute.status !== "evidenceCollection") {
        throw new AppException("ATTENDANCE_CASE_STATE_INVALID", "Evidence collection is already complete", HttpStatus.CONFLICT);
      }
      if (dispute.evidenceDueAt.getTime() <= Date.now()) {
        throw new AppException("ATTENDANCE_EVIDENCE_WINDOW_CLOSED", "The evidence collection window has closed", HttpStatus.CONFLICT);
      }
      await db.attendanceDispute.update({
        where: { id: disputeId },
        data: {
          status: "counterpartyResponse",
          counterpartyResponseDueAt: new Date(Date.now() + ATTENDANCE_RESPONSE_HOURS * 60 * 60_000)
        }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId
        ),
        action: "attendance.evidence_completed",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId
        }
      }, db);
      await this.notifyAttendanceUsers(db, [dispute.counterpartyUserId], {
        disputeId,
        orderId: dispute.orderId,
        stage: "response-opened",
        title: "履约争议答辩窗口已开放",
        body: "请在公开期限内查看出席摘要并提交你的事实说明。"
      });
    });
    return this.getForParticipant(userId, disputeId);
  }

  async submitStatement(userId: string, disputeId: string, dto: SubmitAttendanceStatementDto) {
    // Reject media evidence before the transaction creates a statement. Empty
    // evidence lists remain valid for text-only case statements.
    this.caseEvidence.assertAttachmentsAllowed(dto.evidenceAssetIds);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute || (dispute.openedByUserId !== userId && dispute.counterpartyUserId !== userId)) {
        throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      }
      const participantCount = await db.attendanceDisputeStatement.count({
        where: { disputeId, submittedByUserId: userId }
      });
      if (participantCount >= MAX_STATEMENTS_PER_PARTICIPANT) {
        throw new AppException("ATTENDANCE_STATEMENT_LIMIT_REACHED", "Statement limit reached", HttpStatus.CONFLICT);
      }
      let kind: string;
      let nextStatus: string | undefined;
      const now = Date.now();
      const isCounterparty = dispute.counterpartyUserId === userId;
      if (dispute.status === "evidenceCollection") {
        if (isCounterparty) {
          throw new AppException(
            "ATTENDANCE_RESPONSE_NOT_OPEN",
            "The case owner is still collecting evidence",
            HttpStatus.CONFLICT
          );
        }
        if (dispute.evidenceDueAt.getTime() <= now) {
          throw new AppException("ATTENDANCE_EVIDENCE_WINDOW_CLOSED", "The evidence collection window has closed", HttpStatus.CONFLICT);
        }
        kind = "evidence";
      } else if (dispute.status === "counterpartyResponse") {
        if (!isCounterparty && dispute.evidenceDueAt.getTime() <= now) {
          throw new AppException("ATTENDANCE_EVIDENCE_WINDOW_CLOSED", "The evidence collection window has closed", HttpStatus.CONFLICT);
        }
        if (isCounterparty && dispute.counterpartyResponseDueAt.getTime() <= now) {
          throw new AppException("ATTENDANCE_RESPONSE_WINDOW_CLOSED", "The counterparty response window has closed", HttpStatus.CONFLICT);
        }
        kind = isCounterparty ? "counterpartyResponse" : "evidence";
        if (isCounterparty) nextStatus = "review";
      } else if (dispute.status === "appealed") {
        if (
          dispute.appealedByUserId !== userId
          && dispute.appealResponseDueAt
          && dispute.appealResponseDueAt.getTime() <= now
        ) {
          throw new AppException("ATTENDANCE_APPEAL_RESPONSE_WINDOW_CLOSED", "The appeal response window has closed", HttpStatus.CONFLICT);
        }
        kind = dispute.appealedByUserId === userId ? "appeal" : "appealResponse";
      } else {
        throw new AppException("ATTENDANCE_CASE_STATE_INVALID", "This case is not accepting statements", HttpStatus.CONFLICT);
      }
      const createdStatement = await db.attendanceDisputeStatement.create({
        data: { disputeId, submittedByUserId: userId, kind, statement: dto.statement.trim() }
      });
      await this.caseEvidence.bindAttendanceStatement(db, {
        assetIds: dto.evidenceAssetIds,
        userId,
        disputeId,
        statementId: createdStatement.id
      });
      if (nextStatus) await db.attendanceDispute.update({ where: { id: disputeId }, data: { status: nextStatus } });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId
        ),
        action: "attendance.statement_submitted",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          kind,
          evidenceCount: dto.evidenceAssetIds?.length ?? 0,
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId
        }
      }, db);
      if (kind === "counterpartyResponse") {
        await this.notifyAttendanceUsers(db, [dispute.openedByUserId], {
          disputeId,
          orderId: dispute.orderId,
          stage: "counterparty-responded",
          title: "履约争议已收到对方答辩",
          body: "案件已进入平台复核；请在订单中查看最新状态。"
        });
      } else if (kind === "appealResponse") {
        await this.notifyAttendanceUsers(db, [dispute.appealedByUserId], {
          disputeId,
          orderId: dispute.orderId,
          stage: "appeal-responded",
          title: "履约申诉已收到对方答辩",
          body: "独立复核将在答辩事实基础上继续处理。"
        });
      }
    });
    return this.getForParticipant(userId, disputeId);
  }

  async appeal(userId: string, disputeId: string, dto: SubmitAttendanceStatementDto) {
    // An appeal can remain a pure-text appeal in the first release, but may not
    // start a transaction when it carries historical media references.
    this.caseEvidence.assertAttachmentsAllowed(dto.evidenceAssetIds);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute || (dispute.openedByUserId !== userId && dispute.counterpartyUserId !== userId)) {
        throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      }
      if (dispute.status !== "decided" || !dispute.appealDeadlineAt || dispute.appealDeadlineAt.getTime() <= Date.now()) {
        throw new AppException("ATTENDANCE_APPEAL_UNAVAILABLE", "The appeal window is not open", HttpStatus.CONFLICT);
      }
      const participantRole: ParticipantRole = dispute.openedByUserId === userId
        ? dispute.openedByRole
        : (dispute.openedByRole === "customer" ? "companion" : "customer");
      const adverselyAffectedRole: ParticipantRole = dispute.decision === "fullRefund"
        ? "companion"
        : "customer";
      if (participantRole !== adverselyAffectedRole) {
        throw new AppException(
          "ATTENDANCE_APPEAL_NOT_ADVERSELY_AFFECTED",
          "Only the participant adversely affected by the current decision may appeal it",
          HttpStatus.CONFLICT
        );
      }
      const now = new Date();
      const appealStatement = await db.attendanceDisputeStatement.create({
        data: { disputeId, submittedByUserId: userId, kind: "appeal", statement: dto.statement.trim() }
      });
      await this.caseEvidence.bindAttendanceStatement(db, {
        assetIds: dto.evidenceAssetIds,
        userId,
        disputeId,
        statementId: appealStatement.id
      });
      await db.attendanceDispute.update({
        where: { id: disputeId },
        data: {
          status: "appealed",
          appealedByUserId: userId,
          appealedAt: now,
          appealResponseDueAt: new Date(now.getTime() + ATTENDANCE_RESPONSE_HOURS * 60 * 60_000)
        }
      });
      await this.audit.record({
        actorId: userId,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId
        ),
        action: "attendance.case_appealed",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          evidenceCount: dto.evidenceAssetIds?.length ?? 0,
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId
        }
      }, db);
      const appealCounterparty = dispute.openedByUserId === userId
        ? dispute.counterpartyUserId
        : dispute.openedByUserId;
      await this.notifyAttendanceUsers(db, [appealCounterparty], {
        disputeId,
        orderId: dispute.orderId,
        stage: "appealed",
        title: "履约争议已进入独立申诉复核",
        body: "请在申诉答辩期限内查看案件并提交你的事实说明。"
      });
    });
    return this.getForParticipant(userId, disputeId);
  }

  async listAdmin(actor: AuthenticatedUser, query: ListAttendanceDisputesDto) {
    this.assertStaff(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      ...(query.status ? { status: query.status } : {}),
      ...(actor.role === "support" ? {
        OR: [{ assignedToUserId: actor.id }, { appealAssignedToUserId: actor.id }]
      } : {})
    };
    const [rows, total] = await Promise.all([
      this.prisma.attendanceDispute.findMany({
        where,
        include: this.caseInclude(),
        orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.attendanceDispute.count({ where } as any)
    ]);
    const summaries = await this.attendanceSummaries(rows as any[]);
    return {
      items: await Promise.all((rows as any[]).map((row) =>
        this.toDto(row, true, summaries.get(row.id))
      )),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async getForStaff(actor: AuthenticatedUser, disputeId: string) {
    this.assertStaff(actor);
    const dispute = await this.loadCase(disputeId);
    if (
      actor.role === "support"
      && dispute?.assignedToUserId !== actor.id
      && dispute?.appealAssignedToUserId !== actor.id
    ) {
      throw new AppException(
        "ATTENDANCE_CASE_NOT_FOUND",
        "Attendance case not found",
        HttpStatus.NOT_FOUND
      );
    }
    return this.toDto(dispute, true);
  }

  async listClaimable(actor: AuthenticatedUser, query: ListAttendanceDisputesDto) {
    this.assertStaff(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const now = new Date();
    const where: any = {
      OR: [
        {
          assignedToUserId: null,
          OR: [
            { status: "review" },
            { status: "evidenceCollection", evidenceDueAt: { lte: now } },
            { status: "counterpartyResponse", counterpartyResponseDueAt: { lte: now } },
            { status: "evidenceCollection", issue: "safetyBoundary" },
            { status: "counterpartyResponse", issue: "safetyBoundary" }
          ]
        },
        {
          status: "appealed",
          appealAssignedToUserId: null,
          decidedByUserId: { not: actor.id },
          OR: [
            { appealResponseDueAt: { lte: now } },
            { statements: { some: { kind: "appealResponse" } } }
          ]
        }
      ]
    };
    const [items, total] = await Promise.all([
      this.prisma.attendanceDispute.findMany({
        where,
        select: {
          id: true,
          issue: true,
          status: true,
          evidenceDueAt: true,
          counterpartyResponseDueAt: true,
          appealResponseDueAt: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.attendanceDispute.count({ where } as any)
    ]);
    return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async claim(actor: AuthenticatedUser, disputeId: string) {
    this.assertStaff(actor);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      if (dispute.assignedToUserId && dispute.assignedToUserId !== actor.id) {
        throw new AppException("ATTENDANCE_CASE_ALREADY_ASSIGNED", "Attendance case is already assigned", HttpStatus.CONFLICT);
      }
      const ready = dispute.status === "review"
        || dispute.issue === "safetyBoundary"
        || (dispute.status === "evidenceCollection" && dispute.evidenceDueAt.getTime() <= Date.now())
        || (dispute.status === "counterpartyResponse" && dispute.counterpartyResponseDueAt.getTime() <= Date.now());
      if (!ready) throw new AppException("ATTENDANCE_CASE_NOT_READY", "Evidence or response collection is still open", HttpStatus.CONFLICT);
      await db.attendanceDispute.update({
        where: { id: disputeId },
        data: { assignedToUserId: actor.id, assignedAt: new Date(), status: "review" }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId
        ),
        action: "attendance.case_claimed",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          actorRole: actor.role,
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId
        }
      }, db);
    });
    return this.toDto(await this.loadCase(disputeId), true);
  }

  async decide(actor: AuthenticatedUser, disputeId: string, dto: DecideAttendanceDisputeDto) {
    this.assertStaff(actor);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      if (dispute.status !== "review" || dispute.assignedToUserId !== actor.id) {
        throw new AppException("ATTENDANCE_CASE_ASSIGNEE_REQUIRED", "Only the assigned reviewer can decide this case", HttpStatus.FORBIDDEN);
      }
      const now = new Date();
      await db.attendanceDispute.update({
        where: { id: disputeId },
        data: {
          status: "decided",
          decision: dto.decision,
          decisionReason: dto.reason.trim(),
          decidedByUserId: actor.id,
          decidedAt: now,
          appealDeadlineAt: new Date(now.getTime() + ATTENDANCE_APPEAL_HOURS * 60 * 60_000)
        }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId
        ),
        action: "attendance.case_decided",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          decision: dto.decision,
          refundCreated: false,
          appealWindowHours: ATTENDANCE_APPEAL_HOURS,
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId
        }
      }, db);
      await this.notifyAttendanceUsers(db, [dispute.openedByUserId, dispute.counterpartyUserId], {
        disputeId,
        orderId: dispute.orderId,
        stage: "decided",
        title: "履约争议首轮结果已更新",
        body: "请在公开申诉期限内查看理由；首轮结果不代表退款已经到账。"
      });
    });
    return this.toDto(await this.loadCase(disputeId), true);
  }

  async claimAppeal(actor: AuthenticatedUser, disputeId: string) {
    this.assertStaff(actor);
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      if (dispute.status !== "appealed") {
        throw new AppException("ATTENDANCE_CASE_STATE_INVALID", "This case is not awaiting appeal review", HttpStatus.CONFLICT);
      }
      if (dispute.decidedByUserId === actor.id) {
        throw new AppException("ATTENDANCE_APPEAL_INDEPENDENT_REVIEW_REQUIRED", "The initial reviewer cannot review the appeal", HttpStatus.FORBIDDEN);
      }
      const appealResponseCount = await db.attendanceDisputeStatement.count({
        where: { disputeId, kind: "appealResponse" }
      });
      if (
        appealResponseCount === 0
        && dispute.appealResponseDueAt
        && dispute.appealResponseDueAt.getTime() > Date.now()
      ) {
        throw new AppException(
          "ATTENDANCE_APPEAL_RESPONSE_WINDOW_OPEN",
          "The counterparty response window is still open",
          HttpStatus.CONFLICT
        );
      }
      if (dispute.appealAssignedToUserId && dispute.appealAssignedToUserId !== actor.id) {
        throw new AppException("ATTENDANCE_APPEAL_ALREADY_ASSIGNED", "The appeal is already assigned", HttpStatus.CONFLICT);
      }
      await db.attendanceDispute.update({
        where: { id: disputeId },
        data: { appealAssignedToUserId: actor.id, appealAssignedAt: new Date() }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId,
          dispute.decidedByUserId
        ),
        action: "attendance.appeal_claimed",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          initialReviewerId: dispute.decidedByUserId,
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId
        }
      }, db);
    });
    return this.toDto(await this.loadCase(disputeId), true);
  }

  async finalize(actor: AuthenticatedUser, disputeId: string, dto: FinalizeAttendanceDisputeDto) {
    this.assertStaff(actor);
    let finalized: any = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "AttendanceDispute" WHERE "id" = ${disputeId} FOR UPDATE`;
      const dispute = await db.attendanceDispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
      if (dispute.status === "final") {
        if (dispute.finalDecision === "fullRefund" && !dispute.refundTransactionId) return dispute;
        return dispute;
      }
      let finalDecision: AttendanceDecision;
      let finalReason: string;
      const now = new Date();
      if (dispute.status === "appealed") {
        const appealResponseCount = await db.attendanceDisputeStatement.count({
          where: { disputeId, kind: "appealResponse" }
        });
        if (
          dispute.appealAssignedToUserId !== actor.id
          || dispute.decidedByUserId === actor.id
          || !dto.decision
          || !dto.reason
        ) {
          throw new AppException(
            "ATTENDANCE_APPEAL_REVIEWER_REQUIRED",
            "A different assigned appeal reviewer must provide the final decision",
            HttpStatus.FORBIDDEN
          );
        }
        if (
          appealResponseCount === 0
          && dispute.appealResponseDueAt
          && dispute.appealResponseDueAt.getTime() > now.getTime()
        ) {
          throw new AppException(
            "ATTENDANCE_APPEAL_RESPONSE_WINDOW_OPEN",
            "The counterparty response window is still open",
            HttpStatus.CONFLICT
          );
        }
        finalDecision = dto.decision;
        finalReason = dto.reason.trim();
      } else if (dispute.status === "decided") {
        if (!dispute.appealDeadlineAt || dispute.appealDeadlineAt.getTime() > now.getTime()) {
          throw new AppException("ATTENDANCE_APPEAL_WINDOW_OPEN", "The appeal window is still open", HttpStatus.CONFLICT);
        }
        if (dispute.decidedByUserId !== actor.id || !dispute.decision || !dispute.decisionReason) {
          throw new AppException("ATTENDANCE_CASE_ASSIGNEE_REQUIRED", "Only the initial reviewer can finalize an unappealed decision", HttpStatus.FORBIDDEN);
        }
        finalDecision = dispute.decision;
        finalReason = dispute.decisionReason;
      } else {
        throw new AppException("ATTENDANCE_CASE_STATE_INVALID", "This case cannot be finalized", HttpStatus.CONFLICT);
      }
      const updated = await db.attendanceDispute.update({
        where: { id: disputeId },
        data: {
          status: "final",
          finalDecision,
          finalReason,
          finalizedAt: now,
          ...(dispute.status === "appealed" ? {
            appealReviewedByUserId: actor.id,
            appealReviewedAt: now
          } : {})
        }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          dispute.openedByUserId,
          dispute.counterpartyUserId,
          dispute.decidedByUserId
        ),
        action: "attendance.case_finalized",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          finalDecision,
          independentAppealReview: dispute.status === "appealed",
          openedByUserId: dispute.openedByUserId,
          counterpartyUserId: dispute.counterpartyUserId,
          initialReviewerId: dispute.decidedByUserId,
          refundCreated: false
        }
      }, db);
      await this.notifyAttendanceUsers(db, [dispute.openedByUserId, dispute.counterpartyUserId], {
        disputeId,
        orderId: dispute.orderId,
        stage: "finalized",
        title: "履约争议终局结果已更新",
        body: "请在订单中查看终局理由；退款是否成功仍以支付渠道交易状态为准。"
      });
      return updated;
    });

    if (finalized.finalDecision === "fullRefund" && !finalized.refundTransactionId) {
      const refundResult: any = await this.payments.requestAttendanceDisputeRefund(
        actor.id,
        disputeId,
        `attendance_dispute:${finalized.issue}`
      );
      finalized = await this.prisma.attendanceDispute.update({
        where: { id: disputeId },
        data: { refundTransactionId: refundResult.refund.id }
      } as any);
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: this.attendanceAuditSubjectUserIds(
          finalized.openedByUserId,
          finalized.counterpartyUserId
        ),
        action: "attendance.refund_workflow_started",
        resourceType: "attendanceDispute",
        resourceId: disputeId,
        metadata: {
          openedByUserId: finalized.openedByUserId,
          counterpartyUserId: finalized.counterpartyUserId,
          refundId: refundResult.refund.id,
          refundStatus: refundResult.refund.status,
          providerSuccessClaimed: refundResult.refund.status === "success"
        }
      });
    }
    await this.commercial.reconcileOrderEarning(finalized.orderId);
    return this.toDto(await this.loadCase(disputeId), true);
  }

  private attendanceAuditSubjectUserIds(
    ...userIds: Array<string | null | undefined>
  ): string[] {
    const subjects = [...new Set(userIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0
    ))];
    if (!subjects.length) {
      throw new Error("Attendance audit requires at least one business subject");
    }
    return subjects;
  }

  private trtcCallbackRuntime() {
    if (!isFirstReleaseCapabilityEnabled("trtcUserSig", this.config)) {
      throw new AppException(
        "COMMERCIAL_SURFACE_TEXT_ONLY",
        "Real-time voice is disabled for the current commercial surface",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    if (this.config.get<boolean>("TRTC_ENABLED", false) !== true) {
      throw new AppException("TRTC_CALLBACK_DISABLED", "TRTC callback intake is disabled", HttpStatus.SERVICE_UNAVAILABLE);
    }
    const sdkAppId = this.config.get<number>("TRTC_SDK_APP_ID", 0);
    const callbackKey = this.config.get<string>("TRTC_CALLBACK_SIGNING_KEY", "");
    if (!Number.isSafeInteger(sdkAppId) || sdkAppId < 1 || !/^[A-Za-z0-9]{16,32}$/.test(callbackKey)) {
      throw new AppException("TRTC_CALLBACK_DISABLED", "TRTC callback intake is not configured", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { sdkAppId, callbackKey };
  }

  private safeInteger(value: unknown): number {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
  }

  private optionalSafeInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }

  private trtcUserId(platformUserId: string): string {
    const opaque = createHash("sha256")
      .update(`talk-and-talk:trtc-user:${platformUserId}`)
      .digest("base64url")
      .slice(0, 24);
    return `tt_${opaque}`;
  }

  private assertStaff(actor: AuthenticatedUser): void {
    if (!["support", "admin"].includes(actor.role)) {
      throw new AppException("FORBIDDEN", "Insufficient permissions", HttpStatus.FORBIDDEN);
    }
  }

  private async notifyAttendanceUsers(
    db: any,
    userIds: Array<string | null | undefined>,
    input: {
      disputeId: string;
      orderId: string;
      stage: string;
      title: string;
      body: string;
    }
  ) {
    for (const userId of [...new Set(userIds.filter((value): value is string => Boolean(value)))]) {
      await this.notifications.createTransactional(db, {
        userId,
        type: "supportUpdate",
        title: input.title,
        body: input.body,
        data: { orderId: input.orderId, attendanceDisputeId: input.disputeId },
        eventKey: `attendance:${input.disputeId}:${input.stage}:${userId}`,
        templateKey: "supportUpdate"
      });
    }
  }

  private async loadCase(disputeId: string): Promise<any | null> {
    return this.prisma.attendanceDispute.findUnique({
      where: { id: disputeId },
      include: this.caseInclude()
    } as any);
  }

  private caseInclude() {
    return {
      order: {
        include: {
          voiceSession: true,
          companion: { select: { ownerUserId: true } }
        }
      },
      statements: {
        include: this.caseEvidence.attachmentInclude(),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      },
      refundTransaction: true
    } as const;
  }

  private async attendanceSummary(dispute: any) {
    // Historical real-time attendance facts are part of the disabled voice
    // surface. Keep a text-only dispute readable for its written statements,
    // but never query or project those facts back to a participant or staff.
    if (!isFirstReleaseCapabilityEnabled("trtcUserSig", this.config)) {
      return this.emptyAttendanceSummary();
    }
    const sessionId = dispute.order?.voiceSession?.id;
    if (!sessionId) return this.emptyAttendanceSummary();
    const groups: any[] = await this.prisma.voiceAttendanceEvent.groupBy({
      by: ["source", "participantRole", "type"],
      where: { voiceSessionId: sessionId },
      _count: { _all: true },
      _min: { providerOccurredAt: true },
      _max: { providerOccurredAt: true }
    } as any);
    return this.attendanceSummaryFromGroups(groups);
  }

  private async attendanceSummaries(disputes: any[]) {
    const summaries = new Map<string, AttendanceSummary>();
    if (!isFirstReleaseCapabilityEnabled("trtcUserSig", this.config)) {
      for (const dispute of disputes) summaries.set(dispute.id, this.emptyAttendanceSummary());
      return summaries;
    }
    const sessionIds = [...new Set(disputes
      .map((dispute) => dispute.order?.voiceSession?.id)
      .filter((id): id is string => Boolean(id)))];
    if (sessionIds.length === 0) {
      for (const dispute of disputes) summaries.set(dispute.id, this.emptyAttendanceSummary());
      return summaries;
    }
    const groups: any[] = await this.prisma.voiceAttendanceEvent.groupBy({
      by: ["voiceSessionId", "source", "participantRole", "type"],
      where: { voiceSessionId: { in: sessionIds } },
      _count: { _all: true },
      _min: { providerOccurredAt: true },
      _max: { providerOccurredAt: true }
    } as any);
    const bySession = new Map<string, any[]>();
    for (const group of groups) {
      const current = bySession.get(group.voiceSessionId) ?? [];
      current.push(group);
      bySession.set(group.voiceSessionId, current);
    }
    for (const dispute of disputes) {
      const sessionId = dispute.order?.voiceSession?.id;
      summaries.set(
        dispute.id,
        sessionId
          ? this.attendanceSummaryFromGroups(bySession.get(sessionId) ?? [])
          : this.emptyAttendanceSummary()
      );
    }
    return summaries;
  }

  private attendanceSummaryFromGroups(groups: any[]): AttendanceSummary {
    const count = (group: any) => Number(group?._count?._all ?? 0);
    const matching = (source: string, role?: ParticipantRole | "system", type?: string) => groups.filter((group) =>
      group.source === source
      && (role === undefined || group.participantRole === role)
      && (type === undefined || group.type === type)
    );
    const sum = (rows: any[]) => rows.reduce((total, row) => total + count(row), 0);
    const minimumTime = (rows: any[]) => rows.reduce<Date | null>((minimum, row) => {
      const value = row?._min?.providerOccurredAt;
      return value instanceof Date && (!minimum || value.getTime() < minimum.getTime()) ? value : minimum;
    }, null);
    const maximumTime = (rows: any[]) => rows.reduce<Date | null>((maximum, row) => {
      const value = row?._max?.providerOccurredAt;
      return value instanceof Date && (!maximum || value.getTime() > maximum.getTime()) ? value : maximum;
    }, null);
    const summarize = (role: ParticipantRole) => {
      const trusted = matching("provider", role);
      const joins = trusted.filter((group) => group.type === "join" || group.type === "reconnect");
      const leaves = trusted.filter((group) => group.type === "leave");
      return {
        trustedProviderEvents: sum(trusted),
        firstJoinedAt: minimumTime(joins)?.toISOString() ?? null,
        lastLeftAt: maximumTime(leaves)?.toISOString() ?? null,
        joinCount: sum(matching("provider", role, "join")),
        leaveCount: sum(matching("provider", role, "leave")),
        reconnectCount: sum(matching("provider", role, "reconnect")),
        audioStartedCount: sum(matching("provider", role, "audioStarted")),
        audioStoppedCount: sum(matching("provider", role, "audioStopped")),
        auxiliaryClientEvents: sum(matching("client", role))
      };
    };
    const providerEvents = matching("provider");
    return {
      providerEvidenceAvailable: sum(providerEvents) > 0,
      providerRoomEvents: sum(matching("provider", "system")),
      customer: summarize("customer"),
      companion: summarize("companion"),
      auxiliaryClientEvents: sum(matching("client")),
      decisionConstraint: "clientEvidenceCannotDecideCaseAlone"
    };
  }

  private emptyAttendanceSummary(): AttendanceSummary {
    return {
      providerEvidenceAvailable: false,
      providerRoomEvents: 0,
      customer: this.emptyParticipantSummary(),
      companion: this.emptyParticipantSummary(),
      auxiliaryClientEvents: 0,
      decisionConstraint: "clientEvidenceCannotDecideCaseAlone"
    };
  }

  private emptyParticipantSummary(): AttendanceParticipantSummary {
    return {
      trustedProviderEvents: 0,
      firstJoinedAt: null,
      lastLeftAt: null,
      joinCount: 0,
      leaveCount: 0,
      reconnectCount: 0,
      audioStartedCount: 0,
      audioStoppedCount: 0,
      auxiliaryClientEvents: 0
    };
  }

  private async toDto(
    dispute: any,
    staff: boolean,
    precomputedAttendanceSummary?: AttendanceSummary
  ) {
    if (!dispute) throw new AppException("ATTENDANCE_CASE_NOT_FOUND", "Attendance case not found", HttpStatus.NOT_FOUND);
    const participantRoleFor = (userId: string) => userId === dispute.openedByUserId
      ? dispute.openedByRole
      : (dispute.openedByRole === "customer" ? "companion" : "customer");
    return {
      id: dispute.id,
      order: {
        id: dispute.order.id,
        status: dispute.order.status,
        scheduledAt: dispute.order.scheduledAt.toISOString(),
        durationMinutes: dispute.order.durationMinutes,
        serviceTitle: dispute.order.serviceOfferingTitleSnapshot ?? null
      },
      issue: dispute.issue,
      status: dispute.status,
      openedByRole: dispute.openedByRole,
      policyVersion: dispute.policyVersionSnapshot,
      timezone: dispute.timezoneSnapshot,
      deadlines: {
        evidenceDueAt: dispute.evidenceDueAt.toISOString(),
        counterpartyResponseDueAt: dispute.counterpartyResponseDueAt.toISOString(),
        appealDeadlineAt: dispute.appealDeadlineAt?.toISOString() ?? null,
        appealResponseDueAt: dispute.appealResponseDueAt?.toISOString() ?? null
      },
      statements: dispute.statements.map((statement: any) => ({
        id: statement.id,
        participantRole: participantRoleFor(statement.submittedByUserId),
        kind: statement.kind,
        statement: statement.statement,
        evidenceAttachments: this.caseEvidence.attachmentDtos(statement),
        createdAt: statement.createdAt.toISOString()
      })),
      attendanceSummary: precomputedAttendanceSummary ?? await this.attendanceSummary(dispute),
      decision: dispute.decision ? {
        outcome: dispute.decision,
        reason: dispute.decisionReason,
        decidedAt: dispute.decidedAt?.toISOString() ?? null
      } : null,
      appeal: dispute.appealedAt ? {
        appealedByRole: participantRoleFor(dispute.appealedByUserId),
        appealedAt: dispute.appealedAt.toISOString(),
        independentlyAssigned: Boolean(dispute.appealAssignedToUserId)
      } : null,
      finalDecision: dispute.finalDecision ? {
        outcome: dispute.finalDecision,
        reason: dispute.finalReason,
        finalizedAt: dispute.finalizedAt?.toISOString() ?? null
      } : null,
      refund: dispute.refundTransaction ? {
        id: dispute.refundTransaction.id,
        status: dispute.refundTransaction.status,
        amountCents: dispute.refundTransaction.amountCents,
        successConfirmedAt: dispute.refundTransaction.status === "success"
          ? dispute.refundTransaction.updatedAt.toISOString()
          : null
      } : null,
      recording: "notRecordedByDefault",
      ...(staff ? {
        staff: {
          assignedToUserId: dispute.assignedToUserId,
          decidedByUserId: dispute.decidedByUserId,
          appealAssignedToUserId: dispute.appealAssignedToUserId,
          appealReviewedByUserId: dispute.appealReviewedByUserId
        }
      } : {}),
      createdAt: dispute.createdAt.toISOString(),
      updatedAt: dispute.updatedAt.toISOString()
    };
  }
}
