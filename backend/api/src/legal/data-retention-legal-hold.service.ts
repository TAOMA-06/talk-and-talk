import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { Prisma } from "../../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../common/audit/audit.service";
import { ACCOUNT_DELETION_RETENTION_CATEGORIES } from "../common/account-deletion-retention-policy";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import {
  ApproveDataRetentionLegalHoldActionDto,
  DataRetentionLegalHoldAction,
  DataRetentionLegalHoldActionStatus,
  ListDataRetentionLegalHoldHistoryDto,
  ListDataRetentionLegalHoldRecordsDto,
  RejectDataRetentionLegalHoldActionDto,
  RequestDataRetentionLegalHoldActionDto
} from "./dto/data-retention-legal-hold.dto";

const POLICY_APPROVED_KEY = "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVED";
const POLICY_VERSION_KEY = "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_VERSION";
const POLICY_APPROVAL_REFERENCE_KEY =
  "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_POLICY_APPROVAL_REFERENCE";
const POLICY_REASON_CODES_KEY = "ACCOUNT_DATA_RETENTION_LEGAL_HOLD_REASON_CODES_JSON";

const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/;
const RETENTION_CATEGORIES = new Set(
  ACCOUNT_DELETION_RETENTION_CATEGORIES.map((category) => category.code)
);

export const DATA_RETENTION_LEGAL_HOLD_REJECTION_REASON_CODES = [
  "AUTHORITY_NOT_VERIFIED",
  "DUPLICATE_OR_SUPERSEDED",
  "POLICY_SCOPE_MISMATCH",
  "REQUEST_EVIDENCE_INVALID",
  "RETENTION_RECORD_MISMATCH"
] as const;

export type LegalHoldReasonPolicyRule = {
  code: string;
  actions: DataRetentionLegalHoldAction[];
  categories: string[];
};

export type ReadyLegalHoldPolicy = {
  ready: true;
  version: string;
  approvalReference: string;
  reasons: LegalHoldReasonPolicyRule[];
};

export type BlockedLegalHoldPolicy = {
  ready: false;
  errorCode: string;
};

export type LegalHoldPolicy = ReadyLegalHoldPolicy | BlockedLegalHoldPolicy;

type LegalHoldPolicyConfig = Pick<ConfigService, "get">;

/**
 * Evaluates the controlled legal-hold policy without exposing its approval
 * reference. Keeping this parser shared prevents the mutation API and the
 * commercial readiness gate from disagreeing about whether preservation is
 * safely operable.
 */
export function evaluateDataRetentionLegalHoldPolicy(
  config: LegalHoldPolicyConfig
): LegalHoldPolicy {
  if (config.get<unknown>(POLICY_APPROVED_KEY, false) !== true) {
    return { ready: false, errorCode: "LEGAL_HOLD_POLICY_NOT_APPROVED" };
  }
  const version = String(config.get<unknown>(POLICY_VERSION_KEY, "") ?? "").trim();
  const approvalReference = String(
    config.get<unknown>(POLICY_APPROVAL_REFERENCE_KEY, "") ?? ""
  ).trim();
  if (!POLICY_VERSION_PATTERN.test(version) || !REFERENCE_PATTERN.test(approvalReference)) {
    return { ready: false, errorCode: "LEGAL_HOLD_POLICY_EVIDENCE_INVALID" };
  }

  const configured = config.get<unknown>(POLICY_REASON_CODES_KEY, "");
  let parsed: unknown;
  try {
    parsed = typeof configured === "string" ? JSON.parse(configured) : configured;
  } catch {
    return { ready: false, errorCode: "LEGAL_HOLD_REASON_CATALOG_INVALID" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ready: false, errorCode: "LEGAL_HOLD_REASON_CATALOG_INVALID" };
  }

  const seen = new Set<string>();
  const reasons: LegalHoldReasonPolicyRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      return { ready: false, errorCode: "LEGAL_HOLD_REASON_CATALOG_INVALID" };
    }
    const candidate = item as Record<string, unknown>;
    const code = typeof candidate.code === "string" ? candidate.code : "";
    const actions = Array.isArray(candidate.actions) ? candidate.actions : [];
    const categories = Array.isArray(candidate.categories) ? candidate.categories : [];
    if (
      !REASON_CODE_PATTERN.test(code)
      || seen.has(code)
      || actions.length === 0
      || categories.length === 0
      || actions.some((action) => action !== "placement" && action !== "release")
      || categories.some(
        (category) => typeof category !== "string" || !RETENTION_CATEGORIES.has(category)
      )
      || new Set(actions).size !== actions.length
      || new Set(categories).size !== categories.length
    ) {
      return { ready: false, errorCode: "LEGAL_HOLD_REASON_CATALOG_INVALID" };
    }
    seen.add(code);
    reasons.push({
      code,
      actions: actions as DataRetentionLegalHoldAction[],
      categories: categories as string[]
    });
  }
  return { ready: true, version, approvalReference, reasons };
}

type LockedRetentionRecord = {
  id: string;
  deletionRequestId: string;
  userId: string;
  category: string;
  disposition: string;
  retentionEndsAt: Date | null;
  expiryProcessedAt: Date | null;
  expiryAttemptCount: number;
  expiryNextAttemptAt: Date | null;
  expiryLastErrorCode: string | null;
  expiryPhase: string | null;
  expiryCursor: string | null;
  expiryLeaseToken: string | null;
  expiryLeaseExpiresAt: Date | null;
  expiryErasedRecordCount: number;
  mediaDeletionClaimedAt: Date | null;
  processingRestrictedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class DataRetentionLegalHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService
  ) {}

  async policyStatus(actor: AuthenticatedUser) {
    await this.assertActiveAdmin(actor, this.prisma as any);
    const policy = this.loadPolicy();
    return {
      ready: policy.ready,
      approvalStatus: policy.ready ? "approved" : "blocked",
      policyVersion: policy.ready ? policy.version : null,
      blockedReasonCode: policy.ready ? null : policy.errorCode,
      reasons: policy.ready
        ? policy.reasons.map(({ code, actions, categories }) => ({ code, actions, categories }))
        : [],
      rejectionReasonCodes: [...DATA_RETENTION_LEGAL_HOLD_REJECTION_REASON_CODES]
    };
  }

  async listRetentionRecords(
    actor: AuthenticatedUser,
    query: ListDataRetentionLegalHoldRecordsDto
  ) {
    const db = this.prisma as any;
    await this.assertActiveAdmin(actor, db);
    const policy = this.loadPolicy();
    const where = this.retentionRecordWhere(query);
    const [records, total] = await Promise.all([
      db.accountDataRetentionRecord.findMany({
        where,
        include: {
          legalHolds: {
            orderBy: [{ placedAt: "desc" }, { id: "desc" }],
            take: 1
          },
          legalHoldActions: {
            where: { status: "pending" },
            orderBy: [{ requestedAt: "asc" }, { id: "asc" }]
          }
        },
        orderBy: [{ retentionEndsAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.accountDataRetentionRecord.count({ where })
    ]);

    return {
      items: records.map((record: any) => this.toRecordDto(record, actor.id, policy)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      },
      policyReady: policy.ready
    };
  }

  async listLegalHoldHistory(
    actor: AuthenticatedUser,
    retentionRecordId: string,
    query: ListDataRetentionLegalHoldHistoryDto
  ) {
    const db = this.prisma as any;
    await this.assertActiveAdmin(actor, db);
    const record = await db.accountDataRetentionRecord.findUnique({
      where: { id: retentionRecordId },
      select: {
        id: true,
        deletionRequestId: true,
        userId: true,
        category: true,
        disposition: true,
        retentionEndsAt: true,
        expiryProcessedAt: true,
        expiryPhase: true,
        expiryCursor: true,
        expiryErasedRecordCount: true,
        expiryAttemptCount: true
      }
    });
    if (!record) {
      throw new AppException(
        "DATA_RETENTION_RECORD_NOT_FOUND",
        "Data-retention record not found",
        HttpStatus.NOT_FOUND
      );
    }

    const policy = this.loadPolicy();
    const where = {
      retentionRecordId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.status ? { status: query.status } : {})
    };
    const [actions, total] = await Promise.all([
      db.accountDataRetentionLegalHoldAction.findMany({
        where,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.accountDataRetentionLegalHoldAction.count({ where })
    ]);
    // Holds are scoped to this action page: every cycle stays reachable through
    // action pagination without an unbounded second collection or silent cap.
    const releaseHoldIds = actions
      .map((action: any) => action.legalHoldId)
      .filter((id: unknown): id is string => typeof id === "string");
    const placementActionIds = actions
      .filter((action: any) => action.action === "placement")
      .map((action: any) => action.id);
    const holds =
      releaseHoldIds.length || placementActionIds.length
        ? await db.accountDataRetentionLegalHold.findMany({
            where: {
              retentionRecordId,
              OR: [
                ...(releaseHoldIds.length ? [{ id: { in: releaseHoldIds } }] : []),
                ...(placementActionIds.length
                  ? [{ placementActionId: { in: placementActionIds } }]
                  : [])
              ]
            },
            orderBy: [{ placedAt: "desc" }, { id: "desc" }],
            take: query.pageSize
          })
        : [];

    return {
      retentionRecord: this.toRecordSummary(record),
      items: actions.map((action: any) => this.toActionDto(action, actor.id, policy)),
      holds: holds.map((hold: any) => this.toHoldDto(hold)),
      holdsScope: "currentActionPage",
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      },
      policyReady: policy.ready
    };
  }

  async requestPlacement(
    actor: AuthenticatedUser,
    retentionRecordId: string,
    dto: RequestDataRetentionLegalHoldActionDto
  ) {
    this.assertAdminRole(actor);
    const policy = this.requirePolicy();
    const pointer = await this.readRetentionRecordPointer(retentionRecordId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await this.lockMutationUsers(db, actor.id, pointer.userId);
        const record = await this.lockRetentionRecord(db, retentionRecordId, pointer.userId);
        await this.assertActiveAdmin(actor, db);

        const existing = await db.accountDataRetentionLegalHoldAction.findUnique({
          where: {
            requestedById_clientRequestId: {
              requestedById: actor.id,
              clientRequestId: dto.clientRequestId
            }
          }
        });
        if (existing) {
          this.assertIdempotentRequest(existing, "placement", retentionRecordId, null, dto);
          return this.mutationResponse(existing, null, actor.id, policy, false);
        }
        this.assertRecordCanReceiveHold(record);
        await this.assertRetentionMediaPreservable(db, record);
        this.assertReasonAllowed(policy, dto.reasonCode, "placement", record.category);

        const activeHold = await db.accountDataRetentionLegalHold.findFirst({
          where: { retentionRecordId, releasedAt: null },
          select: { id: true }
        });
        if (activeHold) {
          throw new AppException(
            "DATA_RETENTION_LEGAL_HOLD_ALREADY_ACTIVE",
            "An active legal hold already exists for this retention record",
            HttpStatus.CONFLICT,
            { legalHoldId: activeHold.id }
          );
        }
        const pending = await db.accountDataRetentionLegalHoldAction.findFirst({
          where: { retentionRecordId, action: "placement", status: "pending" },
          select: { id: true }
        });
        if (pending) {
          throw new AppException(
            "DATA_RETENTION_LEGAL_HOLD_PLACEMENT_ALREADY_PENDING",
            "A legal-hold placement request is already pending for this retention record",
            HttpStatus.CONFLICT,
            { actionId: pending.id }
          );
        }

        // This update must precede action insertion. The database trigger rejects
        // placement while any lease or due scheduling remains on the record.
        await db.accountDataRetentionRecord.update({
          where: { id: retentionRecordId },
          data: {
            expiryLeaseToken: null,
            expiryLeaseExpiresAt: null,
            expiryNextAttemptAt: null
          }
        });
        const action = await db.accountDataRetentionLegalHoldAction.create({
          data: {
            retentionRecordId,
            action: "placement",
            status: "pending",
            reasonCode: dto.reasonCode,
            authorityReference: dto.authorityReference,
            policyVersion: policy.version,
            policyApprovalReference: policy.approvalReference,
            requestedById: actor.id,
            clientRequestId: dto.clientRequestId,
            partialErasurePhase: record.expiryPhase,
            partialErasureCursor: record.expiryCursor,
            partialErasedRecordCount: record.expiryErasedRecordCount,
            partialExpiryAttemptCount: record.expiryAttemptCount
          }
        });
        await this.audit.record(
          {
            actorId: actor.id,
            subjectUserIds: [record.userId],
            action: "data_retention.legal_hold_placement_requested",
            resourceType: "accountDataRetentionLegalHoldAction",
            resourceId: action.id,
            metadata: this.auditMetadata(record, action, null)
          },
          db
        );
        return this.mutationResponse(action, null, actor.id, policy, false);
      });
    } catch (error) {
      this.rethrowMutationError(error, "placement request");
    }
  }

  async requestRelease(
    actor: AuthenticatedUser,
    legalHoldId: string,
    dto: RequestDataRetentionLegalHoldActionDto
  ) {
    this.assertAdminRole(actor);
    const policy = this.requirePolicy();
    const pointer = await (this.prisma as any).accountDataRetentionLegalHold.findUnique({
      where: { id: legalHoldId },
      select: { id: true, retentionRecordId: true }
    });
    if (!pointer) this.throwHoldNotFound();
    const recordPointer = await this.readRetentionRecordPointer(pointer.retentionRecordId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await this.lockMutationUsers(db, actor.id, recordPointer.userId);
        const record = await this.lockRetentionRecord(
          db,
          pointer.retentionRecordId,
          recordPointer.userId
        );
        const hold = await this.lockLegalHold(db, legalHoldId);
        await this.assertActiveAdmin(actor, db);

        const existing = await db.accountDataRetentionLegalHoldAction.findUnique({
          where: {
            requestedById_clientRequestId: {
              requestedById: actor.id,
              clientRequestId: dto.clientRequestId
            }
          }
        });
        if (existing) {
          this.assertIdempotentRequest(
            existing,
            "release",
            record.id,
            legalHoldId,
            dto
          );
          return this.mutationResponse(existing, hold, actor.id, policy, false);
        }
        if (hold.releasedAt) {
          throw new AppException(
            "DATA_RETENTION_LEGAL_HOLD_ALREADY_RELEASED",
            "The legal hold has already been released",
            HttpStatus.CONFLICT
          );
        }
        this.assertRecordCanReceiveHold(record);
        this.assertReasonAllowed(policy, dto.reasonCode, "release", record.category);

        const pending = await db.accountDataRetentionLegalHoldAction.findFirst({
          where: { legalHoldId, action: "release", status: "pending" },
          select: { id: true }
        });
        if (pending) {
          throw new AppException(
            "DATA_RETENTION_LEGAL_HOLD_RELEASE_ALREADY_PENDING",
            "A release request is already pending for this legal hold",
            HttpStatus.CONFLICT,
            { actionId: pending.id }
          );
        }

        const action = await db.accountDataRetentionLegalHoldAction.create({
          data: {
            retentionRecordId: record.id,
            legalHoldId,
            action: "release",
            status: "pending",
            reasonCode: dto.reasonCode,
            authorityReference: dto.authorityReference,
            policyVersion: policy.version,
            policyApprovalReference: policy.approvalReference,
            requestedById: actor.id,
            clientRequestId: dto.clientRequestId,
            partialErasurePhase: record.expiryPhase,
            partialErasureCursor: record.expiryCursor,
            partialErasedRecordCount: record.expiryErasedRecordCount,
            partialExpiryAttemptCount: record.expiryAttemptCount
          }
        });
        await this.audit.record(
          {
            actorId: actor.id,
            subjectUserIds: [record.userId],
            action: "data_retention.legal_hold_release_requested",
            resourceType: "accountDataRetentionLegalHoldAction",
            resourceId: action.id,
            metadata: this.auditMetadata(record, action, legalHoldId)
          },
          db
        );
        return this.mutationResponse(action, hold, actor.id, policy, false);
      });
    } catch (error) {
      this.rethrowMutationError(error, "release request");
    }
  }

  async approveAction(
    actor: AuthenticatedUser,
    actionId: string,
    dto: ApproveDataRetentionLegalHoldActionDto
  ) {
    this.assertAdminRole(actor);
    const policy = this.requirePolicy();
    return this.decideAction(actor, actionId, "approved", dto, policy);
  }

  async rejectAction(
    actor: AuthenticatedUser,
    actionId: string,
    dto: RejectDataRetentionLegalHoldActionDto
  ) {
    this.assertAdminRole(actor);
    const policy = this.requirePolicy();
    if (!(DATA_RETENTION_LEGAL_HOLD_REJECTION_REASON_CODES as readonly string[]).includes(
      dto.decisionReasonCode
    )) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_REJECTION_REASON_NOT_ALLOWED",
        "The legal-hold rejection reason code is not allowed",
        HttpStatus.BAD_REQUEST
      );
    }
    return this.decideAction(actor, actionId, "rejected", dto, policy);
  }

  private async decideAction(
    actor: AuthenticatedUser,
    actionId: string,
    decision: Exclude<DataRetentionLegalHoldActionStatus, "pending">,
    dto: ApproveDataRetentionLegalHoldActionDto | RejectDataRetentionLegalHoldActionDto,
    policy: ReadyLegalHoldPolicy
  ) {
    const pointer = await (this.prisma as any).accountDataRetentionLegalHoldAction.findUnique({
      where: { id: actionId },
      select: { id: true, retentionRecordId: true, legalHoldId: true, action: true }
    });
    if (!pointer) this.throwActionNotFound();
    const recordPointer = await this.readRetentionRecordPointer(pointer.retentionRecordId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await this.lockMutationUsers(db, actor.id, recordPointer.userId);
        const record = await this.lockRetentionRecord(
          db,
          pointer.retentionRecordId,
          recordPointer.userId
        );
        let hold = pointer.legalHoldId
          ? await this.lockLegalHold(db, pointer.legalHoldId)
          : null;
        const action = await this.lockLegalHoldAction(db, actionId);
        await this.assertActiveAdmin(actor, db);

        if (action.status !== "pending") {
          this.assertIdempotentDecision(action, actor.id, decision, dto);
          if (!hold && action.action === "placement" && action.status === "approved") {
            hold = await db.accountDataRetentionLegalHold.findUnique({
              where: { placementActionId: action.id }
            });
          }
          const shouldWakeRetentionWorker = Boolean(
            record.expiryNextAttemptAt
            && this.retentionIsDue(record, new Date())
            && (
              (action.action === "placement" && action.status === "rejected")
              || (action.action === "release" && action.status === "approved")
            )
          );
          return this.mutationResponse(
            action,
            hold,
            actor.id,
            policy,
            shouldWakeRetentionWorker
          );
        }
        if (action.requestedById === actor.id) {
          throw new AppException(
            "DATA_RETENTION_LEGAL_HOLD_SECOND_REVIEW_REQUIRED",
            "A different active administrator must decide this legal-hold action",
            HttpStatus.FORBIDDEN
          );
        }

        if (decision === "approved") {
          this.assertActionPolicyCurrent(action, policy);
          this.assertReasonAllowed(policy, action.reasonCode, action.action, record.category);
        }

        const decidedAt = new Date();
        let wakeRetentionWorker = false;
        if (decision === "approved" && action.action === "placement") {
          this.assertRecordCanReceiveHold(record);
          await this.assertRetentionMediaPreservable(db, record);
          const active = await db.accountDataRetentionLegalHold.findFirst({
            where: { retentionRecordId: record.id, releasedAt: null },
            select: { id: true }
          });
          if (active) {
            throw new AppException(
              "DATA_RETENTION_LEGAL_HOLD_ALREADY_ACTIVE",
              "An active legal hold already exists for this retention record",
              HttpStatus.CONFLICT,
              { legalHoldId: active.id }
            );
          }
          // The hold is inserted while the action is pending and both deferred
          // commit checks become satisfied after the action update below.
          hold = await db.accountDataRetentionLegalHold.create({
            data: {
              retentionRecordId: record.id,
              placementActionId: action.id,
              placedById: actor.id,
              placedAt: decidedAt
            }
          });
        } else if (decision === "approved" && action.action === "release") {
          if (!hold || hold.releasedAt) {
            throw new AppException(
              "DATA_RETENTION_LEGAL_HOLD_NOT_ACTIVE",
              "The release action no longer targets an active legal hold",
              HttpStatus.CONFLICT
            );
          }
          // Release the hold first, then approve its action. Deferred database
          // checks validate the pair atomically at transaction commit.
          hold = await db.accountDataRetentionLegalHold.update({
            where: { id: hold.id },
            data: {
              releaseActionId: action.id,
              releasedById: actor.id,
              releasedAt: decidedAt
            }
          });
        }

        const decidedAction = await db.accountDataRetentionLegalHoldAction.update({
          where: { id: action.id },
          data: {
            status: decision,
            decidedById: actor.id,
            decidedAt,
            decisionReference: dto.decisionReference,
            decisionReasonCode:
              decision === "rejected"
                ? (dto as RejectDataRetentionLegalHoldActionDto).decisionReasonCode
                : null
          }
        });

        if (
          (decision === "rejected" && action.action === "placement")
          || (decision === "approved" && action.action === "release")
        ) {
          wakeRetentionWorker = this.retentionIsDue(record, decidedAt);
          if (wakeRetentionWorker) {
            await db.accountDataRetentionRecord.update({
              where: { id: record.id },
              data: {
                expiryLeaseToken: null,
                expiryLeaseExpiresAt: null,
                expiryNextAttemptAt: decidedAt
              }
            });
          }
        }

        await this.audit.record(
          {
            actorId: actor.id,
            subjectUserIds: [record.userId],
            action: this.decisionAuditAction(action.action, decision),
            resourceType: "accountDataRetentionLegalHoldAction",
            resourceId: action.id,
            metadata: this.auditMetadata(record, decidedAction, hold?.id ?? null)
          },
          db
        );
        return this.mutationResponse(
          decidedAction,
          hold,
          actor.id,
          policy,
          wakeRetentionWorker
        );
      });
    } catch (error) {
      this.rethrowMutationError(error, `${pointer.action} ${decision}`);
    }
  }

  private retentionRecordWhere(query: ListDataRetentionLegalHoldRecordsDto) {
    const where: Record<string, unknown> = {
      ...(query.category ? { category: query.category } : {})
    };
    const and: Record<string, unknown>[] = [];

    if (query.expiryState === "processed") {
      and.push({ expiryProcessedAt: { not: null } });
    } else if (query.expiryState === "partiallyErased") {
      and.push({
        expiryProcessedAt: null,
        OR: [
          { expiryPhase: { not: null } },
          { expiryCursor: { not: null } },
          { expiryErasedRecordCount: { gt: 0 } }
        ]
      });
    } else if (query.expiryState === "pending") {
      and.push({
        expiryProcessedAt: null,
        expiryPhase: null,
        expiryCursor: null,
        expiryErasedRecordCount: 0
      });
    }

    if (query.holdState === "placementPending") {
      and.push({ legalHoldActions: { some: { action: "placement", status: "pending" } } });
    } else if (query.holdState === "releasePending") {
      and.push({ legalHoldActions: { some: { action: "release", status: "pending" } } });
    } else if (query.holdState === "active") {
      and.push(
        { legalHolds: { some: { releasedAt: null } } },
        { legalHoldActions: { none: { action: "release", status: "pending" } } }
      );
    } else if (query.holdState === "released") {
      and.push(
        { legalHolds: { some: { releasedAt: { not: null } } } },
        { legalHolds: { none: { releasedAt: null } } },
        { legalHoldActions: { none: { action: "placement", status: "pending" } } }
      );
    } else if (query.holdState === "none") {
      and.push(
        { legalHolds: { none: {} } },
        { legalHoldActions: { none: { action: "placement", status: "pending" } } }
      );
    }

    if (and.length) where.AND = and;
    return where;
  }

  private async readRetentionRecordPointer(retentionRecordId: string) {
    const pointer = await (this.prisma as any).accountDataRetentionRecord.findUnique({
      where: { id: retentionRecordId },
      select: { id: true, userId: true }
    });
    if (!pointer) {
      throw new AppException(
        "DATA_RETENTION_RECORD_NOT_FOUND",
        "Data-retention record not found",
        HttpStatus.NOT_FOUND
      );
    }
    return pointer as { id: string; userId: string };
  }

  private async lockRetentionRecord(
    db: any,
    retentionRecordId: string,
    expectedUserId: string
  ) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AccountDataRetentionRecord"
      WHERE "id" = ${retentionRecordId}
      FOR UPDATE
    `;
    if (!rows.length) {
      throw new AppException(
        "DATA_RETENTION_RECORD_NOT_FOUND",
        "Data-retention record not found",
        HttpStatus.NOT_FOUND
      );
    }
    const record = await db.accountDataRetentionRecord.findUnique({
      where: { id: retentionRecordId }
    });
    if (!record) {
      throw new AppException(
        "DATA_RETENTION_RECORD_NOT_FOUND",
        "Data-retention record not found",
        HttpStatus.NOT_FOUND
      );
    }
    if (record.userId !== expectedUserId) {
      throw new AppException(
        "DATA_RETENTION_RECORD_SUBJECT_CHANGED",
        "The data-retention record subject changed while starting the operation",
        HttpStatus.CONFLICT
      );
    }
    return record as LockedRetentionRecord;
  }

  private async lockLegalHold(db: any, legalHoldId: string) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AccountDataRetentionLegalHold"
      WHERE "id" = ${legalHoldId}
      FOR UPDATE
    `;
    if (!rows.length) this.throwHoldNotFound();
    const hold = await db.accountDataRetentionLegalHold.findUnique({ where: { id: legalHoldId } });
    if (!hold) this.throwHoldNotFound();
    return hold;
  }

  private async lockLegalHoldAction(db: any, actionId: string) {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AccountDataRetentionLegalHoldAction"
      WHERE "id" = ${actionId}
      FOR UPDATE
    `;
    if (!rows.length) this.throwActionNotFound();
    const action = await db.accountDataRetentionLegalHoldAction.findUnique({
      where: { id: actionId }
    });
    if (!action) this.throwActionNotFound();
    return action;
  }

  private async lockMutationUsers(db: any, actorId: string, subjectUserId: string) {
    const userIds = [...new Set([actorId, subjectUserId])].sort();
    const lockedUsers = await db.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${Prisma.join(userIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    if (!Array.isArray(lockedUsers) || lockedUsers.length !== userIds.length) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_ACTOR_OR_SUBJECT_NOT_FOUND",
        "The legal-hold actor or retention subject no longer exists",
        HttpStatus.CONFLICT
      );
    }
    await db.$queryRaw`
      SELECT "id"
      FROM "CompanionProfile"
      WHERE "ownerUserId" = ${subjectUserId}
      ORDER BY "id"
      FOR UPDATE
    `;
  }

  private async assertActiveAdmin(actor: AuthenticatedUser, db: any) {
    this.assertAdminRole(actor);
    const current = await db.user.findUnique({
      where: { id: actor.id },
      select: { role: true, accountStatus: true }
    });
    if (!current || current.role !== "admin" || current.accountStatus !== "active") {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_ADMIN_REQUIRED",
        "An active administrator account is required",
        HttpStatus.FORBIDDEN
      );
    }
  }

  private assertAdminRole(actor: AuthenticatedUser) {
    if (actor.role !== "admin") {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_ADMIN_REQUIRED",
        "An active administrator account is required",
        HttpStatus.FORBIDDEN
      );
    }
  }

  private assertRecordCanReceiveHold(record: LockedRetentionRecord) {
    if (record.expiryProcessedAt) {
      throw new AppException(
        "DATA_RETENTION_RECORD_ALREADY_EXPIRED",
        "A terminal data-retention record cannot receive a legal hold",
        HttpStatus.CONFLICT
      );
    }
  }

  private async assertRetentionMediaPreservable(db: any, record: LockedRetentionRecord) {
    if (record.mediaDeletionClaimedAt) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_MEDIA_DELETE_ALREADY_STARTED",
        "A media deletion was already claimed; preservation can no longer be guaranteed",
        HttpStatus.CONFLICT,
        { retentionRecordId: record.id }
      );
    }
    const purposes = record.category === "support_disputes_safety"
      ? [
          "chatMessage",
          "orderSupportFact",
          "attendanceDisputeStatement",
          "companionIncidentReport"
        ]
      : record.category === "consent_rights_account_governance"
        ? ["userAccountAppeal", "companionAccountAppeal"]
        : [];
    const destructive = await db.mediaAsset.findFirst({
      where: {
        OR: [
          { retentionExpiryRecordId: record.id },
          ...(purposes.length > 0 ? [{
            retentionExpiryRecordId: null,
            uploaderId: record.userId,
            purpose: { in: purposes }
          }] : [])
        ],
        AND: [{
          OR: [
            { storageDeleteLeaseToken: { not: null } },
            { storageDeleteOutcomeUnknownAt: { not: null } },
            { storageDeletedAt: { not: null } }
          ]
        }]
      },
      select: { id: true }
    });
    if (destructive) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_MEDIA_DELETE_ALREADY_STARTED",
        "A media deletion is already in flight or has an unknown provider outcome; preservation can no longer be guaranteed",
        HttpStatus.CONFLICT,
        { retentionRecordId: record.id }
      );
    }
  }

  private loadPolicy(): LegalHoldPolicy {
    return evaluateDataRetentionLegalHoldPolicy(this.config);
  }

  private requirePolicy(): ReadyLegalHoldPolicy {
    const policy = this.loadPolicy();
    if (!policy.ready) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_POLICY_BLOCKED",
        "The externally approved legal-hold policy is unavailable or invalid",
        HttpStatus.SERVICE_UNAVAILABLE,
        { reasonCode: policy.errorCode }
      );
    }
    return policy;
  }

  private assertReasonAllowed(
    policy: ReadyLegalHoldPolicy,
    reasonCode: string,
    action: DataRetentionLegalHoldAction,
    category: string
  ) {
    const reason = policy.reasons.find((candidate) => candidate.code === reasonCode);
    if (!reason || !reason.actions.includes(action) || !reason.categories.includes(category)) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_REASON_NOT_ALLOWED",
        "The reason code is not approved for this action and retention category",
        HttpStatus.BAD_REQUEST,
        { action, category }
      );
    }
  }

  private assertActionPolicyCurrent(action: any, policy: ReadyLegalHoldPolicy) {
    if (
      action.policyVersion !== policy.version
      || action.policyApprovalReference !== policy.approvalReference
    ) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_POLICY_SNAPSHOT_STALE",
        "The request policy snapshot is no longer current and must be rejected or superseded",
        HttpStatus.CONFLICT
      );
    }
  }

  private assertIdempotentRequest(
    existing: any,
    action: DataRetentionLegalHoldAction,
    retentionRecordId: string,
    legalHoldId: string | null,
    dto: RequestDataRetentionLegalHoldActionDto
  ) {
    if (
      existing.action !== action
      || existing.retentionRecordId !== retentionRecordId
      || (existing.legalHoldId ?? null) !== legalHoldId
      || existing.reasonCode !== dto.reasonCode
      || existing.authorityReference !== dto.authorityReference
    ) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_IDEMPOTENCY_CONFLICT",
        "The client request identifier was already used for a different legal-hold request",
        HttpStatus.CONFLICT
      );
    }
  }

  private assertIdempotentDecision(
    action: any,
    actorId: string,
    decision: Exclude<DataRetentionLegalHoldActionStatus, "pending">,
    dto: ApproveDataRetentionLegalHoldActionDto | RejectDataRetentionLegalHoldActionDto
  ) {
    const rejectionCode =
      decision === "rejected"
        ? (dto as RejectDataRetentionLegalHoldActionDto).decisionReasonCode
        : null;
    if (
      action.status === decision
      && action.decidedById === actorId
      && action.decisionReference === dto.decisionReference
      && (action.decisionReasonCode ?? null) === rejectionCode
    ) {
      return;
    }
    throw new AppException(
      "DATA_RETENTION_LEGAL_HOLD_ACTION_ALREADY_DECIDED",
      "The legal-hold action has already received a decision",
      HttpStatus.CONFLICT,
      { currentStatus: action.status }
    );
  }

  private retentionIsDue(record: LockedRetentionRecord, now: Date) {
    return Boolean(
      !record.expiryProcessedAt
      && record.retentionEndsAt
      && record.retentionEndsAt.getTime() <= now.getTime()
    );
  }

  private mutationResponse(
    action: any,
    hold: any | null,
    actorId: string,
    policy: LegalHoldPolicy,
    wakeRetentionWorker: boolean
  ) {
    return {
      action: this.toActionDto(action, actorId, policy),
      legalHold: hold ? this.toHoldDto(hold) : null,
      wakeRetentionWorker
    };
  }

  private toRecordDto(record: any, actorId: string, policy: LegalHoldPolicy) {
    const latestHold = record.legalHolds?.[0] ?? null;
    const pendingPlacement = record.legalHoldActions?.find(
      (action: any) => action.action === "placement"
    );
    const pendingRelease = record.legalHoldActions?.find(
      (action: any) => action.action === "release"
    );
    const holdState = pendingPlacement
      ? "placementPending"
      : latestHold && !latestHold.releasedAt
        ? pendingRelease
          ? "releasePending"
          : "active"
        : latestHold
          ? "released"
          : "none";
    return {
      ...this.toRecordSummary(record),
      holdState,
      disposalBarrierActive: Boolean(pendingPlacement || (latestHold && !latestHold.releasedAt)),
      legalHold: latestHold ? this.toHoldDto(latestHold) : null,
      pendingActions: (record.legalHoldActions ?? []).map((action: any) =>
        this.toActionDto(action, actorId, policy)
      ),
      capabilities: {
        canRequestPlacement:
          policy.ready && !record.expiryProcessedAt && holdState !== "placementPending" && holdState !== "active" && holdState !== "releasePending",
        canRequestRelease: policy.ready && holdState === "active",
        canReview: policy.ready
          && (record.legalHoldActions ?? []).some(
            (action: any) => action.status === "pending" && action.requestedById !== actorId
          )
      }
    };
  }

  private toRecordSummary(record: any) {
    return {
      id: record.id,
      deletionRequestId: record.deletionRequestId,
      subjectUserId: record.userId,
      category: record.category,
      disposition: record.disposition,
      retentionEndsAt: this.iso(record.retentionEndsAt),
      expiryProcessedAt: this.iso(record.expiryProcessedAt),
      partialErasure: {
        phase: record.expiryPhase ?? null,
        cursor: record.expiryCursor ?? null,
        erasedRecordCount: record.expiryErasedRecordCount,
        attemptCount: record.expiryAttemptCount
      }
    };
  }

  private toActionDto(action: any, actorId: string, policy: LegalHoldPolicy) {
    return {
      id: action.id,
      retentionRecordId: action.retentionRecordId,
      legalHoldId: action.legalHoldId ?? null,
      action: action.action,
      status: action.status,
      reasonCode: action.reasonCode,
      authorityReferenceMasked: this.maskReference(action.authorityReference),
      policyVersion: action.policyVersion,
      policySnapshotCurrent:
        policy.ready
        && action.policyVersion === policy.version
        && action.policyApprovalReference === policy.approvalReference,
      requestedById: action.requestedById,
      requestedAt: this.iso(action.requestedAt),
      decidedById: action.decidedById ?? null,
      decidedAt: this.iso(action.decidedAt),
      decisionReferenceMasked: this.maskReference(action.decisionReference),
      decisionReasonCode: action.decisionReasonCode ?? null,
      clientRequestId: action.clientRequestId,
      partialErasure: {
        phase: action.partialErasurePhase ?? null,
        cursor: action.partialErasureCursor ?? null,
        erasedRecordCount: action.partialErasedRecordCount,
        attemptCount: action.partialExpiryAttemptCount
      },
      canReview: policy.ready && action.status === "pending" && action.requestedById !== actorId
    };
  }

  private toHoldDto(hold: any) {
    return {
      id: hold.id,
      retentionRecordId: hold.retentionRecordId,
      placementActionId: hold.placementActionId,
      placedById: hold.placedById,
      placedAt: this.iso(hold.placedAt),
      releaseActionId: hold.releaseActionId ?? null,
      releasedById: hold.releasedById ?? null,
      releasedAt: this.iso(hold.releasedAt),
      state: hold.releasedAt ? "released" : "active"
    };
  }

  private auditMetadata(record: LockedRetentionRecord, action: any, legalHoldId: string | null) {
    return {
      retentionRecordId: record.id,
      legalHoldId,
      category: record.category,
      action: action.action,
      status: action.status,
      reasonCode: action.reasonCode,
      partialErasurePhase: action.partialErasurePhase ?? null,
      partialErasedRecordCount: action.partialErasedRecordCount
    };
  }

  private decisionAuditAction(
    action: DataRetentionLegalHoldAction,
    decision: Exclude<DataRetentionLegalHoldActionStatus, "pending">
  ) {
    if (action === "placement") {
      return decision === "approved"
        ? "data_retention.legal_hold_placement_approved"
        : "data_retention.legal_hold_placement_rejected";
    }
    return decision === "approved"
      ? "data_retention.legal_hold_release_approved"
      : "data_retention.legal_hold_release_rejected";
  }

  private maskReference(value: string | null | undefined) {
    if (!value) return null;
    if (value.length <= 10) return `${value.slice(0, 2)}••••${value.slice(-2)}`;
    return `${value.slice(0, 6)}••••${value.slice(-4)}`;
  }

  private iso(value: Date | string | null | undefined) {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private throwHoldNotFound(): never {
    throw new AppException(
      "DATA_RETENTION_LEGAL_HOLD_NOT_FOUND",
      "Data-retention legal hold not found",
      HttpStatus.NOT_FOUND
    );
  }

  private throwActionNotFound(): never {
    throw new AppException(
      "DATA_RETENTION_LEGAL_HOLD_ACTION_NOT_FOUND",
      "Data-retention legal-hold action not found",
      HttpStatus.NOT_FOUND
    );
  }

  private rethrowMutationError(error: unknown, operation: string): never {
    if (error instanceof AppException) throw error;
    if (
      error
      && typeof error === "object"
      && (
        String((error as { code?: unknown }).code ?? "") === "55000"
        || String((error as { message?: unknown }).message ?? "")
          .match(/retention media deletion (?:is already in flight or outcome unknown|was already claimed)/)
      )
    ) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_MEDIA_DELETE_ALREADY_STARTED",
        "A media deletion is already in flight or has an unknown provider outcome; preservation can no longer be guaranteed",
        HttpStatus.CONFLICT
      );
    }
    if (
      error
      && typeof error === "object"
      && ["P2002", "23505"].includes(String((error as { code?: unknown }).code ?? ""))
    ) {
      throw new AppException(
        "DATA_RETENTION_LEGAL_HOLD_CONFLICT",
        `The legal-hold ${operation} conflicts with another committed operation`,
        HttpStatus.CONFLICT
      );
    }
    throw error;
  }
}
