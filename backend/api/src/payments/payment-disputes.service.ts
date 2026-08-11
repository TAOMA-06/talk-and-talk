import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  AssignPaymentDisputeDto,
  CompletePaymentDisputeDto,
  ListPaymentDisputeEvidenceDto,
  ListPaymentDisputesDto,
  ReplyPaymentDisputeDto
} from "./dto/payment-dispute.dto";
import {
  WECHAT_PAY_PROVIDER,
  WeChatComplaintDetail,
  WeChatComplaintNegotiationEvent,
  WeChatPayProvider
} from "./wechat/wechat-pay.provider";

const ACTIVE_STATUSES = ["pendingSync", "open", "processing", "syncFailed"];
const PROVIDER_SYNC_INTERVAL_MS = 30 * 60_000;

@Injectable()
export class PaymentDisputesService {
  private readonly logger = new Logger(PaymentDisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly wechat: WeChatPayProvider
  ) {}

  async handleWechatComplaintNotify(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ) {
    const verified = this.wechat.verifyNotifySignatureAsync
      ? await this.wechat.verifyNotifySignatureAsync(headers, rawBody)
      : this.wechat.verifyNotifySignature(headers, rawBody);
    if (!verified) {
      throw new AppException(
        "WECHAT_COMPLAINT_SIGNATURE_INVALID",
        "Invalid WeChat complaint notification signature",
        HttpStatus.UNAUTHORIZED
      );
    }

    const payload = this.wechat.parseComplaintNotifyPayload(rawBody);
    const rawDigest = createHash("sha256").update(rawBody).digest("hex");
    const providerCreatedAt = safeDate(payload.createTime);
    const dispute = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const existing = await db.paymentDispute.findUnique({
        where: { channel_providerDisputeId: { channel: "wechat", providerDisputeId: payload.complaintId } }
      });
      const current = existing ?? await db.paymentDispute.create({
        data: {
          channel: "wechat",
          type: "consumer_complaint",
          providerDisputeId: payload.complaintId,
          idempotencyKey: `wechat:consumer_complaint:${payload.complaintId}`,
          latestActionType: payload.actionType,
          nextReconcileAt: new Date()
        }
      });
      if (existing) {
        await db.paymentDispute.update({
          where: { id: current.id },
          data: { latestActionType: payload.actionType, nextReconcileAt: new Date() }
        });
      }
      const priorNotice = await db.paymentDisputeNotification.findUnique({
        where: { providerNotificationId: payload.notificationId }
      });
      if (!priorNotice) {
        await db.paymentDisputeNotification.create({
          data: {
            disputeId: current.id,
            providerNotificationId: payload.notificationId,
            eventType: payload.eventType,
            actionType: payload.actionType,
            summary: payload.summary?.slice(0, 64) || null,
            rawDigest,
            providerCreatedAt
          }
        });
        await this.audit.record({
          action: "payment_dispute.wechat_notification_received",
          resourceType: "paymentDispute",
          resourceId: current.id,
          metadata: {
            providerNotificationId: payload.notificationId,
            providerDisputeId: payload.complaintId,
            eventType: payload.eventType,
            actionType: payload.actionType
          }
        }, db);
      }
      return current;
    });

    // The official callback must be acknowledged within five seconds. The
    // durable row above is the handoff; provider detail sync is retryable.
    void this.reconcileById(dispute.id, false).catch((error) => {
      this.logger.warn(`WeChat complaint detail sync deferred (${error instanceof Error ? error.name : "unknown"})`);
    });
    return { accepted: true };
  }

  async listMine(userId: string, query: ListPaymentDisputesDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      AND: [
        {
          OR: [
            { order: { userId } },
            { order: { companion: { ownerUserId: userId } } },
            { complaintOrders: { some: { order: { userId } } } },
            { complaintOrders: { some: { order: { companion: { ownerUserId: userId } } } } }
          ]
        },
        ...(query.status ? [{ status: query.status }] : [])
      ]
    };
    const [items, total] = await Promise.all([
      (this.prisma as any).paymentDispute.findMany({
        where,
        include: this.userOwnershipInclude(userId),
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      (this.prisma as any).paymentDispute.count({ where })
    ]);
    return {
      items: items.map((item: any) => this.toUserDto(item, userId)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async getMine(userId: string, id: string) {
    const item = await (this.prisma as any).paymentDispute.findFirst({
      where: {
        id,
        OR: [
          { order: { userId } },
          { order: { companion: { ownerUserId: userId } } },
          { complaintOrders: { some: { order: { userId } } } },
          { complaintOrders: { some: { order: { companion: { ownerUserId: userId } } } } }
        ]
      },
      include: this.userOwnershipInclude(userId)
    });
    if (!item) {
      throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
    }
    return this.toUserDto(item, userId);
  }

  async getMineByOrder(userId: string, orderId: string) {
    const item = await (this.prisma as any).paymentDispute.findFirst({
      where: {
        complaintOrders: {
          some: {
            orderId,
            OR: [
              { order: { userId } },
              { order: { companion: { ownerUserId: userId } } }
            ]
          }
        }
      },
      include: this.userOwnershipInclude(userId),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    return { item: item ? this.toUserDto(item, userId) : null };
  }

  async listAdmin(actor: AuthenticatedUser, query: ListPaymentDisputesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const now = new Date();
    const dueSoon = new Date(now.getTime() + 6 * 60 * 60_000);
    const filters: any[] = [];
    if (actor.role === "support") {
      filters.push({ OR: [{ assignedSupportUserId: actor.id }, { assignedSupportUserId: null }] });
    }
    if (query.status) filters.push({ status: query.status });
    if (query.sla === "overdue") {
      filters.push({
        status: { in: ACTIVE_STATUSES },
        OR: [
          { resolutionDueAt: { lt: now } },
          { firstRespondedAt: null, firstResponseDueAt: { lt: now } }
        ]
      });
    } else if (query.sla === "dueSoon") {
      filters.push({
        status: { in: ACTIVE_STATUSES },
        OR: [
          { resolutionDueAt: { gte: now, lte: dueSoon } },
          { firstRespondedAt: null, firstResponseDueAt: { gte: now, lte: dueSoon } }
        ]
      });
    }
    const where: any = filters.length ? { AND: filters } : {};
    const [items, total] = await Promise.all([
      (this.prisma as any).paymentDispute.findMany({
        where,
        include: {
          replies: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 },
          attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 },
          notifications: { orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 10 },
          negotiationEvents: { orderBy: [{ operatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 10 },
          recoveries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 },
          complaintOrders: { orderBy: [{ providerSeenAt: "asc" }, { id: "asc" }], take: 10 },
          _count: {
            select: {
              replies: true,
              attachments: true,
              notifications: true,
              negotiationEvents: true,
              recoveries: true,
              complaintOrders: true
            }
          }
        },
        orderBy: [{ resolutionDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      (this.prisma as any).paymentDispute.count({ where })
    ]);
    if (items.length && (this.prisma as any).paymentDisputeOrder?.groupBy) {
      const unmatchedGroups = await (this.prisma as any).paymentDisputeOrder.groupBy({
        by: ["disputeId"],
        where: {
          disputeId: { in: items.map((item: any) => item.id) },
          OR: [{ orderId: null }, { paymentId: null }]
        },
        _count: { _all: true }
      });
      const unmatchedByDispute = new Map<string, number>(unmatchedGroups.map((group: any) => [
        group.disputeId,
        Number(group._count?._all ?? 0)
      ]));
      for (const item of items) {
        item._unmatchedComplaintOrderCount = unmatchedByDispute.get(item.id) ?? 0;
      }
    }
    return {
      items: items.map((item: any) => this.toScopedAdminDto(item, actor, 10)),
      page,
      pageSize,
      total
    };
  }

  async getAdmin(id: string, actor?: AuthenticatedUser) {
    const item = await (this.prisma as any).paymentDispute.findUnique({
      where: { id },
      include: {
        replies: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20 },
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20 },
        notifications: { orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 20 },
        negotiationEvents: { orderBy: [{ operatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 20 },
        recoveries: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20 },
        complaintOrders: { orderBy: [{ providerSeenAt: "asc" }, { id: "asc" }], take: 20 },
        _count: {
          select: {
            replies: true,
            attachments: true,
            notifications: true,
            negotiationEvents: true,
            recoveries: true,
            complaintOrders: true
          }
        }
      }
    });
    if (!item) throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
    if ((this.prisma as any).paymentDisputeOrder?.count) {
      item._unmatchedComplaintOrderCount = await (this.prisma as any).paymentDisputeOrder.count({
        where: { disputeId: item.id, OR: [{ orderId: null }, { paymentId: null }] }
      });
    }
    if (actor?.role === "support"
      && item.assignedSupportUserId
      && item.assignedSupportUserId !== actor.id) {
      throw new AppException(
        "PAYMENT_DISPUTE_ASSIGNED_ELSEWHERE",
        "Payment dispute is assigned to another support agent",
        HttpStatus.FORBIDDEN
      );
    }
    return actor ? this.toScopedAdminDto(item, actor, 20) : this.toAdminDto(item, 20);
  }

  async listAdminEvidence(
    actor: AuthenticatedUser,
    id: string,
    resource: string,
    query: ListPaymentDisputeEvidenceDto
  ) {
    const configurations: Record<string, {
      delegate: string;
      orderBy: any[];
      map: (item: any) => Record<string, unknown>;
    }> = {
      notifications: {
        delegate: "paymentDisputeNotification",
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        map: (item) => ({
          id: item.id,
          eventType: item.eventType,
          actionType: item.actionType,
          summary: item.summary,
          providerCreatedAt: item.providerCreatedAt,
          receivedAt: item.receivedAt
        })
      },
      replies: {
        delegate: "paymentDisputeReply",
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        map: (item) => ({
          id: item.id,
          actorId: item.actorId,
          content: item.content,
          status: item.status,
          providerReference: item.providerReference,
          submittedAt: item.submittedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        })
      },
      attachments: {
        delegate: "paymentDisputeAttachment",
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        map: (item) => ({
          id: item.id,
          replyId: item.replyId,
          source: item.source,
          mediaType: item.mediaType,
          providerMediaId: item.providerMediaId,
          remoteUrlDigest: item.remoteUrlDigest,
          createdAt: item.createdAt
        })
      },
      "negotiation-events": {
        delegate: "paymentDisputeNegotiationEvent",
        orderBy: [{ operatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        map: (item) => ({
          id: item.id,
          providerLogId: item.providerLogId,
          operator: item.operator,
          operateType: item.operateType,
          operateDetails: item.operateDetails,
          operatedAt: item.operatedAt,
          mediaCount: item.mediaDigests?.length ?? 0
        })
      },
      "complaint-orders": {
        delegate: "paymentDisputeOrder",
        orderBy: [{ providerSeenAt: "asc" }, { id: "asc" }],
        map: (item) => ({
          id: item.id,
          orderId: item.orderId,
          paymentId: item.paymentId,
          outTradeNoMasked: maskFinancialReference(item.outTradeNo),
          transactionIdMasked: maskFinancialReference(item.transactionId),
          amountCents: item.amountCents,
          matched: Boolean(item.orderId && item.paymentId),
          providerSeenAt: item.providerSeenAt,
          matchedAt: item.matchedAt
        })
      },
      recoveries: {
        delegate: "companionRecovery",
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        map: (item) => ({
          id: item.id,
          status: item.status,
          reason: item.reason,
          amountCents: item.amountCents,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        })
      }
    };
    const configuration = configurations[resource];
    if (!configuration) {
      throw new AppException(
        "PAYMENT_DISPUTE_EVIDENCE_RESOURCE_INVALID",
        "Unknown payment dispute evidence resource",
        HttpStatus.BAD_REQUEST
      );
    }
    const dispute = await (this.prisma as any).paymentDispute.findUnique({
      where: { id },
      select: { id: true, assignedSupportUserId: true }
    });
    if (!dispute) {
      throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
    }
    const supportResources = new Set([
      "notifications", "replies", "attachments", "negotiation-events", "complaint-orders"
    ]);
    const financeResources = new Set(["notifications", "complaint-orders", "recoveries"]);
    const allowed = actor.role === "admin"
      || (actor.role === "support"
        && dispute.assignedSupportUserId === actor.id
        && supportResources.has(resource))
      || (actor.role === "finance" && financeResources.has(resource));
    if (!allowed) {
      throw new AppException(
        "PAYMENT_DISPUTE_EVIDENCE_FORBIDDEN",
        "This evidence resource is outside the current operator data scope",
        HttpStatus.FORBIDDEN
      );
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const delegate = (this.prisma as any)[configuration.delegate];
    const where = { disputeId: id };
    const [items, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: configuration.orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      delegate.count({ where })
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      resource,
      items: items.map(configuration.map),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        nextPage: page < totalPages ? page + 1 : null
      }
    };
  }

  async claim(actor: AuthenticatedUser, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${id} FOR UPDATE`;
      const current = await db.paymentDispute.findUnique({ where: { id } });
      if (!current) throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
      if (!ACTIVE_STATUSES.includes(current.status)) {
        throw new AppException("PAYMENT_DISPUTE_CLOSED", "Closed payment disputes cannot be claimed", HttpStatus.CONFLICT);
      }
      if (current.assignedSupportUserId && current.assignedSupportUserId !== actor.id) {
        throw new AppException("PAYMENT_DISPUTE_ALREADY_ASSIGNED", "Payment dispute is assigned to another support agent", HttpStatus.CONFLICT);
      }
      if (!current.assignedSupportUserId) {
        await db.paymentDispute.update({
          where: { id },
          data: { assignedSupportUserId: actor.id, assignedAt: new Date() }
        });
        await this.audit.record({
          actorId: actor.id,
          subjectUserIds: await this.auditSubjectUserIds(db, id, [actor.id]),
          action: "payment_dispute.claimed",
          resourceType: "paymentDispute",
          resourceId: id
        }, db);
      }
    });
    return this.getAdmin(id, actor);
  }

  async assign(actor: AuthenticatedUser, id: string, dto: AssignPaymentDisputeDto) {
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${id} FOR UPDATE`;
      const current = await db.paymentDispute.findUnique({ where: { id } });
      if (!current) throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
      if (!ACTIVE_STATUSES.includes(current.status)) {
        throw new AppException("PAYMENT_DISPUTE_CLOSED", "Closed payment disputes cannot be assigned", HttpStatus.CONFLICT);
      }
      const assignee = await db.user.findFirst({
        where: { id: dto.assignedToUserId, role: "support", accountStatus: "active" },
        select: { id: true }
      });
      if (!assignee) {
        throw new AppException("SUPPORT_ASSIGNEE_INVALID", "Active support assignee not found", HttpStatus.UNPROCESSABLE_ENTITY);
      }
      await db.paymentDispute.update({
        where: { id },
        data: { assignedSupportUserId: assignee.id, assignedAt: new Date() }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: await this.auditSubjectUserIds(db, id, [actor.id, assignee.id]),
        action: "payment_dispute.assigned",
        resourceType: "paymentDispute",
        resourceId: id,
        metadata: { assignedSupportUserId: assignee.id }
      }, db);
    });
    return this.getAdmin(id, actor);
  }

  async reply(actor: AuthenticatedUser, id: string, dto: ReplyPaymentDisputeDto) {
    const responseImages = (dto as ReplyPaymentDisputeDto & { responseImages?: unknown }).responseImages;
    if (responseImages !== undefined) {
      throw new AppException(
        "PAYMENT_DISPUTE_MEDIA_DISABLED",
        "Payment-dispute media is disabled for the text-only first release; submit a text reply or escalate through support",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const reservation = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${id} FOR UPDATE`;
      const dispute = await db.paymentDispute.findUnique({ where: { id } });
      if (!dispute) throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
      if (!["open", "processing"].includes(dispute.status)) {
        throw new AppException(
          dispute.status === "resolved" ? "PAYMENT_DISPUTE_RESOLVED" : "PAYMENT_DISPUTE_SYNC_REQUIRED",
          dispute.status === "resolved"
            ? "Resolved dispute cannot be replied to"
            : "Authoritative complaint detail must be synchronized before replying",
          HttpStatus.CONFLICT
        );
      }
      if (dispute.inPlatformService) {
        throw new AppException("PAYMENT_DISPUTE_PLATFORM_SERVICE_ACTIVE", "WeChat platform service is active; merchant replies are not visible", HttpStatus.CONFLICT);
      }
      if (actor.role === "support" && dispute.assignedSupportUserId !== actor.id) {
        throw new AppException(
          "PAYMENT_DISPUTE_CLAIM_REQUIRED",
          "Support agents must claim the payment dispute before replying",
          HttpStatus.FORBIDDEN
        );
      }
      const duplicate = await db.paymentDisputeReply.findUnique({ where: { clientRequestId: dto.clientRequestId } });
      if (duplicate) {
        if (duplicate.disputeId !== id || duplicate.content !== dto.content.trim()) {
          throw new AppException("IDEMPOTENCY_KEY_REUSED", "clientRequestId was reused with different reply data", HttpStatus.CONFLICT);
        }
        return { dispute, reply: duplicate, duplicate: true };
      }
      const uncertain = await db.paymentDisputeReply.findFirst({
        where: { disputeId: id, status: { in: ["submitting", "outcomeUnknown"] } }
      });
      if (uncertain) {
        throw new AppException("PAYMENT_DISPUTE_REPLY_OUTCOME_UNKNOWN", "A previous provider reply outcome needs manual reconciliation", HttpStatus.CONFLICT);
      }
      const reply = await db.paymentDisputeReply.create({
        data: {
          disputeId: id,
          actorId: actor.id,
          clientRequestId: dto.clientRequestId,
          content: dto.content.trim(),
        }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: await this.auditSubjectUserIds(db, id, [actor.id]),
        action: "payment_dispute.reply_submitting",
        resourceType: "paymentDispute",
        resourceId: id,
        metadata: { replyId: reply.id, clientRequestId: dto.clientRequestId, attachmentCount: 0 }
      }, db);
      return { dispute, reply, duplicate: false };
    });

    if (reservation.duplicate) return this.getAdmin(id, actor);
    try {
      const result = await this.wechat.replyComplaint({
        complaintId: reservation.dispute.providerDisputeId,
        responseContent: dto.content.trim()
      });
      await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await db.paymentDisputeReply.update({
          where: { id: reservation.reply.id },
          data: { status: "submitted", submittedAt: new Date(), providerReference: result.providerReference ?? null }
        });
        await db.paymentDispute.update({
          where: { id },
          data: {
            status: "processing",
            providerStatus: "PROCESSING",
            incomingUserResponse: false,
            firstRespondedAt: reservation.dispute.firstRespondedAt ?? new Date(),
            nextReconcileAt: new Date(Date.now() + PROVIDER_SYNC_INTERVAL_MS)
          }
        });
        await this.audit.record({
          actorId: actor.id,
          subjectUserIds: await this.auditSubjectUserIds(db, id, [actor.id]),
          action: "payment_dispute.reply_submitted",
          resourceType: "paymentDispute",
          resourceId: id,
          metadata: { replyId: reservation.reply.id, providerReference: result.providerReference ?? null }
        }, db);
      });
      return this.getAdmin(id, actor);
    } catch (error) {
      await (this.prisma as any).paymentDisputeReply.update({
        where: { id: reservation.reply.id }, data: { status: "outcomeUnknown" }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: await this.auditSubjectUserIds(this.prisma as any, id, [actor.id]),
        action: "payment_dispute.reply_outcome_unknown",
        resourceType: "paymentDispute",
        resourceId: id,
        metadata: { replyId: reservation.reply.id }
      });
      throw error;
    }
  }

  async complete(actor: AuthenticatedUser, id: string, dto: CompletePaymentDisputeDto) {
    const dispute = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${id} FOR UPDATE`;
      const current = await db.paymentDispute.findUnique({ where: { id } });
      if (!current) throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
      const unmatchedOrders = db.paymentDisputeOrder?.count
        ? await db.paymentDisputeOrder.count({
            where: { disputeId: id, OR: [{ orderId: null }, { paymentId: null }] }
          })
        : 0;
      if (unmatchedOrders > 0) {
        throw new AppException(
          "PAYMENT_DISPUTE_ORDERS_UNLINKED",
          "Every provider complaint order must be linked before the dispute can be completed",
          HttpStatus.CONFLICT
        );
      }
      if (actor.role === "support" && current.assignedSupportUserId !== actor.id) {
        throw new AppException(
          "PAYMENT_DISPUTE_ASSIGNED_ELSEWHERE",
          "Only the assigned support agent can complete the payment dispute",
          HttpStatus.FORBIDDEN
        );
      }
      if (current.status === "resolved" && current.completionStatus === "submitted") return current;
      if (current.completionRequestId === dto.clientRequestId) {
        if (current.completionStatus === "outcomeUnknown") {
          throw new AppException("PAYMENT_DISPUTE_COMPLETION_UNKNOWN", "Completion outcome needs provider reconciliation", HttpStatus.CONFLICT);
        }
        return current;
      }
      if (current.completionStatus === "submitting" || current.completionStatus === "outcomeUnknown") {
        throw new AppException("PAYMENT_DISPUTE_COMPLETION_UNKNOWN", "A previous completion outcome needs provider reconciliation", HttpStatus.CONFLICT);
      }
      if (current.providerStatus !== "PROCESSING" || !current.firstRespondedAt || current.incomingUserResponse) {
        throw new AppException("PAYMENT_DISPUTE_NOT_READY_TO_COMPLETE", "Reply to all user messages before completing the dispute", HttpStatus.CONFLICT);
      }
      if (current.inPlatformService) {
        throw new AppException("PAYMENT_DISPUTE_PLATFORM_SERVICE_ACTIVE", "WeChat platform service must finish before merchant completion", HttpStatus.CONFLICT);
      }
      const updated = await db.paymentDispute.update({
        where: { id },
        data: {
          completionRequestId: dto.clientRequestId,
          completionStatus: "submitting",
          completionRequestedById: actor.id,
          completionRequestedAt: new Date()
        }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: await this.auditSubjectUserIds(db, id, [actor.id]),
        action: "payment_dispute.completion_submitting",
        resourceType: "paymentDispute",
        resourceId: id,
        metadata: { clientRequestId: dto.clientRequestId }
      }, db);
      return updated;
    });

    if (dispute.status === "resolved" && dispute.completionStatus === "submitted") return this.getAdmin(id, actor);
    try {
      const result = await this.wechat.completeComplaint(dispute.providerDisputeId);
      const completionOrders = (this.prisma as any).paymentDisputeOrder?.findMany
        ? await (this.prisma as any).paymentDisputeOrder.findMany({
            where: { disputeId: id, orderId: { not: null } },
            select: { orderId: true }
          })
        : [];
      const completionOrderIds = [...new Set([
        ...completionOrders.map((item: any) => item.orderId).filter(Boolean),
        ...(dispute.orderId ? [dispute.orderId] : [])
      ])].sort() as string[];
      await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        for (const orderId of completionOrderIds) {
          await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        }
        await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${id} FOR UPDATE`;
        await db.paymentDispute.update({
          where: { id },
          data: {
            status: "resolved",
            providerStatus: "PROCESSED",
            resolvedAt: new Date(),
            completionStatus: "submitted",
            completionProviderReference: result.providerReference ?? null,
            nextReconcileAt: null
          }
        });
        const linkedOrders = db.paymentDisputeOrder?.findMany
          ? await db.paymentDisputeOrder.findMany({
              where: { disputeId: id, orderId: { not: null } },
              select: { orderId: true }
            })
          : [{ orderId: (await db.paymentDispute.findUnique({ where: { id } }))?.orderId }];
        if (linkedOrders.some((linked: any) => linked.orderId
          && !completionOrderIds.includes(linked.orderId))) {
          throw new AppException(
            "PAYMENT_DISPUTE_ORDER_SET_CHANGED",
            "Complaint order links changed during provider completion; funding requires reconciliation",
            HttpStatus.CONFLICT
          );
        }
        for (const linked of linkedOrders) {
          if (linked.orderId) await this.releaseFundingIfSafe(db, id, linked.orderId);
        }
        const recoveryRequired = await db.companionRecovery.count({
          where: { disputeId: id, status: { in: ["due", "pendingVerification"] } }
        });
        await db.paymentDispute.update({
          where: { id },
          data: { fundingStatus: recoveryRequired > 0 ? "recoveryRequired" : "released" }
        });
        await this.audit.record({
          actorId: actor.id,
          subjectUserIds: await this.auditSubjectUserIds(db, id, [actor.id]),
          action: "payment_dispute.completed",
          resourceType: "paymentDispute",
          resourceId: id,
          metadata: { providerReference: result.providerReference ?? null }
        }, db);
      });
      return this.getAdmin(id, actor);
    } catch (error) {
      await (this.prisma as any).paymentDispute.update({
        where: { id }, data: { completionStatus: "outcomeUnknown", nextReconcileAt: new Date() }
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: await this.auditSubjectUserIds(this.prisma as any, id, [actor.id]),
        action: "payment_dispute.completion_outcome_unknown",
        resourceType: "paymentDispute",
        resourceId: id
      });
      throw error;
    }
  }

  async sync(actor: AuthenticatedUser, id: string) {
    if (actor.role === "support") {
      const current = await (this.prisma as any).paymentDispute.findUnique({
        where: { id },
        select: { assignedSupportUserId: true }
      });
      if (!current) {
        throw new AppException("PAYMENT_DISPUTE_NOT_FOUND", "Payment dispute not found", HttpStatus.NOT_FOUND);
      }
      if (current.assignedSupportUserId && current.assignedSupportUserId !== actor.id) {
        throw new AppException(
          "PAYMENT_DISPUTE_ASSIGNED_ELSEWHERE",
          "Payment dispute is assigned to another support agent",
          HttpStatus.FORBIDDEN
        );
      }
    }
    await this.reconcileById(id, true);
    await this.audit.record({
      actorId: actor.id,
      subjectUserIds: await this.auditSubjectUserIds(this.prisma as any, id, [actor.id]),
      action: "payment_dispute.manual_sync",
      resourceType: "paymentDispute",
      resourceId: id
    });
    return this.getAdmin(id, actor);
  }

  async reconcileDue(batchSize = 50) {
    if (this.wechat.mode === "disabled") return { scanned: 0, synced: 0 };
    const candidates = await (this.prisma as any).paymentDispute.findMany({
      where: {
        channel: "wechat",
        nextReconcileAt: { lte: new Date() },
        OR: [{ reconcileLeaseUntil: null }, { reconcileLeaseUntil: { lt: new Date() } }]
      },
      orderBy: { nextReconcileAt: "asc" },
      select: { id: true },
      take: Math.min(Math.max(batchSize, 1), 200)
    });
    let synced = 0;
    for (const candidate of candidates) {
      if (await this.reconcileById(candidate.id, false)) synced += 1;
    }
    return { scanned: candidates.length, synced };
  }

  async pollRecentWechatComplaints() {
    if (this.wechat.mode === "disabled") return { discovered: 0 };
    const endDate = chinaDate(new Date());
    const beginDate = chinaDate(new Date(Date.now() - 2 * 24 * 60 * 60_000));
    let offset = 0;
    let discovered = 0;
    for (let page = 0; page < 10; page += 1) {
      const result = await this.wechat.listComplaints({ beginDate, endDate, limit: 50, offset });
      for (const detail of result.data) {
        await this.ensureFromProviderDetail(detail);
        discovered += 1;
      }
      offset += result.data.length;
      if (result.data.length === 0 || offset >= result.totalCount) break;
    }
    return { discovered };
  }

  /**
   * Provider-backed payout gate. Every payout transition calls this immediately
   * before changing ledger state, persists every matching provider complaint,
   * and fails closed if the provider scan cannot be completed.
   */
  async refreshActiveForOrder(orderId: string) {
    if (this.wechat.mode === "disabled") {
      throw new AppException(
        "WECHAT_COMPLAINT_PROVIDER_UNAVAILABLE",
        "WeChat complaint verification is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const payment = await (this.prisma as any).paymentTransaction.findFirst({
      where: { orderId, provider: "wechat" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { outTradeNo: true, transactionId: true }
    });
    if (!payment?.outTradeNo) {
      throw new AppException(
        "PAYOUT_PAYMENT_BINDING_MISSING",
        "The payout order has no WeChat payment binding",
        HttpStatus.CONFLICT
      );
    }
    const endDate = chinaDate(new Date());
    const beginDate = chinaDate(new Date(Date.now() - 29 * 24 * 60 * 60_000));
    let offset = 0;
    let totalCount = 0;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.wechat.listComplaints({ beginDate, endDate, limit: 50, offset });
      totalCount = result.totalCount;
      for (const detail of result.data) {
        if (!detail.complaintOrders.some((item) => item.outTradeNo === payment.outTradeNo
          || (payment.transactionId && item.transactionId === payment.transactionId))) continue;
        await this.ensureFromProviderDetail(detail);
      }
      offset += result.data.length;
      if (!result.data.length || offset >= result.totalCount) break;
    }
    if (offset < totalCount) {
      throw new AppException(
        "WECHAT_COMPLAINT_SCAN_INCOMPLETE",
        "WeChat complaint pagination did not reach the authoritative total",
        HttpStatus.BAD_GATEWAY
      );
    }
    const active = await (this.prisma as any).paymentDispute.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        OR: [
          { orderId },
          { complaintOrders: { some: { orderId } } }
        ]
      },
      select: { id: true, fundingStatus: true }
    });
    return { active: active.length > 0, disputeIds: active.map((item: any) => item.id) };
  }

  private async ensureFromProviderDetail(detail: WeChatComplaintDetail) {
    if (!detail.complaintId) return;
    const dispute = await (this.prisma as any).paymentDispute.upsert({
      where: { channel_providerDisputeId: { channel: "wechat", providerDisputeId: detail.complaintId } },
      create: {
        channel: "wechat",
        type: "consumer_complaint",
        providerDisputeId: detail.complaintId,
        idempotencyKey: `wechat:consumer_complaint:${detail.complaintId}`,
        nextReconcileAt: new Date()
      },
      update: {}
    });
    await this.applyProviderDetail(dispute.id, detail);
  }

  private async reconcileById(id: string, force: boolean): Promise<boolean> {
    const leaseToken = randomUUID();
    if (!force) {
      const claimed = await (this.prisma as any).paymentDispute.updateMany({
        where: {
          id,
          OR: [{ reconcileLeaseUntil: null }, { reconcileLeaseUntil: { lt: new Date() } }]
        },
        data: { reconcileLeaseToken: leaseToken, reconcileLeaseUntil: new Date(Date.now() + 60_000) }
      });
      if (claimed.count !== 1) return false;
    }
    const dispute = await (this.prisma as any).paymentDispute.findUnique({ where: { id } });
    if (!dispute) return false;
    try {
      const [detail, negotiationEvents] = await Promise.all([
        this.wechat.queryComplaint(dispute.providerDisputeId),
        this.fetchNegotiationHistory(dispute.providerDisputeId)
      ]);
      if (detail.complaintId !== dispute.providerDisputeId) {
        throw new AppException("WECHAT_COMPLAINT_MISMATCH", "WeChat complaint query returned a different complaint id", HttpStatus.BAD_GATEWAY);
      }
      await this.applyProviderDetail(id, detail, negotiationEvents);
      return true;
    } catch (error) {
      const attempts = dispute.providerQueryAttempts + 1;
      await (this.prisma as any).paymentDispute.updateMany({
        where: { id, ...(force ? {} : { reconcileLeaseToken: leaseToken }) },
        data: {
          status: "syncFailed",
          providerQueryAttempts: attempts,
          nextReconcileAt: new Date(Date.now() + Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(attempts, 8))),
          reconcileLeaseToken: null,
          reconcileLeaseUntil: null
        }
      });
      throw error;
    }
  }

  private async fetchNegotiationHistory(complaintId: string): Promise<WeChatComplaintNegotiationEvent[]> {
    const events: WeChatComplaintNegotiationEvent[] = [];
    let offset = 0;
    let expectedTotal: number | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result = await this.wechat.listComplaintNegotiationHistory({
        complaintId,
        limit: 300,
        offset
      });
      if (page === 0 && result.totalCount > 0) expectedTotal = result.totalCount;
      events.push(...result.data);
      offset += result.data.length;
      if (!result.data.length || result.data.length < 300 || (expectedTotal !== null && offset >= expectedTotal)) break;
    }
    return events;
  }

  private async applyProviderDetail(
    id: string,
    detail: WeChatComplaintDetail,
    negotiationEvents?: WeChatComplaintNegotiationEvent[]
  ) {
    const providerStatus = detail.complaintState;
    const status = providerStatus === "PENDING"
      ? "open"
      : providerStatus === "PROCESSING"
        ? "processing"
        : providerStatus === "PROCESSED"
          ? "resolved"
          : "syncFailed";
    const occurredAt = safeDate(detail.complaintTime) ?? new Date();
    const firstMerchantResponseAt = firstNegotiationTime(negotiationEvents, "MERCHANT_RESPONSE");
    const providerCompletedAt = firstNegotiationTime(negotiationEvents, "MERCHANT_CONFIRM_COMPLETE");
    const providerOrders = uniqueComplaintOrders(detail.complaintOrders);
    const payments: any[] = providerOrders.length
      ? await (this.prisma as any).paymentTransaction.findMany({
          where: {
            OR: [
              { outTradeNo: { in: providerOrders.map((order) => order.outTradeNo) } },
              { transactionId: { in: providerOrders.map((order) => order.transactionId).filter(Boolean) } }
            ]
          },
          select: { id: true, orderId: true, outTradeNo: true, transactionId: true, amountCents: true }
        })
      : [];
    const paymentByTradeNo = new Map<string, any>(payments.map((payment: any) => [payment.outTradeNo, payment]));
    const paymentByTransactionId = new Map<string, any>(
      payments.filter((payment: any) => payment.transactionId)
        .map((payment: any) => [payment.transactionId, payment])
    );
    const linkedProviderOrders = providerOrders.map((providerOrder) => {
      const byTradeNo = paymentByTradeNo.get(providerOrder.outTradeNo) ?? null;
      const byTransactionId = providerOrder.transactionId
        ? paymentByTransactionId.get(providerOrder.transactionId) ?? null
        : null;
      if (byTradeNo && byTransactionId && byTradeNo.id !== byTransactionId.id) {
        throw new AppException(
          "WECHAT_COMPLAINT_PAYMENT_BINDING_CONFLICT",
          "WeChat complaint trade and transaction references resolve to different local payments",
          HttpStatus.BAD_GATEWAY
        );
      }
      const payment = byTradeNo ?? byTransactionId;
      if (payment && (payment.outTradeNo !== providerOrder.outTradeNo
        || (providerOrder.transactionId && payment.transactionId !== providerOrder.transactionId)
        || payment.amountCents !== providerOrder.amountCents)) {
        throw new AppException(
          "WECHAT_COMPLAINT_PAYMENT_BINDING_CONFLICT",
          "WeChat complaint order does not exactly match the local payment binding and amount",
          HttpStatus.BAD_GATEWAY
        );
      }
      return { providerOrder, payment: payment ?? null };
    });
    const primaryPayment: any = linkedProviderOrders.find((item) => item.payment)?.payment ?? null;
    const orderIds = [...new Set(linkedProviderOrders
      .map((item) => item.payment?.orderId)
      .filter((orderId): orderId is string => Boolean(orderId)))].sort();
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Payouts use Order -> Earning. Complaint synchronization takes the same
      // sorted Order locks before Dispute -> Earning, so a payout can never be
      // silently marked paid while this transaction reasons from stale funds.
      for (const orderId of orderIds) {
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      }
      await db.$queryRaw`SELECT "id" FROM "PaymentDispute" WHERE "id" = ${id} FOR UPDATE`;
      const current = await db.paymentDispute.findUnique({ where: { id } });
      if (!current) return;
      await db.paymentDispute.update({
        where: { id },
        data: {
          orderId: primaryPayment?.orderId ?? current.orderId,
          paymentId: primaryPayment?.id ?? current.paymentId,
          outTradeNo: primaryPayment?.outTradeNo ?? providerOrders[0]?.outTradeNo ?? current.outTradeNo,
          status,
          providerStatus,
          problemType: detail.problemType?.slice(0, 64) ?? null,
          complaintDetail: detail.complaintDetail.slice(0, 4000),
          complaintOccurredAt: occurredAt,
          firstResponseDueAt: chinaEndOfDayDeadline(occurredAt, 1),
          resolutionDueAt: chinaEndOfDayDeadline(occurredAt, 3),
          firstRespondedAt: current.firstRespondedAt ?? firstMerchantResponseAt,
          resolvedAt: providerStatus === "PROCESSED"
            ? current.resolvedAt ?? providerCompletedAt
            : null,
          incomingUserResponse: detail.incomingUserResponse,
          complaintCount: Math.max(1, Math.trunc(detail.userComplaintTimes || 1)),
          complaintFullRefunded: detail.complaintFullRefunded,
          requiresImmediateService: detail.needImmediateService,
          inPlatformService: detail.inPlatformService,
          applyRefundAmountCents: detail.applyRefundAmountCents ?? null,
          providerQueryAttempts: { increment: 1 },
          lastProviderSyncAt: new Date(),
          nextReconcileAt: negotiationEvents === undefined
            ? new Date()
            : providerStatus === "PROCESSED"
              ? null
              : new Date(Date.now() + PROVIDER_SYNC_INTERVAL_MS),
          reconcileLeaseToken: null,
          reconcileLeaseUntil: null,
          ...(providerStatus === "PROCESSED" && current.completionStatus === "outcomeUnknown"
            ? { completionStatus: "submitted" }
            : {})
        }
      });
      for (const { providerOrder, payment } of linkedProviderOrders) {
        const key = {
          disputeId_outTradeNo: { disputeId: id, outTradeNo: providerOrder.outTradeNo }
        };
        const existingOrder = await db.paymentDisputeOrder.findUnique({ where: key });
        if (!existingOrder) {
          await db.paymentDisputeOrder.create({
            data: {
              id: randomUUID(),
              disputeId: id,
              orderId: payment?.orderId ?? null,
            paymentId: payment?.id ?? null,
            outTradeNo: providerOrder.outTradeNo,
            transactionId: providerOrder.transactionId || null,
              amountCents: providerOrder.amountCents,
              matchedAt: payment ? new Date() : null
            }
          });
          continue;
        }
        if ((existingOrder.transactionId ?? "") !== providerOrder.transactionId
          || existingOrder.amountCents !== providerOrder.amountCents) {
          throw new AppException(
            "WECHAT_COMPLAINT_ORDER_FACT_CONFLICT",
            "WeChat complaint order facts conflict with the first immutable provider snapshot",
            HttpStatus.BAD_GATEWAY
          );
        }
        if (!payment) continue;
        const completelyUnlinked = !existingOrder.orderId
          && !existingOrder.paymentId
          && !existingOrder.matchedAt;
        const alreadyLinked = existingOrder.orderId === payment.orderId
          && existingOrder.paymentId === payment.id
          && Boolean(existingOrder.matchedAt);
        if (alreadyLinked) continue;
        if (!completelyUnlinked) {
          throw new AppException(
            "WECHAT_COMPLAINT_ORDER_LINK_CONFLICT",
            "The complaint order has a partial or conflicting immutable local payment link",
            HttpStatus.CONFLICT
          );
        }
        // Provider-authored facts remain unchanged; a delayed exact local match
        // may fill the three local-link fields once and only once.
        await db.paymentDisputeOrder.update({
          where: { id: existingOrder.id },
          data: {
            orderId: payment.orderId,
            paymentId: payment.id,
            matchedAt: new Date()
          }
        });
      }
      await db.paymentDisputeAttachment.deleteMany({ where: { disputeId: id, source: "provider" } });
      const attachmentRows = detail.complaintMedia.flatMap((media) => media.mediaUrls.map((url) => ({
        disputeId: id,
        source: "provider",
        mediaType: media.mediaType.slice(0, 64),
        remoteUrlDigest: createHash("sha256").update(url).digest("hex")
      })));
      if (attachmentRows.length) await db.paymentDisputeAttachment.createMany({ data: attachmentRows, skipDuplicates: true });
      const negotiationRows = (negotiationEvents ?? [])
        .filter((event) => event.logId)
        .map((event) => ({
          disputeId: id,
          providerLogId: event.logId.slice(0, 64),
          operator: negotiationOperator(event.operateType),
          operateType: event.operateType.slice(0, 96),
          operateDetails: event.operateDetails?.slice(0, 500) ?? null,
          operatedAt: safeDate(event.operateTime),
          mediaDigests: [...new Set(event.mediaUrls.map((url) => createHash("sha256").update(url).digest("hex")))]
        }));
      if (negotiationRows.length) {
        await db.paymentDisputeNegotiationEvent.createMany({ data: negotiationRows, skipDuplicates: true });
      }
      const merchantResponses = (negotiationEvents ?? [])
        .filter((event) => event.operateType === "MERCHANT_RESPONSE" && event.operateDetails)
        .map((event) => ({
          logId: event.logId,
          content: event.operateDetails!.trim(),
          operatedAt: safeDate(event.operateTime)
        }));
      if (merchantResponses.length) {
        const uncertainReplies = await db.paymentDisputeReply.findMany({
          where: { disputeId: id, status: { in: ["submitting", "outcomeUnknown"] } }
        });
        for (const reply of uncertainReplies) {
          const match = merchantResponses.find((event) => event.content === reply.content.trim());
          if (!match) continue;
          await db.paymentDisputeReply.update({
            where: { id: reply.id },
            data: {
              status: "submitted",
              submittedAt: match.operatedAt ?? reply.submittedAt ?? new Date(),
              providerReference: match.logId || reply.providerReference
            }
          });
          await this.audit.record({
            subjectUserIds: await this.auditSubjectUserIds(db, id, [reply.actorId]),
            action: "payment_dispute.reply_reconciled_submitted",
            resourceType: "paymentDispute",
            resourceId: id,
            metadata: { replyId: reply.id, providerLogId: match.logId || null }
          }, db);
        }
      }
      let fundingStatus: "unlinked" | "held" | "recoveryRequired" | "released" =
        linkedProviderOrders.some((item) => !item.payment) || orderIds.length === 0
          ? "unlinked"
          : status === "resolved" ? "released" : "held";
      if (status === "resolved") {
        for (const orderId of orderIds) {
          await this.releaseFundingIfSafe(db, id, orderId);
        }
      } else {
        for (const orderId of orderIds) {
          const result = await this.holdOrRecoverFunding(db, id, orderId);
          if (result === "recoveryRequired") fundingStatus = "recoveryRequired";
        }
      }
      await db.paymentDispute.update({ where: { id }, data: { fundingStatus } });
      await this.audit.record({
        action: "payment_dispute.provider_synced",
        resourceType: "paymentDispute",
        resourceId: id,
        metadata: {
          channel: "wechat",
          providerStatus,
          linkedOrderCount: orderIds.length,
          unmatchedOrderCount: linkedProviderOrders.filter((item) => !item.payment).length,
          attachmentCount: attachmentRows.length,
          negotiationEventCount: negotiationRows.length
        }
      }, db);
    });
  }

  private async holdOrRecoverFunding(
    db: any,
    disputeId: string,
    orderId?: string | null
  ): Promise<"unlinked" | "held" | "recoveryRequired"> {
    if (!orderId) {
      return "unlinked";
    }
    const pointer = await db.companionEarning.findUnique({
      where: { orderId },
      select: { id: true }
    });
    if (!pointer) return "unlinked";
    await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${pointer.id} FOR UPDATE`;
    const earning = await db.companionEarning.findUnique({ where: { orderId } });
    if (!earning) {
      return "unlinked";
    }
    if (earning.status === "paid" || earning.paidReference) {
      await db.companionRecovery.upsert({
        where: { disputeId_earningId: { disputeId, earningId: earning.id } },
        create: {
          disputeId,
          earningId: earning.id,
          companionId: earning.companionId,
          amountCents: earning.paidAmountCents ?? earning.payableCents,
          reason: "paymentDisputeAfterPayout"
        },
        update: {}
      });
      if (earning.status !== "paid"
        && earning.holdReason !== "payment_dispute_transfer_outcome_unknown") {
        await db.companionEarning.update({
          where: { id: earning.id },
          data: { status: "held", holdReason: "payment_dispute_transfer_outcome_unknown" }
        });
      }
      return "recoveryRequired";
    }
    if (earning.status === "pending" || earning.status === "available") {
      await db.companionEarning.update({
        where: { id: earning.id }, data: { status: "held", holdReason: `payment_dispute:${disputeId}` }
      });
    }
    return "held";
  }

  private async releaseFundingIfSafe(db: any, disputeId: string, orderId: string) {
    const earningPointer = await db.companionEarning.findUnique({
      where: { orderId },
      select: { id: true }
    });
    if (earningPointer) {
      await db.$queryRaw`SELECT "id" FROM "CompanionEarning" WHERE "id" = ${earningPointer.id} FOR UPDATE`;
    }
    const [otherBlocks, refundBlocks, earning] = await Promise.all([
      db.paymentDispute.count({
        where: {
          id: { not: disputeId },
          status: { in: ACTIVE_STATUSES },
          OR: [
            { orderId },
            { complaintOrders: { some: { orderId } } }
          ]
        }
      }),
      db.refundTransaction.count({
        where: { orderId, status: { in: ["pendingReview", "pending", "processing"] } }
      }),
      db.companionEarning.findUnique({ where: { orderId } })
    ]);
    if (otherBlocks > 0 || refundBlocks > 0) return;
    if (earning?.status === "held" && String(earning.holdReason ?? "").startsWith("payment_dispute:")) {
      await db.companionEarning.update({
        where: { id: earning.id },
        data: { status: earning.availableAt <= new Date() ? "available" : "pending", holdReason: null }
      });
    }
  }

  private async auditSubjectUserIds(
    db: any,
    disputeId: string,
    additionalUserIds: readonly (string | null | undefined)[] = []
  ): Promise<string[]> {
    const orderSubjects = {
      select: {
        userId: true,
        companion: { select: { ownerUserId: true } }
      }
    } as const;
    const dispute = await db.paymentDispute.findUnique({
      where: { id: disputeId },
      select: {
        assignedSupportUserId: true,
        order: orderSubjects,
        payment: { select: { order: orderSubjects } },
        complaintOrders: {
          where: { orderId: { not: null } },
          orderBy: { id: "asc" },
          take: 250,
          select: { order: orderSubjects }
        }
      }
    });
    const subjectUserIds = new Set<string>();
    const addOrder = (order: any) => {
      if (order?.userId) subjectUserIds.add(order.userId);
      if (order?.companion?.ownerUserId) subjectUserIds.add(order.companion.ownerUserId);
    };
    for (const userId of additionalUserIds) if (userId) subjectUserIds.add(userId);
    if (dispute?.assignedSupportUserId) subjectUserIds.add(dispute.assignedSupportUserId);
    addOrder(dispute?.order);
    addOrder(dispute?.payment?.order);
    for (const complaintOrder of dispute?.complaintOrders ?? []) addOrder(complaintOrder.order);
    if ((dispute?.complaintOrders?.length ?? 0) >= 250) {
      throw new Error(`Payment dispute audit subject graph exceeds its bounded row limit: ${disputeId}`);
    }
    if (!subjectUserIds.size) {
      throw new Error(`Payment dispute audit is missing its user subjects: ${disputeId}`);
    }
    return [...subjectUserIds];
  }

  private userOwnershipInclude(userId: string) {
    return {
      order: {
        select: {
          id: true,
          userId: true,
          companion: { select: { ownerUserId: true } }
        }
      },
      complaintOrders: {
        where: {
          OR: [
            { order: { userId } },
            { order: { companion: { ownerUserId: userId } } }
          ]
        },
        select: { orderId: true }
      }
    };
  }

  private toUserDto(item: any, userId: string) {
    const ownsPrimary = item.order
      && (item.order.userId === userId || item.order.companion?.ownerUserId === userId);
    const ownedOrderIds = [...new Set([
      ...(item.complaintOrders ?? []).map((order: any) => order.orderId).filter(Boolean),
      ...(ownsPrimary && item.orderId ? [item.orderId] : [])
    ])] as string[];
    return {
      id: item.id,
      channel: item.channel,
      type: item.type,
      // A provider complaint may span orders owned by unrelated accounts.
      // Only actor-owned local ids leave this boundary; provider references,
      // amounts, and other participants' primary order never do.
      orderId: item.orderId && ownedOrderIds.includes(item.orderId) ? item.orderId : null,
      ownedOrderIds,
      ownedOrders: ownedOrderIds.map((orderId) => ({ orderId })),
      status: item.status,
      providerStatus: item.providerStatus,
      complaintOccurredAt: item.complaintOccurredAt,
      firstResponseDueAt: item.firstResponseDueAt,
      resolutionDueAt: item.resolutionDueAt,
      firstRespondedAt: item.firstRespondedAt,
      resolvedAt: item.resolvedAt,
      updatedAt: item.updatedAt
    };
  }

  private toScopedAdminDto(item: any, actor: AuthenticatedUser, notificationLimit = 0) {
    const full = this.toAdminDto(item, notificationLimit);
    if (actor.role === "admin") return { ...full, detailAvailable: true, dataScope: "all" };
    if (actor.role === "support" && item.assignedSupportUserId === actor.id) {
      const { recoveries: _recoveries, ...supportDetail } = full;
      return {
        ...supportDetail,
        evidenceWindows: {
          ...full.evidenceWindows,
          recoveries: undefined
        },
        detailAvailable: true,
        dataScope: "assigned"
      };
    }

    const common = {
      id: item.id,
      channel: item.channel,
      type: item.type,
      status: item.status,
      providerStatus: item.providerStatus,
      complaintOccurredAt: item.complaintOccurredAt,
      firstResponseDueAt: item.firstResponseDueAt,
      resolutionDueAt: item.resolutionDueAt,
      firstRespondedAt: item.firstRespondedAt,
      resolvedAt: item.resolvedAt,
      fundingStatus: item.fundingStatus,
      complaintFullRefunded: item.complaintFullRefunded,
      lastProviderSyncAt: item.lastProviderSyncAt,
      nextReconcileAt: item.nextReconcileAt,
      providerQueryAttempts: item.providerQueryAttempts,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      sla: full.sla,
      detailAvailable: false
    };
    if (actor.role === "finance") {
      return {
        ...common,
        dataScope: "financial",
        orderId: item.orderId,
        paymentId: item.paymentId,
        outTradeNo: item.outTradeNo,
        applyRefundAmountCents: item.applyRefundAmountCents,
        recoveryCount: item._count?.recoveries ?? item.recoveries?.length ?? 0,
        evidenceWindows: {
          notifications: full.evidenceWindows.notifications,
          complaintOrders: full.evidenceWindows.complaintOrders,
          recoveries: full.evidenceWindows.recoveries
        }
      };
    }
    return {
      ...common,
      dataScope: "claimableSummary",
      assignedSupportUserId: item.assignedSupportUserId,
      problemType: item.problemType,
      complaintCount: item.complaintCount,
      requiresImmediateService: item.requiresImmediateService,
      inPlatformService: item.inPlatformService,
      hasOrder: Boolean(item.orderId)
    };
  }

  private toAdminDto(item: any, notificationLimit = 0) {
    const now = Date.now();
    return {
      id: item.id,
      channel: item.channel,
      type: item.type,
      complaintId: item.providerDisputeId,
      orderId: item.orderId,
      paymentId: item.paymentId,
      outTradeNo: item.outTradeNo,
      status: item.status,
      providerStatus: item.providerStatus,
      problemType: item.problemType,
      complaintDetail: item.complaintDetail,
      complaintOccurredAt: item.complaintOccurredAt,
      firstResponseDueAt: item.firstResponseDueAt,
      resolutionDueAt: item.resolutionDueAt,
      firstRespondedAt: item.firstRespondedAt,
      resolvedAt: item.resolvedAt,
      incomingUserResponse: item.incomingUserResponse,
      complaintCount: item.complaintCount,
      complaintFullRefunded: item.complaintFullRefunded,
      requiresImmediateService: item.requiresImmediateService,
      inPlatformService: item.inPlatformService,
      applyRefundAmountCents: item.applyRefundAmountCents,
      latestActionType: item.latestActionType,
      fundingStatus: item.fundingStatus,
      assignedSupportUserId: item.assignedSupportUserId,
      assignedAt: item.assignedAt,
      completionStatus: item.completionStatus,
      completionProviderReference: item.completionProviderReference,
      completionRequestedById: item.completionRequestedById,
      completionRequestedAt: item.completionRequestedAt,
      providerQueryAttempts: item.providerQueryAttempts,
      lastProviderSyncAt: item.lastProviderSyncAt,
      nextReconcileAt: item.nextReconcileAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      replies: (item.replies ?? []).map((reply: any) => ({
        id: reply.id,
        actorId: reply.actorId,
        content: reply.content,
        status: reply.status,
        providerReference: reply.providerReference,
        submittedAt: reply.submittedAt,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt
      })),
      attachments: (item.attachments ?? []).map((attachment: any) => ({
        id: attachment.id,
        replyId: attachment.replyId,
        source: attachment.source,
        mediaType: attachment.mediaType,
        providerMediaId: attachment.providerMediaId,
        remoteUrlDigest: attachment.remoteUrlDigest,
        createdAt: attachment.createdAt
      })),
      notifications: (item.notifications ?? []).map((notification: any) => ({
        id: notification.id,
        eventType: notification.eventType,
        actionType: notification.actionType,
        summary: notification.summary,
        providerCreatedAt: notification.providerCreatedAt,
        receivedAt: notification.receivedAt
      })),
      notificationWindow: {
        limit: notificationLimit,
        total: item._count?.notifications ?? item.notifications?.length ?? 0,
        hasMore: (item._count?.notifications ?? item.notifications?.length ?? 0) > notificationLimit,
        order: "receivedAtDesc"
      },
      evidenceWindows: {
        notifications: evidenceWindow(item, "notifications", notificationLimit, "receivedAtDesc"),
        replies: evidenceWindow(item, "replies", notificationLimit, "createdAtAsc"),
        attachments: evidenceWindow(item, "attachments", notificationLimit, "createdAtAsc"),
        negotiationEvents: evidenceWindow(item, "negotiationEvents", notificationLimit, "operatedAtAsc"),
        recoveries: evidenceWindow(item, "recoveries", notificationLimit, "createdAtAsc"),
        complaintOrders: evidenceWindow(item, "complaintOrders", notificationLimit, "providerSeenAtAsc")
      },
      negotiationEvents: (item.negotiationEvents ?? []).map((event: any) => ({
        id: event.id,
        providerLogId: event.providerLogId,
        operator: event.operator,
        operateType: event.operateType,
        operateDetails: event.operateDetails,
        operatedAt: event.operatedAt,
        mediaCount: event.mediaDigests?.length ?? 0
      })),
      recoveries: (item.recoveries ?? []).map((recovery: any) => ({
        id: recovery.id,
        status: recovery.status,
        reason: recovery.reason,
        amountCents: recovery.amountCents,
        createdAt: recovery.createdAt,
        updatedAt: recovery.updatedAt
      })),
      complaintOrders: (item.complaintOrders ?? []).map((order: any) => ({
        id: order.id,
        orderId: order.orderId,
        paymentId: order.paymentId,
        outTradeNoMasked: maskFinancialReference(order.outTradeNo),
        transactionIdMasked: maskFinancialReference(order.transactionId),
        amountCents: order.amountCents,
        matched: Boolean(order.orderId && order.paymentId),
        providerSeenAt: order.providerSeenAt,
        matchedAt: order.matchedAt
      })),
      unmatchedComplaintOrderCount: item._unmatchedComplaintOrderCount
        ?? (item.complaintOrders ?? []).filter((order: any) => !order.orderId || !order.paymentId).length,
      sla: {
        firstResponseOverdue: !item.firstRespondedAt && item.firstResponseDueAt && item.firstResponseDueAt.getTime() < now,
        resolutionOverdue: item.status !== "resolved" && item.resolutionDueAt && item.resolutionDueAt.getTime() < now,
        hoursUntilResolution: item.resolutionDueAt
          ? Math.round((item.resolutionDueAt.getTime() - now) / 36_000) / 100
          : null
      }
    };
  }
}

function uniqueComplaintOrders(
  orders: Array<{ transactionId: string; outTradeNo: string; amountCents: number }>
) {
  const byTradeNo = new Map<string, { transactionId: string; outTradeNo: string; amountCents: number }>();
  for (const order of orders) {
    const outTradeNo = String(order.outTradeNo ?? "").trim();
    const transactionId = String(order.transactionId ?? "").trim();
    const amountCents = Number(order.amountCents);
    if (!outTradeNo || !Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new AppException(
        "WECHAT_COMPLAINT_ORDER_INVALID",
        "WeChat complaint order information is missing a valid trade reference or amount",
        HttpStatus.BAD_GATEWAY
      );
    }
    const existing = byTradeNo.get(outTradeNo);
    if (existing && (existing.transactionId !== transactionId || existing.amountCents !== amountCents)) {
      throw new AppException(
        "WECHAT_COMPLAINT_ORDER_CONFLICT",
        "WeChat complaint returned conflicting facts for one trade reference",
        HttpStatus.BAD_GATEWAY
      );
    }
    byTradeNo.set(outTradeNo, { transactionId, outTradeNo, amountCents });
  }
  return [...byTradeNo.values()];
}

function evidenceWindow(item: any, relation: string, limit: number, order: string) {
  const loaded = item[relation]?.length ?? 0;
  const total = item._count?.[relation] ?? loaded;
  return {
    limit,
    loaded,
    total,
    hasMore: total > loaded,
    nextPage: total > loaded ? 2 : null,
    order
  };
}

function maskFinancialReference(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}***`;
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

function safeDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function chinaEndOfDayDeadline(value: Date, daysAfter: number): Date {
  const shifted = new Date(value.getTime() + 8 * 60 * 60_000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + daysAfter + 1
  ) - 8 * 60 * 60_000);
}

function chinaDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function firstNegotiationTime(
  events: WeChatComplaintNegotiationEvent[] | undefined,
  operateType: string
): Date | null {
  const times = (events ?? [])
    .filter((event) => event.operateType === operateType)
    .map((event) => safeDate(event.operateTime))
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => left.getTime() - right.getTime());
  return times[0] ?? null;
}

function negotiationOperator(operateType: string): string {
  if (operateType.startsWith("USER_") || operateType.startsWith("COMPLAINT_")) return "user";
  if (operateType.startsWith("MERCHANT_")) return "merchant";
  if (operateType.startsWith("PLATFORM_")) return "wechat_platform";
  return "system";
}
