import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AuthenticatedUser } from "../auth/auth.service";
import { maskPhone, redactSecrets } from "../common/logging/redact";
import { PrismaService } from "../database/prisma.service";
import {
  ListAdminAuditLogsDto,
  ListAdminOrdersDto,
  ListAdminUsersDto,
  ListSupportAssigneesDto
} from "./dto/admin-operations-query.dto";

const CAPABILITIES_BY_ROLE: Record<string, string[]> = {
  support: [
    "support.ticket.assigned.read",
    "support.ticket.claimable-summary.read",
    "support.order.assigned.read",
    "support.claim.self",
    "support.resolve.assigned",
    "support.refund.assigned",
    "payment-dispute.queue.read",
    "payment-dispute.claim.self",
    "payment-dispute.reply.assigned",
    "payment-dispute.sync",
    "data-rights.assigned.manage",
    "data-rights.claimable-summary.read",
    "data-rights.claim.self"
  ],
  finance: [
    "order.read.financial",
    "refund.manage",
    "settlement.manage",
    "recovery.manage",
    "invoice.manage",
    "companion.withdrawal.manage",
    "payment-reconciliation.manage",
    "payment-dispute.financial.read",
    "payment-dispute.sync"
  ],
  supply: [
    "companion.commercial.manage",
    "companion.verification.manage",
    "customer.adult-eligibility.manage",
    "companion.lifecycle.supply.manage"
  ],
  operations: [
    "commercial.readiness.read",
    "commercial.funnel.read",
    "order.read.operational-redacted",
    "supply.aggregate.read"
  ],
  admin: [
    "commercial.readiness.read",
    "commercial.funnel.read",
    "companion.commercial.manage",
    "companion.lifecycle.manage",
    "companion.lifecycle.supply.manage",
    "companion.withdrawal.manage",
    "companion.verification.manage",
    "customer.adult-eligibility.manage",
    "order.read.all",
    "user.read.all",
    "support.ticket.all.read",
    "support.assign.any",
    "support.resolve.assigned",
    "support.refund.assigned",
    "refund.manage",
    "payment-reconciliation.manage",
    "payment-dispute.all.read",
    "payment-dispute.assign",
    "payment-dispute.reply",
    "payment-dispute.sync",
    "settlement.manage",
    "recovery.manage",
    "invoice.manage",
    "account.manage",
    "staff.offboarding.manage",
    "data-rights.manage.all",
    "audit.read"
  ]
};

const DATA_SCOPES_BY_ROLE: Record<string, Record<string, string>> = {
  support: {
    orders: "assignedSupportTickets",
    supportTickets: "assignedToOperator",
    claimableSupportTickets: "unassignedSummaryOnly",
    paymentDisputes: "assignedToOperatorPlusUnassignedSummary",
    paymentReconciliation: "none",
    dataRights: "assignedToOperatorPlusUnassignedSummary",
    identityVerification: "none",
    customerAdultEligibility: "none",
    staffCredentials: "none",
    users: "none"
  },
  finance: {
    orders: "allFinancial",
    supportTickets: "none",
    claimableSupportTickets: "none",
    paymentDisputes: "financialFactsOnly",
    paymentReconciliation: "allFinancial",
    dataRights: "none",
    identityVerification: "none",
    customerAdultEligibility: "none",
    staffCredentials: "none",
    users: "none"
  },
  supply: {
    orders: "none",
    supportTickets: "none",
    claimableSupportTickets: "none",
    paymentDisputes: "none",
    paymentReconciliation: "none",
    dataRights: "none",
    identityVerification: "allKycWorkflow",
    customerAdultEligibility: "allAdultEligibilityWorkflow",
    staffCredentials: "none",
    users: "none"
  },
  operations: {
    orders: "allOperationalRedacted",
    supportTickets: "none",
    claimableSupportTickets: "none",
    paymentDisputes: "none",
    paymentReconciliation: "none",
    dataRights: "none",
    identityVerification: "none",
    customerAdultEligibility: "none",
    staffCredentials: "none",
    users: "none"
  },
  admin: {
    orders: "all",
    supportTickets: "all",
    claimableSupportTickets: "allViaFullQueue",
    paymentDisputes: "all",
    paymentReconciliation: "allFinancial",
    dataRights: "all",
    identityVerification: "allKycWorkflow",
    customerAdultEligibility: "allAdultEligibilityWorkflow",
    staffCredentials: "allCommercialStaff",
    users: "all"
  }
};

@Controller("admin/operations")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("support", "finance", "supply", "operations", "admin")
export class AdminOperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("context")
  context(@CurrentUser() actor: AuthenticatedUser) {
    return {
      operator: { id: actor.id, role: actor.role },
      capabilities: CAPABILITIES_BY_ROLE[actor.role] ?? [],
      dataScopes: DATA_SCOPES_BY_ROLE[actor.role] ?? {
        orders: "none",
        supportTickets: "none",
        claimableSupportTickets: "none",
        dataRights: "none",
        identityVerification: "none",
        customerAdultEligibility: "none",
        staffCredentials: "none",
        users: "none"
      },
      boundaries: {
        reviewDepartment: "separateIdentityDomain",
        destructiveActionsDefault: "readOnly"
      }
    };
  }

  @Get("orders")
  @Roles("finance", "operations", "admin")
  async orders(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAdminOrdersDto
  ) {
    return this.listOrders(
      query,
      actor.role === "operations"
        ? "operations"
        : actor.role === "finance"
          ? "finance"
          : "admin"
    );
  }

  @Get("support/orders")
  @Roles("support")
  async supportOrders(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAdminOrdersDto
  ) {
    return this.listOrders(query, "support", actor.id);
  }

  private async listOrders(
    query: ListAdminOrdersDto,
    responseScope: "admin" | "finance" | "operations" | "support",
    supportAssigneeId?: string
  ) {
    const page = query.page;
    const pageSize = query.pageSize;
    const keyword = query.keyword?.trim();
    const includeCustomer = responseScope !== "operations";
    const includeFinancialReferences = ["admin", "finance"].includes(responseScope);
    const includeSupportTicketDetails = ["admin", "support"].includes(responseScope);
    const where: any = {
      ...(query.status ? { status: query.status } : {}),
      ...(supportAssigneeId
        ? { supportTickets: { some: { assignedToUserId: supportAssigneeId } } }
        : {}),
      ...(keyword
        ? {
            OR: [
              { id: { contains: keyword, mode: "insensitive" } },
              { companionNameSnapshot: { contains: keyword, mode: "insensitive" } },
              { serviceOfferingTitleSnapshot: { contains: keyword, mode: "insensitive" } },
              ...(responseScope === "operations"
                ? []
                : [{ user: { profile: { displayName: { contains: keyword, mode: "insensitive" } } } }])
            ]
          }
        : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          ...(includeCustomer
            ? { user: { select: { id: true, profile: { select: { displayName: true } } } } }
            : {}),
          companion: { select: { id: true, name: true } },
          payments: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              ...(includeFinancialReferences ? { id: true } : {}),
              status: true,
              ...(includeFinancialReferences ? { outTradeNo: true } : {}),
              amountCents: true,
              paidAt: true,
              updatedAt: true
            }
          },
          refunds: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              ...(includeFinancialReferences ? { id: true } : {}),
              status: true,
              ...(includeFinancialReferences ? { outRefundNo: true, failureReason: true } : {}),
              amountCents: true,
              updatedAt: true
            }
          },
          ...(responseScope === "operations"
            ? {
                _count: {
                  select: {
                    supportTickets: {
                      where: { status: { in: ["open", "inProgress"] } }
                    }
                  }
                }
              }
            : includeSupportTicketDetails
              ? {
                supportTickets: {
                  where: {
                    status: { in: ["open", "inProgress"] },
                    ...(supportAssigneeId ? { assignedToUserId: supportAssigneeId } : {})
                  },
                  select: { id: true, priority: true, status: true, dueAt: true }
                }
              }
              : {})
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.order.count({ where } as any)
    ]);

    return {
      items: (items as any[]).map((order) => {
        const payment = order.payments[0]
          ? {
              ...(includeFinancialReferences ? { id: order.payments[0].id } : {}),
              status: order.payments[0].status,
              ...(includeFinancialReferences
                ? { referenceMasked: this.maskReference(order.payments[0].outTradeNo) }
                : {}),
              amountCents: order.payments[0].amountCents,
              paidAt: order.payments[0].paidAt?.toISOString() ?? null,
              updatedAt: order.payments[0].updatedAt.toISOString()
            }
          : null;
        const refund = order.refunds[0]
          ? {
              ...(includeFinancialReferences ? { id: order.refunds[0].id } : {}),
              status: order.refunds[0].status,
              ...(includeFinancialReferences
                ? {
                    referenceMasked: this.maskReference(order.refunds[0].outRefundNo),
                    failureReason: order.refunds[0].failureReason ?? null
                  }
                : {}),
              amountCents: order.refunds[0].amountCents,
              updatedAt: order.refunds[0].updatedAt.toISOString()
            }
          : null;
        return {
          id: order.id,
          status: order.status,
          amountCents: order.amountCents,
          currency: order.currency,
          serviceTitle: order.serviceOfferingTitleSnapshot ?? order.themeNameSnapshot,
          deliveryMode: order.serviceOfferingDeliveryModeSnapshot ?? null,
          durationMinutes: order.durationMinutes,
          scheduledAt: order.scheduledAt.toISOString(),
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          ...(includeCustomer
            ? {
                customer: {
                  id: order.user.id,
                  displayName: order.user.profile?.displayName ?? null
                }
              }
            : {}),
          companion: order.companion
            ? { id: order.companion.id, name: order.companion.name }
            : { id: order.companionId, name: order.companionNameSnapshot },
          payment,
          refund,
          ...(responseScope === "operations"
            ? { activeSupportTicketCount: order._count?.supportTickets ?? 0 }
            : includeSupportTicketDetails
              ? {
                activeSupportTickets: (order.supportTickets ?? []).map((ticket: any) => ({
                  id: ticket.id,
                  priority: ticket.priority,
                  status: ticket.status,
                  dueAt: ticket.dueAt?.toISOString() ?? null
                }))
              }
              : {})
        };
      }),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  @Get("users")
  @Roles("admin")
  async users(@Query() query: ListAdminUsersDto) {
    const page = query.page;
    const pageSize = query.pageSize;
    const keyword = query.keyword?.trim();
    const profileFilter: any = {
      ...(query.verified !== undefined ? { isVerified: query.verified } : {}),
      ...(keyword
        ? {
            OR: [
              { displayName: { contains: keyword, mode: "insensitive" } },
              { phone: { contains: keyword.replace(/\s/g, ""), mode: "insensitive" } }
            ]
          }
        : {})
    };
    const hasProfileFilter = Object.keys(profileFilter).length > 0;
    const where: any = {
      ...(query.accountStatus ? { accountStatus: query.accountStatus } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(keyword
        ? {
            OR: [
              { id: { contains: keyword, mode: "insensitive" } },
              { profile: { is: profileFilter } }
            ]
          }
        : hasProfileFilter
          ? { profile: { is: profileFilter } }
          : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          profile: true,
          companionProfile: {
            select: { id: true, name: true, isPublished: true }
          },
          _count: {
            select: {
              orders: true,
              supportTickets: true,
              deletionRequests: true
            }
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.user.count({ where } as any)
    ]);

    return {
      items: (items as any[]).map((user) => ({
        id: user.id,
        role: user.role,
        accountStatus: user.accountStatus,
        displayName: user.profile?.displayName ?? null,
        phoneMasked: user.profile?.phone ? maskPhone(user.profile.phone) : null,
        isVerified: user.profile?.isVerified ?? false,
        safetyScore: user.profile?.safetyScore ?? null,
        companion: user.companionProfile ?? null,
        counts: {
          orders: user._count?.orders ?? 0,
          supportTickets: user._count?.supportTickets ?? 0,
          deletionRequests: user._count?.deletionRequests ?? 0
        },
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString()
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  @Get("support-assignees")
  @Roles("admin")
  async supportAssignees(@Query() query: ListSupportAssigneesDto) {
    const keyword = query.keyword?.trim();
    const where: any = {
      role: { in: ["support", "admin"] },
      accountStatus: "active",
      ...(keyword ? {
        OR: [
          { id: { contains: keyword, mode: "insensitive" } },
          { profile: { is: { displayName: { contains: keyword, mode: "insensitive" } } } }
        ]
      } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          role: true,
          profile: { select: { displayName: true } },
          createdAt: true
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      } as any),
      this.prisma.user.count({ where } as any)
    ]);
    return {
      items: (items as any[]).map((item) => ({
        id: item.id,
        role: item.role,
        displayName: item.profile?.displayName ?? null
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  @Get("audit-logs")
  @Roles("admin")
  async auditLogs(@Query() query: ListAdminAuditLogsDto) {
    const page = query.page;
    const pageSize = query.pageSize;
    const where: any = {
      ...(query.action
        ? { action: { contains: query.action.trim(), mode: "insensitive" } }
        : {}),
      ...(query.resourceType
        ? { resourceType: { contains: query.resourceType.trim(), mode: "insensitive" } }
        : {}),
      ...(query.actorId ? { actorId: query.actorId.trim() } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      } as any),
      this.prisma.auditLog.count({ where } as any)
    ]);
    return {
      items: (items as any[]).map((log) => ({
        id: log.id,
        actorId: log.actorId ?? null,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId ?? null,
        metadata: redactSecrets(log.metadata ?? null),
        createdAt: log.createdAt.toISOString()
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  private maskReference(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.length <= 10) return `${value.slice(0, 2)}••••${value.slice(-2)}`;
    return `${value.slice(0, 6)}••••${value.slice(-4)}`;
  }
}
