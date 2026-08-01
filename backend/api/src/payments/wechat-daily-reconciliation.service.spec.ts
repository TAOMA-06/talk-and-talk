import { createHash } from "node:crypto";

import { AuthenticatedUser } from "../auth/auth.service";
import { WeChatDailyReconciliationService } from "./wechat-daily-reconciliation.service";

const RUN_KINDS = ["tradeAll", "fundBasic", "fundOperation", "fundFees"] as const;
const BILL_DATE = new Date("2026-07-31T00:00:00.000Z");
const DUE_AT = new Date("2026-08-01T02:00:00.000Z");

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-trade-all",
    provider: "wechat",
    billDate: BILL_DATE,
    kind: "tradeAll",
    status: "pending",
    importedAt: null,
    nextAttemptAt: DUE_AT,
    attemptCount: 0,
    createdAt: new Date("2026-08-01T02:00:00.000Z"),
    ...overrides
  };
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    runId: "run-trade-all",
    kind: "paymentAmountMismatch",
    severity: "critical",
    status: "open",
    localResourceType: "paymentTransaction",
    localResourceId: "payment-private-1234",
    providerReference: "provider-private-1234",
    expectedCents: 1_000,
    actualCents: 1_100,
    detailCode: "WECHAT_PAYMENT_AMOUNT_MISMATCH",
    assignedToUserId: null,
    assignedAt: null,
    resolutionCode: null,
    resolutionNote: null,
    createdAt: new Date("2026-08-01T02:01:00.000Z"),
    resolvedAt: null,
    run: { billDate: BILL_DATE, kind: "tradeAll" },
    resolutionProposals: [],
    ...overrides
  };
}

function makeHarness(options: {
  config?: Record<string, unknown>;
  providerMode?: string;
} = {}) {
  const configValues: Record<string, unknown> = {
    WECHAT_DAILY_BILL_RECONCILIATION_ENABLED: true,
    WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: true,
    WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: "ops:wechat-daily-bill-2026-08-01",
    WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-07-31",
    WECHAT_DAILY_BILL_RECONCILIATION_HOUR: 10,
    ...options.config
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => (
      Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : fallback
    ))
  } as any;
  const provider = {
    mode: options.providerMode ?? "real",
    isMock: false,
    downloadDailyStatement: jest.fn()
  } as any;
  const audit = { record: jest.fn().mockResolvedValue({}) } as any;
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    weChatBillReconciliationRun: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({})
    },
    weChatBillEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0)
    },
    weChatReconciliationIssue: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({})
    },
    weChatReconciliationResolutionProposal: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({})
    },
    weChatBillImportProposal: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn()
    },
    weChatBillImportEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    cashLedgerEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({})
    },
    cashLedgerClassificationProposal: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({})
    },
    paymentTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0)
    },
    refundTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    }
  } as any;
  const prisma = {
    ...db,
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db))
  } as any;
  const service = new WeChatDailyReconciliationService(prisma, config, provider, audit);
  return { service, prisma, db, config, configValues, provider, audit };
}

function queueWonClaim(harness: ReturnType<typeof makeHarness>, run = makeRun()) {
  let leaseToken = "";
  harness.db.weChatBillReconciliationRun.findFirst
    .mockResolvedValueOnce(run)
    .mockResolvedValueOnce(null);
  harness.db.weChatBillReconciliationRun.updateMany.mockImplementationOnce(async ({ data }: any) => {
    leaseToken = data.leaseToken;
    return { count: 1 };
  });
  harness.db.weChatBillReconciliationRun.findUnique.mockImplementation(async () => ({
    ...run,
    status: "processing",
    leaseToken,
    importedAt: null
  }));
  return () => leaseToken;
}

function statement(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return {
    status: "downloaded" as const,
    bytes,
    text,
    sha1: createHash("sha1").update(bytes).digest("hex"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength
  };
}

const operator: AuthenticatedUser = { id: "ops-1", role: "finance" };
const financeReviewer: AuthenticatedUser = { id: "finance-2", role: "finance" };
const adminReviewer: AuthenticatedUser = { id: "admin-2", role: "admin" };

describe("WeChatDailyReconciliationService scheduling and readiness", () => {
  it("uses the latest already-ready bill date before the Shanghai cutoff", async () => {
    const { service, db } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-07-30" }
    });
    db.weChatBillReconciliationRun.createMany.mockResolvedValueOnce({ count: 4 });

    await expect(service.ensureExpectedRuns(new Date("2026-08-01T01:59:59.999Z"))).resolves.toEqual({
      created: 4,
      coverageStartDate: "2026-07-30",
      dueDate: "2026-07-30",
      billDates: ["2026-07-30"]
    });
    expect(db.weChatBillReconciliationRun.createMany.mock.calls[0][0].data).toEqual(
      expect.arrayContaining(RUN_KINDS.map((kind) => expect.objectContaining({
        billDate: new Date("2026-07-30T00:00:00.000Z"),
        kind
      })))
    );
  });

  it("creates exactly four bill kinds at 10:00 and is idempotent on repeated scheduling", async () => {
    const { service, db } = makeHarness();
    db.weChatBillReconciliationRun.createMany
      .mockResolvedValueOnce({ count: 4 })
      .mockResolvedValueOnce({ count: 0 });

    const expected = {
      coverageStartDate: "2026-07-31",
      dueDate: "2026-07-31",
      billDates: ["2026-07-31"]
    };
    await expect(service.ensureExpectedRuns(DUE_AT)).resolves.toEqual({ created: 4, ...expected });
    await expect(service.ensureExpectedRuns(DUE_AT)).resolves.toEqual({ created: 0, ...expected });

    expect(db.weChatBillReconciliationRun.createMany).toHaveBeenCalledTimes(2);
    const request = db.weChatBillReconciliationRun.createMany.mock.calls[0][0];
    expect(request.skipDuplicates).toBe(true);
    expect(request.data).toHaveLength(4);
    expect(request.data.map((item: any) => item.kind)).toEqual(RUN_KINDS);
    expect(request.data).toEqual(expect.arrayContaining(RUN_KINDS.map((kind) => expect.objectContaining({
      provider: "wechat",
      billDate: BILL_DATE,
      kind,
      status: "pending",
      nextAttemptAt: DUE_AT
    }))));
  });

  it("catches up every missed date x four kinds and remains idempotent", async () => {
    const { service, db } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-07-29" }
    });
    db.weChatBillReconciliationRun.createMany
      .mockResolvedValueOnce({ count: 12 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await service.ensureExpectedRuns(DUE_AT);
    const second = await service.ensureExpectedRuns(DUE_AT);

    expect(first).toEqual({
      created: 12,
      coverageStartDate: "2026-07-29",
      dueDate: "2026-07-31",
      billDates: ["2026-07-29", "2026-07-30", "2026-07-31"]
    });
    expect(second.created).toBe(0);
    expect(db.weChatBillReconciliationRun.createMany.mock.calls[0][0].data).toHaveLength(12);
  });

  it.each([
    ["approval flag is false", { WECHAT_DAILY_BILL_RECONCILIATION_APPROVED: false }, "real"],
    ["approval reference is missing", { WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE: "" }, "real"],
    ["provider is disabled", {}, "disabled"]
  ])("fails closed when %s", async (_label, config, providerMode) => {
    const { service, db, provider } = makeHarness({ config, providerMode });

    await expect(service.ensureYesterdayRuns(DUE_AT)).rejects.toMatchObject({
      code: provider.mode === "disabled"
        ? "WECHAT_PAY_NOT_CONFIGURED"
        : "WECHAT_DAILY_BILL_RECONCILIATION_NOT_APPROVED"
    });
    await expect(service.processDue(4, DUE_AT)).rejects.toMatchObject({
      code: provider.mode === "disabled"
        ? "WECHAT_PAY_NOT_CONFIGURED"
        : "WECHAT_DAILY_BILL_RECONCILIATION_NOT_APPROVED"
    });
    expect(db.weChatBillReconciliationRun.createMany).not.toHaveBeenCalled();
    expect(db.weChatBillReconciliationRun.findFirst).not.toHaveBeenCalled();
  });
});

describe("WeChatDailyReconciliationService leases and retries", () => {
  it("does not download a statement unless its compare-and-set lease claim wins", async () => {
    const { service, db, provider } = makeHarness();
    db.weChatBillReconciliationRun.findFirst.mockResolvedValueOnce(makeRun());
    db.weChatBillReconciliationRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.processDue(4, DUE_AT)).resolves.toEqual({
      processed: 0,
      reconciled: 0,
      noStatement: 0,
      failed: 0
    });
    expect(provider.downloadDailyStatement).not.toHaveBeenCalled();
  });

  it("rechecks nextAttemptAt in the lease CAS so a concurrent backoff extension cannot be bypassed", async () => {
    const { service, db } = makeHarness();
    db.weChatBillReconciliationRun.findFirst.mockResolvedValueOnce(makeRun());
    db.weChatBillReconciliationRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.processDue(1, DUE_AT);

    expect(db.weChatBillReconciliationRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ nextAttemptAt: { lte: DUE_AT } })
    }));
  });

  it("allows finance to re-fetch a no-statement run before any immutable statement was imported", async () => {
    const { service, db, audit } = makeHarness();
    db.weChatBillReconciliationRun.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(service.retryRun(operator, "run-trade-all")).resolves.toEqual({
      runId: "run-trade-all",
      status: "pending"
    });
    expect(db.weChatBillReconciliationRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "run-trade-all",
        status: { in: ["failed", "noStatement"] },
        importedAt: null
      },
      data: expect.objectContaining({ status: "pending", leaseToken: null, leaseExpiresAt: null })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "wechat.bill_reconciliation_retry_requested",
      resourceId: "run-trade-all"
    }));
  });

  it("records a sanitized exponential retry after a provider failure", async () => {
    jest.useFakeTimers().setSystemTime(DUE_AT);
    try {
      const { service, db, provider } = makeHarness();
      const run = makeRun({ attemptCount: 2 });
      queueWonClaim({ service, db, provider } as any, run);
      provider.downloadDailyStatement.mockRejectedValue(new Error("raw provider secret must not persist"));

      await expect(service.processDue(1, DUE_AT)).resolves.toEqual({
        processed: 1,
        reconciled: 0,
        noStatement: 0,
        failed: 1
      });

      expect(db.weChatBillReconciliationRun.updateMany).toHaveBeenNthCalledWith(2, {
        where: expect.objectContaining({ id: run.id, leaseToken: expect.any(String), importedAt: null }),
        data: expect.objectContaining({
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date("2026-08-01T02:20:00.000Z"),
          lastErrorCode: "WECHAT_BILL_RECONCILIATION_FAILED",
          lastErrorSummary: "Error"
        })
      });
      expect(JSON.stringify(db.weChatBillReconciliationRun.updateMany.mock.calls[1])).not.toContain("raw provider secret");
    } finally {
      jest.useRealTimers();
    }
  });

  it("cannot finalize or overwrite a run after its lease has been taken by another worker", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun();
    db.weChatBillReconciliationRun.findFirst
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null);
    db.weChatBillReconciliationRun.updateMany.mockResolvedValueOnce({ count: 1 });
    db.weChatBillReconciliationRun.findUnique.mockResolvedValue({
      ...run,
      status: "processing",
      leaseToken: "new-owner-token",
      importedAt: null
    });
    provider.downloadDailyStatement.mockResolvedValue({ status: "noStatement" });

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual({
      processed: 1,
      reconciled: 0,
      noStatement: 0,
      failed: 1
    });
    expect(db.weChatBillReconciliationRun.update).not.toHaveBeenCalled();
    expect(db.weChatReconciliationIssue.createMany).not.toHaveBeenCalled();
    expect(db.weChatReconciliationIssue.updateMany).not.toHaveBeenCalled();
    expect(db.weChatBillReconciliationRun.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        id: run.id,
        leaseToken: expect.not.stringMatching(/^new-owner-token$/)
      })
    }));
  });
});

describe("WeChatDailyReconciliationService immutable import and reconciliation", () => {
  it("imports normalized data from the verified provider statement without persisting raw CSV or personal columns", async () => {
    const { service, db, provider, audit } = makeHarness();
    const run = makeRun();
    const getLease = queueWonClaim({ service, db, provider } as any, run);
    const csv = [
      "`交易时间,`微信订单号,`商户订单号,`用户标识,`交易状态,`订单金额,`微信退款单号,`商户退款单号,`申请退款金额,`退款状态,`商品名称,`手续费",
      "`2026-07-31 10:20:30,`wx-txn-1,`T100,`openid-never-store,`SUCCESS,`39.00,`wx-refund-1,`R100,`10.50,`SUCCESS,`private-product-never-store,`0.20",
      "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额",
      "`1,`28.30,`10.50,`0.00,`0.20,`39.00,`10.50"
    ].join("\r\n");
    const downloaded = statement(csv);
    provider.downloadDailyStatement.mockResolvedValue(downloaded);
    const payment = {
      id: "payment-1",
      outTradeNo: "T100",
      transactionId: "wx-txn-1",
      amountCents: 3_900,
      status: "success"
    };
    const refund = {
      id: "refund-1",
      outRefundNo: "R100",
      providerRefundId: "wx-refund-1",
      amountCents: 1_050,
      status: "success"
    };
    db.paymentTransaction.findMany
      .mockResolvedValueOnce([payment])
      .mockResolvedValueOnce([payment]);
    db.refundTransaction.findMany
      .mockResolvedValueOnce([refund])
      .mockResolvedValueOnce([refund]);
    db.cashLedgerEntry.findMany
      .mockResolvedValueOnce([
        { id: "cash-direction", accountType: "BASIC", providerReference: "wx-direction", businessType: "PAYMENT", direction: "收入", netCents: 1_000 },
        { id: "cash-unknown", accountType: "BASIC", providerReference: "wx-unknown", businessType: "PAYMENT", direction: "收入", netCents: 500 },
        { id: "cash-fee", accountType: "BASIC", providerReference: "wx-fee", businessType: "FEE", direction: "支出", netCents: 100 },
        { id: "cash-refund", accountType: "BASIC", providerReference: "wx-refund", businessType: "REFUND", direction: "支出", netCents: 200 }
      ])
      .mockResolvedValueOnce([]);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual({
      processed: 1,
      reconciled: 1,
      noStatement: 0,
      failed: 0
    });

    expect(provider.downloadDailyStatement).toHaveBeenCalledWith({ billDate: "2026-07-31", kind: "tradeAll" });
    expect(getLease()).toMatch(/^[0-9a-f-]{36}$/);
    const entryRequest = db.weChatBillEntry.createMany.mock.calls[0][0];
    expect(entryRequest.data).toHaveLength(1);
    expect(entryRequest.data[0]).toEqual(expect.objectContaining({
      runId: run.id,
      entryType: "trade",
      outTradeNo: "T100",
      transactionId: "wx-txn-1",
      outRefundNo: "R100",
      providerRefundId: "wx-refund-1",
      amountCents: 3_900,
      refundAmountCents: 1_050,
      rowDigest: expect.stringMatching(/^[0-9a-f]{64}$/)
    }));
    expect(db.weChatReconciliationIssue.createMany).not.toHaveBeenCalled();
    expect(db.weChatReconciliationIssue.updateMany).toHaveBeenCalledWith({
      where: {
        runId: run.id,
        kind: "providerStatementMissingWithLocalActivity",
        status: { in: ["open", "investigating"] }
      },
      data: {
        status: "resolved",
        resolvedAt: expect.any(Date),
        resolutionCode: "providerStatementRecovered",
        resolutionNote: "A verified provider statement became available and was reconciled."
      }
    });
    expect(db.weChatBillReconciliationRun.update).toHaveBeenCalledWith({
      where: { id: run.id },
      data: expect.objectContaining({
        status: "reconciled",
        hashType: "SHA1",
        providerHash: downloaded.sha1,
        contentSha256: downloaded.sha256,
        downloadedBytes: downloaded.sizeBytes,
        entryCount: 1,
        issueCount: 0,
        importedAt: expect.any(Date),
        leaseToken: null
      })
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "wechat.bill_imported_and_reconciled",
      metadata: expect.objectContaining({
        billDate: "2026-07-31",
        kind: "tradeAll",
        entryCount: 1,
        issueCount: 0,
        contentSha256: downloaded.sha256
      })
    }), db);

    const persistedSurfaces = JSON.stringify({
      entries: db.weChatBillEntry.createMany.mock.calls,
      run: db.weChatBillReconciliationRun.update.mock.calls,
      issues: db.weChatReconciliationIssue.createMany.mock.calls,
      audit: audit.record.mock.calls
    });
    expect(persistedSurfaces).not.toContain(csv);
    expect(persistedSurfaces).not.toContain("openid-never-store");
    expect(persistedSurfaces).not.toContain("private-product-never-store");
  });

  it("raises payment/refund orphan, amount, id, status, and local-missing-provider differences", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun();
    queueWonClaim({ service, db, provider } as any, run);
    const csv = [
      "`交易时间,`微信订单号,`商户订单号,`交易状态,`订单金额,`微信退款单号,`商户退款单号,`申请退款金额,`退款状态,`退款申请时间,`退款成功时间,`手续费",
      "`2026-07-31 10:00:00,`wx-orphan,`T-ORPHAN,`SUCCESS,`10.00,,,,,,,`0.00",
      "`2026-07-31 10:01:00,`wx-provider,`T-MISMATCH,`SUCCESS,`11.00,,,,,,,`0.00",
      "`2026-07-31 10:02:00,`wx-provider-unpaid,`T-LOCAL-SUCCESS-STATE,`REVOKED,`0.00,`wx-revoke,`R-REVOKE,`12.00,`SUCCESS,`2026-07-31 10:02:00,`2026-07-31 10:02:30,`0.00",
      "`2026-07-31 10:03:00,`wx-origin-refund-orphan,`T-REFUND-ORPHAN,`REFUND,`0.00,`wx-refund-orphan,`R-ORPHAN,`2.00,`SUCCESS,`2026-07-31 10:03:00,`2026-07-31 10:03:30,`0.00",
      "`2026-07-31 10:04:00,`wx-origin-refund-mismatch,`T-REFUND-MISMATCH,`REFUND,`0.00,`wx-refund-provider,`R-MISMATCH,`3.00,`SUCCESS,`2026-07-31 10:04:00,`2026-07-31 10:04:30,`0.00",
      "`2026-07-31 10:05:00,`wx-origin-refund-processing,`T-REFUND-PROCESSING,`REFUND,`0.00,`wx-refund-processing,`R-LOCAL-SUCCESS-STATE,`3.50,`PROCESSING,`2026-07-31 10:05:00,,`0.00",
      "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额",
      "`6,`0.50,`20.50,`0.00,`0.00,`21.00,`20.50"
    ].join("\r\n");
    provider.downloadDailyStatement.mockResolvedValue(statement(csv));
    db.paymentTransaction.findMany
      .mockResolvedValueOnce([{
        id: "payment-mismatch",
        outTradeNo: "T-MISMATCH",
        transactionId: "wx-local",
        amountCents: 1_000,
        status: "pending"
      }, {
        id: "payment-local-success-provider-unpaid",
        outTradeNo: "T-LOCAL-SUCCESS-STATE",
        transactionId: "wx-provider-unpaid",
        amountCents: 1_200,
        status: "success"
      }])
      .mockResolvedValueOnce([
        {
          id: "payment-local-success-provider-unpaid",
          outTradeNo: "T-LOCAL-SUCCESS-STATE",
          amountCents: 1_200
        },
        {
          id: "payment-local-only",
          outTradeNo: "T-LOCAL-ONLY",
          amountCents: 2_500
        }
      ]);
    db.refundTransaction.findMany
      .mockResolvedValueOnce([{
        id: "refund-mismatch",
        outRefundNo: "R-MISMATCH",
        providerRefundId: "wx-refund-local",
        amountCents: 200,
        status: "pending"
      }, {
        id: "refund-local-success-provider-processing",
        outRefundNo: "R-LOCAL-SUCCESS-STATE",
        providerRefundId: "wx-refund-processing",
        amountCents: 350,
        status: "success"
      }])
      .mockResolvedValueOnce([
        {
          id: "refund-local-success-provider-processing",
          outRefundNo: "R-LOCAL-SUCCESS-STATE",
          amountCents: 350
        },
        {
          id: "refund-local-only",
          outRefundNo: "R-LOCAL-ONLY",
          amountCents: 500
        }
      ]);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual(expect.objectContaining({
      processed: 1,
      reconciled: 1,
      failed: 0
    }));

    const issueData = db.weChatReconciliationIssue.createMany.mock.calls[0][0].data;
    expect(issueData.map((item: any) => item.kind)).toEqual(expect.arrayContaining([
      "providerPaymentMissingLocally",
      "paymentAmountMismatch",
      "paymentTransactionIdMismatch",
      "providerPaidLocalUnsettled",
      "providerRefundMissingLocally",
      "refundAmountMismatch",
      "refundProviderIdMismatch",
      "providerRefundedLocalUnsettled",
      "localPaymentMissingProviderBill",
      "localRefundMissingProviderBill"
    ]));
    expect(issueData.find((item: any) => item.kind === "paymentAmountMismatch")).toEqual(expect.objectContaining({
      severity: "critical",
      expectedCents: 1_000,
      actualCents: 1_100
    }));
    expect(issueData.find((item: any) => item.kind === "refundAmountMismatch")).toEqual(expect.objectContaining({
      severity: "critical",
      expectedCents: 200,
      actualCents: 300
    }));
    expect(issueData.find((item: any) => item.kind === "localRefundMissingProviderBill").severity).toBe("high");
  });

  it("preserves fund business semantics and accepts an exact BASIC payment match", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun({ id: "run-fund-basic", kind: "fundBasic" });
    queueWonClaim({ service, db, provider } as any, run);
    const csv = [
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元),`账户结余(元),`资金变更提交申请人,`备注,`业务凭证号",
      "`2026-07-31 11:00:00,`wx-txn-1,`fund-1,`订单入账,`交易,`收入,`39.00,`100.00,`system,`-,`T100",
      "`资金流水总笔数,`收入笔数,`收入金额,`支出笔数,`支出金额",
      "`1,`1,`39.00,`0,`0.00"
    ].join("\n");
    provider.downloadDailyStatement.mockResolvedValue(statement(csv));
    const payment = {
      id: "payment-1",
      outTradeNo: "T100",
      transactionId: "wx-txn-1",
      amountCents: 3_900,
      status: "success",
      providerPaidAt: new Date("2026-07-31T03:00:00.000Z")
    };
    db.paymentTransaction.findMany
      .mockResolvedValueOnce([payment])
      .mockResolvedValueOnce([payment]);
    db.refundTransaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    db.cashLedgerEntry.findMany
      .mockResolvedValueOnce([{
        id: "cash-payment-1",
        accountType: "BASIC",
        providerReference: "wx-txn-1",
        businessType: "PAYMENT",
        direction: "收入",
        netCents: 3_900
      }])
      .mockResolvedValueOnce([]);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual(expect.objectContaining({
      processed: 1,
      reconciled: 1,
      failed: 0
    }));

    expect(db.weChatBillEntry.createMany.mock.calls[0][0].data[0]).toEqual(expect.objectContaining({
      entryType: "fund",
      businessReference: "wx-txn-1",
      businessName: "订单入账",
      businessType: "交易",
      accountType: "BASIC",
      fundDirection: "收入",
      fundAmountCents: 3_900
    }));
    expect(db.weChatReconciliationIssue.createMany).not.toHaveBeenCalled();
  });

  it("fails closed on unknown and fee fund types and validates direction, amount, and settlement", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun({ id: "run-fund-controls", kind: "fundBasic" });
    queueWonClaim({ service, db, provider } as any, run);
    const csv = [
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元),`账户结余(元),`资金变更提交申请人,`备注,`业务凭证号",
      "`2026-07-31 11:00:00,`wx-direction,`fund-1,`订单入账,`交易,`支出,`11.00,`100.00,`system,`-,`T-DIRECTION",
      "`2026-07-31 11:01:00,`wx-unknown,`fund-2,`营销补贴,`补贴,`收入,`5.00,`105.00,`system,`-,`T-UNKNOWN",
      "`2026-07-31 11:02:00,`wx-fee,`fund-3,`手续费,`手续费,`支出,`1.00,`104.00,`system,`-,`T-FEE",
      "`2026-07-31 11:03:00,`wx-refund,`fund-4,`订单退款,`退款,`收入,`2.00,`106.00,`system,`-,`R-REFUND",
      "`资金流水总笔数,`收入笔数,`收入金额,`支出笔数,`支出金额",
      "`4,`2,`7.00,`2,`12.00"
    ].join("\n");
    provider.downloadDailyStatement.mockResolvedValue(statement(csv));
    const directionPayment = {
      id: "payment-direction",
      outTradeNo: "T-DIRECTION",
      transactionId: "wx-direction",
      amountCents: 1_000,
      status: "pending",
      providerPaidAt: null
    };
    const unknownPayment = {
      id: "payment-unknown",
      outTradeNo: "T-UNKNOWN",
      transactionId: "wx-unknown",
      amountCents: 500,
      status: "success",
      providerPaidAt: new Date("2026-07-31T03:01:00.000Z")
    };
    const feePayment = {
      id: "payment-fee",
      outTradeNo: "T-FEE",
      transactionId: "wx-fee",
      amountCents: 100,
      status: "success",
      providerPaidAt: new Date("2026-07-31T03:02:00.000Z")
    };
    const refund = {
      id: "refund-1",
      outRefundNo: "R-REFUND",
      providerRefundId: "wx-refund",
      amountCents: 200,
      status: "success",
      providerRefundAcceptedAt: new Date("2026-07-31T03:03:00.000Z")
    };
    db.paymentTransaction.findMany
      .mockResolvedValueOnce([directionPayment, unknownPayment, feePayment])
      .mockResolvedValueOnce([unknownPayment, feePayment]);
    db.refundTransaction.findMany
      .mockResolvedValueOnce([refund])
      .mockResolvedValueOnce([refund]);
    db.cashLedgerEntry.findMany
      .mockResolvedValueOnce([
        {
          id: "cash-direction",
          accountType: "BASIC",
          providerReference: "wx-direction",
          businessType: "PAYMENT",
          direction: "收入",
          netCents: 1_000
        },
        {
          id: "cash-unknown",
          accountType: "BASIC",
          providerReference: "wx-unknown",
          businessType: "PAYMENT",
          direction: "收入",
          netCents: 500
        },
        {
          id: "cash-fee",
          accountType: "BASIC",
          providerReference: "wx-fee",
          businessType: "FEE",
          direction: "支出",
          netCents: 100
        },
        {
          id: "cash-refund",
          accountType: "BASIC",
          providerReference: "wx-refund",
          businessType: "REFUND",
          direction: "支出",
          netCents: 200
        }
      ])
      .mockResolvedValueOnce([]);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual(expect.objectContaining({
      reconciled: 1,
      failed: 0
    }));

    const issues = db.weChatReconciliationIssue.createMany.mock.calls[0][0].data;
    expect(issues.map((issue: any) => issue.kind)).toEqual(expect.arrayContaining([
      "providerFundDirectionMismatch",
      "providerFundAmountMismatch",
      "providerFundBusinessTypeUnreviewed"
    ]));
    expect(issues.filter((issue: any) => issue.kind === "providerFundDirectionMismatch")).toHaveLength(2);
    expect(issues.find((issue: any) => issue.kind === "providerFundAmountMismatch")).toEqual(
      expect.objectContaining({ expectedCents: 1_000, actualCents: 1_100 })
    );
    expect(issues.filter((issue: any) => issue.kind === "providerFundBusinessTypeUnreviewed")
      .every((issue: any) => issue.severity === "critical")).toBe(true);
  });

  it("raises reverse-coverage issues when a zero-row BASIC fund statement omits local provider-timed facts", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun({ id: "run-fund-empty", kind: "fundBasic" });
    queueWonClaim({ service, db, provider } as any, run);
    const csv = [
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元),`账户结余(元),`资金变更提交申请人,`备注,`业务凭证号",
      "`资金流水总笔数,`收入笔数,`收入金额,`支出笔数,`支出金额",
      "`0,`0,`0.00,`0,`0.00"
    ].join("\n");
    provider.downloadDailyStatement.mockResolvedValue(statement(csv));
    db.paymentTransaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "payment-local",
        outTradeNo: "T-LOCAL",
        transactionId: "wx-local",
        amountCents: 3_900
      }]);
    db.refundTransaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "refund-local",
        outRefundNo: "R-LOCAL",
        providerRefundId: "wx-refund-local",
        amountCents: 1_000
      }]);
    db.cashLedgerEntry.findMany.mockResolvedValueOnce([{
      id: "cash-local-payment",
      accountType: "BASIC",
      providerReference: "wx-local",
      businessType: "PAYMENT",
      direction: "收入",
      netCents: 3_900
    }, {
      id: "cash-local-refund",
      accountType: "BASIC",
      providerReference: "wx-refund-local",
      businessType: "REFUND",
      direction: "支出",
      netCents: 1_000
    }]);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual(expect.objectContaining({
      reconciled: 1,
      failed: 0
    }));

    const issues = db.weChatReconciliationIssue.createMany.mock.calls[0][0].data;
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "localCashLedgerMissingProviderFundBill",
        localResourceId: "cash-local-payment",
        expectedCents: 3_900
      }),
      expect.objectContaining({
        kind: "localCashLedgerMissingProviderFundBill",
        localResourceId: "cash-local-refund",
        expectedCents: 1_000
      })
    ]));
  });
});

describe("WeChatDailyReconciliationService no-statement handling", () => {
  it("creates one critical issue when the provider has no trade statement but local activity exists", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun();
    queueWonClaim({ service, db, provider } as any, run);
    provider.downloadDailyStatement.mockResolvedValue({ status: "noStatement" });
    db.paymentTransaction.count.mockResolvedValue(1);
    db.refundTransaction.count.mockResolvedValue(1);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual({
      processed: 1,
      reconciled: 0,
      noStatement: 1,
      failed: 0
    });

    expect(db.weChatReconciliationIssue.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        runId: run.id,
        kind: "providerStatementMissingWithLocalActivity",
        severity: "critical",
        detailCode: "WECHAT_BILL_NO_STATEMENT_WITH_LOCAL_ACTIVITY"
      })],
      skipDuplicates: true
    });
    expect(db.weChatBillReconciliationRun.update).toHaveBeenCalledWith({
      where: { id: run.id },
      data: expect.objectContaining({ status: "noStatement", issueCount: 1, leaseToken: null })
    });
  });

  it("does not create a false positive for a genuinely empty trade statement day", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun();
    queueWonClaim({ service, db, provider } as any, run);
    provider.downloadDailyStatement.mockResolvedValue({ status: "noStatement" });
    db.paymentTransaction.count.mockResolvedValue(0);
    db.refundTransaction.count.mockResolvedValue(0);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual(expect.objectContaining({ noStatement: 1, failed: 0 }));

    expect(db.weChatReconciliationIssue.createMany).not.toHaveBeenCalled();
    expect(db.weChatBillReconciliationRun.update).toHaveBeenCalledWith({
      where: { id: run.id },
      data: expect.objectContaining({ status: "noStatement", issueCount: 0 })
    });
  });

  it("treats a missing fund statement with provider-timed local activity as critical", async () => {
    const { service, db, provider } = makeHarness();
    const run = makeRun({ id: "run-fund-no-statement", kind: "fundBasic" });
    queueWonClaim({ service, db, provider } as any, run);
    provider.downloadDailyStatement.mockResolvedValue({ status: "noStatement" });
    db.cashLedgerEntry.count.mockResolvedValue(1);

    await expect(service.processDue(1, DUE_AT)).resolves.toEqual(expect.objectContaining({
      noStatement: 1,
      failed: 0
    }));

    expect(db.cashLedgerEntry.count).toHaveBeenCalledWith({
      where: {
        provider: "wechat",
        accountType: "BASIC",
        expectedStatementDate: BILL_DATE
      }
    });
    expect(db.weChatReconciliationIssue.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        kind: "providerStatementMissingWithLocalActivity",
        severity: "critical",
        expectedCents: 1
      })],
      skipDuplicates: true
    });
  });
});

describe("WeChatDailyReconciliationService issue ownership", () => {
  it("rejects a claim owned by somebody else", async () => {
    const { service, db } = makeHarness();
    db.weChatReconciliationIssue.findUnique.mockResolvedValue(makeIssue({
      status: "investigating",
      assignedToUserId: "ops-2",
      assignedAt: new Date("2026-08-01T02:02:00.000Z")
    }));

    await expect(service.claimIssue(operator, "issue-1")).rejects.toMatchObject({
      code: "WECHAT_RECONCILIATION_ISSUE_ALREADY_ASSIGNED"
    });
    expect(db.weChatReconciliationIssue.update).not.toHaveBeenCalled();
  });

  it("treats a repeated claim by the same owner as side-effect idempotent", async () => {
    const { service, db, audit } = makeHarness();
    const assignedAt = new Date("2026-08-01T02:02:00.000Z");
    db.weChatReconciliationIssue.findUnique.mockResolvedValue(makeIssue({
      status: "investigating",
      assignedToUserId: operator.id,
      assignedAt
    }));

    await expect(service.claimIssue(operator, "issue-1")).resolves.toEqual(expect.objectContaining({
      id: "issue-1",
      status: "investigating"
    }));
    expect(db.weChatReconciliationIssue.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("requires current ownership before a resolution proposal can be submitted", async () => {
    const { service, db } = makeHarness();
    db.weChatReconciliationIssue.findUnique.mockResolvedValue(makeIssue({
      status: "investigating",
      assignedToUserId: "ops-2"
    }));

    await expect(service.submitResolutionProposal(operator, "issue-1", {
      outcome: "resolved",
      resolutionCode: "PROVIDER_CONFIRMED",
      note: "Verified against the provider statement.",
      evidenceReference: "finance:reconciliation/case-1",
      evidenceDigestSha256: "a".repeat(64)
    })).rejects.toMatchObject({ code: "WECHAT_RECONCILIATION_ISSUE_NOT_ASSIGNED" });
    expect(db.weChatReconciliationResolutionProposal.create).not.toHaveBeenCalled();
  });

  it("keeps the issue investigating after the owner submits immutable evidence", async () => {
    const { service, db, audit } = makeHarness();
    const pendingProposal = {
      id: "proposal-1",
      outcome: "resolved",
      status: "pending",
      resolutionCode: "PROVIDER_CONFIRMED",
      resolutionNote: "Verified against the provider statement.",
      evidenceReference: "finance:reconciliation/case-1",
      evidenceDigestSha256: "a".repeat(64),
      proposedByUserId: operator.id,
      proposedAt: DUE_AT,
      reviewedAt: null,
      reviewNote: null
    };
    db.weChatReconciliationIssue.findUnique
      .mockResolvedValueOnce(makeIssue({
        status: "investigating",
        assignedToUserId: operator.id,
        resolutionProposals: []
      }))
      .mockResolvedValueOnce(makeIssue({
        status: "investigating",
        assignedToUserId: operator.id,
        resolutionProposals: [pendingProposal]
      }));
    db.weChatReconciliationResolutionProposal.create.mockResolvedValue({ id: "proposal-1" });

    await expect(service.submitResolutionProposal(operator, "issue-1", {
      outcome: "resolved",
      resolutionCode: "PROVIDER_CONFIRMED",
      note: "Verified against the provider statement.",
      evidenceReference: "finance:reconciliation/case-1",
      evidenceDigestSha256: "A".repeat(64)
    })).resolves.toEqual(expect.objectContaining({
      status: "investigating",
      assignedToCurrentActor: true,
      canSubmitResolution: false,
      resolutionProposal: expect.objectContaining({ status: "pending", proposedByCurrentActor: true })
    }));
    expect(db.weChatReconciliationIssue.update).not.toHaveBeenCalled();
    expect(db.weChatReconciliationResolutionProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueId: "issue-1",
        evidenceDigestSha256: "a".repeat(64),
        proposedByUserId: operator.id
      })
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "wechat.reconciliation_resolution_proposed",
      resourceId: "proposal-1"
    }), db);
  });

  it("enforces a different reviewer and admin-only exception approval", async () => {
    const { service, db } = makeHarness();
    const proposal = {
      id: "proposal-1",
      outcome: "acceptedException",
      status: "pending",
      resolutionCode: "DOCUMENTED_PROVIDER_EXCEPTION",
      resolutionNote: "Documented provider exception with finance evidence.",
      proposedByUserId: operator.id,
      proposedAt: DUE_AT
    };
    db.weChatReconciliationIssue.findUnique.mockResolvedValue(makeIssue({
      status: "investigating",
      assignedToUserId: operator.id,
      resolutionProposals: [proposal]
    }));

    await expect(service.reviewResolutionProposal(operator, "issue-1", {
      decision: "approve",
      note: "Attempted self review must fail closed."
    })).rejects.toMatchObject({ code: "WECHAT_RECONCILIATION_SECOND_REVIEW_REQUIRED" });
    await expect(service.reviewResolutionProposal(financeReviewer, "issue-1", {
      decision: "approve",
      note: "Finance reviewed the provider exception evidence."
    })).rejects.toMatchObject({ code: "WECHAT_RECONCILIATION_ADMIN_EXCEPTION_APPROVAL_REQUIRED" });
    expect(db.weChatReconciliationResolutionProposal.update).not.toHaveBeenCalled();
  });

  it("prevents stale approval after machine recovery but still allows independent rejection", async () => {
    const proposal = {
      id: "proposal-stale",
      outcome: "resolved",
      status: "pending",
      resolutionCode: "MANUAL_RECOVERY",
      resolutionNote: "Manual evidence was proposed before the provider statement recovered.",
      proposedByUserId: operator.id,
      proposedAt: DUE_AT
    };
    const approving = makeHarness();
    approving.db.weChatReconciliationIssue.findUnique.mockResolvedValue(makeIssue({
      status: "resolved",
      resolutionCode: "providerStatementRecovered",
      resolutionProposals: [proposal]
    }));

    await expect(approving.service.reviewResolutionProposal(financeReviewer, "issue-1", {
      decision: "approve",
      note: "This proposal became stale after provider recovery."
    })).rejects.toMatchObject({ code: "WECHAT_RECONCILIATION_ISSUE_STATE_CHANGED" });
    expect(approving.db.weChatReconciliationResolutionProposal.update).not.toHaveBeenCalled();

    const rejecting = makeHarness();
    expect((rejecting.service as any).issueDto(makeIssue({
      status: "resolved",
      resolutionCode: "providerStatementRecovered",
      resolutionProposals: [proposal]
    }), financeReviewer)).toEqual(expect.objectContaining({
      canApproveResolution: false,
      canRejectResolution: true
    }));
    rejecting.db.weChatReconciliationIssue.findUnique
      .mockResolvedValueOnce(makeIssue({
        status: "resolved",
        resolutionCode: "providerStatementRecovered",
        resolutionProposals: [proposal]
      }))
      .mockResolvedValueOnce(makeIssue({
        status: "resolved",
        resolutionCode: "providerStatementRecovered",
        resolutionProposals: [{
          ...proposal,
          status: "rejected",
          reviewedAt: DUE_AT,
          reviewNote: "Rejected because provider recovery superseded the proposal."
        }]
      }));

    await expect(rejecting.service.reviewResolutionProposal(financeReviewer, "issue-1", {
      decision: "reject",
      note: "Rejected because provider recovery superseded the proposal."
    })).resolves.toEqual(expect.objectContaining({
      status: "resolved",
      canApproveResolution: false,
      canRejectResolution: false,
      resolutionProposal: expect.objectContaining({ status: "rejected" })
    }));
    expect(rejecting.db.weChatReconciliationResolutionProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) })
    );
    expect(rejecting.db.weChatReconciliationIssue.update).not.toHaveBeenCalled();
  });

  it("closes only after a different admin approves the immutable proposal", async () => {
    const { service, db, audit } = makeHarness();
    const proposal = {
      id: "proposal-1",
      outcome: "acceptedException",
      status: "pending",
      resolutionCode: "DOCUMENTED_PROVIDER_EXCEPTION",
      resolutionNote: "Documented provider exception with finance evidence.",
      evidenceReference: "finance:reconciliation/case-2",
      evidenceDigestSha256: "b".repeat(64),
      proposedByUserId: operator.id,
      proposedAt: DUE_AT
    };
    db.weChatReconciliationIssue.findUnique
      .mockResolvedValueOnce(makeIssue({ status: "investigating", resolutionProposals: [proposal] }))
      .mockResolvedValueOnce(makeIssue({
        status: "acceptedException",
        resolutionCode: proposal.resolutionCode,
        resolutionNote: proposal.resolutionNote,
        resolvedAt: DUE_AT,
        resolutionProposals: [{
          ...proposal,
          status: "approved",
          reviewedAt: DUE_AT,
          reviewNote: "Independent admin approval completed."
        }]
      }));

    await expect(service.reviewResolutionProposal(adminReviewer, "issue-1", {
      decision: "approve",
      note: "Independent admin approval completed."
    })).resolves.toEqual(expect.objectContaining({ status: "acceptedException" }));
    expect(db.weChatReconciliationResolutionProposal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "proposal-1" },
      data: expect.objectContaining({ status: "approved", reviewedByUserId: adminReviewer.id })
    }));
    expect(db.weChatReconciliationIssue.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "acceptedException",
        resolvedByUserId: adminReviewer.id,
        resolutionCode: proposal.resolutionCode
      })
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "wechat.reconciliation_resolution_approved"
    }), db);
  });
});

describe("WeChatDailyReconciliationService release gate", () => {
  it("keeps the gate on the most recent available bill date before the configured Shanghai cutoff", async () => {
    const { service, db } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-07-30" }
    });
    db.weChatBillReconciliationRun.findMany.mockResolvedValue([]);
    db.weChatReconciliationIssue.count.mockResolvedValue(0);
    const beforeCutoff = new Date("2026-08-01T01:59:59.999Z");

    await expect(service.releaseGate(beforeCutoff)).resolves.toEqual(expect.objectContaining({
      dueDate: "2026-07-30"
    }));
    expect(db.weChatBillReconciliationRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        provider: "wechat",
        billDate: {
          gte: new Date("2026-07-30T00:00:00.000Z"),
          lte: new Date("2026-07-30T00:00:00.000Z")
        }
      }
    }));
  });

  it("blocks when any one of the four required bill kinds is incomplete", async () => {
    const { service, db } = makeHarness();
    db.weChatBillReconciliationRun.findMany.mockResolvedValue([
      { billDate: BILL_DATE, kind: "tradeAll", status: "reconciled" },
      { billDate: BILL_DATE, kind: "fundBasic", status: "noStatement" },
      { billDate: BILL_DATE, kind: "fundOperation", status: "reconciled" }
    ]);
    db.weChatReconciliationIssue.count.mockResolvedValue(0);

    await expect(service.releaseGate(DUE_AT)).resolves.toEqual(expect.objectContaining({
      dueDate: "2026-07-31",
      complete: false,
      missingOrIncompleteRuns: 1,
      blocked: true
    }));
  });

  it("blocks complete coverage while any issue remains open or investigating", async () => {
    const { service, db } = makeHarness();
    db.weChatBillReconciliationRun.findMany.mockResolvedValue(RUN_KINDS.map((kind) => ({
      billDate: BILL_DATE,
      kind,
      status: kind === "fundFees" ? "noStatement" : "reconciled"
    })));
    db.weChatReconciliationIssue.count.mockResolvedValue(1);

    await expect(service.releaseGate(DUE_AT)).resolves.toEqual(expect.objectContaining({
      dueDate: "2026-07-31",
      complete: false,
      unresolvedIssues: 1,
      blocked: true
    }));
    expect(db.weChatReconciliationIssue.count).toHaveBeenCalledWith({
      where: {
        run: { provider: "wechat" },
        status: { in: ["open", "investigating"] }
      }
    });
  });

  it("passes only when all four kinds are complete and no issue is open", async () => {
    const { service, db } = makeHarness();
    db.weChatBillReconciliationRun.findMany.mockResolvedValue(RUN_KINDS.map((kind) => ({
      billDate: BILL_DATE,
      kind,
      status: kind === "fundFees" ? "noStatement" : "reconciled"
    })));
    db.weChatReconciliationIssue.count.mockResolvedValue(0);

    await expect(service.releaseGate(DUE_AT)).resolves.toEqual(expect.objectContaining({
      dueDate: "2026-07-31",
      complete: true,
      missingOrIncompleteRuns: 0,
      blocked: false
    }));
  });

  it("blocks historical issues, pending approvals, and successful rows without provider time", async () => {
    const { service, db } = makeHarness();
    db.weChatBillReconciliationRun.findMany.mockResolvedValue(RUN_KINDS.map((kind) => ({
      billDate: BILL_DATE,
      kind,
      status: "reconciled"
    })));
    db.weChatReconciliationIssue.count.mockResolvedValue(2);
    db.weChatReconciliationResolutionProposal.count.mockResolvedValue(1);
    db.paymentTransaction.count.mockResolvedValue(3);
    db.refundTransaction.count.mockResolvedValue(4);

    await expect(service.releaseGate(DUE_AT)).resolves.toEqual(expect.objectContaining({
      unresolvedIssues: 2,
      pendingApprovals: 1,
      unknownProviderPaymentTimes: 3,
      unknownProviderRefundTimes: 4,
      complete: false,
      blocked: true
    }));
  });

  it("does not erase older coverage gaps when only the latest day is complete", async () => {
    const { service, db } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2026-07-29" }
    });
    db.weChatBillReconciliationRun.findMany.mockResolvedValue(RUN_KINDS.map((kind) => ({
      billDate: BILL_DATE,
      kind,
      status: "reconciled"
    })));

    await expect(service.releaseGate(DUE_AT)).resolves.toEqual(expect.objectContaining({
      requiredDates: 3,
      requiredRuns: 12,
      completedRuns: 4,
      missingOrIncompleteRuns: 8,
      blocked: true
    }));
  });
});

describe("WeChatDailyReconciliationService historical import and cash classification controls", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-01T05:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function historicalTradeCsv(rowDate = "2026-04-01") {
    return [
      "`交易时间,`微信订单号,`商户订单号,`交易状态,`订单金额,`微信退款单号,`商户退款单号,`申请退款金额,`退款状态,`手续费",
      `\`${rowDate} 10:00:00,\`wx-historical-1,\`T-HISTORICAL-1,\`SUCCESS,\`10.00,,,,,\`0.00`,
      "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额",
      "`1,`10.00,`0.00,`0.00,`0.00,`10.00,`0.00"
    ].join("\n");
  }

  it("accepts only a single-day statement outside 90 days but inside five years and never persists raw text", async () => {
    const { service, db, audit } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2021-01-01" }
    });
    const content = historicalTradeCsv();
    const contentSha256 = createHash("sha256").update(content).digest("hex");
    db.weChatBillReconciliationRun.findUnique.mockResolvedValue(null);
    db.weChatBillImportProposal.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      status: "pending",
      proposedAt: new Date(),
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNote: null
    }));

    const result = await service.submitMerchantBillImport(operator, {
      billDate: "2026-04-01",
      kind: "tradeAll",
      content,
      contentSha256,
      evidenceReference: "finance:merchant-bill/2026-04-01"
    });

    expect(result).toEqual(expect.objectContaining({
      source: "merchantPlatform",
      billDate: "2026-04-01",
      contentSha256,
      rawContentPersisted: false,
      proposedByUserIdMasked: expect.any(String)
    }));
    expect(db.weChatBillImportEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        providerOccurredAt: new Date("2026-04-01T02:00:00.000Z"),
        outTradeNo: "T-HISTORICAL-1"
      })]
    }));
    const durableSurfaces = JSON.stringify({
      proposal: db.weChatBillImportProposal.create.mock.calls,
      entries: db.weChatBillImportEntry.createMany.mock.calls,
      audit: audit.record.mock.calls,
      response: result
    });
    expect(durableSurfaces).not.toContain(content);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ rawContentPersisted: false })
    }), db);
  });

  it("rejects API-window, older-than-five-years, and merged multi-day merchant statements", async () => {
    const { service } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2020-01-01" }
    });
    const recent = historicalTradeCsv("2026-07-01");
    await expect(service.submitMerchantBillImport(operator, {
      billDate: "2026-07-01",
      kind: "tradeAll",
      content: recent,
      contentSha256: createHash("sha256").update(recent).digest("hex"),
      evidenceReference: "finance:merchant-bill/recent"
    })).rejects.toMatchObject({ code: "WECHAT_BILL_IMPORT_NOT_HISTORICAL" });

    const tooOld = historicalTradeCsv("2021-07-30");
    await expect(service.submitMerchantBillImport(operator, {
      billDate: "2021-07-30",
      kind: "tradeAll",
      content: tooOld,
      contentSha256: createHash("sha256").update(tooOld).digest("hex"),
      evidenceReference: "finance:merchant-bill/too-old"
    })).rejects.toMatchObject({ code: "WECHAT_BILL_IMPORT_BEYOND_MERCHANT_HISTORY" });

    const merged = historicalTradeCsv("2026-04-02");
    await expect(service.submitMerchantBillImport(operator, {
      billDate: "2026-04-01",
      kind: "tradeAll",
      content: merged,
      contentSha256: createHash("sha256").update(merged).digest("hex"),
      evidenceReference: "finance:merchant-bill/merged-31-day"
    })).rejects.toMatchObject({ code: "WECHAT_BILL_IMPORT_DATE_MISMATCH" });
  });

  it("requires a second reviewer and re-digests normalized import rows before approval", async () => {
    const { service, db } = makeHarness({
      config: { WECHAT_DAILY_BILL_RECONCILIATION_START_DATE: "2021-01-01" }
    });
    const proposal = {
      id: "proposal-1",
      provider: "wechat",
      source: "merchantPlatform",
      billDate: new Date("2026-04-01T00:00:00.000Z"),
      kind: "tradeAll",
      status: "pending",
      contentSha256: "a".repeat(64),
      normalizedSha256: "b".repeat(64),
      sizeBytes: 100,
      entryCount: 1,
      evidenceReference: "finance:merchant-bill/proposal-1",
      proposedByUserId: operator.id,
      proposedAt: new Date(),
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNote: null,
      entries: [{
        lineNumber: 2,
        entryType: "trade",
        providerOccurredAt: new Date("2026-04-01T02:00:00.000Z"),
        rowDigest: "c".repeat(64)
      }]
    };
    db.weChatBillImportProposal.findUnique.mockResolvedValue(proposal);

    await expect(service.reviewMerchantBillImport(operator, proposal.id, {
      decision: "approve",
      note: "Importer cannot approve the same statement."
    })).rejects.toMatchObject({ code: "WECHAT_BILL_IMPORT_SECOND_REVIEW_REQUIRED" });
    await expect(service.reviewMerchantBillImport(financeReviewer, proposal.id, {
      decision: "approve",
      note: "Independent normalized evidence review completed."
    })).rejects.toMatchObject({ code: "WECHAT_BILL_IMPORT_NORMALIZED_EVIDENCE_TAMPERED" });
    expect(db.weChatBillEntry.createMany).not.toHaveBeenCalled();
  });

  it("classifies cash only after an independent approval using the fixed ledger-then-proposal lock order", async () => {
    const { service, db, audit } = makeHarness();
    const entry = {
      id: "cash-1",
      accountType: "UNCLASSIFIED",
      expectedStatementDate: null,
      bookedAt: new Date("2026-07-30T03:00:00.000Z"),
      classificationProposals: []
    };
    const pending = {
      id: "cash-proposal-1",
      cashLedgerEntryId: entry.id,
      accountType: "BASIC",
      expectedStatementDate: new Date("2026-07-31T00:00:00.000Z"),
      evidenceReference: "finance:cash-ledger/cash-1",
      evidenceDigestSha256: "d".repeat(64),
      proposedByUserId: operator.id,
      proposedAt: new Date(),
      status: "pending",
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNote: null
    };
    db.cashLedgerEntry.findUnique.mockResolvedValue(entry);
    db.cashLedgerClassificationProposal.create.mockResolvedValue(pending);

    await expect(service.submitCashLedgerClassification(operator, entry.id, {
      accountType: "BASIC",
      expectedStatementDate: "2026-07-31",
      evidenceReference: pending.evidenceReference,
      evidenceDigestSha256: pending.evidenceDigestSha256.toUpperCase()
    })).resolves.toEqual(expect.objectContaining({
      id: pending.id,
      status: "pending",
      evidenceDigestSha256: pending.evidenceDigestSha256
    }));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);

    db.$queryRaw.mockClear();
    db.cashLedgerClassificationProposal.findUnique.mockResolvedValue(pending);
    const approved = {
      ...pending,
      status: "approved",
      reviewedByUserId: financeReviewer.id,
      reviewedAt: new Date(),
      reviewNote: "Independent account and statement-date review completed."
    };
    db.cashLedgerClassificationProposal.update.mockResolvedValue(approved);

    await expect(service.reviewCashLedgerClassification(operator, pending.id, {
      decision: "approve",
      note: "Self review is forbidden by the two-person control."
    })).rejects.toMatchObject({ code: "CASH_LEDGER_CLASSIFICATION_SECOND_REVIEW_REQUIRED" });

    await expect(service.reviewCashLedgerClassification(financeReviewer, pending.id, {
      decision: "approve",
      note: approved.reviewNote
    })).resolves.toEqual(expect.objectContaining({ status: "approved" }));
    expect(db.$queryRaw).toHaveBeenCalledTimes(4);
    expect(db.cashLedgerClassificationProposal.update.mock.invocationCallOrder[0])
      .toBeLessThan(db.cashLedgerEntry.update.mock.invocationCallOrder[0]);
    expect(db.cashLedgerEntry.update).toHaveBeenCalledWith({
      where: { id: entry.id },
      data: {
        accountType: "BASIC",
        expectedStatementDate: pending.expectedStatementDate
      }
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "wechat.cash_ledger_classification_approved"
    }), db);
  });

  it("repairs only missing exact refund times and creates the corresponding unclassified cash fact", async () => {
    const { service, db, audit } = makeHarness();
    const refund = {
      id: "refund-legacy-1",
      status: "success",
      amountCents: 500,
      providerRefundId: "wx-refund-legacy-1",
      providerRefundAcceptedAt: null,
      providerRefundSucceededAt: null
    };
    const entry: any = {
      id: "bill-entry-1",
      rowDigest: "e".repeat(64),
      outRefundNo: "R-LEGACY-1",
      providerRefundId: refund.providerRefundId,
      providerRefundAcceptedAt: new Date("2026-04-01T02:00:00.000Z"),
      providerRefundSucceededAt: new Date("2026-04-02T03:00:00.000Z")
    };
    db.refundTransaction.updateMany.mockResolvedValue({ count: 1 });

    await (service as any).repairApprovedRefundTimes(db, refund, entry, {
      actorId: financeReviewer.id,
      importProposalId: "import-proposal-1"
    });

    expect(db.refundTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: refund.id,
        status: "success",
        amountCents: refund.amountCents,
        providerRefundId: refund.providerRefundId
      }),
      data: {
        providerRefundAcceptedAt: entry.providerRefundAcceptedAt,
        providerRefundSucceededAt: entry.providerRefundSucceededAt
      }
    }));
    expect(db.cashLedgerEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        accountType: "UNCLASSIFIED",
        bookedAt: entry.providerRefundSucceededAt,
        providerReference: refund.providerRefundId,
        sourceResourceId: refund.id
      })],
      skipDuplicates: true
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "wechat.refund_provider_times_repaired_from_approved_bill"
    }), db);
  });
});
