import { createCipheriv, createSign, generateKeyPairSync } from "node:crypto";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RealWeChatPayProvider,
  decryptResource,
  decryptToString,
  isWeChatConfigured
} from "./real-wechat-pay.provider";

describe("RealWeChatPayProvider helpers", () => {
  it("isWeChatConfigured requires all fields", () => {
    expect(
      isWeChatConfigured({
        WECHAT_PAY_APP_ID: "wx",
        WECHAT_PAY_MCH_ID: "m",
        WECHAT_PAY_API_V3_KEY: "k".repeat(32),
        WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/k.pem",
        WECHAT_PAY_CERT_SERIAL_NO: "ser"
      })
    ).toBe(true);

    expect(
      isWeChatConfigured({
        WECHAT_PAY_APP_ID: "",
        WECHAT_PAY_MCH_ID: "m",
        WECHAT_PAY_API_V3_KEY: "k".repeat(32),
        WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/k.pem",
        WECHAT_PAY_CERT_SERIAL_NO: "ser"
      })
    ).toBe(false);
  });

  it("decrypts AES-256-GCM resource with apiV3Key", () => {
    const apiV3Key = "A".repeat(32);
    const plaintext = JSON.stringify({
      out_trade_no: "T123",
      transaction_id: "wx_txn_1",
      trade_state: "SUCCESS",
      amount: { total: 3900 }
    });
    const nonce = "0123456789ab";
    const associatedData = "transaction";
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, tag]).toString("base64");

    const decrypted = decryptResource(apiV3Key, { ciphertext, nonce, associatedData });
    expect(decrypted.out_trade_no).toBe("T123");
    expect(decrypted.trade_state).toBe("SUCCESS");
    expect((decrypted.amount as { total: number }).total).toBe(3900);

    const asString = decryptToString(apiV3Key, { ciphertext, nonce, associatedData });
    expect(JSON.parse(asString).transaction_id).toBe("wx_txn_1");
  });

  it("createAppPrepay signs and returns client params when API returns prepay_id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));

    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ prepay_id: "wx_prepay_abc" })
    });

    const provider = new RealWeChatPayProvider({
      appId: "wx_app",
      mchId: "1900000000",
      apiV3Key: "B".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "SERIAL1",
      apiBaseUrl: "https://example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const result = await provider.createAppPrepay({
      outTradeNo: "T999",
      description: "test",
      amountCents: 100,
      notifyUrl: "https://api.example/notify"
    });

    expect(result.mock).toBe(false);
    expect(result.prepayId).toBe("wx_prepay_abc");
    expect(result.clientParams.appId).toBe("wx_app");
    expect(result.clientParams.partnerId).toBe("1900000000");
    expect(result.clientParams.prepayId).toBe("wx_prepay_abc");
    expect(result.clientParams.package).toBe("Sign=WXPay");
    expect(result.clientParams.sign).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalled();

    unlinkSync(keyPath);
  });

  it("creates Mini Program JSAPI params with the Mini Program AppID and OpenID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ prepay_id: "wx_mini_prepay" })
    });
    const provider = new RealWeChatPayProvider({
      appId: "wx_ios_app",
      miniProgramAppId: "wx_mini_app",
      mchId: "1900000000",
      apiV3Key: "B".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "SERIAL1",
      apiBaseUrl: "https://example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const expiresAt = new Date("2026-07-19T04:00:00.000Z");
    const result = await provider.createMiniProgramPrepay({
      outTradeNo: "T1000", description: "test", amountCents: 100, notifyUrl: "https://api.example/notify", openId: "openid-1", expiresAt
    });

    expect(result.channel).toBe("miniProgram");
    expect(result.clientParams.package).toBe("prepay_id=wx_mini_prepay");
    expect(result.clientParams.signType).toBe("RSA");
    expect(result.clientParams.paySign).toBeTruthy();
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v3/pay/transactions/jsapi");
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      appid: "wx_mini_app", payer: { openid: "openid-1" }, time_expire: expiresAt.toISOString()
    }));

    unlinkSync(keyPath);
  });

  it("maps an aborted WeChat request to a gateway timeout error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const provider = new RealWeChatPayProvider({
      appId: "wx_app",
      mchId: "1900000000",
      apiV3Key: "B".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "SERIAL1",
      fetchImpl: jest.fn().mockRejectedValue(timeout) as unknown as typeof fetch
    });

    await expect(provider.createAppPrepay({
      outTradeNo: "T-timeout",
      description: "test",
      amountCents: 100,
      notifyUrl: "https://api.example/notify"
    })).rejects.toMatchObject({ code: "WECHAT_API_TIMEOUT", status: 502 });

    unlinkSync(keyPath);
  });

  it("closes a payment by out_trade_no and accepts an already-closed response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => "" })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ code: "ORDER_CLOSED" }) });
    const provider = new RealWeChatPayProvider({
      appId: "wx_app",
      mchId: "1900000000",
      apiV3Key: "B".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "SERIAL1",
      apiBaseUrl: "https://example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(provider.closePayment("T/1000")).resolves.toBeUndefined();
    await expect(provider.closePayment("T/1000")).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://example.test/v3/pay/transactions/out-trade-no/T%2F1000/close"
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ mchid: "1900000000" });

    unlinkSync(keyPath);
  });

  it("queries a payment by out_trade_no with merchant binding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        appid: "wx-mini-app",
        mchid: "1900000000",
        out_trade_no: "T-query",
        transaction_id: "wx-query-txn",
        trade_state: "SUCCESS",
        amount: { total: 3900, currency: "CNY" }
      })
    });
    const provider = new RealWeChatPayProvider({
      appId: "wx-app",
      mchId: "1900000000",
      apiV3Key: "B".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "SERIAL1",
      apiBaseUrl: "https://example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const result = await provider.queryPayment("T/query");

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://example.test/v3/pay/transactions/out-trade-no/T%2Fquery?mchid=1900000000"
    );
    expect(result).toEqual(expect.objectContaining({
      outTradeNo: "T-query",
      transactionId: "wx-query-txn",
      tradeState: "SUCCESS",
      amountCents: 3900,
      currency: "CNY"
    }));

    unlinkSync(keyPath);
  });

  it("parseNotifyPayload decrypts ciphertext resource", () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));

    const apiV3Key = "C".repeat(32);
    const inner = {
      appid: "wx-mini-app",
      mchid: "1900000000",
      out_trade_no: "T777",
      transaction_id: "txn_777",
      trade_state: "SUCCESS",
      amount: { total: 1200, currency: "CNY" }
    };
    const nonce = "123456789012";
    const associatedData = "transaction";
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(inner), "utf8"), cipher.final()]);
    const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");

    const provider = new RealWeChatPayProvider({
      appId: "wx",
      mchId: "m",
      apiV3Key,
      privateKeyPath: keyPath,
      certSerialNo: "s",
      fetchImpl: jest.fn() as unknown as typeof fetch
    });

    const payload = provider.parseNotifyPayload(
      JSON.stringify({
        id: "evt1",
        resource: { ciphertext, nonce, associated_data: associatedData }
      })
    );

    expect(payload.outTradeNo).toBe("T777");
    expect(payload.transactionId).toBe("txn_777");
    expect(payload.tradeState).toBe("SUCCESS");
    expect(payload.amountCents).toBe(1200);
    expect(payload.appId).toBe("wx-mini-app");
    expect(payload.mchId).toBe("1900000000");
    expect(payload.currency).toBe("CNY");

    unlinkSync(keyPath);
  });

  it("verifyNotifySignature rejects missing headers", () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));

    const provider = new RealWeChatPayProvider({
      appId: "wx",
      mchId: "m",
      apiV3Key: "D".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "s"
    });

    expect(provider.verifyNotifySignature({}, "{}")).toBe(false);
    unlinkSync(keyPath);
  });

  it("verifies a real RSA callback signature and rejects tamper, stale time, and unknown serial", () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, merchantKeys.privateKey.export({ type: "pkcs8", format: "pem" }));
    const provider = new RealWeChatPayProvider({
      appId: "wx",
      mchId: "m",
      apiV3Key: "D".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "merchant-serial",
      fetchImpl: jest.fn().mockRejectedValue(new Error("not used")) as unknown as typeof fetch
    });
    (provider as any).platformCerts = [{
      serialNo: "platform-serial",
      publicKeyPem: platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      expireAt: Date.now() + 60_000
    }];

    const rawBody = JSON.stringify({ id: "evt-1", resource: { ciphertext: "ciphertext" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-1";
    const signer = createSign("RSA-SHA256");
    signer.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    signer.end();
    const signature = signer.sign(platformKeys.privateKey, "base64");
    const headers = {
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-signature": signature,
      "wechatpay-serial": "platform-serial"
    };

    expect(provider.verifyNotifySignature(headers, rawBody)).toBe(true);
    expect(provider.verifyNotifySignature(headers, `${rawBody} `)).toBe(false);
    expect(provider.verifyNotifySignature({
      ...headers,
      "wechatpay-timestamp": String(Number(timestamp) - 301)
    }, rawBody)).toBe(false);
    expect(provider.verifyNotifySignature({
      ...headers,
      "wechatpay-serial": "unknown-serial"
    }, rawBody)).toBe(false);

    unlinkSync(keyPath);
  });

  it("refreshes platform certificates before async callback verification", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, merchantKeys.privateKey.export({ type: "pkcs8", format: "pem" }));
    const provider = new RealWeChatPayProvider({
      appId: "wx",
      mchId: "m",
      apiV3Key: "D".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "merchant-serial"
    });
    const refresh = jest.spyOn(provider as any, "refreshPlatformCertificates")
      .mockImplementation(async () => {
        (provider as any).platformCerts = [{
          serialNo: "platform-serial",
          publicKeyPem: platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
          expireAt: Date.now() + 60_000
        }];
        (provider as any).platformCertsFetchedAt = Date.now();
      });
    const rawBody = JSON.stringify({ id: "evt-refresh" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-refresh";
    const signer = createSign("RSA-SHA256");
    signer.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    signer.end();
    const headers = {
      "wechatpay-timestamp": timestamp,
      "wechatpay-nonce": nonce,
      "wechatpay-signature": signer.sign(platformKeys.privateKey, "base64"),
      "wechatpay-serial": "platform-serial"
    };

    await expect(provider.verifyNotifySignatureAsync(headers, rawBody)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    unlinkSync(keyPath);
  });

  it("parses refund identity, transaction binding, and amount fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "wx-pay-"));
    const keyPath = join(dir, "key.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const provider = new RealWeChatPayProvider({
      appId: "",
      miniProgramAppId: "wx-mini-app",
      mchId: "1900000000",
      apiV3Key: "E".repeat(32),
      privateKeyPath: keyPath,
      certSerialNo: "s"
    });

    const payload = provider.parseRefundNotifyPayload(JSON.stringify({
      resource: {
        plaintext: {
          appid: "wx-mini-app",
          mchid: "1900000000",
          out_trade_no: "T777",
          transaction_id: "txn_777",
          out_refund_no: "R777",
          refund_id: "wx_refund_777",
          refund_status: "SUCCESS",
          amount: { total: 1200, refund: 1200, currency: "CNY" }
        }
      }
    }));

    expect(payload).toEqual(expect.objectContaining({
      appId: "wx-mini-app",
      mchId: "1900000000",
      outTradeNo: "T777",
      transactionId: "txn_777",
      outRefundNo: "R777",
      refundId: "wx_refund_777",
      status: "SUCCESS",
      totalAmountCents: 1200,
      refundAmountCents: 1200,
      currency: "CNY"
    }));

    unlinkSync(keyPath);
  });
});
