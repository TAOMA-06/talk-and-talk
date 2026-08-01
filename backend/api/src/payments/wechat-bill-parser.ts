import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";

import { AppException } from "../common/errors/app.exception";

export type WeChatDailyBillKind = "tradeAll" | "fundBasic" | "fundOperation" | "fundFees";

export type NormalizedWeChatBillEntry = {
  lineNumber: number;
  entryType: "trade" | "fund";
  providerOccurredAt: Date | null;
  providerRefundAcceptedAt: Date | null;
  providerRefundSucceededAt: Date | null;
  outTradeNo: string | null;
  transactionId: string | null;
  outRefundNo: string | null;
  providerRefundId: string | null;
  businessReference: string | null;
  businessName: string | null;
  businessType: string | null;
  tradeState: string | null;
  refundState: string | null;
  amountCents: number | null;
  refundAmountCents: number | null;
  feeCents: number | null;
  fundDirection: string | null;
  fundAmountCents: number | null;
  accountType: string | null;
  rowDigest: string;
};

const MAX_COLUMNS = 128;
const MAX_ROWS = 250_000;

/**
 * Parses only the financial identifiers required for reconciliation. OpenID,
 * product descriptions, bank names and merchant attachment fields are never
 * returned and therefore cannot enter the application database.
 */
export function parseWeChatDailyBill(
  kind: WeChatDailyBillKind,
  text: string
): NormalizedWeChatBillEntry[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const trade = kind === "tradeAll";
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(cleanCell);
    return trade
      ? headers.includes("商户订单号") && headers.includes("微信订单号")
      : headers.includes("记账时间") && (
        headers.includes("微信支付业务单号") || headers.includes("资金流水单号")
      );
  });
  if (headerIndex < 0) {
    throw invalidBill("WECHAT_BILL_HEADER_INVALID", "The WeChat bill header is missing or unsupported");
  }

  const headers = rows[headerIndex].map(cleanCell);
  if (headers.length > MAX_COLUMNS || new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
    throw invalidBill("WECHAT_BILL_HEADER_INVALID", "The WeChat bill header is ambiguous");
  }
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const entries: NormalizedWeChatBillEntry[] = [];
  const summaryMarker = trade ? "总交易单数" : "资金流水总笔数";
  let summaryHeaders: string[] | null = null;
  let summaryValues: string[] | null = null;

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    if (entries.length >= MAX_ROWS) {
      throw invalidBill("WECHAT_BILL_ROW_LIMIT_EXCEEDED", "The WeChat bill contains too many rows");
    }
    const row = rows[rowIndex];
    const cleaned = row.map(cleanCell);
    if (cleaned.every((value) => !value)) continue;
    if (cleaned[0] === summaryMarker) {
      summaryHeaders = cleaned;
      const valuesRow = rows.slice(rowIndex + 1).find((candidate) =>
        candidate.map(cleanCell).some((value) => Boolean(value))
      );
      summaryValues = valuesRow ? valuesRow.map(cleanCell) : null;
      break;
    }
    if (row.length > MAX_COLUMNS) {
      throw invalidBill("WECHAT_BILL_ROW_INVALID", "A WeChat bill row contains too many columns");
    }

    const value = (...aliases: string[]): string | null => {
      for (const alias of aliases) {
        const index = indexByHeader.get(alias);
        if (index !== undefined) return nullable(cleaned[index]);
      }
      return null;
    };
    const rowDigest = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    if (trade) {
      const outTradeNo = financialReference(value("商户订单号"));
      const transactionId = financialReference(value("微信订单号"));
      const outRefundNo = financialReference(value("商户退款单号"));
      const providerRefundId = financialReference(value("微信退款单号"));
      if (!outTradeNo && !transactionId && !outRefundNo && !providerRefundId) {
        throw invalidBill("WECHAT_BILL_ROW_INVALID", "A trade bill row has no financial reference");
      }
      const tradeState = value("交易状态");
      const amountCents = parseYuan(value("订单金额", "总金额", "应结订单金额"));
      const refundAmountCents = parseYuan(value("申请退款金额", "退款金额"));
      if (!tradeState || !["SUCCESS", "REFUND", "REVOKED"].includes(tradeState.toUpperCase())) {
        throw invalidBill("WECHAT_BILL_ROW_INVALID", "A trade bill row has an unsupported transaction state");
      }
      if (!outTradeNo || !transactionId || amountCents === null) {
        throw invalidBill("WECHAT_BILL_ROW_INVALID", "A trade bill row is missing required transaction facts");
      }
      const normalizedTradeState = tradeState.toUpperCase();
      if (normalizedTradeState === "SUCCESS" && amountCents <= 0) {
        throw invalidBill("WECHAT_BILL_ROW_INVALID", "A successful trade bill row must have a positive order amount");
      }
      if (["REFUND", "REVOKED"].includes(normalizedTradeState)
        && (amountCents !== 0 || !outRefundNo || !providerRefundId || refundAmountCents === null
          || refundAmountCents <= 0)) {
        throw invalidBill("WECHAT_BILL_ROW_INVALID", "A refund bill row is missing required refund facts");
      }
      const providerRefundAcceptedAt = parseShanghaiDate(value("退款申请时间"));
      const providerRefundSucceededAt = parseShanghaiDate(value("退款成功时间"));
      if (["REFUND", "REVOKED"].includes(normalizedTradeState) && !providerRefundAcceptedAt) {
        throw invalidBill(
          "WECHAT_BILL_ROW_INVALID",
          "A refund bill row must preserve the official refund application time"
        );
      }
      if (["REFUND", "REVOKED"].includes(normalizedTradeState)
        && isRefundSuccess(value("退款状态"))
        && !providerRefundSucceededAt) {
        throw invalidBill(
          "WECHAT_BILL_ROW_INVALID",
          "A successful refund bill row must preserve the independent refund success time"
        );
      }
      if (providerRefundAcceptedAt && providerRefundSucceededAt
        && providerRefundSucceededAt < providerRefundAcceptedAt) {
        throw invalidBill(
          "WECHAT_BILL_ROW_INVALID",
          "Refund success time cannot precede the official refund application time"
        );
      }
      entries.push({
        lineNumber: rowIndex + 1,
        entryType: "trade",
        providerOccurredAt: normalizedTradeState === "SUCCESS"
          ? parseShanghaiDate(value("交易时间"))
          : providerRefundAcceptedAt,
        providerRefundAcceptedAt,
        providerRefundSucceededAt,
        outTradeNo,
        transactionId,
        outRefundNo,
        providerRefundId,
        businessReference: null,
        businessName: null,
        businessType: null,
        tradeState,
        refundState: value("退款状态"),
        amountCents,
        refundAmountCents,
        feeCents: parseYuan(value("手续费")),
        fundDirection: null,
        fundAmountCents: null,
        accountType: null,
        rowDigest
      });
      continue;
    }

    const businessReference = financialReference(value("微信支付业务单号", "业务凭证号"));
    const fundFlowId = financialReference(value("资金流水单号"));
    if (!businessReference && !fundFlowId) {
      throw invalidBill("WECHAT_BILL_ROW_INVALID", "A fund bill row has no financial reference");
    }
    const providerOccurredAt = parseShanghaiDate(value("记账时间"));
    const fundDirection = value("收支类型");
    const fundAmountCents = parseYuan(value("收支金额(元)", "收支金额（元）", "收支金额"));
    if (!providerOccurredAt || !fundDirection || !["收入", "支出"].includes(fundDirection)
      || fundAmountCents === null || fundAmountCents < 0) {
      throw invalidBill("WECHAT_BILL_ROW_INVALID", "A fund bill row is missing valid time, direction, or amount facts");
    }
    const businessName = value("业务名称");
    const businessType = value("业务类型");
    entries.push({
      lineNumber: rowIndex + 1,
      entryType: "fund",
      providerOccurredAt,
      providerRefundAcceptedAt: null,
      providerRefundSucceededAt: null,
      outTradeNo: null,
      transactionId: null,
      outRefundNo: null,
      providerRefundId: null,
      businessReference: businessReference ?? fundFlowId,
      businessName,
      businessType,
      tradeState: businessType ?? businessName,
      refundState: null,
      amountCents: null,
      refundAmountCents: null,
      feeCents: null,
      fundDirection,
      fundAmountCents,
      accountType: kind.slice("fund".length).toUpperCase(),
      rowDigest
    });
  }
  validateSummary(kind, entries, summaryHeaders, summaryValues);
  return entries;
}

function validateSummary(
  kind: WeChatDailyBillKind,
  entries: NormalizedWeChatBillEntry[],
  headers: string[] | null,
  row: string[] | null
): void {
  if (!headers || !row) {
    throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", "The WeChat bill summary is missing");
  }
  const summary = (name: string): string => {
    const index = headers.indexOf(name);
    const value = index >= 0 ? nullable(row[index]) : null;
    if (!value) {
      throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", `The WeChat bill summary is missing ${name}`);
    }
    return value;
  };
  const expectEqual = (actual: number, expected: number, name: string) => {
    if (actual !== expected) {
      throw invalidBill("WECHAT_BILL_SUMMARY_MISMATCH", `The WeChat bill ${name} does not match its detail rows`);
    }
  };

  if (kind === "tradeAll") {
    expectEqual(entries.length, parseCount(summary("总交易单数")), "trade count");
    expectEqual(sum(entries.map((entry) => entry.amountCents)), parseYuan(summary("订单总金额"))!, "order total");
    expectEqual(
      sumOptional(entries.map((entry) => entry.refundAmountCents)),
      parseYuan(summary("申请退款总金额"))!,
      "requested refund total"
    );
    expectEqual(sum(entries.map((entry) => entry.feeCents)), parseYuan(summary("手续费总金额"))!, "fee total");
    return;
  }

  const income = entries.filter((entry) => entry.fundDirection === "收入");
  const expenses = entries.filter((entry) => entry.fundDirection === "支出");
  expectEqual(entries.length, parseCount(summary("资金流水总笔数")), "fund count");
  expectEqual(income.length, parseCount(summary("收入笔数")), "income count");
  expectEqual(sum(income.map((entry) => entry.fundAmountCents)), parseYuan(summary("收入金额"))!, "income total");
  expectEqual(expenses.length, parseCount(summary("支出笔数")), "expense count");
  expectEqual(sum(expenses.map((entry) => entry.fundAmountCents)), parseYuan(summary("支出金额"))!, "expense total");
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field.length > 0) throw invalidBill("WECHAT_BILL_CSV_INVALID", "The WeChat bill CSV is malformed");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw invalidBill("WECHAT_BILL_CSV_INVALID", "The WeChat bill CSV has an unterminated quote");
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function cleanCell(value: string | undefined): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().replace(/^`/, "").trim();
}

function nullable(value: string | undefined): string | null {
  const normalized = cleanCell(value);
  return normalized && normalized !== "-" ? normalized : null;
}

function financialReference(value: string | null): string | null {
  return value === "0" ? null : value;
}

function isRefundSuccess(value: string | null): boolean {
  return ["SUCCESS", "REFUND_SUCCESS"].includes(String(value ?? "").trim().toUpperCase());
}

function parseCount(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", "A WeChat bill summary count is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", "A WeChat bill summary count is outside the supported range");
  }
  return parsed;
}

function sum(values: Array<number | null>): number {
  if (values.some((value) => value === null)) {
    throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", "A WeChat bill detail amount is missing");
  }
  const total = values.reduce<number>((result, value) => result + Number(value), 0);
  if (!Number.isSafeInteger(total)) {
    throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", "A WeChat bill summary total is outside the supported range");
  }
  return total;
}

function sumOptional(values: Array<number | null>): number {
  const total = values.reduce<number>((result, value) => result + (value ?? 0), 0);
  if (!Number.isSafeInteger(total)) {
    throw invalidBill("WECHAT_BILL_SUMMARY_INVALID", "A WeChat bill summary total is outside the supported range");
  }
  return total;
}

function parseYuan(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/[￥¥]/g, "").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw invalidBill("WECHAT_BILL_AMOUNT_INVALID", "A WeChat bill amount is invalid");
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [yuan, fraction = ""] = unsigned.split(".");
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw invalidBill("WECHAT_BILL_AMOUNT_INVALID", "A WeChat bill amount is outside the supported range");
  }
  return negative ? -cents : cents;
}

function parseShanghaiDate(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function invalidBill(code: string, message: string): AppException {
  return new AppException(code, message, HttpStatus.BAD_GATEWAY);
}
