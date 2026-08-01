export const WECHAT_DAILY_BILL_KINDS = [
  "tradeAll",
  "fundBasic",
  "fundOperation",
  "fundFees"
] as const;

export const WECHAT_DAILY_BILL_MAX_LOOKBACK_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const APPROVAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/;

type ConfigReader = {
  get<T = unknown>(key: string, fallback?: T): T;
};

export type WeChatReconciliationCoverageWindow = {
  configuredStartDate: string;
  coverageStartDate: string;
  providerCatchupStartDate: string;
  dueDate: string;
  requiredDates: string[];
  catchupDates: string[];
};

export type WeChatReconciliationGate = {
  enabled: boolean;
  approved: boolean;
  configurationReady: boolean;
  configurationError: string | null;
  configuredStartDate: string | null;
  coverageStartDate: string | null;
  providerCatchupStartDate: string | null;
  dueDate: string;
  requiredDates: number;
  requiredRuns: number;
  completedRuns: number;
  missingOrIncompleteRuns: number;
  unresolvedIssues: number;
  pendingApprovals: number;
  pendingBillImportApprovals: number;
  unknownProviderPaymentTimes: number;
  unknownProviderRefundTimes: number;
  unclassifiedCashLedgerEntries: number;
  complete: boolean;
  blocked: boolean;
};

export async function evaluateWeChatReconciliationGate(
  prisma: any,
  config: ConfigReader,
  now = new Date()
): Promise<WeChatReconciliationGate> {
  const enabled = config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_ENABLED", false) === true;
  const approvedFlag = config.get<boolean>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVED", false) === true;
  const approvalReference = String(
    config.get<string>("WECHAT_DAILY_BILL_RECONCILIATION_APPROVAL_REFERENCE", "") ?? ""
  ).trim();
  const approved = approvedFlag && APPROVAL_REFERENCE_PATTERN.test(approvalReference);
  const dueDate = latestReadyWeChatBillDate(
    now,
    config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_HOUR", 10)
  );
  let window: WeChatReconciliationCoverageWindow | null = null;
  let configurationError: string | null = null;
  try {
    window = configuredWeChatReconciliationWindow(config, now);
  } catch (error) {
    configurationError = error instanceof Error ? error.message : "invalid start date";
  }
  const configurationReady = enabled && approved && Boolean(window);
  if (!configurationReady || !window) {
    return {
      enabled,
      approved,
      configurationReady,
      configurationError,
      configuredStartDate: null,
      coverageStartDate: null,
      providerCatchupStartDate: null,
      dueDate,
      requiredDates: 0,
      requiredRuns: 0,
      completedRuns: 0,
      missingOrIncompleteRuns: 0,
      unresolvedIssues: 0,
      pendingApprovals: 0,
      pendingBillImportApprovals: 0,
      unknownProviderPaymentTimes: 0,
      unknownProviderRefundTimes: 0,
      unclassifiedCashLedgerEntries: 0,
      complete: false,
      blocked: true
    };
  }

  const [
    runs,
    unresolvedIssues,
    pendingApprovals,
    pendingBillImportApprovals,
    unknownProviderPaymentTimes,
    unknownProviderRefundTimes,
    unclassifiedCashLedgerEntries
  ] =
    await Promise.all([
      prisma.weChatBillReconciliationRun.findMany({
        where: {
          provider: "wechat",
          billDate: {
            gte: billDateToUtc(window.coverageStartDate),
            lte: billDateToUtc(window.dueDate)
          }
        },
        select: { billDate: true, kind: true, status: true }
      }),
      prisma.weChatReconciliationIssue.count({
        where: {
          run: { provider: "wechat" },
          status: { in: ["open", "investigating"] }
        }
      }),
      prisma.weChatReconciliationResolutionProposal.count({
        where: { issue: { run: { provider: "wechat" } }, status: "pending" }
      }),
      prisma.weChatBillImportProposal?.count
        ? prisma.weChatBillImportProposal.count({ where: { provider: "wechat", status: "pending" } })
        : Promise.resolve(0),
      prisma.paymentTransaction.count({
        where: { provider: "wechat", status: "success", providerPaidAt: null }
      }),
      prisma.refundTransaction.count({
        where: {
          payment: { provider: "wechat" },
          status: "success",
          OR: [{ providerRefundAcceptedAt: null }, { providerRefundSucceededAt: null }]
        }
      }),
      prisma.cashLedgerEntry?.count
        ? prisma.cashLedgerEntry.count({
            where: {
              provider: "wechat",
              OR: [{ accountType: "UNCLASSIFIED" }, { expectedStatementDate: null }]
            }
          })
        : Promise.resolve(0)
    ]);

  const completedKeys = new Set(
    (runs ?? [])
      .filter((run: any) => ["reconciled", "noStatement"].includes(run.status))
      .map((run: any) => `${isoBillDate(run.billDate)}:${run.kind}`)
  );
  let completedRuns = 0;
  for (const billDate of window.requiredDates) {
    for (const kind of WECHAT_DAILY_BILL_KINDS) {
      if (completedKeys.has(`${billDate}:${kind}`)) completedRuns += 1;
    }
  }
  const requiredRuns = window.requiredDates.length * WECHAT_DAILY_BILL_KINDS.length;
  const missingOrIncompleteRuns = Math.max(0, requiredRuns - completedRuns);
  const blocked = missingOrIncompleteRuns > 0
    || Number(unresolvedIssues) > 0
    || Number(pendingApprovals) > 0
    || Number(pendingBillImportApprovals) > 0
    || Number(unknownProviderPaymentTimes) > 0
    || Number(unknownProviderRefundTimes) > 0
    || Number(unclassifiedCashLedgerEntries) > 0;

  return {
    enabled,
    approved,
    configurationReady,
    configurationError,
    configuredStartDate: window.configuredStartDate,
    coverageStartDate: window.coverageStartDate,
    providerCatchupStartDate: window.providerCatchupStartDate,
    dueDate: window.dueDate,
    requiredDates: window.requiredDates.length,
    requiredRuns,
    completedRuns,
    missingOrIncompleteRuns,
    unresolvedIssues: Number(unresolvedIssues),
    pendingApprovals: Number(pendingApprovals),
    pendingBillImportApprovals: Number(pendingBillImportApprovals),
    unknownProviderPaymentTimes: Number(unknownProviderPaymentTimes),
    unknownProviderRefundTimes: Number(unknownProviderRefundTimes),
    unclassifiedCashLedgerEntries: Number(unclassifiedCashLedgerEntries),
    complete: !blocked,
    blocked
  };
}

export function configuredWeChatReconciliationWindow(
  config: ConfigReader,
  now = new Date()
): WeChatReconciliationCoverageWindow {
  const dueDate = latestReadyWeChatBillDate(
    now,
    config.get<number>("WECHAT_DAILY_BILL_RECONCILIATION_HOUR", 10)
  );
  const configuredStartDate = String(
    config.get<string>("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE", "") ?? ""
  ).trim();
  if (!isValidBillDate(configuredStartDate)) {
    throw new Error("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE must use a valid YYYY-MM-DD date");
  }
  if (configuredStartDate > dueDate) {
    throw new Error("WECHAT_DAILY_BILL_RECONCILIATION_START_DATE cannot be later than the latest ready bill date");
  }
  const oldestProviderDate = isoBillDate(new Date(
    billDateToUtc(dueDate).getTime() - (WECHAT_DAILY_BILL_MAX_LOOKBACK_DAYS - 1) * DAY_MS
  ));
  const providerCatchupStartDate = configuredStartDate > oldestProviderDate
    ? configuredStartDate
    : oldestProviderDate;
  return {
    configuredStartDate,
    coverageStartDate: configuredStartDate,
    providerCatchupStartDate,
    dueDate,
    requiredDates: inclusiveBillDates(configuredStartDate, dueDate),
    catchupDates: inclusiveBillDates(providerCatchupStartDate, dueDate)
  };
}

export function latestReadyWeChatBillDate(now: Date, notBeforeHour: number): string {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const shanghaiToday = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ));
  const lagDays = shifted.getUTCHours() >= notBeforeHour ? 1 : 2;
  return isoBillDate(new Date(shanghaiToday.getTime() - lagDays * DAY_MS));
}

export function billDateToUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isoBillDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

export function isValidBillDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && isoBillDate(billDateToUtc(value)) === value;
}

function inclusiveBillDates(start: string, end: string): string[] {
  const values: string[] = [];
  for (
    let timestamp = billDateToUtc(start).getTime();
    timestamp <= billDateToUtc(end).getTime();
    timestamp += DAY_MS
  ) {
    values.push(isoBillDate(new Date(timestamp)));
  }
  return values;
}
