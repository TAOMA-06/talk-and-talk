import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { maskPhone } from "../common/logging/redact";
import { PrismaService } from "../database/prisma.service";
import { LegalDocumentArchiveService } from "../legal/legal-document-archive.service";
import { ModerationCaseService } from "../moderation/moderation-case.service";
import { ModerationService } from "../moderation/moderation.service";
import { CreateLegalConsentDto } from "./dto/legal-consent.dto";
import { UpdateMeDto } from "./dto/update-me.dto";

const LEGAL_CONSENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DELETION_PROCESSING_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly legalArchive: LegalDocumentArchiveService,
    private readonly moderation: ModerationService,
    private readonly moderationCases: ModerationCaseService
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true }
    });

    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    return {
      id: user.id,
      role: user.role,
      profile: user.profile
        ? {
            displayName: user.profile.displayName,
            phone: user.profile.phone ? maskPhone(user.profile.phone) : null,
            age: user.profile.age,
            gender: user.profile.gender,
            isVerified: user.profile.isVerified,
            safetyScore: user.profile.safetyScore
          }
        : null
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException("UNAUTHORIZED", "User not found", HttpStatus.UNAUTHORIZED);
    }

    const profileData: {
      displayName?: string;
      gender?: string;
      age?: number;
    } = {};

    if (dto.displayName !== undefined) {
      const displayName = dto.displayName.trim();
      if (!displayName) {
        throw new AppException("DISPLAY_NAME_REQUIRED", "Display name is required", HttpStatus.BAD_REQUEST);
      }
      const moderation = await this.moderation.moderateAsync(displayName, "profile");
      if (moderation.decision !== "allow") {
        const moderationCase = await this.moderationCases.createFromResult({
          result: moderation,
          source: "profile",
          content: displayName,
          targetId: userId,
          subjectUserId: userId,
          actorId: userId,
          title: "公开昵称待处理",
          forceCreate: true
        });
        throw new AppException(
          "DISPLAY_NAME_REQUIRES_REVISION",
          "Display name cannot be published; revise it and try again",
          HttpStatus.UNPROCESSABLE_ENTITY,
          { moderationCaseId: moderationCase?.id ?? null, decision: moderation.decision }
        );
      }
      profileData.displayName = displayName;
    }
    if (dto.gender !== undefined) {
      profileData.gender = dto.gender;
    }
    if (dto.age !== undefined) {
      profileData.age = dto.age;
    }

    if (Object.keys(profileData).length > 0) {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...profileData
        },
        update: profileData
      });
    }

    return this.getMe(userId);
  }

  async requestDeletion(userId: string) {
    const request = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const completed = await db.accountDeletionRequest.findFirst({
        where: { userId, status: "completed" },
        orderBy: { updatedAt: "desc" }
      });
      if (completed) {
        throw new AppException(
          "DELETION_ALREADY_COMPLETED",
          "This account deletion has already been completed",
          HttpStatus.CONFLICT
        );
      }
      const existing = await db.accountDeletionRequest.findFirst({
        where: { userId, status: { in: ["pending", "processing"] } },
        orderBy: { createdAt: "desc" }
      });
      if (existing) return existing;

      const created = await db.accountDeletionRequest.create({
        data: { userId, status: "pending" }
      });
      await this.audit.record({
        actorId: userId,
        action: "account.deletion_requested",
        resourceType: "accountDeletionRequest",
        resourceId: created.id,
        metadata: { userId: created.userId }
      }, db);
      return created;
    });

    return {
      id: request.id,
      status: request.status,
      message: "我们已收到你的注销申请，将在 15 个工作日内处理。"
    };
  }

  async listDeletionRequests(status?: "pending" | "processing", page = 1, pageSize = 50) {
    const where = status
      ? { status }
      : { status: { in: ["pending", "processing"] as Array<"pending" | "processing"> } };
    const [requests, total] = await Promise.all([
      this.prisma.accountDeletionRequest.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: { id: true, role: true, accountStatus: true, createdAt: true }
          }
        }
      }),
      this.prisma.accountDeletionRequest.count({ where })
    ]);
    return {
      items: requests.map((request) => this.deletionRequestDto(request)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    };
  }

  async getDeletionSettlementUserId(requestId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true, status: true }
      });
      if (!request || request.status !== "processing") {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          "Only a processing deletion request may settle financial state",
          HttpStatus.CONFLICT
        );
      }
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { userId: true }
      });
      if (!order || order.userId !== request.userId) {
        throw new AppException("ORDER_NOT_FOUND", "Order not found for this deletion request", HttpStatus.NOT_FOUND);
      }
      return request.userId;
    });
  }

  async getDeletionSettlementDetails(requestId: string) {
    const request: any = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { id: true, role: true, accountStatus: true, createdAt: true } } }
    } as any);
    if (!request) {
      throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
    }
    const orders: any[] = await this.prisma.order.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: "asc" },
      include: {
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        refunds: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    } as any);
    return {
      request: this.deletionRequestDto(request),
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        amountCents: order.amountCents,
        scheduledAt: order.scheduledAt.toISOString(),
        payment: order.payments[0]
          ? {
              id: order.payments[0].id,
              outTradeNo: order.payments[0].outTradeNo,
              status: order.payments[0].status,
              expiresAt: order.payments[0].expiresAt?.toISOString() ?? null
            }
          : null,
        refund: order.refunds[0]
          ? {
              id: order.refunds[0].id,
              status: order.refunds[0].status,
              outRefundNo: order.refunds[0].outRefundNo
            }
          : null
      }))
    };
  }

  async startDeletionRequest(requestId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const restrictedAt = new Date();
      const claimed = await db.accountDeletionRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: "processing", updatedAt: restrictedAt }
      });
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: { user: { select: { id: true, role: true, accountStatus: true, createdAt: true } } }
      });
      if (!request) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      if (claimed.count === 0) {
        if (request.status === "processing") return this.deletionRequestDto(request);
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          `Cannot start an account deletion request with status ${request.status}`,
          HttpStatus.CONFLICT
        );
      }
      const restricted = await db.user.updateMany({
        where: { id: request.userId, accountStatus: "active" },
        data: { accountStatus: "restricted" }
      });
      const revoked = await db.refreshToken.updateMany({
        where: { userId: request.userId, revokedAt: null },
        data: { revokedAt: restrictedAt }
      });
      if (restricted.count === 1) request.user.accountStatus = "restricted";
      await this.audit.record({
        actorId,
        action: "account.deletion_processing_started",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          accountRestricted: restricted.count === 1,
          revokedRefreshTokenCount: revoked.count,
          processingCooldownSeconds: DELETION_PROCESSING_COOLDOWN_MS / 1000
        }
      }, db);
      return this.deletionRequestDto(request);
    });
  }

  async completeDeletionRequest(requestId: string, actorId: string, note: string) {
    const normalizedNote = note.trim();
    if (!normalizedNote) {
      throw new AppException("DELETION_NOTE_REQUIRED", "A completion note is required", HttpStatus.BAD_REQUEST);
    }
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const completedAt = new Date();
      const candidate = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { userId: true }
      });
      if (!candidate) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
      const request = await db.accountDeletionRequest.findUnique({
        where: { id: requestId },
        include: { user: { select: { id: true, role: true, accountStatus: true, createdAt: true } } }
      });
      if (!request) {
        throw new AppException("DELETION_REQUEST_NOT_FOUND", "Account deletion request not found", HttpStatus.NOT_FOUND);
      }
      if (request.status === "completed") return this.deletionRequestDto(request);
      if (request.status !== "processing") {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          `Cannot complete an account deletion request with status ${request.status}`,
          HttpStatus.CONFLICT
        );
      }
      if (request.userId === actorId) {
        throw new AppException(
          "SELF_DELETION_COMPLETION_FORBIDDEN",
          "Administrators cannot complete their own account deletion",
          HttpStatus.CONFLICT
        );
      }
      if (completedAt.getTime() - request.updatedAt.getTime() < DELETION_PROCESSING_COOLDOWN_MS) {
        throw new AppException(
          "DELETION_PROCESSING_COOLDOWN",
          "Wait for in-flight account operations to settle before completing deletion",
          HttpStatus.CONFLICT
        );
      }

      const [activeOrderCount, activeRefundCount] = await Promise.all([
        db.order.count({
          where: { userId: request.userId, status: { in: ["paying", "paid", "inService"] } }
        }),
        db.refundTransaction.count({
          where: {
            order: { userId: request.userId },
            status: { in: ["pendingReview", "pending", "processing"] }
          }
        })
      ]);
      if (activeOrderCount > 0 || activeRefundCount > 0) {
        throw new AppException(
          "DELETION_HAS_ACTIVE_FINANCIAL_OBLIGATIONS",
          "Account deletion cannot complete while orders or refunds are still active",
          HttpStatus.CONFLICT
        );
      }

      const claimed = await db.accountDeletionRequest.updateMany({
        where: { id: requestId, status: "processing", updatedAt: request.updatedAt },
        data: { status: "completed", note: normalizedNote }
      });
      if (claimed.count !== 1) {
        throw new AppException(
          "DELETION_REQUEST_STATE_CONFLICT",
          "Account deletion request changed while it was being completed",
          HttpStatus.CONFLICT
        );
      }

      const [retainedOrderCount, retainedPaymentCount, retainedRefundCount] = await Promise.all([
        db.order.count({ where: { userId: request.userId } }),
        db.paymentTransaction.count({ where: { order: { userId: request.userId } } }),
        db.refundTransaction.count({ where: { order: { userId: request.userId } } })
      ]);
      const revoked = await db.refreshToken.updateMany({
        where: { userId: request.userId, revokedAt: null },
        data: { revokedAt: completedAt }
      });
      const removedIdentities = await db.authIdentity.deleteMany({ where: { userId: request.userId } });
      const removedStaffCredentials = await db.staffCredential.deleteMany({ where: { userId: request.userId } });
      await db.userProfile.updateMany({
        where: { userId: request.userId },
        data: {
          displayName: null,
          phone: null,
          age: null,
          gender: null,
          isVerified: false,
          safetyScore: 80
        }
      });
      await db.user.update({
        where: { id: request.userId },
        data: { accountStatus: "banned" }
      });
      request.status = "completed";
      request.note = normalizedNote;
      request.updatedAt = completedAt;
      request.user.accountStatus = "banned";
      await this.audit.record({
        actorId,
        action: "account.deletion_completed",
        resourceType: "accountDeletionRequest",
        resourceId: request.id,
        metadata: {
          userId: request.userId,
          note: normalizedNote,
          completedAt: completedAt.toISOString(),
          revokedRefreshTokenCount: revoked.count,
          removedIdentityCount: removedIdentities.count,
          removedStaffCredentialCount: removedStaffCredentials.count,
          retainedOrderCount,
          retainedPaymentCount,
          retainedRefundCount
        }
      }, db);
      return {
        ...this.deletionRequestDto(request),
        retainedRecords: {
          orders: retainedOrderCount,
          payments: retainedPaymentCount,
          refunds: retainedRefundCount
        }
      };
    });
  }

  async recordLegalConsent(userId: string, dto: CreateLegalConsentDto) {
    const definition = this.currentLegalConsentDefinition();
    if (
      dto.version !== definition.version ||
      dto.privacyUrl !== definition.privacyUrl ||
      dto.termsUrl !== definition.termsUrl
    ) {
      throw new AppException(
        "LEGAL_CONSENT_DOCUMENT_MISMATCH",
        "Legal consent must reference the current server-published documents",
        HttpStatus.BAD_REQUEST
      );
    }
    await this.legalArchive.assertVersionPublished(definition.version, ["privacy", "terms"]);
    const acceptedAt = new Date(dto.acceptedAt);
    if (
      !Number.isFinite(acceptedAt.getTime()) ||
      acceptedAt.getTime() > Date.now() + LEGAL_CONSENT_CLOCK_SKEW_MS
    ) {
      throw new AppException(
        "LEGAL_CONSENT_ACCEPTED_AT_INVALID",
        "Legal consent acceptedAt cannot be in the future",
        HttpStatus.BAD_REQUEST
      );
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const existing = await db.legalConsentReceipt.findFirst({
        where: {
          userId,
          version: definition.version,
          withdrawnAt: null
        },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
      });
      if (existing) {
        return existing;
      }

      const previous = await db.legalConsentReceipt.findFirst({
        where: { userId },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
      });
      const created = await db.legalConsentReceipt.create({
        data: {
          userId,
          version: definition.version,
          privacyVersion: definition.version,
          termsVersion: definition.version,
          privacyAccepted: true,
          termsAccepted: true,
          adultConfirmed: true,
          acceptedAt,
          privacyUrl: definition.privacyUrl,
          termsUrl: definition.termsUrl,
          source: dto.source
        }
      });

      await this.audit.record({
        actorId: userId,
        action: previous?.withdrawnAt
          ? "legal.consent_reaccepted"
          : previous
            ? "legal.consent_upgraded"
            : "legal.consent_recorded",
        resourceType: "legalConsentReceipt",
        resourceId: created.id,
        metadata: {
          version: created.version,
          privacyVersion: created.privacyVersion,
          termsVersion: created.termsVersion,
          adultConfirmed: created.adultConfirmed,
          source: created.source,
          acceptedAt: created.acceptedAt.toISOString(),
          consentedAt: created.consentedAt.toISOString(),
          privacyArchiveUrl: this.legalArchiveUrl(created.privacyUrl, created.privacyVersion),
          termsArchiveUrl: this.legalArchiveUrl(created.termsUrl, created.termsVersion),
          previousVersion: previous?.version ?? null,
          previousReceiptId: previous?.id ?? null
        }
      }, db);

      return created;
    });

    return { receipt: this.legalConsentReceiptDto(receipt) };
  }

  private legalArchiveUrl(currentUrl: string, version: string) {
    const url = new URL(currentUrl);
    const sourcePath = url.pathname;
    let archivePath = sourcePath.replace(/\.html$/, "");
    // The public consent URLs intentionally remain stable .html entry points.
    // Those files redirect into Nest under API_PREFIX, so audit evidence must
    // point at the real immutable endpoint rather than a non-existent
    // /legal/.../versions route at the site root.
    if (sourcePath.endsWith(".html")) {
      const apiPrefix = this.config.getOrThrow<string>("API_PREFIX").replace(/^\/+|\/+$/g, "");
      const prefixedPath = `/${apiPrefix}`;
      if (!archivePath.startsWith(`${prefixedPath}/`)) {
        archivePath = `${prefixedPath}${archivePath}`;
      }
    }
    url.pathname = `${archivePath}/versions/${encodeURIComponent(version)}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async getLegalConsent(userId: string, version?: string) {
    const definition = this.currentLegalConsentDefinition();
    const receipt = await this.prisma.legalConsentReceipt.findFirst({
      where: { userId, ...(version ? { version } : {}) },
      orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
    });

    if (!receipt) {
      return { valid: false, receipt: null };
    }
    const valid =
      receipt.privacyAccepted === true &&
      receipt.termsAccepted === true &&
      receipt.adultConfirmed === true &&
      receipt.withdrawnAt === null &&
      ["wechatMiniProgram", "web"].includes(receipt.source) &&
      receipt.version === definition.version &&
      receipt.privacyVersion === definition.version &&
      receipt.termsVersion === definition.version &&
      receipt.privacyUrl === definition.privacyUrl &&
      receipt.termsUrl === definition.termsUrl;
    return { valid, receipt: this.legalConsentReceiptDto(receipt) };
  }

  async withdrawLegalConsent(userId: string) {
    const definition = this.currentLegalConsentDefinition();
    const result = await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const receipt = await db.legalConsentReceipt.findFirst({
        where: { userId, version: definition.version, withdrawnAt: null },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }]
      });
      if (!receipt) {
        return { withdrawn: false, withdrawnAt: null };
      }
      const withdrawnAt = new Date();
      await db.legalConsentReceipt.update({
        where: { id: receipt.id },
        data: { withdrawnAt }
      });
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: withdrawnAt }
      });
      await this.audit.record({
        actorId: userId,
        action: "legal.consent_withdrawn",
        resourceType: "legalConsentReceipt",
        resourceId: receipt.id,
        metadata: { version: receipt.version, withdrawnAt: withdrawnAt.toISOString() }
      }, db);
      return { withdrawn: true, withdrawnAt: withdrawnAt.toISOString() };
    });
    return result;
  }

  private deletionRequestDto(request: {
    id: string;
    userId: string;
    status: string;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    user?: {
      id: string;
      role: string;
      accountStatus: string;
      createdAt: Date;
    };
  }) {
    return {
      id: request.id,
      userId: request.userId,
      status: request.status,
      note: request.note,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      ...(request.user
        ? {
            user: {
              id: request.user.id,
              role: request.user.role,
              accountStatus: request.user.accountStatus,
              createdAt: request.user.createdAt.toISOString()
            }
          }
        : {})
    };
  }

  private currentLegalConsentDefinition() {
    return {
      version: this.config.getOrThrow<string>("LEGAL_CONSENT_VERSION"),
      privacyUrl: this.config.getOrThrow<string>("LEGAL_PRIVACY_URL"),
      termsUrl: this.config.getOrThrow<string>("LEGAL_TERMS_URL")
    };
  }

  private legalConsentReceiptDto(receipt: {
    id: string;
    userId: string;
    version: string;
    privacyVersion: string;
    termsVersion: string;
    privacyAccepted: boolean;
    termsAccepted: boolean;
    adultConfirmed: boolean;
    acceptedAt: Date;
    consentedAt: Date;
    withdrawnAt: Date | null;
    privacyUrl: string;
    termsUrl: string;
    source: string;
  }) {
    const recordedAt = receipt.consentedAt.toISOString();
    return {
      id: receipt.id,
      userId: receipt.userId,
      version: receipt.version,
      privacyVersion: receipt.privacyVersion,
      termsVersion: receipt.termsVersion,
      privacyAccepted: receipt.privacyAccepted,
      termsAccepted: receipt.termsAccepted,
      adultConfirmed: receipt.adultConfirmed,
      acceptedAt: receipt.acceptedAt.toISOString(),
      consentedAt: recordedAt,
      recordedAt,
      withdrawnAt: receipt.withdrawnAt?.toISOString() ?? null,
      privacyUrl: receipt.privacyUrl,
      termsUrl: receipt.termsUrl,
      source: receipt.source
    };
  }
}
