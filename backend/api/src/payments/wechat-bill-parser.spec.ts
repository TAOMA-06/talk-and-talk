import { parseWeChatDailyBill } from "./wechat-bill-parser";

describe("parseWeChatDailyBill", () => {
  it("normalizes trade and refund references without retaining personal columns", () => {
    const text = [
      "`交易时间,`微信订单号,`商户订单号,`用户标识,`交易状态,`订单金额,`微信退款单号,`商户退款单号,`申请退款金额,`退款状态,`商品名称,`手续费",
      "`2026-07-31 10:20:30,`wx-txn-1,`T100,`openid-secret,`SUCCESS,`39.00,`wx-refund-1,`R100,`10.50,`SUCCESS,`private description,`0.20",
      "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额",
      "`1,`28.30,`10.50,`0.00,`0.20,`39.00,`10.50"
    ].join("\r\n");

    const [entry] = parseWeChatDailyBill("tradeAll", text);

    expect(entry).toMatchObject({
      entryType: "trade",
      outTradeNo: "T100",
      transactionId: "wx-txn-1",
      outRefundNo: "R100",
      providerRefundId: "wx-refund-1",
      amountCents: 3900,
      refundAmountCents: 1050,
      feeCents: 20,
      tradeState: "SUCCESS",
      refundState: "SUCCESS"
    });
    expect(entry.providerOccurredAt?.toISOString()).toBe("2026-07-31T02:20:30.000Z");
    expect(JSON.stringify(entry)).not.toContain("openid-secret");
    expect(JSON.stringify(entry)).not.toContain("private description");
    expect(entry.rowDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses quoted fund rows and maps the account type", () => {
    const text = [
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元),`账户结余(元),`资金变更提交申请人,`备注,`业务凭证号",
      '"`2026-07-31 11:00:00","`wx-txn-1","`fund-1","`订单入账","`交易","`收入","`38.80","`100.00","`operator-secret","`comma, private note","`T100"',
      "`资金流水总笔数,`收入笔数,`收入金额,`支出笔数,`支出金额",
      "`1,`1,`38.80,`0,`0.00"
    ].join("\n");

    expect(parseWeChatDailyBill("fundBasic", text)[0]).toMatchObject({
      entryType: "fund",
      businessReference: "wx-txn-1",
      fundDirection: "收入",
      fundAmountCents: 3880,
      accountType: "BASIC"
    });
    expect(JSON.stringify(parseWeChatDailyBill("fundBasic", text))).not.toContain("operator-secret");
    expect(JSON.stringify(parseWeChatDailyBill("fundBasic", text))).not.toContain("private note");
  });

  it("normalizes literal zero refund references on a payment row", () => {
    const text = [
      "`交易时间,`微信订单号,`商户订单号,`交易状态,`订单金额,`微信退款单号,`商户退款单号,`申请退款金额,`退款状态,`手续费",
      "`2026-07-31 10:20:30,`wx-txn-1,`T100,`SUCCESS,`39.00,`0,`0,`0.00,`0,`0.20",
      "`总交易单数,`应结订单总金额,`退款总金额,`充值券退款总金额,`手续费总金额,`订单总金额,`申请退款总金额",
      "`1,`38.80,`0.00,`0.00,`0.20,`39.00,`0.00"
    ].join("\r\n");

    expect(parseWeChatDailyBill("tradeAll", text)[0]).toMatchObject({
      outRefundNo: null,
      providerRefundId: null,
      refundAmountCents: 0
    });
  });

  it("fails closed when official summary totals do not match detail rows", () => {
    const text = [
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元),`账户结余(元),`资金变更提交申请人,`备注,`业务凭证号",
      "`2026-07-31 11:00:00,`wx-txn-1,`fund-1,`订单入账,`交易,`收入,`38.80,`100.00,`system,`-,`T100",
      "`资金流水总笔数,`收入笔数,`收入金额,`支出笔数,`支出金额",
      "`1,`1,`38.81,`0,`0.00"
    ].join("\n");

    expect(() => parseWeChatDailyBill("fundBasic", text)).toThrow(
      expect.objectContaining({ code: "WECHAT_BILL_SUMMARY_MISMATCH" })
    );
  });

  it("fails closed on unsupported headers, malformed quotes and invalid amounts", () => {
    expect(() => parseWeChatDailyBill("tradeAll", "a,b\n1,2")).toThrow(
      expect.objectContaining({ code: "WECHAT_BILL_HEADER_INVALID" })
    );
    expect(() => parseWeChatDailyBill(
      "tradeAll",
      '`交易时间,`微信订单号,`商户订单号,`订单金额\n"unterminated'
    )).toThrow(expect.objectContaining({ code: "WECHAT_BILL_CSV_INVALID" }));
    expect(() => parseWeChatDailyBill(
      "tradeAll",
      "`交易时间,`微信订单号,`商户订单号,`订单金额\n`2026-07-31 10:00:00,`wx1,`T1,`3.999"
    )).toThrow(expect.objectContaining({ code: "WECHAT_BILL_AMOUNT_INVALID" }));
    expect(() => parseWeChatDailyBill(
      "fundFees",
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元)\n`2026-07-31 11:00:00,`wx1,`fund1,`订单入账,`交易,`未知,`1.00"
    )).toThrow(expect.objectContaining({ code: "WECHAT_BILL_ROW_INVALID" }));
    expect(() => parseWeChatDailyBill(
      "fundFees",
      "`记账时间,`微信支付业务单号,`资金流水单号,`业务名称,`业务类型,`收支类型,`收支金额(元)\n`2026-07-31 11:00:00,`wx1,`fund1,`订单入账,`交易,`收入,`1.00"
    )).toThrow(expect.objectContaining({ code: "WECHAT_BILL_SUMMARY_INVALID" }));
  });
});
