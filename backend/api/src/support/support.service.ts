import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { CommercialService } from "../commercial/commercial.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateSupportTicketDto } from "./dto/create-support-ticket.dto";
import { ListSupportTicketsDto } from "./dto/list-support-tickets.dto";
import { ResolveSupportTicketDto } from "./dto/resolve-support-ticket.dto";

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
      include: { order: true },
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
          assignedTo: { include: { profile: true } }
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

  private async enqueueTransactionalNotification(
    db: any,
    input: Parameters<NotificationsService["createTransactional"]>[1]
  ) {
    return this.notifications.createTransactional(db, input);
  }
}
