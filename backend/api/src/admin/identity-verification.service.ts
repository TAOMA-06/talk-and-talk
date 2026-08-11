import { HttpStatus, Injectable } from "@nestjs/common";

import { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  IdentityVerificationRequestStatusValue,
  ListIdentityVerificationRequestsDto,
  ReviewIdentityVerificationRequestDto
} from "./dto/identity-verification-review.dto";
import { UpdateUserVerificationDto } from "./dto/update-user-verification.dto";

const KYC_STAFF_ROLES = ["supply", "admin"] as const;
const KYC_SUBJECT_ROLES = ["user", "companion"] as const;
const EVIDENCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const KYC_SENSITIVE_LITERAL = /(?:\b\d{15}\b|\b\d{17}[\dXx]\b|(?:^|\D)(?:\d[ -]?){16,19}(?:\D|$)|(?:身份证(?:号)?|银行卡(?:号)?|银行账号|卡号)\s*[:：=]?\s*[A-Za-z0-9 -]{6,})/u;

type VerificationDecision = "approved" | "rejected";

@Injectable()
export class IdentityVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async submitRequest(
    actor: AuthenticatedUser,
    userId: string,
    dto: UpdateUserVerificationDto
  ) {
    this.assertKycActor(actor);
    this.assertIdentityGrantAllowed(dto.isVerified);
    const reason = this.normalizeReason(dto.reason);
    const evidenceReference = this.normalizeEvidenceReference(dto.evidenceReference);

    try {
      const request = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        // Submission does not change eligibility. Locking the subject is enough
        // to serialize pending-request creation and state snapshots per user.
        await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const subject = await db.user.findUnique({
          where: { id: userId },
          include: {
            profile: true,
            companionProfile: { select: { id: true, name: true, isPublished: true } }
          }
        });
        if (!subject) {
          throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
        }
        if (!(KYC_SUBJECT_ROLES as readonly string[]).includes(subject.role)) {
          throw new AppException(
            "IDENTITY_VERIFICATION_SUBJECT_NOT_ELIGIBLE",
            "Staff accounts cannot be changed through the companion identity-verification workflow",
            HttpStatus.CONFLICT
          );
        }

        const currentIsVerified = subject.profile?.isVerified === true;
        if (currentIsVerified === dto.isVerified) {
          throw new AppException(
            "IDENTITY_VERIFICATION_STATE_UNCHANGED",
            "The requested identity-verification state is already active",
            HttpStatus.CONFLICT
          );
        }
        const pending = await db.identityVerificationRequest.findFirst({
          where: { userId, status: "pending" },
          select: { id: true, requestedIsVerified: true }
        });
        if (pending) {
          throw new AppException(
            "IDENTITY_VERIFICATION_REQUEST_ALREADY_PENDING",
            "A pending identity-verification request already exists for this user",
            HttpStatus.CONFLICT,
            { requestId: pending.id, requestedIsVerified: pending.requestedIsVerified }
          );
        }

        const created = await db.identityVerificationRequest.create({
          data: {
            userId,
            requestedIsVerified: dto.isVerified,
            previousIsVerified: currentIsVerified,
            reason,
            evidenceReference,
            submittedById: actor.id
          },
          include: this.requestInclude()
        });
        await this.audit.record({
          actorId: actor.id,
          subjectUserIds: [userId],
          action: "identity.verification_change_submitted",
          resourceType: "identityVerificationRequest",
          resourceId: created.id,
          metadata: {
            userId,
            previousIsVerified: currentIsVerified,
            requestedIsVerified: dto.isVerified,
            evidenceReference
          }
        }, db);
        return created;
      });
      return this.toDto(request);
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (this.isUniqueConstraintError(error)) {
        throw new AppException(
          "IDENTITY_VERIFICATION_REQUEST_CONFLICT",
          "The evidence reference is already bound or another request became pending",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async listRequests(query: ListIdentityVerificationRequestsDto) {
    const status = query.status ?? "pending";
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = { status };
    const [items, total] = await Promise.all([
      this.prisma.identityVerificationRequest.findMany({
        where,
        include: this.requestInclude(),
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.identityVerificationRequest.count({ where })
    ]);
    return {
      items: items.map((item) => this.toDto(item)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  approveRequest(
    actor: AuthenticatedUser,
    requestId: string,
    dto: ReviewIdentityVerificationRequestDto
  ) {
    return this.reviewRequest(actor, requestId, dto, "approved");
  }

  rejectRequest(
    actor: AuthenticatedUser,
    requestId: string,
    dto: ReviewIdentityVerificationRequestDto
  ) {
    return this.reviewRequest(actor, requestId, dto, "rejected");
  }

  private async reviewRequest(
    actor: AuthenticatedUser,
    requestId: string,
    dto: ReviewIdentityVerificationRequestDto,
    decision: VerificationDecision
  ) {
    this.assertKycActor(actor);
    const reviewReason = this.normalizeReason(dto.reason);
    const reviewedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`
        SELECT "id" FROM "IdentityVerificationRequest"
        WHERE "id" = ${requestId}
        FOR UPDATE
      `;
      let request = await db.identityVerificationRequest.findUnique({
        where: { id: requestId },
        include: this.requestInclude()
      });
      if (!request) {
        throw new AppException(
          "IDENTITY_VERIFICATION_REQUEST_NOT_FOUND",
          "Identity-verification request not found",
          HttpStatus.NOT_FOUND
        );
      }
      if (request.status !== "pending") {
        throw new AppException(
          "IDENTITY_VERIFICATION_REQUEST_ALREADY_REVIEWED",
          "Identity-verification request has already been reviewed",
          HttpStatus.CONFLICT,
          { currentStatus: request.status }
        );
      }
      if (request.submittedById === actor.id) {
        throw new AppException(
          "IDENTITY_VERIFICATION_SECOND_REVIEW_REQUIRED",
          "A different staff member must review this identity-verification request",
          HttpStatus.FORBIDDEN
        );
      }

      if (decision === "approved") {
        this.assertIdentityGrantAllowed(request.requestedIsVerified);
      }

      let unpublishedCompanions = 0;
      if (decision === "approved") {
        // Orders lock CompanionProfile before reading the owner's verification
        // state. Lock the same profile first, then User, so revocation and order
        // intake cannot both commit against an obsolete eligibility snapshot.
        await db.$queryRaw`
          SELECT "id" FROM "CompanionProfile"
          WHERE "ownerUserId" = ${request.userId}
          ORDER BY "id"
          FOR UPDATE
        `;
        await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${request.userId} FOR UPDATE`;
        const subject = await db.user.findUnique({
          where: { id: request.userId },
          include: { profile: true }
        });
        if (!subject) {
          throw new AppException("USER_NOT_FOUND", "User not found", HttpStatus.NOT_FOUND);
        }
        if (!(KYC_SUBJECT_ROLES as readonly string[]).includes(subject.role)) {
          throw new AppException(
            "IDENTITY_VERIFICATION_SUBJECT_NOT_ELIGIBLE",
            "Staff accounts cannot be changed through the companion identity-verification workflow",
            HttpStatus.CONFLICT
          );
        }
        const currentIsVerified = subject.profile?.isVerified === true;
        if (currentIsVerified !== request.previousIsVerified) {
          throw new AppException(
            "IDENTITY_VERIFICATION_STATE_CHANGED",
            "The user's identity-verification state changed after submission",
            HttpStatus.CONFLICT,
            {
              expectedIsVerified: request.previousIsVerified,
              currentIsVerified
            }
          );
        }
        await db.userProfile.upsert({
          where: { userId: request.userId },
          create: { userId: request.userId, isVerified: request.requestedIsVerified },
          update: { isVerified: request.requestedIsVerified }
        });
        if (!request.requestedIsVerified) {
          const unpublished = await db.companionProfile.updateMany({
            where: { ownerUserId: request.userId, isPublished: true },
            data: { isPublished: false }
          });
          unpublishedCompanions = unpublished.count;
        }
      }

      request = await db.identityVerificationRequest.update({
        where: { id: requestId },
        data: {
          status: decision,
          reviewedById: actor.id,
          reviewedAt,
          reviewReason
        },
        include: this.requestInclude()
      });
      await this.audit.record({
        actorId: actor.id,
        subjectUserIds: [request.userId],
        action: decision === "approved"
          ? "identity.verification_change_approved"
          : "identity.verification_change_rejected",
        resourceType: "identityVerificationRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          submittedById: request.submittedById,
          previousIsVerified: request.previousIsVerified,
          requestedIsVerified: request.requestedIsVerified,
          evidenceReference: request.evidenceReference,
          unpublishedCompanions
        }
      }, db);
      return { request, unpublishedCompanions };
    });

    return {
      ...this.toDto(result.request),
      applied: decision === "approved",
      unpublishedCompanions: result.unpublishedCompanions
    };
  }

  private requestInclude() {
    return {
      subject: {
        select: {
          id: true,
          role: true,
          accountStatus: true,
          profile: { select: { displayName: true, isVerified: true } },
          companionProfile: { select: { id: true, name: true, isPublished: true } }
        }
      },
      submittedBy: {
        select: { id: true, profile: { select: { displayName: true } } }
      },
      reviewedBy: {
        select: { id: true, profile: { select: { displayName: true } } }
      }
    } as const;
  }

  private toDto(item: any) {
    return {
      id: item.id,
      userId: item.userId,
      status: item.status as IdentityVerificationRequestStatusValue,
      previousIsVerified: item.previousIsVerified,
      requestedIsVerified: item.requestedIsVerified,
      reason: item.reason,
      evidenceReference: item.evidenceReference,
      subject: item.subject
        ? {
            id: item.subject.id,
            role: item.subject.role,
            accountStatus: item.subject.accountStatus,
            displayName: item.subject.profile?.displayName ?? null,
            currentIsVerified: item.subject.profile?.isVerified === true,
            companion: item.subject.companionProfile ?? null
          }
        : null,
      submittedBy: item.submittedBy
        ? {
            id: item.submittedBy.id,
            displayName: item.submittedBy.profile?.displayName ?? null
          }
        : { id: item.submittedById, displayName: null },
      submittedAt: item.submittedAt.toISOString(),
      reviewedBy: item.reviewedBy
        ? {
            id: item.reviewedBy.id,
            displayName: item.reviewedBy.profile?.displayName ?? null
          }
        : null,
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      reviewReason: item.reviewReason ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private assertKycActor(actor: AuthenticatedUser): void {
    if (!(KYC_STAFF_ROLES as readonly string[]).includes(actor.role)) {
      throw new AppException("FORBIDDEN", "Insufficient permissions", HttpStatus.FORBIDDEN);
    }
  }

  private assertIdentityGrantAllowed(requestedIsVerified: boolean): void {
    if (!requestedIsVerified) return;
    throw new AppException(
      "IDENTITY_VERIFICATION_GRANT_FROZEN",
      "New identity-verification grants are frozen until an approved authority and revocation lifecycle are configured",
      HttpStatus.CONFLICT,
      {
        recoveryOwner: "support",
        recoveryPath: "/pages/profile/index"
      }
    );
  }

  private normalizeReason(value: string): string {
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length < 3 || normalized.length > 500) {
      throw new AppException(
        "IDENTITY_VERIFICATION_REASON_INVALID",
        "Identity-verification reason must contain 3 to 500 characters",
        HttpStatus.BAD_REQUEST
      );
    }
    if (KYC_SENSITIVE_LITERAL.test(normalized)) {
      throw new AppException(
        "IDENTITY_VERIFICATION_SENSITIVE_CONTENT",
        "Do not place identity or bank-card numbers in the request reason",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
  }

  private normalizeEvidenceReference(value: string): string {
    const normalized = value.trim();
    if (
      normalized.length < 6
      || normalized.length > 160
      || !EVIDENCE_REFERENCE_PATTERN.test(normalized)
    ) {
      throw new AppException(
        "IDENTITY_VERIFICATION_EVIDENCE_INVALID",
        "A controlled evidence reference is required",
        HttpStatus.BAD_REQUEST
      );
    }
    return normalized;
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
