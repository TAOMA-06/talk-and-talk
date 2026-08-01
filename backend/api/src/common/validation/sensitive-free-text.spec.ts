import { validate } from "class-validator";

import { detectSensitivePlaintext, IsSafeOperationalText } from "./sensitive-free-text";

class OperationalNoteDto {
  @IsSafeOperationalText()
  note!: string;
}

describe("sensitive operational free-text validation", () => {
  it.each([
    ["identityNumber", "身份证号：11010519491231002X"],
    ["paymentCard", "收款银行卡 4111 1111 1111 1111"],
    ["phoneNumber", "联系电话 13800138000"],
    ["password", "password = S3cret!"],
    ["securityCode", "CVV: 123"],
    ["verificationCode", "短信验证码 482913"],
    ["accessCredential", "access_token=abcdefghijklmno"],
    ["accessCredential", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"]
  ] as const)("detects %s plaintext", (kind, value) => {
    expect(detectSensitivePlaintext(value)).toBe(kind);
  });

  it.each([
    "手机号 138****8000，已通过原渠道核验",
    "银行卡 **** **** **** 4242",
    "身份证号 110***********02X",
    "验证码已核验，不记录原文",
    "密码已重置",
    "password: [REDACTED]",
    "证据见 evidence://case/kyc_123",
    "订单 123456 已完成复核"
  ])("allows masked, status-only, or reference text: %s", (value) => {
    expect(detectSensitivePlaintext(value)).toBeNull();
  });

  it("exposes a stable class-validator constraint", async () => {
    const unsafe = Object.assign(new OperationalNoteDto(), { note: "银行卡 4111 1111 1111 1111" });
    const [error] = await validate(unsafe);
    expect(error.constraints).toEqual(expect.objectContaining({
      isSafeOperationalText: expect.stringContaining("approved evidence reference")
    }));

    const safe = Object.assign(new OperationalNoteDto(), { note: "银行卡 **** **** **** 4242" });
    await expect(validate(safe)).resolves.toEqual([]);
  });
});
