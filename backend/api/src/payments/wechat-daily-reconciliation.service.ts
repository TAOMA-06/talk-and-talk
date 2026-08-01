import { createHash, randomUUID } from "node:crypto";

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AuthenticatedUser } from "../auth/auth.service";
import { AuditService } from "../common/audit/audit.service";
import { AppException } from "../common/errors/app.exception";
import { PrismaService } from "../database/prisma.service";
import { NormalizedWeChatBillEntry, parseWeChatDailyBill, WeChatDailyBillKind } from "./wechat-bill-parser";
import {
  WECHAT_DAILY_STATEMENT_MAX_BYTES,
  WECHAT_PAY_PROVIDER,
  WeChatPayProvider
} from "./wechat/wechat-pay.provider";
import {
  billDateToUtc,
  configuredWeChatReconciliationWindow,
  evaluateWeChatReconciliationGate,
  latestReadyWeChatBillDate,
  WECHAT_DAILY_BILL_KINDS,
  WECHAT_DAILY_BILL_MAX_LOOKBACK_DAYS
} from "./wechat-reconciliation-gate";

type BillRunStatus = "pending" | "processing" | "noStatement" | "reconciled" | "failed";
type IssueStatus = "open" | "investigating" | "resolved" | "acceptedException";

type DownloadedStatement = {
  status: "downloaded";
  bytes: Uint8Array;
  text: string;
  sha1: string;
  sha256: string;
  sizeBytes: number;
};

type NoStatement = { status: "noStatement" };

type IssueCandidate = {
  entryId?: string;
  source: string;
  kind: string;
  severity?: "critical" | "high" | "medium";
  localResourceType?: string;
  localResourceId?: string;
  providerReference?: string;
  expectedCents?: number;
  actualCents?: number;
  detailCode: string;
};

const BILL_KINDS: WeChatDailyBillKind[] = [...WECHAT_DAILY_BILL_KINDS];
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const MAX_LOOKBACK_DAYS = WECHAT_DAILY_BILL_MAX_LOOKBACK_DAYS;
const MERCHANT_PLATFORM_HISTORY_YEARS = 5;
const LEASE_MS = 10 * 60_000;

@Injectable()
export class WeChatDailyReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(WECHAT_PAY_PROVIDER) private readonly provider: WeChatPayProvider,
    private readonly audit: AuditService
  ) {}

  async readiness(now = new Date()) {
    const enabled = this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false);
    const approved = this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVED", false);
    const approvalReference = this.config.get<string>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE", "").trim();
    const gate = await this.releaseGate(now);
    return {
      enabled,
      approved: approved && Boolean(approvalReference),
      providerMode: this.provider.mode,
      scheduleTimezone: "Asia/Shanghai",
      notBeforeHour: this.config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_HOUR", 10),
      startDate: this.config.get<string>("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE", "").trim() || null,
      gate
    };
  }

  async ensureExpectedRuns(now = new Date()) {
    if (!this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false)) {
      return { created: 0, coverageStartDate: null, dueDate: null, billDates: [] as string[] };
    }
    this.assertRuntimeReady(now);
    const window = configuredWeChatReconciliationWindow(this.config, now);
    const result = await (this.prisma as any).weChatBillReconciliationRun.createMany({
      data: window.catchupDates.flatMap((billDate) => BILL_KINDS.map((kind) => ({
          id: randomUUID(),
          provider: "wechat",
          billDate: billDateToUtc(billDate),
          kind,
          status: "pending",
          nextAttemptAt: now
        }))),
      skipDuplicates: true
    });
    return {
      created: Number(result?.count ?? 0),
      coverageStartDate: window.coverageStartDate,
      dueDate: window.dueDate,
      billDates: window.catchupDates
    };
  }

  async ensureYesterdayRuns(now = new Date()) {
    return this.ensureExpectedRuns(now);
  }

  async createRuns(actor: AuthenticatedUser, billDate: string) {
    const now = new Date();
    this.assertRuntimeReady(now);
    const normalized = this.assertEligibleBillDate(billDate, now);
    const result = await (this.prisma as any).weChatBillReconciliationRun.createMany({
      data: BILL_KINDS.map((kind) => ({
        id: randomUUID(),
        provider: "wechat",
        billDate: billDateDate(normalized),
        kind,
        status: "pending",
        nextAttemptAt: now
      })),
      skipDuplicates: true
    });
    await this.audit.record({
      actorId: actor.id,
      action: "wechat.bill_reconciliation_requested",
      resourceType: "wechatBillReconciliationDate",
      resourceId: normalized,
      metadata: { kinds: BILL_KINDS, created: Number(result?.count ?? 0) }
    });
    return { billDate: normalized, created: Number(result?.count ?? 0), kinds: BILL_KINDS };
  }

  async processDue(limit = 4, now = new Date()) {
    if (!this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false)) {
      return { processed: 0, reconciled: 0, noStatement: 0, failed: 0 };
    }
    this.assertRuntimeReady(now);
    const bounded = Math.max(1, Math.min(16, Math.trunc(limit)));
    const summary = { processed: 0, reconciled: 0, noStatement: 0, failed: 0 };
    for (let index = 0; index < bounded; index += 1) {
      const claimed = await this.claimNextRun(now);
      if (!claimed) break;
      summary.processed += 1;
      const status = await this.processClaimedRun(claimed);
      summary[status] += 1;
    }
    return summary;
  }

  async retryRun(actor: AuthenticatedUser, runId: string) {
    this.assertRuntimeReady();
    const result = await (this.prisma as any).weChatBillReconciliationRun.updateMany({
      where: { id: runId, status: { in: ["failed", "noStatement"] }, importedAt: null },
      data: {
        status: "pending",
        nextAttemptAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorSummary: null
      }
    });
    if (result.count !== 1) {
      throw new AppException(
        "WECHAT_BILL_RUN_NOT_RETRYABLE",
        "The bill run is neither failed nor a provider no-statement result, or it has already imported an immutable artifact",
        HttpStatus.CONFLICT
      );
    }
    await this.audit.record({
      actorId: actor.id,
      action: "wechat.bill_reconciliation_retry_requested",
      resourceType: "wechatBillReconciliationRun",
      resourceId: runId
    });
    return { runId, status: "pending" as const };
  }

  async listMerchantBillImports(query: { page: number; pageSize: number; status?: string }) {
    const where = query.status ? { status: query.status } : {};
    const db = this.prisma as any;
    const [items, total] = await Promise.all([
      db.weChatBillImportProposal.findMany({
        where,
        orderBy: [{ proposedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.weChatBillImportProposal.count({ where })
    ]);
    return {
      items: items.map((item: any) => this.merchantImportDto(item)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async listCashLedgerEntries(query: {
    page: number;
    pageSize: number;
    classificationStatus?: "unclassified" | "classified";
  }) {
    const where = query.classificationStatus === "unclassified"
      ? { OR: [{ accountType: "UNCLASSIFIED" }, { expectedStatementDate: null }] }
      : query.classificationStatus === "classified"
        ? { accountType: { not: "UNCLASSIFIED" }, expectedStatementDate: { not: null } }
        : {};
    const db = this.prisma as any;
    const [items, total] = await Promise.all([
      db.cashLedgerEntry.findMany({
        where,
        include: { classificationProposals: { orderBy: { proposedAt: "desc" }, take: 1 } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.cashLedgerEntry.count({ where })
    ]);
    return {
      items: items.map((item: any) => this.cashLedgerDto(item)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async submitCashLedgerClassification(actor: AuthenticatedUser, cashLedgerEntryId: string, input: {
    accountType: "BASIC" | "OPERATION" | "FEES";
    expectedStatementDate: string;
    evidenceReference: string;
    evidenceDigestSha256: string;
  }) {
    this.assertRuntimeReady();
    const expectedStatementDate = this.assertDateFormat(input.expectedStatementDate);
    if (!/^[a-fA-F0-9]{64}$/.test(input.evidenceDigestSha256)
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(input.evidenceReference)) {
      throw new AppException(
        "CASH_LEDGER_CLASSIFICATION_EVIDENCE_INVALID",
        "A private evidence reference and SHA-256 digest are required",
        HttpStatus.BAD_REQUEST
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        await db.$queryRaw`SELECT "id" FROM "CashLedgerEntry" WHERE "id" = ${cashLedgerEntryId} FOR UPDATE`;
        const entry = await db.cashLedgerEntry.findUnique({
          where: { id: cashLedgerEntryId },
          include: { classificationProposals: { where: { status: "pending" }, take: 1 } }
        });
        if (!entry) {
          throw new AppException("CASH_LEDGER_ENTRY_NOT_FOUND", "Cash ledger entry not found", HttpStatus.NOT_FOUND);
        }
        if (entry.accountType !== "UNCLASSIFIED" || entry.expectedStatementDate) {
          throw new AppException(
            "CASH_LEDGER_ENTRY_ALREADY_CLASSIFIED",
            "Cash ledger entry already has an immutable approved classification",
            HttpStatus.CONFLICT
          );
        }
        if (entry.classificationProposals?.length) {
          throw new AppException(
            "CASH_LEDGER_CLASSIFICATION_ALREADY_PENDING",
            "An independent classification review is already pending",
            HttpStatus.CONFLICT
          );
        }
        const bookedDate = shanghaiIsoDate(entry.bookedAt);
        const latestReady = latestReadyWeChatBillDate(
          new Date(),
          this.config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_HOUR", 10)
        );
        if (expectedStatementDate < bookedDate || expectedStatementDate > latestReady) {
          throw new AppException(
            "CASH_LEDGER_STATEMENT_DATE_INVALID",
            "The statement date must be between the provider booking date and the latest available bill date",
            HttpStatus.BAD_REQUEST
          );
        }
        const proposal = await db.cashLedgerClassificationProposal.create({
          data: {
            id: randomUUID(),
            cashLedgerEntryId,
            accountType: input.accountType,
            expectedStatementDate: billDateDate(expectedStatementDate),
            evidenceReference: input.evidenceReference,
            evidenceDigestSha256: input.evidenceDigestSha256.toLowerCase(),
            proposedByUserId: actor.id
          }
        });
        await this.audit.record({
          actorId: actor.id,
          action: "wechat.cash_ledger_classification_proposed",
          resourceType: "cashLedgerClassificationProposal",
          resourceId: proposal.id,
          metadata: {
            cashLedgerEntryId,
            accountType: input.accountType,
            expectedStatementDate,
            evidenceReference: input.evidenceReference,
            evidenceDigestSha256: input.evidenceDigestSha256.toLowerCase()
          }
        }, db);
        return this.cashLedgerClassificationDto(proposal);
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (String((error as { code?: string })?.code ?? "") === "P2002") {
        throw new AppException(
          "CASH_LEDGER_CLASSIFICATION_ALREADY_PENDING",
          "An independent classification review is already pending",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async reviewCashLedgerClassification(actor: AuthenticatedUser, proposalId: string, input: {
    decision: "approve" | "reject";
    note: string;
  }) {
    this.assertRuntimeReady();
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      const candidate = await db.cashLedgerClassificationProposal.findUnique({ where: { id: proposalId } });
      if (!candidate) {
        throw new AppException(
          "CASH_LEDGER_CLASSIFICATION_NOT_FOUND",
          "Cash ledger classification proposal not found",
          HttpStatus.NOT_FOUND
        );
      }
      // Consistent lock order for submit/review: ledger first, proposal second.
      await db.$queryRaw`SELECT "id" FROM "CashLedgerEntry" WHERE "id" = ${candidate.cashLedgerEntryId} FOR UPDATE`;
      await db.$queryRaw`SELECT "id" FROM "CashLedgerClassificationProposal" WHERE "id" = ${proposalId} FOR UPDATE`;
      const proposal = await db.cashLedgerClassificationProposal.findUnique({ where: { id: proposalId } });
      const entry = await db.cashLedgerEntry.findUnique({ where: { id: candidate.cashLedgerEntryId } });
      if (!proposal || proposal.status !== "pending") {
        throw new AppException(
          "CASH_LEDGER_CLASSIFICATION_ALREADY_REVIEWED",
          "Cash ledger classification proposal is already reviewed",
          HttpStatus.CONFLICT
        );
      }
      if (proposal.proposedByUserId === actor.id) {
        throw new AppException(
          "CASH_LEDGER_CLASSIFICATION_SECOND_REVIEW_REQUIRED",
          "The proposer cannot review the same cash classification",
          HttpStatus.FORBIDDEN
        );
      }
      if (!entry || entry.accountType !== "UNCLASSIFIED" || entry.expectedStatementDate) {
        throw new AppException(
          "CASH_LEDGER_ENTRY_CLASSIFICATION_STATE_CHANGED",
          "The cash ledger entry classification changed after proposal",
          HttpStatus.CONFLICT
        );
      }
      const reviewedAt = new Date();
      const status = input.decision === "approve" ? "approved" : "rejected";
      const reviewed = await db.cashLedgerClassificationProposal.update({
        where: { id: proposalId },
        data: {
          status,
          reviewedByUserId: actor.id,
          reviewedAt,
          reviewNote: input.note
        }
      });
      if (status === "approved") {
        await db.cashLedgerEntry.update({
          where: { id: entry.id },
          data: {
            accountType: proposal.accountType,
            expectedStatementDate: proposal.expectedStatementDate
          }
        });
      }
      await this.audit.record({
        actorId: actor.id,
        action: status === "approved"
          ? "wechat.cash_ledger_classification_approved"
          : "wechat.cash_ledger_classification_rejected",
        resourceType: "cashLedgerClassificationProposal",
        resourceId: proposalId,
        metadata: {
          cashLedgerEntryId: proposal.cashLedgerEntryId,
          accountType: proposal.accountType,
          expectedStatementDate: isoDate(proposal.expectedStatementDate),
          evidenceReference: proposal.evidenceReference,
          evidenceDigestSha256: proposal.evidenceDigestSha256
        }
      }, db);
      return this.cashLedgerClassificationDto(reviewed);
    });
  }

  async submitMerchantBillImport(actor: AuthenticatedUser, input: {
    billDate: string;
    kind: WeChatDailyBillKind;
    content: string;
    contentSha256: string;
    evidenceReference: string;
  }) {
    this.assertHistoricalImportRuntimeReady();
    if (typeof input.content !== "string") {
      throw new AppException(
        "WECHAT_BILL_IMPORT_CONTENT_TYPE_INVALID",
        "Merchant-platform imports must use UTF-8 text/plain or text/csv content",
        HttpStatus.UNSUPPORTED_MEDIA_TYPE
      );
    }
    if (!/^[a-fA-F0-9]{64}$/.test(String(input.contentSha256 ?? ""))) {
      throw new AppException("WECHAT_BILL_IMPORT_DIGEST_INVALID", "A SHA-256 digest is required", HttpStatus.BAD_REQUEST);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(String(input.evidenceReference ?? "").trim())) {
      throw new AppException(
        "WECHAT_BILL_IMPORT_EVIDENCE_REFERENCE_INVALID",
        "A private operational evidence reference is required",
        HttpStatus.BAD_REQUEST
      );
    }
    const billDate = this.assertHistoricalImportBillDate(input.billDate, new Date());
    if (!BILL_KINDS.includes(input.kind)) {
      throw new AppException("WECHAT_BILL_KIND_INVALID", "Unsupported WeChat bill kind", HttpStatus.BAD_REQUEST);
    }
    const bytes = Buffer.from(input.content, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > WECHAT_DAILY_STATEMENT_MAX_BYTES) {
      throw new AppException(
        "WECHAT_BILL_IMPORT_SIZE_INVALID",
        "Merchant-platform bill text must be between 1 byte and 20 MiB",
        HttpStatus.BAD_REQUEST
      );
    }
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    if (contentSha256 !== input.contentSha256.toLowerCase()) {
      throw new AppException(
        "WECHAT_BILL_IMPORT_DIGEST_MISMATCH",
        "The supplied SHA-256 does not match the submitted bill bytes",
        HttpStatus.BAD_REQUEST
      );
    }
    const entries = parseWeChatDailyBill(input.kind, input.content);
    this.assertImportedEntriesBelongToDate(billDate, entries);
    const normalizedSha256 = createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex");
    const proposalId = randomUUID();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const db = tx as any;
        const run = await db.weChatBillReconciliationRun.findUnique({
          where: {
            provider_billDate_kind: {
              provider: "wechat",
              billDate: billDateDate(billDate),
              kind: input.kind
            }
          },
          select: { id: true, importedAt: true }
        });
        if (run?.importedAt) {
          throw new AppException(
            "WECHAT_BILL_ALREADY_IMPORTED",
            "This bill date and kind already has an immutable imported statement",
            HttpStatus.CONFLICT
          );
        }
        const proposal = await db.weChatBillImportProposal.create({
          data: {
            id: proposalId,
            provider: "wechat",
            source: "merchantPlatform",
            billDate: billDateDate(billDate),
            kind: input.kind,
            contentSha256,
            normalizedSha256,
            sizeBytes: bytes.byteLength,
            entryCount: entries.length,
            evidenceReference: input.evidenceReference.trim(),
            proposedByUserId: actor.id
          }
        });
        if (entries.length) {
          await db.weChatBillImportEntry.createMany({
            data: entries.map((entry) => ({
              id: randomUUID(),
              proposalId,
              ...entry
            }))
          });
        }
        await this.audit.record({
          actorId: actor.id,
          action: "wechat.merchant_bill_import_proposed",
          resourceType: "wechatBillImportProposal",
          resourceId: proposalId,
          metadata: {
            billDate,
            kind: input.kind,
            contentSha256,
            normalizedSha256,
            sizeBytes: bytes.byteLength,
            entryCount: entries.length,
            evidenceReference: input.evidenceReference.trim(),
            rawContentPersisted: false
          }
        }, db);
        return proposal;
      });
      return this.merchantImportDto(created);
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (String((error as { code?: string })?.code ?? "") === "P2002") {
        throw new AppException(
          "WECHAT_BILL_IMPORT_DUPLICATE",
          "An identical or pending import already exists for this bill date and kind",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async reviewMerchantBillImport(
    actor: AuthenticatedUser,
    proposalId: string,
    input: { decision: "approve" | "reject"; note: string }
  ) {
    this.assertHistoricalImportRuntimeReady();
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "WeChatBillImportProposal" WHERE "id" = ${proposalId} FOR UPDATE`;
      const proposal = await db.weChatBillImportProposal.findUnique({
        where: { id: proposalId },
        include: { entries: { orderBy: { lineNumber: "asc" } } }
      });
      if (!proposal) {
        throw new AppException("WECHAT_BILL_IMPORT_NOT_FOUND", "Bill import proposal not found", HttpStatus.NOT_FOUND);
      }
      if (proposal.status !== "pending") {
        throw new AppException("WECHAT_BILL_IMPORT_ALREADY_REVIEWED", "Bill import proposal is already reviewed", HttpStatus.CONFLICT);
      }
      if (proposal.proposedByUserId === actor.id) {
        throw new AppException(
          "WECHAT_BILL_IMPORT_SECOND_REVIEW_REQUIRED",
          "The importer cannot review the same merchant-platform statement",
          HttpStatus.FORBIDDEN
        );
      }
      if (proposal.entries.length !== proposal.entryCount
        || this.normalizedImportDigest(proposal.entries) !== proposal.normalizedSha256) {
        throw new AppException(
          "WECHAT_BILL_IMPORT_NORMALIZED_EVIDENCE_TAMPERED",
          "Normalized import evidence does not match its immutable digest",
          HttpStatus.CONFLICT
        );
      }
      const reviewedAt = new Date();
      if (input.decision === "reject") {
        const rejected = await db.weChatBillImportProposal.update({
          where: { id: proposalId },
          data: {
            status: "rejected",
            reviewedByUserId: actor.id,
            reviewedAt,
            reviewNote: input.note
          }
        });
        await this.audit.record({
          actorId: actor.id,
          action: "wechat.merchant_bill_import_rejected",
          resourceType: "wechatBillImportProposal",
          resourceId: proposalId,
          metadata: { contentSha256: proposal.contentSha256 }
        }, db);
        return this.merchantImportDto(rejected);
      }

      const runKey = {
        provider: "wechat",
        billDate: proposal.billDate,
        kind: proposal.kind
      };
      let run = await db.weChatBillReconciliationRun.findUnique({
        where: { provider_billDate_kind: runKey }
      });
      if (run?.importedAt || run?.importProposalId) {
        throw new AppException(
          "WECHAT_BILL_ALREADY_IMPORTED",
          "This bill date and kind already has immutable import evidence",
          HttpStatus.CONFLICT
        );
      }
      if (run) {
        await db.$queryRaw`SELECT "id" FROM "WeChatBillReconciliationRun" WHERE "id" = ${run.id} FOR UPDATE`;
        const entryCount = await db.weChatBillEntry.count({ where: { runId: run.id } });
        if (entryCount > 0) {
          throw new AppException(
            "WECHAT_BILL_RUN_HAS_UNCOMMITTED_ENTRIES",
            "The target run contains unexpected entries and cannot accept an import",
            HttpStatus.CONFLICT
          );
        }
      } else {
        run = await db.weChatBillReconciliationRun.create({
          data: {
            id: randomUUID(),
            ...runKey,
            source: "merchantPlatform",
            importProposalId: proposalId,
            status: "processing",
            nextAttemptAt: reviewedAt
          }
        });
      }
      const persistedEntries = proposal.entries.map((entry: any) => ({
        id: randomUUID(),
        runId: run.id,
        ...this.normalizedEntryFromImport(entry)
      }));
      if (persistedEntries.length) {
        await db.weChatBillEntry.createMany({ data: persistedEntries });
      }
      const issues = await this.reconcileEntries(db, run, persistedEntries, {
        actorId: actor.id,
        importProposalId: proposalId
      });
      await this.createIssues(db, run.id, issues);
      await db.weChatReconciliationIssue.updateMany({
        where: {
          runId: run.id,
          kind: "providerStatementMissingWithLocalActivity",
          status: { in: ["open", "investigating"] }
        },
        data: {
          status: "resolved",
          resolvedAt: reviewedAt,
          resolutionCode: "providerStatementRecovered",
          resolutionNote: "An independently reviewed merchant-platform statement was imported and reconciled."
        }
      });
      await db.weChatBillReconciliationRun.update({
        where: { id: run.id },
        data: {
          source: "merchantPlatform",
          importProposalId: proposalId,
          status: "reconciled",
          hashType: "SHA256",
          providerHash: proposal.contentSha256,
          contentSha256: proposal.contentSha256,
          downloadedBytes: proposal.sizeBytes,
          entryCount: persistedEntries.length,
          issueCount: issues.length,
          importedAt: reviewedAt,
          reconciledAt: reviewedAt,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: reviewedAt,
          lastErrorCode: null,
          lastErrorSummary: null
        }
      });
      const approved = await db.weChatBillImportProposal.update({
        where: { id: proposalId },
        data: {
          status: "approved",
          reviewedByUserId: actor.id,
          reviewedAt,
          reviewNote: input.note
        }
      });
      await this.audit.record({
        actorId: actor.id,
        action: "wechat.merchant_bill_import_approved_and_reconciled",
        resourceType: "wechatBillImportProposal",
        resourceId: proposalId,
        metadata: {
          runId: run.id,
          contentSha256: proposal.contentSha256,
          normalizedSha256: proposal.normalizedSha256,
          entryCount: persistedEntries.length,
          issueCount: issues.length,
          rawContentPersisted: false
        }
      }, db);
      return this.merchantImportDto({ ...approved, run: { id: run.id } });
    }, { maxWait: 5_000, timeout: 30_000 });
  }

  async listRuns(query: { page: number; pageSize: number; status?: BillRunStatus; billDate?: string }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.billDate) where.billDate = billDateDate(this.assertDateFormat(query.billDate));
    const skip = (query.page - 1) * query.pageSize;
    const db = this.prisma as any;
    const [items, total] = await Promise.all([
      db.weChatBillReconciliationRun.findMany({
        where,
        orderBy: [{ billDate: "desc" }, { kind: "asc" }],
        skip,
        take: query.pageSize
      }),
      db.weChatBillReconciliationRun.count({ where })
    ]);
    return {
      items: items.map((item: any) => this.runDto(item)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async listIssues(actor: AuthenticatedUser, query: {
    page: number;
    pageSize: number;
    status?: IssueStatus;
    kind?: string;
    runId?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;
    if (query.runId) where.runId = query.runId;
    const skip = (query.page - 1) * query.pageSize;
    const db = this.prisma as any;
    const [items, total] = await Promise.all([
      db.weChatReconciliationIssue.findMany({
        where,
        include: {
          run: { select: { billDate: true, kind: true } },
          resolutionProposals: { orderBy: { proposedAt: "desc" }, take: 1 }
        },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip,
        take: query.pageSize
      }),
      db.weChatReconciliationIssue.count({ where })
    ]);
    return {
      items: items.map((item: any) => this.issueDto(item, actor)),
      pagination: this.pagination(query.page, query.pageSize, total)
    };
  }

  async claimIssue(actor: AuthenticatedUser, issueId: string) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "WeChatReconciliationIssue" WHERE "id" = ${issueId} FOR UPDATE`;
      const issue = await db.weChatReconciliationIssue.findUnique({
        where: { id: issueId },
        include: {
          run: { select: { billDate: true, kind: true } },
          resolutionProposals: { orderBy: { proposedAt: "desc" }, take: 1 }
        }
      });
      if (!issue) throw new AppException("WECHAT_RECONCILIATION_ISSUE_NOT_FOUND", "Issue not found", HttpStatus.NOT_FOUND);
      if (["resolved", "acceptedException"].includes(issue.status)) {
        throw new AppException("WECHAT_RECONCILIATION_ISSUE_CLOSED", "Closed issues cannot be claimed", HttpStatus.CONFLICT);
      }
      if (issue.assignedToUserId && issue.assignedToUserId !== actor.id) {
        throw new AppException("WECHAT_RECONCILIATION_ISSUE_ALREADY_ASSIGNED", "Issue is assigned", HttpStatus.CONFLICT);
      }
      if (issue.status === "investigating" && issue.assignedToUserId === actor.id) {
        return this.issueDto(issue, actor);
      }
      const updated = await db.weChatReconciliationIssue.update({
        where: { id: issueId },
        data: {
          status: "investigating",
          assignedToUserId: actor.id,
          assignedAt: issue.assignedAt ?? new Date()
        },
        include: {
          run: { select: { billDate: true, kind: true } },
          resolutionProposals: { orderBy: { proposedAt: "desc" }, take: 1 }
        }
      });
      await this.audit.record({
        actorId: actor.id,
        action: "wechat.reconciliation_issue_claimed",
        resourceType: "wechatReconciliationIssue",
        resourceId: issueId
      }, db);
      return this.issueDto(updated, actor);
    });
  }

  async submitResolutionProposal(
    actor: AuthenticatedUser,
    issueId: string,
    input: {
      outcome: "resolved" | "acceptedException";
      resolutionCode: string;
      note: string;
      evidenceReference: string;
      evidenceDigestSha256: string;
    }
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "WeChatReconciliationIssue" WHERE "id" = ${issueId} FOR UPDATE`;
      const issue = await db.weChatReconciliationIssue.findUnique({
        where: { id: issueId },
        include: { resolutionProposals: { where: { status: "pending" }, take: 1 } }
      });
      if (!issue) throw new AppException("WECHAT_RECONCILIATION_ISSUE_NOT_FOUND", "Issue not found", HttpStatus.NOT_FOUND);
      if (["resolved", "acceptedException"].includes(issue.status)) {
        throw new AppException("WECHAT_RECONCILIATION_ISSUE_CLOSED", "Closed issues cannot receive proposals", HttpStatus.CONFLICT);
      }
      if (issue.status !== "investigating" || issue.assignedToUserId !== actor.id) {
        throw new AppException(
          "WECHAT_RECONCILIATION_ISSUE_NOT_ASSIGNED",
          "Only the current assignee may submit a resolution proposal",
          HttpStatus.FORBIDDEN
        );
      }
      if (issue.resolutionProposals?.length) {
        throw new AppException(
          "WECHAT_RECONCILIATION_RESOLUTION_ALREADY_PENDING",
          "An independent review is already pending",
          HttpStatus.CONFLICT
        );
      }
      const proposal = await db.weChatReconciliationResolutionProposal.create({
        data: {
          id: randomUUID(),
          issueId,
          outcome: input.outcome,
          resolutionCode: input.resolutionCode,
          resolutionNote: input.note,
          evidenceReference: input.evidenceReference,
          evidenceDigestSha256: input.evidenceDigestSha256.toLowerCase(),
          proposedByUserId: actor.id
        }
      });
      await this.audit.record({
        actorId: actor.id,
        action: "wechat.reconciliation_resolution_proposed",
        resourceType: "wechatReconciliationResolutionProposal",
        resourceId: proposal.id,
        metadata: {
          issueId,
          outcome: input.outcome,
          resolutionCode: input.resolutionCode,
          evidenceReference: input.evidenceReference,
          evidenceDigestSha256: input.evidenceDigestSha256.toLowerCase()
        }
      }, db);
      const updated = await db.weChatReconciliationIssue.findUnique({
        where: { id: issueId },
        include: {
          run: { select: { billDate: true, kind: true } },
          resolutionProposals: { orderBy: { proposedAt: "desc" }, take: 1 }
        }
      });
      return this.issueDto(updated, actor);
    });
  }

  async reviewResolutionProposal(
    actor: AuthenticatedUser,
    issueId: string,
    input: { decision: "approve" | "reject"; note: string }
  ) {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "WeChatReconciliationIssue" WHERE "id" = ${issueId} FOR UPDATE`;
      const issue = await db.weChatReconciliationIssue.findUnique({
        where: { id: issueId },
        include: {
          resolutionProposals: {
            where: { status: "pending" },
            orderBy: { proposedAt: "asc" },
            take: 1
          }
        }
      });
      if (!issue) throw new AppException("WECHAT_RECONCILIATION_ISSUE_NOT_FOUND", "Issue not found", HttpStatus.NOT_FOUND);
      const proposal = issue.resolutionProposals?.[0];
      if (!proposal) {
        throw new AppException(
          "WECHAT_RECONCILIATION_RESOLUTION_NOT_PENDING",
          "No resolution proposal is awaiting independent review",
          HttpStatus.CONFLICT
        );
      }
      if (proposal.proposedByUserId === actor.id) {
        throw new AppException(
          "WECHAT_RECONCILIATION_SECOND_REVIEW_REQUIRED",
          "The resolution proposer cannot review the same financial discrepancy",
          HttpStatus.FORBIDDEN
        );
      }
      if (input.decision === "approve" && proposal.outcome === "acceptedException" && actor.role !== "admin") {
        throw new AppException(
          "WECHAT_RECONCILIATION_ADMIN_EXCEPTION_APPROVAL_REQUIRED",
          "Only an administrator may independently approve an accepted financial exception",
          HttpStatus.FORBIDDEN
        );
      }
      if (input.decision === "approve" && issue.status !== "investigating") {
        throw new AppException(
          "WECHAT_RECONCILIATION_ISSUE_STATE_CHANGED",
          "The issue changed after evidence was proposed; the stale proposal may only be rejected",
          HttpStatus.CONFLICT
        );
      }
      const reviewedAt = new Date();
      await db.weChatReconciliationResolutionProposal.update({
        where: { id: proposal.id },
        data: {
          status: input.decision === "approve" ? "approved" : "rejected",
          reviewedByUserId: actor.id,
          reviewedAt,
          reviewNote: input.note
        }
      });
      if (input.decision === "approve") {
        await db.weChatReconciliationIssue.update({
          where: { id: issueId },
          data: {
            status: proposal.outcome,
            resolvedByUserId: actor.id,
            resolvedAt: reviewedAt,
            resolutionCode: proposal.resolutionCode,
            resolutionNote: proposal.resolutionNote
          }
        });
      }
      await this.audit.record({
        actorId: actor.id,
        action: input.decision === "approve"
          ? "wechat.reconciliation_resolution_approved"
          : "wechat.reconciliation_resolution_rejected",
        resourceType: "wechatReconciliationResolutionProposal",
        resourceId: proposal.id,
        metadata: { issueId, outcome: proposal.outcome, resolutionCode: proposal.resolutionCode }
      }, db);
      const updated = await db.weChatReconciliationIssue.findUnique({
        where: { id: issueId },
        include: {
          run: { select: { billDate: true, kind: true } },
          resolutionProposals: { orderBy: { proposedAt: "desc" }, take: 1 }
        }
      });
      return this.issueDto(updated, actor);
    });
  }

  async releaseGate(now = new Date()) {
    return evaluateWeChatReconciliationGate(this.prisma as any, this.config, now);
  }

  private async claimNextRun(now: Date): Promise<any | null> {
    const db = this.prisma as any;
    const candidate = await db.weChatBillReconciliationRun.findFirst({
      where: {
        nextAttemptAt: { lte: now },
        importedAt: null,
        OR: [
          { status: { in: ["pending", "failed"] } },
          { status: "processing", leaseExpiresAt: { lte: now } }
        ]
      },
      orderBy: [{ billDate: "asc" }, { kind: "asc" }, { createdAt: "asc" }]
    });
    if (!candidate) return null;
    const leaseToken = randomUUID();
    const claimed = await db.weChatBillReconciliationRun.updateMany({
      where: {
        id: candidate.id,
        nextAttemptAt: { lte: now },
        importedAt: null,
        OR: [
          { status: { in: ["pending", "failed"] } },
          { status: "processing", leaseExpiresAt: { lte: now } }
        ]
      },
      data: {
        status: "processing",
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        requestedAt: now,
        attemptCount: { increment: 1 },
        lastErrorCode: null,
        lastErrorSummary: null
      }
    });
    return claimed.count === 1 ? { ...candidate, leaseToken } : null;
  }

  private async processClaimedRun(run: any): Promise<"reconciled" | "noStatement" | "failed"> {
    try {
      const statement = await (this.provider as WeChatPayProvider & {
        downloadDailyStatement(input: { billDate: string; kind: WeChatDailyBillKind }): Promise<DownloadedStatement | NoStatement>;
      }).downloadDailyStatement({ billDate: isoDate(run.billDate), kind: run.kind });
      if (statement.status === "noStatement") {
        await this.finalizeNoStatement(run);
        return "noStatement";
      }
      const entries = parseWeChatDailyBill(run.kind, statement.text);
      await this.importAndReconcile(run, statement, entries);
      return "reconciled";
    } catch (error) {
      await this.recordFailure(run, error);
      return "failed";
    }
  }

  private async finalizeNoStatement(run: any) {
    const now = new Date();
    const { start, end } = shanghaiDayRange(isoDate(run.billDate));
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "WeChatBillReconciliationRun" WHERE "id" = ${run.id} FOR UPDATE`;
      const current = await db.weChatBillReconciliationRun.findUnique({ where: { id: run.id } });
      if (!current || current.leaseToken !== run.leaseToken || current.importedAt) {
        throw new AppException("WECHAT_BILL_LEASE_LOST", "Bill processing lease was lost", HttpStatus.CONFLICT);
      }
      const localActivity = await this.localActivityCount(
        db, run.kind, isoDate(run.billDate), start, end
      );
      const issues: IssueCandidate[] = localActivity > 0 ? [{
        source: `${run.kind}:no-statement`,
        kind: "providerStatementMissingWithLocalActivity",
        severity: "critical",
        expectedCents: localActivity,
        detailCode: "WECHAT_BILL_NO_STATEMENT_WITH_LOCAL_ACTIVITY"
      }] : [];
      await this.createIssues(db, run.id, issues);
      await db.weChatBillReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: "noStatement",
          issueCount: issues.length,
          reconciledAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: now
        }
      });
      await this.audit.record({
        actorId: null,
        action: "wechat.bill_no_statement_reconciled",
        resourceType: "wechatBillReconciliationRun",
        resourceId: run.id,
        metadata: { billDate: isoDate(run.billDate), kind: run.kind, localActivity, issueCount: issues.length }
      }, db);
    });
  }

  private async importAndReconcile(
    run: any,
    statement: DownloadedStatement,
    entries: NormalizedWeChatBillEntry[]
  ) {
    const now = new Date();
    const persistedEntries = entries.map((entry) => ({ id: randomUUID(), runId: run.id, ...entry }));
    await this.prisma.$transaction(async (tx) => {
      const db = tx as any;
      await db.$queryRaw`SELECT "id" FROM "WeChatBillReconciliationRun" WHERE "id" = ${run.id} FOR UPDATE`;
      const current = await db.weChatBillReconciliationRun.findUnique({ where: { id: run.id } });
      if (!current || current.leaseToken !== run.leaseToken || current.importedAt) {
        throw new AppException("WECHAT_BILL_LEASE_LOST", "Bill processing lease was lost", HttpStatus.CONFLICT);
      }
      if (persistedEntries.length > 0) {
        await db.weChatBillEntry.createMany({ data: persistedEntries });
      }
      const issues = await this.reconcileEntries(db, run, persistedEntries);
      await this.createIssues(db, run.id, issues);
      const recoveredNoStatementIssues = await db.weChatReconciliationIssue.updateMany({
        where: {
          runId: run.id,
          kind: "providerStatementMissingWithLocalActivity",
          status: { in: ["open", "investigating"] }
        },
        data: {
          status: "resolved",
          resolvedAt: now,
          resolutionCode: "providerStatementRecovered",
          resolutionNote: "A verified provider statement became available and was reconciled."
        }
      });
      await db.weChatBillReconciliationRun.update({
        where: { id: run.id },
        data: {
          status: "reconciled",
          hashType: "SHA1",
          providerHash: statement.sha1,
          contentSha256: statement.sha256,
          downloadedBytes: statement.sizeBytes,
          entryCount: persistedEntries.length,
          issueCount: issues.length,
          downloadedAt: now,
          importedAt: now,
          reconciledAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: now
        }
      });
      await this.audit.record({
        actorId: null,
        action: "wechat.bill_imported_and_reconciled",
        resourceType: "wechatBillReconciliationRun",
        resourceId: run.id,
        metadata: {
          billDate: isoDate(run.billDate),
          kind: run.kind,
          entryCount: persistedEntries.length,
          issueCount: issues.length,
          recoveredNoStatementIssues: Number(recoveredNoStatementIssues?.count ?? 0),
          contentSha256: statement.sha256
        }
      }, db);
    }, { maxWait: 5_000, timeout: 20_000 });
  }

  private async reconcileEntries(
    db: any,
    run: any,
    entries: Array<NormalizedWeChatBillEntry & { id: string }>,
    approvedRepair?: { actorId: string; importProposalId: string }
  ) {
    const issues: IssueCandidate[] = [];
    const tradeEntries = entries.filter((entry) => entry.entryType === "trade");
    const outTradeNos = unique(tradeEntries.map((entry) => entry.outTradeNo));
    const outRefundNos = unique(tradeEntries.map((entry) => entry.outRefundNo));
    const payments = outTradeNos.length > 0
      ? await db.paymentTransaction.findMany({ where: { outTradeNo: { in: outTradeNos } } })
      : [];
    const refunds = outRefundNos.length > 0
      ? await db.refundTransaction.findMany({ where: { outRefundNo: { in: outRefundNos } } })
      : [];
    const paymentByTrade = new Map(payments.map((item: any) => [item.outTradeNo, item]));
    const refundByNo = new Map(refunds.map((item: any) => [item.outRefundNo, item]));

    for (const entry of tradeEntries) {
      const tradeState = normalizedProviderState(entry.tradeState);
      if (entry.outTradeNo) {
        const payment: any = paymentByTrade.get(entry.outTradeNo);
        if (!payment) {
          issues.push(this.issue(entry, "providerPaymentMissingLocally", "critical", entry.outTradeNo,
            "WECHAT_PROVIDER_PAYMENT_NOT_LOCAL"));
        } else {
          // Official REFUND/REVOKED rows carry order amount 0. They evidence a
          // refund application, not a second payment event, so only SUCCESS
          // rows compare the original payment amount and settlement state.
          if (tradeState === "SUCCESS"
            && entry.amountCents !== null
            && payment.amountCents !== entry.amountCents) {
            issues.push(this.issue(entry, "paymentAmountMismatch", "critical", entry.outTradeNo,
              "WECHAT_PAYMENT_AMOUNT_MISMATCH", "paymentTransaction", payment.id, payment.amountCents, entry.amountCents));
          }
          if (entry.transactionId && payment.transactionId && payment.transactionId !== entry.transactionId) {
            issues.push(this.issue(entry, "paymentTransactionIdMismatch", "critical", entry.outTradeNo,
              "WECHAT_PAYMENT_TRANSACTION_ID_MISMATCH", "paymentTransaction", payment.id));
          }
          if (tradeState === "SUCCESS" && payment.status !== "success") {
            issues.push(this.issue(entry, "providerPaidLocalUnsettled", "critical", entry.outTradeNo,
              "WECHAT_PROVIDER_PAID_LOCAL_UNSETTLED", "paymentTransaction", payment.id));
          }
          if (tradeState === "SUCCESS" && payment.status === "success" && !isProviderPaidState(entry.tradeState)) {
            issues.push(this.issue(entry, "localPaymentSuccessProviderNotPaid", "critical", entry.outTradeNo,
              "WECHAT_LOCAL_PAYMENT_SUCCESS_PROVIDER_NOT_PAID", "paymentTransaction", payment.id));
          }
        }
      }
      if (entry.outRefundNo) {
        const refund: any = refundByNo.get(entry.outRefundNo);
        if (!refund) {
          issues.push(this.issue(entry, "providerRefundMissingLocally", "critical", entry.outRefundNo,
            "WECHAT_PROVIDER_REFUND_NOT_LOCAL"));
        } else {
          if (entry.refundAmountCents !== null && refund.amountCents !== entry.refundAmountCents) {
            issues.push(this.issue(entry, "refundAmountMismatch", "critical", entry.outRefundNo,
              "WECHAT_REFUND_AMOUNT_MISMATCH", "refundTransaction", refund.id,
              refund.amountCents, entry.refundAmountCents));
          }
          if (entry.providerRefundId && refund.providerRefundId && refund.providerRefundId !== entry.providerRefundId) {
            issues.push(this.issue(entry, "refundProviderIdMismatch", "critical", entry.outRefundNo,
              "WECHAT_REFUND_PROVIDER_ID_MISMATCH", "refundTransaction", refund.id));
          }
          if (entry.providerRefundId && !refund.providerRefundId) {
            issues.push(this.issue(entry, "refundProviderIdMissingLocally", "critical", entry.outRefundNo,
              "WECHAT_REFUND_PROVIDER_ID_MISSING_LOCALLY", "refundTransaction", refund.id));
          }
          if (isProviderRefundSuccess(entry.refundState) && refund.status !== "success") {
            issues.push(this.issue(entry, "providerRefundedLocalUnsettled", "critical", entry.outRefundNo,
              "WECHAT_PROVIDER_REFUNDED_LOCAL_UNSETTLED", "refundTransaction", refund.id));
          }
          // The trade bill is a generated daily snapshot. A refund that
          // succeeds after that snapshot is not back-written by WeChat, so a
          // non-success snapshot can never disprove a later local success.
          const acceptedConflict = refund.providerRefundAcceptedAt
            && entry.providerRefundAcceptedAt
            && refund.providerRefundAcceptedAt.getTime() !== entry.providerRefundAcceptedAt.getTime();
          const succeededConflict = refund.providerRefundSucceededAt
            && entry.providerRefundSucceededAt
            && refund.providerRefundSucceededAt.getTime() !== entry.providerRefundSucceededAt.getTime();
          if (acceptedConflict || succeededConflict) {
            issues.push(this.issue(entry, "refundProviderTimeMismatch", "critical", entry.outRefundNo,
              "WECHAT_REFUND_PROVIDER_TIME_MISMATCH", "refundTransaction", refund.id));
          } else if (approvedRepair
            && refund.status === "success"
            && isProviderRefundSuccess(entry.refundState)
            && entry.refundAmountCents === refund.amountCents
            && Boolean(entry.providerRefundId)
            && entry.providerRefundId === refund.providerRefundId
            && entry.providerRefundAcceptedAt
            && entry.providerRefundSucceededAt
            && (!refund.providerRefundAcceptedAt || !refund.providerRefundSucceededAt)) {
            await this.repairApprovedRefundTimes(db, refund, entry, approvedRepair);
          }
        }
      }
    }

    if (run.kind === "tradeAll") {
      const { start, end } = shanghaiDayRange(isoDate(run.billDate));
      const localPayments = await db.paymentTransaction.findMany({
        where: { provider: "wechat", status: "success", providerPaidAt: { gte: start, lt: end } },
        select: { id: true, outTradeNo: true, amountCents: true }
      });
      const seenPayments = new Set(unique(
        tradeEntries.filter((entry) => normalizedProviderState(entry.tradeState) === "SUCCESS")
          .map((entry) => entry.outTradeNo)
      ));
      for (const payment of localPayments) {
        if (!seenPayments.has(payment.outTradeNo)) {
          issues.push({
            source: `local-payment:${payment.id}`,
            kind: "localPaymentMissingProviderBill",
            severity: "critical",
            localResourceType: "paymentTransaction",
            localResourceId: payment.id,
            providerReference: payment.outTradeNo,
            expectedCents: payment.amountCents,
            detailCode: "WECHAT_LOCAL_PAYMENT_NOT_IN_PROVIDER_BILL"
          });
        }
      }
      const localRefunds = await db.refundTransaction.findMany({
        where: {
          payment: { provider: "wechat" },
          status: "success",
          // Only same-day acceptance + success can be asserted against this
          // acceptance-day snapshot. Cross-day success belongs to provider
          // query/cash-ledger evidence and the old snapshot is not rewritten.
          providerRefundAcceptedAt: { gte: start, lt: end },
          providerRefundSucceededAt: { gte: start, lt: end }
        },
        select: { id: true, outRefundNo: true, amountCents: true }
      });
      const seenRefunds = new Set(unique(tradeEntries
        .filter((entry) => isProviderRefundSuccess(entry.refundState))
        .map((entry) => entry.outRefundNo)));
      for (const refund of localRefunds) {
        if (!seenRefunds.has(refund.outRefundNo)) {
          issues.push({
            source: `local-refund:${refund.id}`,
            kind: "localRefundMissingProviderBill",
            severity: "high",
            localResourceType: "refundTransaction",
            localResourceId: refund.id,
            providerReference: refund.outRefundNo,
            expectedCents: refund.amountCents,
            detailCode: "WECHAT_LOCAL_REFUND_NOT_IN_PROVIDER_BILL"
          });
        }
      }
    }

    const fundEntries = entries.filter((entry) => entry.entryType === "fund" && entry.businessReference);
    if (run.kind !== "tradeAll") {
      const references = unique(fundEntries.map((entry) => entry.businessReference));
      const accountType = fundAccountType(run.kind);
      const localEntries = references.length
        ? await db.cashLedgerEntry.findMany({
            where: { provider: "wechat", providerReference: { in: references } }
          })
        : [];
      const ledgerByReference = new Map<string, any[]>();
      for (const local of localEntries) {
        const bucket = ledgerByReference.get(local.providerReference) ?? [];
        bucket.push(local);
        ledgerByReference.set(local.providerReference, bucket);
      }
      for (const entry of fundEntries) {
        const reference = entry.businessReference!;
        const candidates = ledgerByReference.get(reference) ?? [];
        const businessClass = classifyFundBusiness(entry.businessName, entry.businessType);
        if (!candidates.length) {
          issues.push(this.issue(entry, "providerFundReferenceMissingLocally", "high", entry.businessReference!,
            "WECHAT_PROVIDER_FUND_REFERENCE_NOT_LOCAL"));
          continue;
        }
        if (businessClass === "unknown") {
          issues.push(this.issue(
            entry,
            "providerFundBusinessTypeUnreviewed",
            "critical",
            reference,
            "WECHAT_PROVIDER_FUND_BUSINESS_TYPE_UNREVIEWED",
            "cashLedgerEntry",
            candidates[0].id
          ));
          continue;
        }
        const accountCandidates = candidates.filter((candidate) => candidate.accountType === accountType);
        if (!accountCandidates.length) {
          issues.push(this.issue(entry, "providerFundAccountMismatch", "critical", reference,
            "WECHAT_PROVIDER_FUND_ACCOUNT_MISMATCH", "cashLedgerEntry", candidates[0].id));
          continue;
        }
        const local = accountCandidates.find((candidate) =>
          classifyCashLedgerBusiness(candidate.businessType) === businessClass
        );
        if (!local) {
          issues.push(this.issue(
            entry,
            "providerFundBusinessBindingMismatch",
            "critical",
            reference,
            "WECHAT_PROVIDER_FUND_BUSINESS_BINDING_MISMATCH",
            "cashLedgerEntry",
            accountCandidates[0].id
          ));
          continue;
        }
        if (entry.accountType !== accountType || entry.fundDirection !== local.direction) {
          issues.push(this.issue(entry, "providerFundDirectionMismatch", "critical", reference,
            "WECHAT_PROVIDER_FUND_DIRECTION_MISMATCH", "cashLedgerEntry", local.id));
        }
        if (entry.fundAmountCents !== local.netCents) {
          issues.push(this.issue(entry, "providerFundAmountMismatch", "critical", reference,
            "WECHAT_PROVIDER_FUND_AMOUNT_MISMATCH", "cashLedgerEntry",
            local.id, local.netCents, entry.fundAmountCents ?? undefined));
        }
      }
      const expectedLedger = await db.cashLedgerEntry.findMany({
        where: {
          provider: "wechat",
          accountType,
          expectedStatementDate: run.billDate
        }
      });
      const seenReferences = new Set(references);
      for (const local of expectedLedger) {
        if (!seenReferences.has(local.providerReference)) {
          issues.push({
            source: `local-cash-ledger:${local.id}`,
            kind: "localCashLedgerMissingProviderFundBill",
            severity: "critical",
            localResourceType: "cashLedgerEntry",
            localResourceId: local.id,
            providerReference: local.providerReference,
            expectedCents: local.netCents,
            detailCode: "WECHAT_LOCAL_CASH_LEDGER_NOT_IN_PROVIDER_FUND_BILL"
          });
        }
      }
    }
    return issues;
  }

  private async repairApprovedRefundTimes(
    db: any,
    refund: any,
    entry: NormalizedWeChatBillEntry & { id: string },
    context: { actorId: string; importProposalId: string }
  ) {
    const data = {
      ...(!refund.providerRefundAcceptedAt
        ? { providerRefundAcceptedAt: entry.providerRefundAcceptedAt }
        : {}),
      ...(!refund.providerRefundSucceededAt
        ? { providerRefundSucceededAt: entry.providerRefundSucceededAt }
        : {})
    };
    const requiredNulls = [
      ...(!refund.providerRefundAcceptedAt ? [{ providerRefundAcceptedAt: null }] : []),
      ...(!refund.providerRefundSucceededAt ? [{ providerRefundSucceededAt: null }] : [])
    ];
    const updated = await db.refundTransaction.updateMany({
      where: {
        id: refund.id,
        status: "success",
        amountCents: refund.amountCents,
        providerRefundId: entry.providerRefundId,
        ...(requiredNulls.length ? { AND: requiredNulls } : {})
      },
      data
    });
    const repaired = Number(updated?.count ?? 0) === 1;
    if (!repaired) {
      const current = await db.refundTransaction.findUnique({ where: { id: refund.id } });
      const exact = current
        && current.status === "success"
        && current.amountCents === refund.amountCents
        && current.providerRefundId === entry.providerRefundId
        && sameInstant(current.providerRefundAcceptedAt, entry.providerRefundAcceptedAt)
        && sameInstant(current.providerRefundSucceededAt, entry.providerRefundSucceededAt);
      if (!exact) {
        throw new AppException(
          "WECHAT_REFUND_PROVIDER_TIME_REPAIR_CONFLICT",
          "Refund facts changed while approved statement evidence was being applied",
          HttpStatus.CONFLICT
        );
      }
    }
    await db.cashLedgerEntry.createMany({
      data: [{
        id: randomUUID(),
        provider: "wechat",
        accountType: "UNCLASSIFIED",
        bookedAt: entry.providerRefundSucceededAt!,
        expectedStatementDate: null,
        businessName: "退款支出",
        businessType: "REFUND",
        direction: "支出",
        grossCents: refund.amountCents,
        feeCents: 0,
        netCents: refund.amountCents,
        providerReference: entry.providerRefundId!,
        sourceResourceType: "refundTransaction",
        sourceResourceId: refund.id,
        evidenceReference: `wechat-import:${context.importProposalId}:${entry.rowDigest}`
      }],
      skipDuplicates: true
    });
    if (!repaired) return;
    await this.audit.record({
      actorId: context.actorId,
      action: "wechat.refund_provider_times_repaired_from_approved_bill",
      resourceType: "refundTransaction",
      resourceId: refund.id,
      metadata: {
        importProposalId: context.importProposalId,
        billEntryId: entry.id,
        outRefundNo: entry.outRefundNo,
        providerRefundId: entry.providerRefundId,
        providerRefundAcceptedAt: entry.providerRefundAcceptedAt?.toISOString() ?? null,
        providerRefundSucceededAt: entry.providerRefundSucceededAt?.toISOString() ?? null,
        overwrittenExistingFacts: false
      }
    }, db);
  }

  private issue(
    entry: NormalizedWeChatBillEntry & { id: string },
    kind: string,
    severity: "critical" | "high" | "medium",
    providerReference: string,
    detailCode: string,
    localResourceType?: string,
    localResourceId?: string,
    expectedCents?: number,
    actualCents?: number
  ): IssueCandidate {
    return {
      entryId: entry.id,
      source: `entry:${entry.lineNumber}:${kind}`,
      kind,
      severity,
      providerReference,
      detailCode,
      localResourceType,
      localResourceId,
      expectedCents,
      actualCents
    };
  }

  private async createIssues(db: any, runId: string, issues: IssueCandidate[]) {
    if (issues.length === 0) return;
    await db.weChatReconciliationIssue.createMany({
      data: issues.map((issue) => ({
        id: randomUUID(),
        runId,
        entryId: issue.entryId,
        fingerprint: createHash("sha256").update(`${runId}:${issue.source}`).digest("hex"),
        kind: issue.kind,
        severity: issue.severity ?? "high",
        localResourceType: issue.localResourceType,
        localResourceId: issue.localResourceId,
        providerReference: issue.providerReference,
        expectedCents: issue.expectedCents,
        actualCents: issue.actualCents,
        detailCode: issue.detailCode
      })),
      skipDuplicates: true
    });
  }

  private async recordFailure(run: any, error: unknown) {
    const attempt = Number(run.attemptCount ?? 0) + 1;
    const backoffMinutes = Math.min(24 * 60, 5 * (2 ** Math.min(8, attempt - 1)));
    const code = error instanceof AppException ? error.code : "WECHAT_BILL_RECONCILIATION_FAILED";
    const summary = error instanceof Error ? error.name : "unknown_error";
    await (this.prisma as any).weChatBillReconciliationRun.updateMany({
      where: { id: run.id, leaseToken: run.leaseToken, importedAt: null },
      data: {
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + backoffMinutes * 60_000),
        lastErrorCode: String(code).slice(0, 96),
        lastErrorSummary: summary.slice(0, 160)
      }
    });
  }

  private async localActivityCount(
    db: any,
    kind: WeChatDailyBillKind,
    billDate: string,
    start: Date,
    end: Date
  ) {
    if (kind !== "tradeAll") {
      return Number(await db.cashLedgerEntry.count({
        where: {
          provider: "wechat",
          accountType: fundAccountType(kind),
          expectedStatementDate: billDateDate(billDate)
        }
      }));
    }
    const [payments, refunds] = await Promise.all([
      db.paymentTransaction.count({
        where: { provider: "wechat", status: "success", providerPaidAt: { gte: start, lt: end } }
      }),
      db.refundTransaction.count({
        where: {
          payment: { provider: "wechat" },
          status: { in: ["pending", "processing", "success", "failed"] },
          providerRefundAcceptedAt: { gte: start, lt: end }
        }
      })
    ]);
    return Number(payments) + Number(refunds);
  }

  private assertRuntimeReady(now = new Date()) {
    if (!this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false)) {
      throw new AppException(
        "WECHAT_DAILY_BILL_RECONCILIATION_DISABLED",
        "Daily WeChat bill reconciliation is disabled",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const approved = this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVED", false);
    const reference = this.config.get<string>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE", "").trim();
    if (!approved || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(reference)) {
      throw new AppException(
        "WECHAT_DAILY_BILL_RECONCILIATION_NOT_APPROVED",
        "Daily WeChat bill reconciliation lacks an approved operational evidence reference",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    if (this.provider.mode === "disabled") {
      throw new AppException(
        "WECHAT_PAY_NOT_CONFIGURED",
        "WeChat Pay is not configured for daily bill reconciliation",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    try {
      configuredWeChatReconciliationWindow(this.config, now);
    } catch (error) {
      throw new AppException(
        "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE_INVALID",
        error instanceof Error ? error.message : "Daily reconciliation start date is invalid",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private assertHistoricalImportRuntimeReady(now = new Date()) {
    if (!this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false)) {
      throw new AppException(
        "WECHAT_DAILY_BILL_RECONCILIATION_DISABLED",
        "Daily WeChat bill reconciliation is disabled",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    const approved = this.config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVED", false);
    const reference = this.config.get<string>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE", "").trim();
    if (!approved || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(reference)) {
      throw new AppException(
        "WECHAT_DAILY_BILL_RECONCILIATION_NOT_APPROVED",
        "Daily WeChat bill reconciliation lacks an approved operational evidence reference",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    try {
      configuredWeChatReconciliationWindow(this.config, now);
    } catch (error) {
      throw new AppException(
        "WECHAT_DAILY_BILL_RECONCILIATION_START_DATE_INVALID",
        error instanceof Error ? error.message : "Daily reconciliation start date is invalid",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private assertHistoricalImportBillDate(value: string, now: Date) {
    const billDate = this.assertDateFormat(value);
    const latestReady = latestReadyWeChatBillDate(
      now,
      this.config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_HOUR", 10)
    );
    if (billDate > latestReady) {
      throw new AppException("WECHAT_BILL_DATE_NOT_READY", "The bill date is not yet available", HttpStatus.BAD_REQUEST);
    }
    const oldestApiDate = isoDate(
      new Date(billDateDate(latestReady).getTime() - (MAX_LOOKBACK_DAYS - 1) * 24 * 60 * 60_000)
    );
    if (billDate >= oldestApiDate) {
      throw new AppException(
        "WECHAT_BILL_IMPORT_NOT_HISTORICAL",
        "Use the signed WeChat API flow for dates still inside its 90-day window",
        HttpStatus.CONFLICT
      );
    }
    const configuredStart = configuredWeChatReconciliationWindow(this.config, now).configuredStartDate;
    if (billDate < configuredStart) {
      throw new AppException(
        "WECHAT_BILL_DATE_BEFORE_CONFIGURED_START",
        "Bill date precedes the approved reconciliation coverage start date",
        HttpStatus.BAD_REQUEST
      );
    }
    const latestDate = billDateDate(latestReady);
    const oldestMerchantDate = new Date(latestDate);
    oldestMerchantDate.setUTCFullYear(
      oldestMerchantDate.getUTCFullYear() - MERCHANT_PLATFORM_HISTORY_YEARS
    );
    if (billDate < isoDate(oldestMerchantDate)) {
      throw new AppException(
        "WECHAT_BILL_IMPORT_BEYOND_MERCHANT_HISTORY",
        "The merchant platform import is limited to its five-year statement history",
        HttpStatus.BAD_REQUEST
      );
    }
    return billDate;
  }

  private assertImportedEntriesBelongToDate(
    billDate: string,
    entries: NormalizedWeChatBillEntry[]
  ) {
    const invalid = entries.find((entry) => !entry.providerOccurredAt
      || shanghaiIsoDate(entry.providerOccurredAt) !== billDate);
    if (invalid) {
      throw new AppException(
        "WECHAT_BILL_IMPORT_DATE_MISMATCH",
        "A normalized provider row does not belong to the declared Shanghai bill date",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private normalizedEntryFromImport(entry: any): NormalizedWeChatBillEntry {
    return {
      lineNumber: Number(entry.lineNumber),
      entryType: entry.entryType,
      providerOccurredAt: entry.providerOccurredAt ?? null,
      providerRefundAcceptedAt: entry.providerRefundAcceptedAt ?? null,
      providerRefundSucceededAt: entry.providerRefundSucceededAt ?? null,
      outTradeNo: entry.outTradeNo ?? null,
      transactionId: entry.transactionId ?? null,
      outRefundNo: entry.outRefundNo ?? null,
      providerRefundId: entry.providerRefundId ?? null,
      businessReference: entry.businessReference ?? null,
      businessName: entry.businessName ?? null,
      businessType: entry.businessType ?? null,
      tradeState: entry.tradeState ?? null,
      refundState: entry.refundState ?? null,
      amountCents: entry.amountCents ?? null,
      refundAmountCents: entry.refundAmountCents ?? null,
      feeCents: entry.feeCents ?? null,
      fundDirection: entry.fundDirection ?? null,
      fundAmountCents: entry.fundAmountCents ?? null,
      accountType: entry.accountType ?? null,
      rowDigest: entry.rowDigest
    };
  }

  private normalizedImportDigest(entries: any[]) {
    return createHash("sha256")
      .update(JSON.stringify(entries.map((entry) => this.normalizedEntryFromImport(entry))))
      .digest("hex");
  }

  private merchantImportDto(item: any) {
    return {
      id: item.id,
      source: "merchantPlatform" as const,
      billDate: isoDate(item.billDate),
      kind: item.kind,
      status: item.status,
      contentSha256: item.contentSha256,
      normalizedSha256: item.normalizedSha256,
      sizeBytes: item.sizeBytes,
      entryCount: item.entryCount,
      evidenceReference: item.evidenceReference,
      proposedByUserIdMasked: maskReference(item.proposedByUserId),
      proposedAt: item.proposedAt?.toISOString?.() ?? null,
      reviewedByUserIdMasked: maskReference(item.reviewedByUserId),
      reviewedAt: item.reviewedAt?.toISOString?.() ?? null,
      reviewNote: item.reviewNote ?? null,
      runId: item.run?.id ?? null,
      rawContentPersisted: false
    };
  }

  private cashLedgerDto(item: any) {
    const latestProposal = item.classificationProposals?.[0] ?? null;
    return {
      id: item.id,
      provider: item.provider,
      accountType: item.accountType,
      bookedAt: item.bookedAt?.toISOString?.() ?? null,
      expectedStatementDate: item.expectedStatementDate ? isoDate(item.expectedStatementDate) : null,
      businessName: item.businessName,
      businessType: item.businessType,
      direction: item.direction,
      grossCents: item.grossCents,
      feeCents: item.feeCents,
      netCents: item.netCents,
      providerReferenceMasked: maskReference(item.providerReference),
      sourceResourceType: item.sourceResourceType,
      sourceResourceIdMasked: maskReference(item.sourceResourceId),
      evidenceReference: item.evidenceReference,
      classification: latestProposal ? this.cashLedgerClassificationDto(latestProposal) : null
    };
  }

  private cashLedgerClassificationDto(item: any) {
    return {
      id: item.id,
      cashLedgerEntryId: item.cashLedgerEntryId,
      accountType: item.accountType,
      expectedStatementDate: isoDate(item.expectedStatementDate),
      evidenceReference: item.evidenceReference,
      evidenceDigestSha256: item.evidenceDigestSha256,
      status: item.status,
      proposedByUserIdMasked: maskReference(item.proposedByUserId),
      proposedAt: item.proposedAt?.toISOString?.() ?? null,
      reviewedByUserIdMasked: maskReference(item.reviewedByUserId),
      reviewedAt: item.reviewedAt?.toISOString?.() ?? null,
      reviewNote: item.reviewNote ?? null
    };
  }

  private assertEligibleBillDate(value: string, now: Date) {
    const billDate = this.assertDateFormat(value);
    const latestReady = latestReadyWeChatBillDate(
      now,
      this.config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_HOUR", 10)
    );
    if (billDate > latestReady) {
      throw new AppException(
        "WECHAT_BILL_DATE_NOT_READY",
        "Only T+1 bill dates past the configured WeChat availability hour may be requested",
        HttpStatus.BAD_REQUEST
      );
    }
    const oldest = isoDate(new Date(billDateDate(latestReady).getTime() - (MAX_LOOKBACK_DAYS - 1) * 24 * 60 * 60_000));
    if (billDate < oldest) {
      throw new AppException("WECHAT_BILL_DATE_TOO_OLD", "WeChat API bill lookback is limited to 90 days", HttpStatus.BAD_REQUEST);
    }
    const configuredStart = configuredWeChatReconciliationWindow(this.config, now).configuredStartDate;
    if (billDate < configuredStart) {
      throw new AppException(
        "WECHAT_BILL_DATE_BEFORE_CONFIGURED_START",
        "Bill date precedes the approved reconciliation coverage start date",
        HttpStatus.BAD_REQUEST
      );
    }
    return billDate;
  }

  private assertDateFormat(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppException("WECHAT_BILL_DATE_INVALID", "billDate must use YYYY-MM-DD", HttpStatus.BAD_REQUEST);
    }
    const date = billDateDate(value);
    if (isoDate(date) !== value) {
      throw new AppException("WECHAT_BILL_DATE_INVALID", "billDate is not a valid calendar date", HttpStatus.BAD_REQUEST);
    }
    return value;
  }

  private runDto(run: any) {
    return {
      id: run.id,
      source: run.source ?? "api",
      billDate: isoDate(run.billDate),
      kind: run.kind,
      status: run.status,
      entryCount: run.entryCount,
      issueCount: run.issueCount,
      attemptCount: run.attemptCount,
      hashVerified: Boolean(run.providerHash && run.contentSha256 && run.importedAt),
      lastErrorCode: run.lastErrorCode,
      requestedAt: run.requestedAt?.toISOString?.() ?? null,
      importedAt: run.importedAt?.toISOString?.() ?? null,
      reconciledAt: run.reconciledAt?.toISOString?.() ?? null,
      nextAttemptAt: run.nextAttemptAt?.toISOString?.() ?? null
    };
  }

  private issueDto(issue: any, actor: AuthenticatedUser) {
    const proposal = issue.resolutionProposals?.[0] ?? null;
    const pendingProposal = proposal?.status === "pending" ? proposal : null;
    const assignedToCurrentActor = issue.assignedToUserId === actor.id;
    const canSubmitResolution = issue.status === "investigating"
      && assignedToCurrentActor
      && !pendingProposal;
    const independentReviewer = Boolean(pendingProposal && pendingProposal.proposedByUserId !== actor.id);
    const canRejectResolution = independentReviewer;
    const canApproveResolution = independentReviewer
      && issue.status === "investigating"
      && (pendingProposal.outcome !== "acceptedException" || actor.role === "admin");
    const canReviewResolution = canApproveResolution || canRejectResolution;
    return {
      id: issue.id,
      runId: issue.runId,
      billDate: issue.run?.billDate ? isoDate(issue.run.billDate) : null,
      billKind: issue.run?.kind ?? null,
      kind: issue.kind,
      severity: issue.severity,
      status: issue.status,
      localResourceType: issue.localResourceType,
      localResourceIdMasked: maskReference(issue.localResourceId),
      providerReferenceMasked: maskReference(issue.providerReference),
      expectedCents: issue.expectedCents,
      actualCents: issue.actualCents,
      detailCode: issue.detailCode,
      assignedToUserIdMasked: maskReference(issue.assignedToUserId),
      assignedToCurrentActor,
      canSubmitResolution,
      canReviewResolution,
      canApproveResolution,
      canRejectResolution,
      resolutionProposal: proposal ? {
        id: proposal.id,
        outcome: proposal.outcome,
        status: proposal.status,
        resolutionCode: proposal.resolutionCode,
        resolutionNote: proposal.resolutionNote,
        evidenceReference: proposal.evidenceReference,
        evidenceDigestSha256: proposal.evidenceDigestSha256,
        proposedByCurrentActor: proposal.proposedByUserId === actor.id,
        proposedAt: proposal.proposedAt?.toISOString?.() ?? null,
        reviewedAt: proposal.reviewedAt?.toISOString?.() ?? null,
        reviewNote: proposal.reviewNote
      } : null,
      resolutionCode: issue.resolutionCode,
      resolutionNote: issue.resolutionNote,
      createdAt: issue.createdAt?.toISOString?.() ?? null,
      resolvedAt: issue.resolvedAt?.toISOString?.() ?? null
    };
  }

  private pagination(page: number, pageSize: number, total: number) {
    return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function billDateDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function normalizedProviderState(value: string | null): string {
  return String(value ?? "").trim().toUpperCase();
}

function isProviderPaidState(value: string | null): boolean {
  return ["SUCCESS", "REFUND"].includes(normalizedProviderState(value));
}

function isProviderRefundSuccess(value: string | null): boolean {
  return ["SUCCESS", "REFUND_SUCCESS", "退款成功"].includes(normalizedProviderState(value));
}

function sameInstant(left: Date | string | null | undefined, right: Date | string | null | undefined): boolean {
  if (!left || !right) return left == null && right == null;
  return new Date(left).getTime() === new Date(right).getTime();
}

function classifyFundBusiness(
  businessName: string | null,
  businessType: string | null
): "payment" | "refund" | "fee" | "unknown" {
  const value = `${businessName ?? ""} ${businessType ?? ""}`.trim();
  if (!value) return "unknown";
  if (/(手续费|FEE)/i.test(value)) return "fee";
  if (/(退款|REFUND)/i.test(value)) return "refund";
  if (/(交易|支付|TRANSACTION|PAYMENT)/i.test(value)) return "payment";
  return "unknown";
}

function classifyCashLedgerBusiness(value: string): "payment" | "refund" | "fee" | "unknown" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "PAYMENT") return "payment";
  if (normalized === "REFUND") return "refund";
  if (normalized === "FEE") return "fee";
  return "unknown";
}

function fundAccountType(kind: WeChatDailyBillKind): "BASIC" | "OPERATION" | "FEES" {
  if (kind === "fundBasic") return "BASIC";
  if (kind === "fundOperation") return "OPERATION";
  if (kind === "fundFees") return "FEES";
  throw new Error("Trade bills do not have a fund account type");
}

function shanghaiDayRange(value: string) {
  const midnightUtc = billDateDate(value).getTime() - SHANGHAI_OFFSET_MS;
  return { start: new Date(midnightUtc), end: new Date(midnightUtc + 24 * 60 * 60_000) };
}

function shanghaiIsoDate(value: Date): string {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function maskReference(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}***`;
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}
