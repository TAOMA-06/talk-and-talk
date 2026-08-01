import { HttpStatus, Injectable } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { detectSensitivePlaintext } from "../common/validation/sensitive-free-text";
import { PrismaService } from "../database/prisma.service";
import {
  CustomerAdultEligibilityStatusValue,
  ListCustomerAdultEligibilityDto,
  MarkCustomerAdultDto,
  MarkCustomerIneligibleDto,
  SubmitCustomerAdultEligibilityDto
} from "./dto/customer-adult-eligibility.dto";

const CUSTOMER_ROLES = new Set(["user", "companion"]);
const REVIEW_ROLES = new Set(["supply", "admin"]);
const MAX_VALIDITY_MS = 366 * 24 * 60 * 60_000;
const CONTROLLED_EVIDENCE_REFERENCE = /^(?!.*\d{10,})[A-Za-z][A-Za-z0-9._-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{4,127}$/;

type EligibilityRecord = {
  id: string;
  userId: string;
  status: CustomerAdultEligibilityStatusValue;
  verificationMethod: string;
  evidenceReference: string;
  submittedById: string;
  submittedAt: Date;
  reviewedById: string | null;
  verifiedAt: Date | null;
  validUntil: Date | null;
  reviewReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  subject?: any;
  reviewedBy?: any;
};

type EligibilityDatabase = {
  customerAdultEligibility: {
    findFirst(input: Record<string, unknown>): Promise<EligibilityRecord | null>;
  };
};

export type CurrentCustomerAdultEligibility = {
  recordId: string;
  verifiedAt: Date;
  validUntil: Date;
  verificationMethod: string;
};

/**
 * Enforces the current server-side commercial fact. A profile age or a legal
 * consent checkbox is deliberately never consulted here.
 */
export async function assertCurrentCustomerAdultEligibility(
  db: EligibilityDatabase,
  userId: string,
  now = new Date(),
  requiredThrough: Date | null = null
): Promise<CurrentCustomerAdultEligibility> {
  const record = await db.customerAdultEligibility.findFirst({
    where: { userId },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }]
  });
  if (!record) {
    throw adultEligibilityException(
      "CUSTOMER_ADULT_ELIGIBILITY_REQUIRED",
      "A current adult-eligibility verification is required",
      HttpStatus.FORBIDDEN,
      "notSubmitted"
    );
  }
  if (record.status === "pending") {
    throw adultEligibilityException(
      "CUSTOMER_ADULT_ELIGIBILITY_PENDING",
      "Adult-eligibility verification is awaiting independent review",
      HttpStatus.CONFLICT,
      "pending"
    );
  }
  if (record.status === "ineligible") {
    throw adultEligibilityException(
      "CUSTOMER_ADULT_ELIGIBILITY_INELIGIBLE",
      "The current verification result is not eligible for paid services",
      HttpStatus.FORBIDDEN,
      "ineligible"
    );
  }
  if (
    !(record.verifiedAt instanceof Date)
    || !(record.validUntil instanceof Date)
    || !record.reviewedById
    || record.validUntil.getTime() <= now.getTime()
  ) {
    throw adultEligibilityException(
      "CUSTOMER_ADULT_ELIGIBILITY_EXPIRED",
      "Adult-eligibility verification has expired and must be renewed",
      HttpStatus.CONFLICT,
      "expired",
      record.validUntil instanceof Date ? record.validUntil.toISOString() : null
    );
  }
  if (
    requiredThrough
    && (
      Number.isNaN(requiredThrough.getTime())
      || record.validUntil!.getTime() < requiredThrough.getTime()
    )
  ) {
    throw new AppException(
      "CUSTOMER_ADULT_ELIGIBILITY_VALIDITY_TOO_SHORT",
      "Adult-eligibility verification must remain current through the scheduled service",
      HttpStatus.CONFLICT,
      {
        eligibilityStatus: "expiresBeforeServiceEnd",
        validUntil: record.validUntil!.toISOString(),
        requiredThrough: Number.isNaN(requiredThrough.getTime())
          ? null
          : requiredThrough.toISOString(),
        recoveryPath: "/api/v1/me/adult-eligibility",
        existingOrderRightsRemainAvailable: true
      }
    );
  }
  return {
    recordId: record.id,
    verifiedAt: record.verifiedAt,
    validUntil: record.validUntil,
    verificationMethod: record.verificationMethod
  };
}

function adultEligibilityException(
  code: string,
  message: string,
  status: HttpStatus,
  eligibilityStatus: string,
  validUntil: string | null = null
) {
  return new AppException(code, message, status, {
    eligibilityStatus,
    validUntil,
    recoveryPath: "/api/v1/me/adult-eligibility",
    existingOrderRightsRemainAvailable: true
  });
}

@Injectable()
export class CustomerAdultEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async getMyStatus(userId: string) {
    const record = await this.findLatest(this.prisma as any, userId);
    return this.toUserStatus(record);
  }

  async submit(userId: string, dto: SubmitCustomerAdultEligibilityDto) {
    const evidenceReference = this.normalizeEvidenceReference(dto.evidenceReference);
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const subject = await db.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true }
        });
        if (!subject) {
          throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
        }
        if (!CUSTOMER_ROLES.has(subject.role)) {
          throw new AppException(
            "CUSTOMER_ADULT_ELIGIBILITY_SUBJECT_NOT_ELIGIBLE",
            "Staff accounts cannot use the customer adult-eligibility workflow",
            HttpStatus.FORBIDDEN
          );
        }

        const latest = await this.findLatest(db, userId);
        const current = this.currentState(latest, new Date());
        if (current === "pending") {
          throw new AppException(
            "CUSTOMER_ADULT_ELIGIBILITY_ALREADY_PENDING",
            "An adult-eligibility verification is already awaiting review",
            HttpStatus.CONFLICT,
            { requestId: latest?.id ?? null }
          );
        }
        if (current === "adult") {
          throw new AppException(
            "CUSTOMER_ADULT_ELIGIBILITY_ALREADY_CURRENT",
            "The current adult-eligibility verification has not expired",
            HttpStatus.CONFLICT,
            { validUntil: latest?.validUntil?.toISOString() ?? null }
          );
        }

        const created = await db.customerAdultEligibility.create({
          data: {
            userId,
            status: "pending",
            verificationMethod: dto.verificationMethod,
            evidenceReference,
            submittedById: userId
          }
        });
        await this.audit.record({
          actorId: userId,
          action: "customer.adult_eligibility_submitted",
          resourceType: "customerAdultEligibility",
          resourceId: created.id,
          metadata: {
            verificationMethod: dto.verificationMethod,
            replacedStatus: latest?.status ?? null
          }
        }, db);
        return created as EligibilityRecord;
      });
      return this.toUserStatus(record);
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (this.isUniqueConstraintError(error)) {
        throw new AppException(
          "CUSTOMER_ADULT_ELIGIBILITY_SUBMISSION_CONFLICT",
          "The evidence reference is already bound or another review became pending",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async list(query: ListCustomerAdultEligibilityDto) {
    const where = { status: query.status };
    const include = this.adminInclude();
    const [items, total] = await Promise.all([
      this.prisma.customerAdultEligibility.findMany({
        where,
        include,
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.customerAdultEligibility.count({ where })
    ]);
    return {
      items: items.map((item) => this.toAdminDto(item as any)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      }
    };
  }

  markAdult(actor: AuthenticatedUser, requestId: string, dto: MarkCustomerAdultDto) {
    const validUntil = new Date(dto.validUntil);
    const now = new Date();
    if (
      Number.isNaN(validUntil.getTime())
      || validUntil.getTime() <= now.getTime()
      || validUntil.getTime() > now.getTime() + MAX_VALIDITY_MS
    ) {
      throw new AppException(
        "CUSTOMER_ADULT_ELIGIBILITY_VALIDITY_INVALID",
        "validUntil must be in the future and no more than 366 days from review",
        HttpStatus.BAD_REQUEST
      );
    }
    return this.review(actor, requestId, "adult", dto.reason, validUntil, now);
  }

  markIneligible(actor: AuthenticatedUser, requestId: string, dto: MarkCustomerIneligibleDto) {
    return this.review(actor, requestId, "ineligible", dto.reason, null, new Date());
  }

  private async review(
    actor: AuthenticatedUser,
    requestId: string,
    decision: "adult" | "ineligible",
    rawReason: string,
    validUntil: Date | null,
    verifiedAt: Date
  ) {
    this.assertReviewer(actor);
    const reviewReason = this.normalizeReason(rawReason);
    const record = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT "id" FROM "CustomerAdultEligibility"
        WHERE "id" = ${requestId}
        FOR UPDATE
      `;
      let request = await db.customerAdultEligibility.findUnique({
        where: { id: requestId },
        include: this.adminInclude()
      });
      if (!request) {
        throw new AppException(
          "CUSTOMER_ADULT_ELIGIBILITY_NOT_FOUND",
          "Adult-eligibility verification was not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (request.status !== "pending") {
        throw new AppException(
          "CUSTOMER_ADULT_ELIGIBILITY_ALREADY_REVIEWED",
          "Adult-eligibility verification has already been reviewed",
          HttpStatus.CONFLICT,
          { currentStatus: request.status }
        );
      }
      if (request.submittedById === actor.id) {
        throw new AppException(
          "CUSTOMER_ADULT_ELIGIBILITY_INDEPENDENT_REVIEW_REQUIRED",
          "A different operator must review this submission",
          HttpStatus.FORBIDDEN
        );
      }

      // The same lock is used by order, payment and voice gates. The decision
      // therefore becomes authoritative atomically at transaction commit.
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${request.userId} FOR UPDATE`;
      request = await db.customerAdultEligibility.update({
        where: { id: requestId },
        data: {
          status: decision,
          reviewedById: actor.id,
          verifiedAt,
          validUntil,
          reviewReason
        },
        include: this.adminInclude()
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: [request.userId],
        action: decision === "adult"
          ? "customer.adult_eligibility_marked_adult"
          : "customer.adult_eligibility_marked_ineligible",
        resourceType: "customerAdultEligibility",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          submittedById: request.submittedById,
          verificationMethod: request.verificationMethod,
          validUntil: validUntil?.toISOString() ?? null
        }
      }, db);
      return request as EligibilityRecord;
    });
    return this.toAdminDto(record);
  }

  private async findLatest(db: any, userId: string): Promise<EligibilityRecord | null> {
    return db.customerAdultEligibility.findFirst({
      where: { userId },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }]
    });
  }

  private currentState(
    record: EligibilityRecord | null,
    now: Date
  ): "notSubmitted" | "pending" | "adult" | "expired" | "ineligible" {
    if (!record) return "notSubmitted";
    if (record.status === "pending") return "pending";
    if (record.status === "ineligible") return "ineligible";
    if (
      !(record.validUntil instanceof Date)
      || !(record.verifiedAt instanceof Date)
      || !record.reviewedById
      || record.validUntil.getTime() <= now.getTime()
    ) return "expired";
    return "adult";
  }

  private toUserStatus(record: EligibilityRecord | null) {
    const currentState = this.currentState(record, new Date());
    return {
      currentAdult: currentState === "adult",
      status: currentState,
      recordedStatus: record?.status ?? null,
      verificationMethod: record?.verificationMethod ?? null,
      evidenceReferenceMasked: record ? this.maskEvidenceReference(record.evidenceReference) : null,
      submittedAt: record?.submittedAt?.toISOString() ?? null,
      verifiedAt: record?.verifiedAt?.toISOString() ?? null,
      validUntil: record?.validUntil?.toISOString() ?? null,
      reviewReason: record?.reviewReason ?? null,
      canSubmit: ["notSubmitted", "expired", "ineligible"].includes(currentState),
      recovery: {
        submissionPath: "/api/v1/me/adult-eligibility/submissions",
        existingOrdersPath: "/api/v1/orders",
        accountRightsRemainAvailable: true,
        unpaidOrderCancellationRemainsAvailable: true,
        paidUnfulfilledRefundRequestsRemainAvailable: true
      }
    };
  }

  private toAdminDto(item: EligibilityRecord) {
    return {
      id: item.id,
      userId: item.userId,
      status: item.status,
      verificationMethod: item.verificationMethod,
      evidenceReference: item.evidenceReference,
      subject: item.subject
        ? {
            id: item.subject.id,
            role: item.subject.role,
            accountStatus: item.subject.accountStatus,
            displayName: item.subject.profile?.displayName ?? null
          }
        : null,
      submittedById: item.submittedById,
      submittedAt: item.submittedAt.toISOString(),
      reviewedBy: item.reviewedBy
        ? {
            id: item.reviewedBy.id,
            displayName: item.reviewedBy.profile?.displayName ?? null
          }
        : null,
      verifiedAt: item.verifiedAt?.toISOString() ?? null,
      validUntil: item.validUntil?.toISOString() ?? null,
      reviewReason: item.reviewReason ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private adminInclude() {
    return {
      subject: {
        select: {
          id: true,
          role: true,
          accountStatus: true,
          profile: { select: { displayName: true } }
        }
      },
      reviewedBy: {
        select: { id: true, profile: { select: { displayName: true } } }
      }
    } as const;
  }

  private assertReviewer(actor: AuthenticatedUser): void {
    if (!REVIEW_ROLES.has(actor.role)) {
      throw new AppException("FORBIDDEN", "Insufficient permissions", HttpStatus.FORBIDDEN);
    }
  }

  private normalizeEvidenceReference(value: string): string {
    const normalized = value.trim();
    if (
      normalized.length < 7
      || normalized.length > 160
      || !CONTROLLED_EVIDENCE_REFERENCE.test(normalized)
      || detectSensitivePlaintext(normalized) !== null
    ) {
      throw new AppException(
        "CUSTOMER_ADULT_ELIGIBILITY_EVIDENCE_INVALID",
        "Use only an approved opaque evidence reference; do not submit an identity number or document image",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private normalizeReason(value: string): string {
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      normalized.length < 3
      || normalized.length > 500
      || detectSensitivePlaintext(normalized) !== null
    ) {
      throw new AppException(
        "CUSTOMER_ADULT_ELIGIBILITY_REVIEW_REASON_INVALID",
        "Review reason must contain 3 to 500 characters and no raw sensitive data",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private maskEvidenceReference(value: string): string {
    const separator = value.indexOf(":");
    const prefix = separator > 0 ? value.slice(0, separator) : "evidence";
    const opaque = separator > 0 ? value.slice(separator + 1) : value;
    return `${prefix}:••••${opaque.slice(-4)}`;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(
      error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: unknown }).code === "P2002"
    );
  }
}
