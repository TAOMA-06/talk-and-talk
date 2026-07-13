import { createCipheriv, generateKeyPairSync } from "node:crypto";
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
        WECHAT_PAY_APP_ID: "wx",
        WECHAT_PAY_MCH_ID: "m",
        WECHAT_PAY_API_V3_KEY: "k".repeat(32),
        WECHAT_PAY_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----",
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
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const inlinePrivateKey = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
      .replace(/\n/g, "\\n");

    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ prepay_id: "wx_prepay_abc" })
    });

    const provider = new RealWeChatPayProvider({
      appId: "wx_app",
      mchId: "1900000000",
      apiV3Key: "B".repeat(32),
      privateKey: inlinePrivateKey,
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

    const result = await provider.createMiniProgramPrepay({
      outTradeNo: "T1000", description: "test", amountCents: 100, notifyUrl: "https://api.example/notify", openId: "openid-1"
    });

    expect(result.channel).toBe("miniProgram");
    expect(result.clientParams.package).toBe("prepay_id=wx_mini_prepay");
    expect(result.clientParams.signType).toBe("RSA");
    expect(result.clientParams.paySign).toBeTruthy();
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v3/pay/transactions/jsapi");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      appid: "wx_mini_app", payer: { openid: "openid-1" }
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
      out_trade_no: "T777",
      transaction_id: "txn_777",
      trade_state: "SUCCESS",
      amount: { total: 1200 }
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
});
