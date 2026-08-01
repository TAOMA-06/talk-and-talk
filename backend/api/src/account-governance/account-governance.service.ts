import { HttpStatus, Injectable } from "@nestjs/common";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { AddDataRightsFollowUpDto } from "./dto/add-data-rights-follow-up.dto";
import { CreateDataRightsRequestDto } from "./dto/create-data-rights-request.dto";
import { CreateInvoiceRequestDto } from "./dto/create-invoice-request.dto";
import {
  DataRightsRequestStatusValue,
  InvoiceRequestStatusValue,
  ListDataRightsRequestsDto,
  ListInvoiceEligibleOrdersDto,
  ListInvoiceRequestsDto
} from "./dto/list-governance-requests.dto";
import {
  TransitionDataRightsRequestDto,
  TransitionInvoiceRequestDto
} from "./dto/transition-governance-request.dto";

const ACTIVE_DATA_RIGHTS_STATUSES: DataRightsRequestStatusValue[] = [
  "submitted",
  "inReview",
  "needsInformation"
];
const BLOCKING_REFUND_STATUSES = [
  "pendingReview",
  "pending",
  "processing",
  "success",
  "failed"
] as const;
const INVOICE_ELIGIBLE_ORDER_STATUSES = ["paid", "inService", "completed"] as const;

const OBVIOUS_SENSITIVE_LITERAL_PATTERNS = [
  /\b\d{17}[\dXx]\b/,
  /\b\d{15}\b/,
  /(?:^|\D)(?:\d[ -]?){16,19}(?:\D|$)/,
  /(?:身份证(?:号)?|银行卡(?:号)?|卡号|账号)\s*[:：=]?\s*[A-Za-z0-9 -]{6,}/i,
  /(?:密码|password|passwd|口令|cvv|cvc|验证码|短信码)\s*[:：=]?\s*\S{4,}/i
];

const INVOICE_TITLE_FORBIDDEN_PATTERNS = [
  /身份证|银行卡|卡号|开户行|银行账号|税号|纳税人识别号|统一社会信用代码|地址电话|密码|password|cvv|cvc/i,
  /\b\d{17}[\dXx]\b/,
  /(?:^|\D)(?:\d[ -]?){16,19}(?:\D|$)/,
  /(?=[A-Z0-9]{15,20}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+/i
];
const EVIDENCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

const DATA_RIGHTS_TRANSITIONS: Record<DataRightsRequestStatusValue, DataRightsRequestStatusValue[]> = {
  submitted: ["inReview", "needsInformation", "completed", "rejected"],
  inReview: ["needsInformation", "completed", "rejected"],
  needsInformation: ["inReview", "completed", "rejected"],
  completed: [],
  rejected: []
};

const INVOICE_TRANSITIONS: Record<InvoiceRequestStatusValue, InvoiceRequestStatusValue[]> = {
  submitted: ["inReview", "rejected"],
  inReview: ["issued", "rejected"],
  issued: ["voided"],
  rejected: [],
  voided: [],
  cancelled: []
};

@Injectable()
export class AccountGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listSessions(
    userId: string,
    currentSessionId?: string,
    page = 1,
    pageSize = 20
  ) {
    const now = new Date();
    const where = {
      userId,
      revokedAt: null,
      expiresAt: { gt: now }
    };
    const [total, sessions] = await Promise.all([
      this.prisma.refreshToken.count({ where }),
      this.prisma.refreshToken.findMany({
        where,
        orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      items: sessions.map((session) => ({
        id: session.id,
        sessionLabel: session.sessionLabel,
        clientPlatform: session.clientPlatform,
        lastUsedAt: session.lastUsedAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === currentSessionId
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  async revokeSession(userId: string, sessionId: string) {
    const revokedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const result = await db.refreshToken.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: { gt: revokedAt }
        },
        data: { revokedAt }
      });
      if (result.count !== 1) {
        throw new AppException("SESSION_NOT_FOUND", "Active session not found", HttpStatus.NOT_FOUND);
      }
      await this.audit.record({
        actorId: userId,
        action: "account.session_revoked",
        resourceType: "refreshToken",
        resourceId: sessionId
      }, db);
    });
    return { success: true, id: sessionId };
  }

  async revokeOtherSessions(userId: string, currentSessionId?: string) {
    if (!currentSessionId) {
      throw new AppException(
        "SESSION_ASSURANCE_REQUIRED",
        "Current session assurance is required",
        HttpStatus.UNAUTHORIZED
      );
    }
    const revokedAt = new Date();
    const revokedCount = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const result = await db.refreshToken.updateMany({
        where: {
          userId,
          id: { not: currentSessionId },
          revokedAt: null,
          expiresAt: { gt: revokedAt }
        },
        data: { revokedAt }
      });
      await this.audit.record({
        actorId: userId,
        action: "account.other_sessions_revoked",
        resourceType: "user",
        metadata: { currentSessionId, revokedCount: result.count }
      }, db);
      return result.count;
    });
    return { success: true, revokedCount };
  }

  async listMyDataRightsRequests(
    userId: string,
    query: ListDataRightsRequestsDto = Object.assign(new ListDataRightsRequestsDto(), { page: 1, pageSize: 50 })
  ) {
    const where = { userId, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.dataRightsRequest.findMany({
      where,
      include: {
        followUps: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 20
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
      this.prisma.dataRightsRequest.count({ where })
    ]);
    return {
      items: items.map((item) => this.toDataRightsDto(item, false)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async createDataRightsRequest(userId: string, dto: CreateDataRightsRequestDto) {
    const description = this.normalizeLowSensitivityText(dto.description, 500, 5);
    this.assertNoObviousSensitiveLiteral(description, "DATA_RIGHTS_SENSITIVE_CONTENT");

    const created = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`talk-and-talk:data-rights:${userId}:${dto.type}`}))::text AS "lock"
      `;
      const existing = await db.dataRightsRequest.findFirst({
        where: {
          userId,
          type: dto.type,
          status: { in: ACTIVE_DATA_RIGHTS_STATUSES }
        },
        orderBy: { createdAt: "desc" }
      });
      if (existing) {
        throw new AppException(
          "DATA_RIGHTS_REQUEST_ALREADY_OPEN",
          "An active request of this type already exists",
          HttpStatus.CONFLICT,
          { requestId: existing.id, status: existing.status }
        );
      }
      const item = await db.dataRightsRequest.create({
        data: {
          userId,
          type: dto.type,
          description
        }
      });
      await this.audit.record({
        actorId: userId,
        action: "account.data_rights_requested",
        resourceType: "dataRightsRequest",
        resourceId: item.id,
        metadata: { type: dto.type }
      }, db);
      return item;
    });
    return this.toDataRightsDto(created, false);
  }

  async addDataRightsFollowUp(
    userId: string,
    requestId: string,
    dto: AddDataRightsFollowUpDto
  ) {
    const statement = this.normalizeLowSensitivityText(dto.statement, 500, 5);
    this.assertNoObviousSensitiveLiteral(statement, "DATA_RIGHTS_SENSITIVE_CONTENT");
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT "id" FROM "DataRightsRequest"
        WHERE "id" = ${requestId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      const request = await db.dataRightsRequest.findFirst({
        where: { id: requestId, userId },
        include: {
          followUps: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20
          }
        }
      });
      if (!request) {
        throw new AppException(
          "DATA_RIGHTS_REQUEST_NOT_FOUND",
          "Data-rights request not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (request.status !== "needsInformation") {
        throw new AppException(
          "DATA_RIGHTS_FOLLOW_UP_NOT_ALLOWED",
          "Additional information is accepted only when the request is waiting for it",
          HttpStatus.CONFLICT
        );
      }
      if ((request.followUps?.length ?? 0) >= 20) {
        throw new AppException(
          "DATA_RIGHTS_FOLLOW_UP_LIMIT_REACHED",
          "The follow-up limit has been reached; contact support for further handling",
          HttpStatus.CONFLICT
        );
      }
      const followUp = await db.dataRightsRequestFollowUp.create({
        data: {
          requestId: request.id,
          userId,
          requestedInformation: request.statusReason
            ?? "Additional information requested by the platform",
          statement
        }
      });
      const updated = await db.dataRightsRequest.update({
        where: { id: request.id },
        data: {
          status: "submitted",
          handledById: null,
          handledAt: null,
          resolvedAt: null,
          resolutionEvidenceReference: null,
          statusReason: null
        },
        include: {
          followUps: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20
          }
        }
      });
      await this.audit.record({
        actorId: userId,
        action: "account.data_rights_information_added",
        resourceType: "dataRightsRequest",
        resourceId: request.id,
        metadata: {
          followUpId: followUp.id,
          previousStatus: "needsInformation",
          status: "submitted"
        }
      }, db);
      return { request: updated, followUp };
    });
    return {
      request: this.toDataRightsDto(result.request, false),
      followUp: this.toDataRightsFollowUpDto(result.followUp)
    };
  }

  async listMyInvoiceRequests(
    userId: string,
    query: ListInvoiceRequestsDto = Object.assign(new ListInvoiceRequestsDto(), { page: 1, pageSize: 50 })
  ) {
    const where = { userId, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.invoiceRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize
    }),
      this.prisma.invoiceRequest.count({ where })
    ]);
    return {
      items: items.map((item) => this.toInvoiceDto(item, false)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async listInvoiceCandidateOrders(
    userId: string,
    query: ListInvoiceEligibleOrdersDto = Object.assign(new ListInvoiceEligibleOrdersDto(), { page: 1, pageSize: 50 })
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = {
      userId,
      status: { in: [...INVOICE_ELIGIBLE_ORDER_STATUSES] }
    };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          amountCents: true,
          currency: true,
          serviceOfferingTitleSnapshot: true,
          themeNameSnapshot: true,
          companionNameSnapshot: true,
          payments: {
            where: { status: "success", paidAt: { not: null } },
            orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            select: { id: true, amountCents: true, paidAt: true },
            take: 1
          },
          refunds: {
            where: { status: { in: [...BLOCKING_REFUND_STATUSES] } },
            select: { id: true },
            take: 1
          },
          invoiceRequests: {
            where: { status: { in: ["submitted", "inReview", "issued"] } },
            select: { id: true, status: true },
            take: 1
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.order.count({ where } as any)
    ]);
    return {
      items: (orders as any[]).map((order) => {
        const payment = order.payments[0];
        const reason = !payment || !payment.paidAt || payment.amountCents !== order.amountCents
          ? "paymentNotConfirmed"
          : order.refunds.length
            ? "refundInProgressOrCompleted"
            : order.invoiceRequests.length
              ? "requestAlreadyExists"
              : null;
        return {
          id: order.id,
          status: order.status,
          scheduledAt: order.scheduledAt.toISOString(),
          amountCents: order.amountCents,
          currency: order.currency,
          serviceTitle: order.serviceOfferingTitleSnapshot ?? order.themeNameSnapshot,
          companionName: order.companionNameSnapshot,
          eligible: reason === null,
          ineligibleReason: reason
        };
      }),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async createInvoiceRequest(userId: string, dto: CreateInvoiceRequestDto) {
    const invoiceTitle = this.normalizeLowSensitivityText(dto.invoiceTitle, 100, 2);
    if (INVOICE_TITLE_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(invoiceTitle))) {
      throw new AppException(
        "INVOICE_TITLE_SENSITIVE_CONTENT",
        "Invoice title must not contain tax, identity, bank, account, or credential information",
        HttpStatus.BAD_REQUEST
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
        // Refund and settlement workflows use the same canonical Order lock.
        // Re-checking payment/refund truth after the lock prevents an invoice
        // request from racing an accepted or provider-completed refund.
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${dto.orderId} FOR UPDATE`;
        const order = await db.order.findFirst({
          where: { id: dto.orderId, userId },
          include: {
            payments: {
              where: { status: "success", paidAt: { not: null } },
              orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
              take: 1
            },
            refunds: {
              where: { status: { in: [...BLOCKING_REFUND_STATUSES] } },
              select: { id: true, status: true },
              take: 1
            }
          }
        });
        if (!order) {
          throw new AppException("INVOICE_ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
        }
        if (!(INVOICE_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
          throw new AppException(
            "INVOICE_ORDER_NOT_SETTLED",
            "Only a paid, in-service, or completed order can be invoiced",
            HttpStatus.CONFLICT
          );
        }
        const payment = order.payments[0];
        if (!payment || !payment.paidAt || payment.amountCents !== order.amountCents) {
          throw new AppException(
            "INVOICE_PAYMENT_NOT_CONFIRMED",
            "The authoritative successful payment has not been confirmed",
            HttpStatus.CONFLICT
          );
        }
        if (order.refunds.length > 0) {
          throw new AppException(
            "INVOICE_REFUND_IN_PROGRESS_OR_COMPLETED",
            "An invoice cannot be requested while a refund is active or completed",
            HttpStatus.CONFLICT
          );
        }
        const existing = await db.invoiceRequest.findFirst({
          where: {
            orderId: order.id,
            status: { in: ["submitted", "inReview", "issued"] }
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        });
        if (existing) {
          throw new AppException(
            "INVOICE_REQUEST_ALREADY_EXISTS",
            "An invoice request already exists for this order",
            HttpStatus.CONFLICT,
            { requestId: existing.id, status: existing.status }
          );
        }
        const item = await db.invoiceRequest.create({
          data: {
            userId,
            orderId: order.id,
            paymentTransactionId: payment.id,
            invoiceTitle,
            amountCents: order.amountCents,
            currency: order.currency,
            paymentPaidAt: payment.paidAt,
            serviceTitleSnapshot: order.serviceOfferingTitleSnapshot ?? order.themeNameSnapshot,
            serviceDeliveryModeSnapshot: order.serviceOfferingDeliveryModeSnapshot,
            serviceDurationMinutesSnapshot: order.serviceOfferingDurationSnapshot ?? order.durationMinutes,
            companionNameSnapshot: order.companionNameSnapshot
          }
        });
        await this.audit.record({
          actorId: userId,
          action: "account.invoice_requested",
          resourceType: "invoiceRequest",
          resourceId: item.id,
          metadata: {
            orderId: order.id,
            paymentTransactionId: payment.id,
            amountCents: order.amountCents,
            currency: order.currency
          }
        }, db);
      return item;
    });
    return this.toInvoiceDto(created, false);
  }

  async cancelInvoiceRequest(userId: string, requestId: string) {
    const cancelledAt = new Date();
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const existing = await db.invoiceRequest.findFirst({
        where: { id: requestId, userId },
        select: { id: true, orderId: true, status: true }
      });
      if (!existing) {
        throw new AppException(
          "INVOICE_REQUEST_NOT_FOUND",
          "Invoice request not found",
          HttpStatus.NOT_FOUND
        );
      }
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${existing.orderId} FOR UPDATE`;
      const result = await db.invoiceRequest.updateMany({
        where: { id: requestId, userId, status: "submitted" },
        data: {
          status: "cancelled",
          statusReason: "Cancelled by requester",
          cancelledAt
        }
      });
      if (result.count !== 1) {
        const current = await db.invoiceRequest.findUnique({
          where: { id: requestId },
          select: { status: true }
        });
        throw new AppException(
          "INVOICE_CANCELLATION_NOT_ALLOWED",
          "Only a submitted invoice request can be cancelled by its requester",
          HttpStatus.CONFLICT,
          { currentStatus: current?.status ?? null }
        );
      }
      const item = await db.invoiceRequest.findUniqueOrThrow({ where: { id: requestId } });
      await this.audit.record({
        actorId: userId,
        action: "account.invoice_cancelled",
        resourceType: "invoiceRequest",
        resourceId: requestId,
        metadata: { orderId: existing.orderId }
      }, db);
      return item;
    });
    return this.toInvoiceDto(cancelled, false);
  }

  async listDataRightsForAdmin(
    actorId: string,
    actorRole: string,
    query: ListDataRightsRequestsDto
  ) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(actorRole === "admin" ? {} : { handledById: actorId })
    };
    const [items, total] = await Promise.all([
      this.prisma.dataRightsRequest.findMany({
        where,
        include: {
          followUps: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.dataRightsRequest.count({ where })
    ]);
    return {
      items: items.map((item) => this.toDataRightsDto(item, true)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async listClaimableDataRights(query: ListDataRightsRequestsDto) {
    const requestedStatus = query.status;
    if (requestedStatus && !ACTIVE_DATA_RIGHTS_STATUSES.includes(requestedStatus)) {
      return {
        items: [],
        pagination: this.pagination(query.page, query.pageSize, 0)
      };
    }
    const where = {
      handledById: null,
      status: requestedStatus ?? { in: ACTIVE_DATA_RIGHTS_STATUSES }
    };
    const [items, total] = await Promise.all([
      this.prisma.dataRightsRequest.findMany({
        where,
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.dataRightsRequest.count({ where })
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString()
      })),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async claimDataRightsRequest(actorId: string, actorRole: string, requestId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "DataRightsRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const existing = await db.dataRightsRequest.findUnique({
        where: { id: requestId },
        include: {
          followUps: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20
          }
        }
      });
      if (!existing) {
        throw new AppException(
          "DATA_RIGHTS_REQUEST_NOT_FOUND",
          "Data-rights request not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (!ACTIVE_DATA_RIGHTS_STATUSES.includes(existing.status)) {
        throw new AppException(
          "DATA_RIGHTS_CLAIM_NOT_ALLOWED",
          "Only an active data-rights request can be claimed",
          HttpStatus.CONFLICT,
          { currentStatus: existing.status }
        );
      }
      if (
        existing.handledById
        && existing.handledById !== actorId
        && actorRole !== "admin"
      ) {
        throw new AppException(
          "DATA_RIGHTS_REQUEST_ALREADY_CLAIMED",
          "This data-rights request is assigned to another staff member",
          HttpStatus.CONFLICT
        );
      }
      const previousHandlerId = existing.handledById ?? null;
      if (previousHandlerId !== actorId) {
        await db.dataRightsRequest.update({
          where: { id: requestId },
          data: { handledById: actorId, handledAt: new Date() }
        });
        await this.audit.record({
          actorId,
          subjectUserIds: [
            existing.userId,
            ...(previousHandlerId ? [previousHandlerId] : [])
          ],
          action: previousHandlerId
            ? "account.data_rights_assignment_taken_over"
            : "account.data_rights_claimed",
          resourceType: "dataRightsRequest",
          resourceId: requestId,
          metadata: { userId: existing.userId, previousHandlerId }
        }, db);
      }
      return db.dataRightsRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: {
          followUps: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20
          }
        }
      });
    });
    return this.toDataRightsDto(item, true);
  }

  async transitionDataRightsRequest(
    actorId: string,
    actorRole: string,
    requestId: string,
    dto: TransitionDataRightsRequestDto
  ) {
    this.assertTransition(
      DATA_RIGHTS_TRANSITIONS,
      dto.expectedStatus,
      dto.nextStatus,
      "DATA_RIGHTS_STATUS_TRANSITION_INVALID"
    );
    const reason = this.normalizeLowSensitivityText(dto.reason, 500, 3);
    this.assertNoObviousSensitiveLiteral(reason, "DATA_RIGHTS_SENSITIVE_CONTENT");
    const resolutionEvidenceReference = dto.nextStatus === "completed"
      ? this.normalizeEvidenceReference(
          dto.resolutionEvidenceReference,
          "DATA_RIGHTS_RESOLUTION_EVIDENCE_REQUIRED"
        )
      : null;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "DataRightsRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const before = await db.dataRightsRequest.findUnique({
        where: { id: requestId },
        select: { userId: true, status: true, handledById: true }
      });
      if (!before) {
        throw new AppException(
          "DATA_RIGHTS_REQUEST_NOT_FOUND",
          "Data-rights request not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (before.status !== dto.expectedStatus) {
        throw new AppException(
          "DATA_RIGHTS_STATUS_CONFLICT",
          "Data-rights request status changed before this update",
          HttpStatus.CONFLICT,
          { expectedStatus: dto.expectedStatus, currentStatus: before.status }
        );
      }
      if (actorRole !== "admin" && before.handledById !== actorId) {
        throw new AppException(
          "DATA_RIGHTS_ASSIGNEE_REQUIRED",
          "Claim this data-rights request before changing its status",
          HttpStatus.FORBIDDEN
        );
      }
      if (actorRole === "admin" && before.handledById !== actorId) {
        await this.audit.record({
          actorId,
          subjectUserIds: [
            before.userId,
            ...(before.handledById ? [before.handledById] : [])
          ],
          action: "account.data_rights_assignment_taken_over",
          resourceType: "dataRightsRequest",
          resourceId: requestId,
          metadata: {
            userId: before.userId,
            previousHandlerId: before.handledById ?? null
          }
        }, db);
      }
      await db.dataRightsRequest.update({
        where: { id: requestId },
        data: {
          status: dto.nextStatus,
          statusReason: reason,
          handledById: actorId,
          handledAt: now,
          resolvedAt: ["completed", "rejected"].includes(dto.nextStatus) ? now : null,
          resolutionEvidenceReference
        }
      });
      const item = await db.dataRightsRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: {
          followUps: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 20
          }
        }
      });
      await this.audit.record({
        actorId,
        subjectUserIds: [item.userId],
        action: "account.data_rights_status_changed",
        resourceType: "dataRightsRequest",
        resourceId: requestId,
        metadata: {
          userId: item.userId,
          from: dto.expectedStatus,
          to: dto.nextStatus,
          resolutionEvidenceReference
        }
      }, db);
      return item;
    });
    return this.toDataRightsDto(updated, true);
  }

  async listInvoicesForAdmin(query: ListInvoiceRequestsDto) {
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.invoiceRequest.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.invoiceRequest.count({ where })
    ]);
    return {
      items: items.map((item) => this.toInvoiceDto(item, true)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async transitionInvoiceRequest(
    actorId: string,
    requestId: string,
    dto: TransitionInvoiceRequestDto
  ) {
    this.assertTransition(
      INVOICE_TRANSITIONS,
      dto.expectedStatus,
      dto.nextStatus,
      "INVOICE_STATUS_TRANSITION_INVALID"
    );
    const reason = this.normalizeLowSensitivityText(dto.reason, 500, 3);
    this.assertNoObviousSensitiveLiteral(reason, "INVOICE_STATUS_REASON_SENSITIVE_CONTENT");
    const evidenceReference = ["issued", "voided"].includes(dto.nextStatus)
      ? this.normalizeEvidenceReference(
          dto.evidenceReference,
          dto.nextStatus === "issued"
            ? "INVOICE_ISSUANCE_EVIDENCE_REQUIRED"
            : "INVOICE_VOID_EVIDENCE_REQUIRED"
        )
      : null;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const before = await db.invoiceRequest.findUnique({
        where: { id: requestId },
        select: { id: true, userId: true, orderId: true, status: true }
      });
      if (!before) {
        throw new AppException(
          "INVOICE_REQUEST_NOT_FOUND",
          "Invoice request not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (before.status !== dto.expectedStatus) {
        throw new AppException(
          "INVOICE_STATUS_CONFLICT",
          "Invoice request status changed before this update",
          HttpStatus.CONFLICT,
          { expectedStatus: dto.expectedStatus, currentStatus: before.status }
        );
      }
      if (dto.nextStatus === "issued") {
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${before.orderId} FOR UPDATE`;
        const order = await db.order.findUnique({
          where: { id: before.orderId },
          include: {
            payments: {
              where: { status: "success", paidAt: { not: null } },
              orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
              take: 1
            },
            refunds: {
              where: { status: { in: [...BLOCKING_REFUND_STATUSES] } },
              select: { id: true, status: true },
              take: 1
            }
          }
        });
        const payment = order?.payments?.[0];
        if (
          !order
          || !(INVOICE_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)
          || !payment?.paidAt
          || payment.amountCents !== order.amountCents
        ) {
          throw new AppException(
            "INVOICE_PAYMENT_NOT_CONFIRMED",
            "The authoritative successful payment is no longer eligible for invoice issuance",
            HttpStatus.CONFLICT
          );
        }
        if (order.refunds.length > 0) {
          throw new AppException(
            "INVOICE_REFUND_IN_PROGRESS_OR_COMPLETED",
            "An invoice cannot be issued while a refund is active, failed-but-retryable, or completed",
            HttpStatus.CONFLICT
          );
        }
      }
      const result = await db.invoiceRequest.updateMany({
        where: { id: requestId, status: dto.expectedStatus },
        data: {
          status: dto.nextStatus,
          statusReason: reason,
          handledById: actorId,
          handledAt: now,
          ...(dto.nextStatus === "issued"
            ? { issuedAt: now, issuanceEvidenceReference: evidenceReference }
            : {}),
          ...(dto.nextStatus === "voided"
            ? { voidedAt: now, voidEvidenceReference: evidenceReference }
            : {})
        }
      });
      if (result.count !== 1) {
        const current = await db.invoiceRequest.findUnique({
          where: { id: requestId },
          select: { status: true }
        });
        if (!current) {
          throw new AppException("INVOICE_REQUEST_NOT_FOUND", "Invoice request not found", HttpStatus.NOT_FOUND);
        }
        throw new AppException(
          "INVOICE_STATUS_CONFLICT",
          "Invoice request status changed before this update",
          HttpStatus.CONFLICT,
          { expectedStatus: dto.expectedStatus, currentStatus: current.status }
        );
      }
      const item = await db.invoiceRequest.findUniqueOrThrow({ where: { id: requestId } });
      await this.audit.record({
        actorId,
        subjectUserIds: [item.userId],
        action: "account.invoice_status_changed",
        resourceType: "invoiceRequest",
        resourceId: requestId,
        metadata: {
          userId: item.userId,
          from: dto.expectedStatus,
          to: dto.nextStatus,
          evidenceReference
        }
      }, db);
      return item;
    });
    return this.toInvoiceDto(updated, true);
  }

  private toDataRightsDto(item: any, admin: boolean) {
    const dto = {
      id: item.id,
      type: item.type,
      status: item.status,
      description: item.description,
      statusReason: item.statusReason ?? null,
      followUps: (item.followUps ?? []).map((followUp: any) =>
        this.toDataRightsFollowUpDto(followUp)
      ),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
      resolutionEvidenceAvailable: Boolean(item.resolutionEvidenceReference)
    };
    return admin
      ? {
          ...dto,
          userId: item.userId,
          handledById: item.handledById ?? null,
          resolutionEvidenceReference: item.resolutionEvidenceReference ?? null
        }
      : dto;
  }

  private toDataRightsFollowUpDto(item: any) {
    return {
      id: item.id,
      requestedInformation: item.requestedInformation,
      statement: item.statement,
      createdAt: item.createdAt.toISOString()
    };
  }

  private toInvoiceDto(item: any, admin: boolean) {
    const dto = {
      id: item.id,
      orderId: item.orderId,
      status: item.status,
      invoiceTitle: item.invoiceTitle,
      amountCents: item.amountCents,
      currency: item.currency,
      paymentPaidAt: item.paymentPaidAt.toISOString(),
      service: {
        title: item.serviceTitleSnapshot,
        deliveryMode: item.serviceDeliveryModeSnapshot ?? null,
        durationMinutes: item.serviceDurationMinutesSnapshot,
        companionName: item.companionNameSnapshot
      },
      statusReason: item.statusReason ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      issuedAt: item.issuedAt?.toISOString() ?? null,
      voidedAt: item.voidedAt?.toISOString() ?? null,
      cancelledAt: item.cancelledAt?.toISOString() ?? null
    };
    return admin
      ? {
          ...dto,
          userId: item.userId,
          paymentTransactionId: item.paymentTransactionId,
          handledById: item.handledById ?? null,
          issuanceEvidenceReference: item.issuanceEvidenceReference ?? null,
          voidEvidenceReference: item.voidEvidenceReference ?? null
        }
      : dto;
  }

  private normalizeLowSensitivityText(value: string, maxLength: number, minLength = 1): string {
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length < minLength || normalized.length > maxLength) {
      throw new AppException("GOVERNANCE_TEXT_INVALID", "Text is empty or exceeds the allowed length", HttpStatus.BAD_REQUEST);
    }
    return normalized;
  }

  private assertNoObviousSensitiveLiteral(value: string, code: string): void {
    if (OBVIOUS_SENSITIVE_LITERAL_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new AppException(
        code,
        "Do not submit identity numbers, bank-card details, passwords, verification codes, or credentials",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private normalizeEvidenceReference(value: string | undefined, code: string): string {
    const normalized = value?.trim() ?? "";
    if (
      normalized.length < 6
      || normalized.length > 160
      || !EVIDENCE_REFERENCE_PATTERN.test(normalized)
    ) {
      throw new AppException(
        code,
        "A controlled evidence reference is required for this transition",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private assertTransition<T extends string>(
    transitions: Record<T, T[]>,
    expectedStatus: T,
    nextStatus: T,
    code: string
  ): void {
    if (!transitions[expectedStatus]?.includes(nextStatus)) {
      throw new AppException(
        code,
        `Cannot transition from ${expectedStatus} to ${nextStatus}`,
        HttpStatus.CONFLICT
      );
    }
  }

  private pagination(page: number, pageSize: number, total: number) {
    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    };
  }

}
