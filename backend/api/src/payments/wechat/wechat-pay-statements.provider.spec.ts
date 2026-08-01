import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
  KeyObject
} from "node:crypto";

import { DisabledWeChatPayProvider } from "./disabled-wechat-pay.provider";
import { MockWeChatPayProvider } from "./mock-wechat-pay.provider";
import { RealWeChatPayProvider } from "./real-wechat-pay.provider";
import {
  WeChatDailyStatementInput,
  WECHAT_DAILY_STATEMENT_MAX_BYTES
} from "./wechat-pay.provider";

describe("WeChat Pay T+1 statement provider boundary", () => {
  const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const merchantPrivateKey = merchant.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  function provider(fetchImpl: jest.Mock, verifyResponseSignatures = false) {
    const value = new RealWeChatPayProvider({
      appId: "wx-app",
      mchId: "1900000000",
      apiV3Key: "S".repeat(32),
      privateKey: merchantPrivateKey,
      certSerialNo: "MERCHANT-SERIAL",
      apiBaseUrl: "https://example.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyResponseSignatures
    });
    (value as any).platformCerts = [{
      serialNo: "PLATFORM-SERIAL",
      publicKeyPem: platform.publicKey.export({ type: "spki", format: "pem" }).toString(),
      expireAt: Date.now() + 60_000
    }];
    return value;
  }

  function signedJsonResponse(body: string, privateKey: KeyObject = platform.privateKey): Response {
    const timestamp = "1785542400";
    const nonce = "bill-application-response";
    const signer = createSign("RSA-SHA256");
    signer.update(`${timestamp}\n${nonce}\n${body}\n`);
    signer.end();
    return new Response(body, {
      status: 200,
      headers: {
        "Wechatpay-Serial": "PLATFORM-SERIAL",
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": nonce,
        "Wechatpay-Signature": signer.sign(privateKey, "base64")
      }
    });
  }

  function applicationBody(downloadUrl: string, bytes: Uint8Array, hash?: string): string {
    return JSON.stringify({
      hash_type: "SHA1",
      hash_value: hash ?? createHash("sha1").update(bytes).digest("hex"),
      download_url: downloadUrl
    });
  }

  it("verifies the application response, signs the complete download path/query, and accepts an unsigned file response", async () => {
    const bytes = Buffer.from("交易时间,商户订单号,金额\n2026-07-31,T-1,10.00\n", "utf8");
    const downloadUrl = "https://example.test/v3/bill/downloadurl?token=a%2Fb&part=2";
    const application = applicationBody(downloadUrl, bytes);
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(signedJsonResponse(application))
      // Official bill downloads intentionally have no Wechatpay-* signature headers.
      .mockResolvedValueOnce(new Response(bytes, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      }));
    const value = provider(fetchImpl, true);

    const result = await value.downloadDailyStatement({
      billDate: "2026-07-31",
      kind: "tradeAll"
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://example.test/v3/bill/tradebill?bill_date=2026-07-31&bill_type=ALL"
    );
    expect(fetchImpl.mock.calls[0][0]).not.toContain("tar_type");
    expect(fetchImpl.mock.calls[1][0]).toBe(downloadUrl);
    expect(fetchImpl.mock.calls[1][1].redirect).toBe("error");
    expect(result).toMatchObject({
      status: "downloaded",
      billDate: "2026-07-31",
      kind: "tradeAll",
      text: bytes.toString("utf8"),
      sizeBytes: bytes.byteLength,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
    if (result.status !== "downloaded") throw new Error("expected downloaded result");
    expect(Buffer.from(result.bytes)).toEqual(bytes);

    const authorization = String(fetchImpl.mock.calls[1][1].headers.Authorization);
    const fields = Object.fromEntries(
      [...authorization.matchAll(/([a-z_]+)="([^"]*)"/g)].map((match) => [match[1], match[2]])
    );
    const verifier = createVerify("RSA-SHA256");
    verifier.update(
      `GET\n/v3/bill/downloadurl?token=a%2Fb&part=2\n${fields.timestamp}\n${fields.nonce_str}\n\n`
    );
    verifier.end();
    expect(verifier.verify(merchant.publicKey, fields.signature, "base64")).toBe(true);
  });

  it("maps all four statement kinds without ever requesting GZIP and returns explicit noStatement", async () => {
    const inputs: Array<[WeChatDailyStatementInput["kind"], string]> = [
      ["tradeAll", "/v3/bill/tradebill?bill_date=2026-07-31&bill_type=ALL"],
      ["fundBasic", "/v3/bill/fundflowbill?bill_date=2026-07-31&account_type=BASIC"],
      ["fundOperation", "/v3/bill/fundflowbill?bill_date=2026-07-31&account_type=OPERATION"],
      ["fundFees", "/v3/bill/fundflowbill?bill_date=2026-07-31&account_type=FEES"]
    ];

    for (const [kind, expectedPath] of inputs) {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(
        JSON.stringify({ code: "NO_STATEMENT_EXIST", message: "none" }),
        { status: 400 }
      ));
      await expect(provider(fetchImpl).downloadDailyStatement({ billDate: "2026-07-31", kind }))
        .resolves.toEqual({ status: "noStatement", billDate: "2026-07-31", kind });
      expect(fetchImpl.mock.calls[0][0]).toBe(`https://example.test${expectedPath}`);
      expect(fetchImpl.mock.calls[0][0]).not.toContain("tar_type");
    }
  });

  it("rejects an application response whose platform signature is invalid", async () => {
    const bytes = Buffer.from("bill", "utf8");
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fetchImpl = jest.fn().mockResolvedValue(signedJsonResponse(
      applicationBody("https://example.test/v3/billdownload/file?token=secret", bytes),
      attacker.privateKey
    ));

    await expect(provider(fetchImpl, true).downloadDailyStatement({
      billDate: "2026-07-31",
      kind: "tradeAll"
    })).rejects.toMatchObject({ code: "WECHAT_RESPONSE_SIGNATURE_INVALID" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://api.mch.weixin.qq.com/v3/billdownload/file?token=secret",
    "https://api.mch.weixin.qq.com.evil.test/v3/billdownload/file?token=secret",
    "https://api.mch.weixin.qq.com:444/v3/billdownload/file?token=secret",
    "https://example.test/v3/private?token=secret",
    "https://user:pass@example.test/v3/billdownload/file?token=secret",
    "https://example.test/v3/billdownload/file?token=secret#fragment"
  ])("rejects unapproved bill download URL without fetching or exposing its token: %s", async (downloadUrl) => {
    const bytes = Buffer.from("bill", "utf8");
    const fetchImpl = jest.fn().mockResolvedValue(new Response(applicationBody(downloadUrl, bytes)));
    const value = provider(fetchImpl);

    let caught: any;
    try {
      await value.downloadDailyStatement({ billDate: "2026-07-31", kind: "tradeAll" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "WECHAT_BILL_DOWNLOAD_URL_REJECTED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(caught.getResponse())).not.toContain("secret");
  });

  it("fails closed on SHA1 mismatch without returning or exposing the downloaded body", async () => {
    const bytes = Buffer.from("sensitive bill body", "utf8");
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(applicationBody(
        "https://example.test/v3/billdownload/file?token=secret-token",
        bytes,
        "0".repeat(40)
      )))
      .mockResolvedValueOnce(new Response(bytes));
    const value = provider(fetchImpl);

    let caught: any;
    try {
      await value.downloadDailyStatement({ billDate: "2026-07-31", kind: "fundBasic" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "WECHAT_BILL_HASH_MISMATCH" });
    const publicError = JSON.stringify(caught.getResponse());
    expect(publicError).not.toContain("sensitive bill body");
    expect(publicError).not.toContain("secret-token");
  });

  it("rejects a bill above 20 MB before consuming its body", async () => {
    const bytes = Buffer.from("small fixture", "utf8");
    const downloadUrl = "https://example.test/v3/billdownload/file?token=size";
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(applicationBody(downloadUrl, bytes)))
      .mockResolvedValueOnce(new Response(bytes, {
        headers: { "Content-Length": String(WECHAT_DAILY_STATEMENT_MAX_BYTES + 1) }
      }));

    await expect(provider(fetchImpl).downloadDailyStatement({
      billDate: "2026-07-31",
      kind: "fundFees"
    })).rejects.toMatchObject({ code: "WECHAT_BILL_TOO_LARGE" });
  });

  it("redacts upstream response bodies for non-no-statement application errors", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "STATEMENT_CREATING",
      message: "private-upstream-body-token"
    }), { status: 400 }));
    const value = provider(fetchImpl);

    let caught: any;
    try {
      await value.downloadDailyStatement({ billDate: "2026-07-31", kind: "fundOperation" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "WECHAT_BILL_APPLICATION_FAILED",
      details: { status: 400, upstreamCode: "STATEMENT_CREATING" }
    });
    expect(JSON.stringify(caught.getResponse())).not.toContain("private-upstream-body-token");
  });

  it("lets mock providers return noStatement or deterministic UTF-8 fixtures", async () => {
    const empty = new MockWeChatPayProvider();
    await expect(empty.downloadDailyStatement({ billDate: "2026-07-31", kind: "tradeAll" }))
      .resolves.toEqual({ status: "noStatement", billDate: "2026-07-31", kind: "tradeAll" });

    const text = "交易时间,金额\n2026-07-31,10.00\n";
    const fixture = new MockWeChatPayProvider([{
      billDate: "2026-07-31",
      kind: "tradeAll",
      text
    }]);
    const result = await fixture.downloadDailyStatement({ billDate: "2026-07-31", kind: "tradeAll" });
    expect(result).toMatchObject({
      status: "downloaded",
      text,
      sha256: createHash("sha256").update(Buffer.from(text)).digest("hex")
    });
  });

  it("keeps disabled statement retrieval fail-closed", async () => {
    await expect(new DisabledWeChatPayProvider().downloadDailyStatement({
      billDate: "2026-07-31",
      kind: "tradeAll"
    })).rejects.toMatchObject({ code: "WECHAT_PAY_NOT_CONFIGURED", status: 503 });
  });
});
