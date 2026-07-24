import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { CommercialService } from "../commercial/commercial.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AddOrderSupportFactDto } from "./dto/add-order-support-fact.dto";
import { CreateSupportTicketDto } from "./dto/create-support-ticket.dto";
import { ListSupportTicketsDto } from "./dto/list-support-tickets.dto";
import { ResolveSupportTicketDto } from "./dto/resolve-support-ticket.dto";

// This is a narrow prevention layer, not content moderation. It keeps obvious
// identity-document, direct-contact, and health/medical material out of a
// field whose only allowed purpose is describing time, fulfillment, or payment
// facts. Attachments and chat imports are not supported at all.
const ORDER_FACT_SENSITIVE_CONTENT = /(?:\b\d{15}\b|\b\d{17}[\dXx]\b|(?:^|[^\d])1[3-9]\d{9}(?:$|[^\d])|身份证|护照|驾驶证|社保(?:卡|号)?|银行卡|银行账户|病历|诊断|健康(?:证明|码|状况)?|疾病|医疗|就诊|处方)/u;
const MAX_ORDER_FACTS_PER_TICKET = 10;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly commercial: CommercialService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async create(user: AuthenticatedUser, dto: CreateSupportTicketDto) {
    const dueAt = new Date(Date.now() + (this.config.get<number>("SUPPORT_RESPONSE_HOURS") ?? 24) * 60 * 60_000);
    const priority = dto.category === "safety" ? "urgent" : ["orderIssue", "refund"].includes(dto.category) ? "high" : "normal";
    const ticket = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      if (dto.orderId) {
        // Keep the same Order → CompanionEarning lock order as refund and
        // payout flows so a new dispute cannot race a payout claim.
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${dto.orderId} FOR UPDATE`;
        // Authorization must be re-evaluated after the same lock. In particular,
        // a former companion owner cannot race reassignment and create a ticket
        // that freezes somebody else's settlement.
        const order = await db.order.findUnique({
          where: { id: dto.orderId },
          include: { companion: { select: { ownerUserId: true } } }
        });
        if (!order || (order.userId !== user.id && order.companion.ownerUserId !== user.id)) {
          throw new AppException("ORDER_NOT_FOUND", "Order not found", HttpStatus.NOT_FOUND);
        }
      }
      await db.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`talk-and-talk:support:${user.id}`}))::text AS "lock"
      `;
      const maxOpenPerUser = this.config.get<number>("SUPPORT_MAX_OPEN_PER_USER") ?? 5;
      const openForUser = await db.supportTicket.count({
        where: { userId: user.id, status: { in: ["open", "inProgress"] } }
      });
      if (dto.category !== "safety" && openForUser >= maxOpenPerUser) {
        throw new AppException(
          "SUPPORT_OPEN_LIMIT_REACHED",
          "Resolve an existing support ticket before opening another",
          HttpStatus.CONFLICT,
          { limit: maxOpenPerUser }
        );
      }
      const created = await db.supportTicket.create({
        data: {
          userId: user.id,
          orderId: dto.orderId ?? null,
          category: dto.category,
          priority,
          subject: dto.subject.trim(),
          body: dto.body.trim(),
          dueAt
        }
      });
      await this.audit.record({
        actorId: user.id,
        action: "support.ticket_created",
        resourceType: "supportTicket",
        resourceId: created.id,
        metadata: { orderId: dto.orderId ?? null, category: dto.category, priority }
      }, db);
      if (created.orderId) {
        await this.commercial.holdForOrder(created.orderId, "unresolved_support_ticket", db);
      }
      return created;
    });
    return this.toDto(ticket, false);
  }

  async listMine(userId: string) {
    const items = await this.prisma.supportTicket.findMany({
      where: { userId },
      include: {
        order: true,
        // A requester sees only their own voluntary statements. In particular,
        // the other order participant cannot use this list to read a private
        // support submission or even infer its content.
        orderFacts: {
          where: { submittedByUserId: userId },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 100
    } as any);
    return { items: items.map((ticket: any) => this.toDto(ticket, false)) };
  }

  async listAdmin(query: ListSupportTicketsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = query.status ? { status: query.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          order: true,
          requester: { include: { profile: true } },
          assignedTo: { include: { profile: true } },
          orderFacts: { orderBy: { createdAt: "asc" } }
        },
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.supportTicket.count({ where } as any)
    ]);
    return {
      items: items.map((ticket: any) => this.toDto(ticket, true)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async addOrderFact(user: AuthenticatedUser, ticketId: string, dto: AddOrderSupportFactDto) {
    const statement = dto.statement.trim();
    if (statement.length < 5) {
      throw new AppException(
        "SUPPORT_ORDER_FACT_INVALID",
        "Order support fact must contain at least five non-whitespace characters",
        HttpStatus.BAD_REQUEST
      );
    }
    if (ORDER_FACT_SENSITIVE_CONTENT.test(statement)) {
      throw new AppException(
        "SUPPORT_ORDER_FACT_SENSITIVE_CONTENT",
        "Order support facts may not include identity, contact, document, or health material",
        HttpStatus.BAD_REQUEST
      );
    }
    const fact = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Read only the opaque order pointer before acquiring the canonical
      // Order → SupportTicket locks. All authorization is re-checked after the
      // locks, and every unauthorized branch uses the same non-probing result.
      const pointer = await db.supportTicket.findUnique({
        where: { id: ticketId },
        select: { orderId: true }
      });
      if (!pointer?.orderId) {
        throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${pointer.orderId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${ticketId} FOR UPDATE`;
      const ticket = await db.supportTicket.findUnique({
        where: { id: ticketId },
        include: { order: { include: { companion: { select: { ownerUserId: true } } } } }
      });
      const isCurrentOrderParticipant = ticket?.order
        && (ticket.order.userId === user.id || ticket.order.companion.ownerUserId === user.id);
      if (
        !ticket
        || !ticket.orderId
        || !ticket.order
        || ticket.userId !== user.id
        || !isCurrentOrderParticipant
        || !["orderIssue", "refund"].includes(ticket.category)
      ) {
        throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
      }
      if (["resolved", "closed"].includes(ticket.status)) {
        throw new AppException(
          "SUPPORT_TICKET_CLOSED",
          "Resolved tickets cannot receive additional order facts",
          HttpStatus.CONFLICT
        );
      }
      const existingFacts = await db.orderSupportFact.count({ where: { supportTicketId: ticket.id } });
      if (existingFacts >= MAX_ORDER_FACTS_PER_TICKET) {
        throw new AppException(
          "SUPPORT_ORDER_FACT_LIMIT_REACHED",
          "This support ticket already has the maximum number of order facts",
          HttpStatus.CONFLICT,
          { limit: MAX_ORDER_FACTS_PER_TICKET }
        );
      }
      const created = await db.orderSupportFact.create({
        data: {
          supportTicketId: ticket.id,
          orderId: ticket.orderId,
          submittedByUserId: user.id,
          statement
        }
      });
      // Facts do not change case status, refund, or settlement. Touching only
      // the ticket timestamp keeps the requester's private queue current.
      await db.supportTicket.update({
        where: { id: ticket.id },
        data: { updatedAt: new Date() }
      });
      await this.audit.record({
        actorId: user.id,
        action: "support.order_fact_added",
        resourceType: "supportTicket",
        resourceId: ticket.id,
        metadata: { orderId: ticket.orderId, submittedByUserId: user.id, orderSupportFactId: created.id }
      }, db);
      return created;
    });
    return this.toOrderFactDto(fact, false);
  }

  async assign(actorId: string, ticketId: string, assignedToUserId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const pointer = await db.supportTicket.findUnique({
        where: { id: ticketId },
        select: { orderId: true }
      });
      if (!pointer) {
        throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
      }
      if (pointer.orderId) {
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${pointer.orderId} FOR UPDATE`;
      }
      await db.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${ticketId} FOR UPDATE`;
      const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } });
      const assignee = await db.user.findUnique({
        where: { id: assignedToUserId },
        select: { id: true, role: true, accountStatus: true }
      });
      if (!ticket) throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
      if (!assignee || assignee.role !== "admin" || assignee.accountStatus !== "active") {
        throw new AppException("SUPPORT_ASSIGNEE_INVALID", "Assignee must be an active administrator", HttpStatus.BAD_REQUEST);
      }
      if (["resolved", "closed"].includes(ticket.status)) {
        throw new AppException("SUPPORT_TICKET_CLOSED", "Resolved tickets cannot be assigned", HttpStatus.CONFLICT);
      }
      const updated = await db.supportTicket.update({
        where: { id: ticketId },
        data: { assignedToUserId, status: "inProgress" },
        include: { order: true }
      });
      await this.audit.record({
        actorId,
        action: "support.ticket_assigned",
        resourceType: "supportTicket",
        resourceId: ticketId,
        metadata: { assignedToUserId }
      }, db);
      return updated;
    });
    return this.toDto(result, true);
  }

  async resolve(actorId: string, ticketId: string, dto: ResolveSupportTicketDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      // Order → SupportTicket matches create/payout lock order so resolving a
      // ticket cannot race claim/verify while settlement eligibility flips.
      const pointer = await db.supportTicket.findUnique({
        where: { id: ticketId },
        select: { orderId: true }
      });
      if (!pointer) {
        throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
      }
      if (pointer.orderId) {
        await db.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${pointer.orderId} FOR UPDATE`;
      }
      await db.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${ticketId} FOR UPDATE`;
      const ticket = await db.supportTicket.findUnique({ where: { id: ticketId }, include: { order: true } });
      if (!ticket) throw new AppException("SUPPORT_TICKET_NOT_FOUND", "Support ticket not found", HttpStatus.NOT_FOUND);
      if (["resolved", "closed"].includes(ticket.status)) {
        throw new AppException("SUPPORT_TICKET_CLOSED", "Ticket is already resolved", HttpStatus.CONFLICT);
      }
      if (ticket.assignedToUserId !== actorId) {
        throw new AppException(
          "SUPPORT_TICKET_ASSIGNEE_REQUIRED",
          "Only the active assignee can resolve this ticket",
          HttpStatus.FORBIDDEN
        );
      }
      if (dto.resolutionCode === "refundInProgress") {
        const activeRefund = await db.refundTransaction.findFirst({
          where: { orderId: ticket.orderId, status: { in: ["pendingReview", "pending", "processing", "failed"] } },
          select: { id: true }
        });
        if (!activeRefund) {
          throw new AppException(
            "SUPPORT_REFUND_NOT_STARTED",
            "A refund must be created before resolving the ticket as refund in progress",
            HttpStatus.CONFLICT
          );
        }
      }
      const updated = await db.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: dto.status,
          resolution: dto.resolution.trim(),
          resolutionCode: dto.resolutionCode,
          resolvedAt: new Date()
        },
        include: { order: true }
      });
      await this.enqueueTransactionalNotification(db, {
        userId: ticket.userId,
        type: "supportUpdate",
        title: "客服工单已更新",
        body: "你的客服工单已有处理结果，请在订单或消息中心查看。",
        data: { ticketId, orderId: ticket.orderId ?? null, status: dto.status },
        eventKey: `support:${ticketId}:${dto.status}`,
        templateKey: "supportUpdate"
      });
      await this.audit.record({
        actorId,
        action: "support.ticket_resolved",
        resourceType: "supportTicket",
        resourceId: ticketId,
        metadata: { status: dto.status, orderId: ticket.orderId ?? null, resolutionCode: dto.resolutionCode }
      }, db);
      return updated;
    });
    return this.toDto(result, true);
  }

  private toDto(ticket: any, includeOperations: boolean) {
    const dto = {
      id: ticket.id,
      orderId: ticket.orderId ?? null,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      subject: ticket.subject,
      body: ticket.body,
      dueAt: ticket.dueAt?.toISOString() ?? null,
      resolution: ticket.resolution ?? null,
      resolutionCode: ticket.resolutionCode ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      order: ticket.order ? {
        status: ticket.order.status,
        amountCents: ticket.order.amountCents,
        scheduledAt: ticket.order.scheduledAt?.toISOString?.() ?? null
      } : null
    } as Record<string, unknown>;
    dto.orderFacts = (ticket.orderFacts ?? []).map((fact: any) => this.toOrderFactDto(fact, includeOperations));
    if (includeOperations) {
      dto.requester = ticket.requester ? {
        id: ticket.requester.id,
        displayName: ticket.requester.profile?.displayName ?? null
      } : null;
      dto.assignedTo = ticket.assignedTo ? {
        id: ticket.assignedTo.id,
        displayName: ticket.assignedTo.profile?.displayName ?? null
      } : null;
    }
    return dto;
  }

  private toOrderFactDto(fact: any, includeOperations: boolean) {
    const dto = {
      id: fact.id,
      statement: fact.statement,
      createdAt: fact.createdAt.toISOString()
    } as Record<string, unknown>;
    if (includeOperations) dto.submittedByUserId = fact.submittedByUserId;
    return dto;
  }

  private async enqueueTransactionalNotification(
    db: any,
    input: Parameters<NotificationsService["createTransactional"]>[1]
  ) {
    return this.notifications.createTransactional(db, input);
  }
}
