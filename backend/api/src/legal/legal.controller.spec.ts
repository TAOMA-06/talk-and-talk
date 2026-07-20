import { LegalController } from "./legal.controller";

describe("LegalController startup publication", () => {
  it("archives all current legal documents before the application accepts traffic", async () => {
    const values: Record<string, unknown> = {
      REFUND_REQUEST_WINDOW_HOURS: 72,
      COMPANION_SETTLEMENT_HOLD_HOURS: 96,
      LEGAL_PRIVACY_RETENTION_DAYS: 1095,
      LEGAL_OPERATOR_NAME: "示例运营主体",
      LEGAL_CONTACT_EMAIL: "legal@operator.test",
      LEGAL_CONTACT_PHONE: "4000000000",
      LEGAL_COMPLAINT_CHANNEL: "小程序客服工单",
      LEGAL_PLATFORM_RULES_URL: "https://api.operator.test/api/v1/legal/platform-rules",
      LEGAL_CONSENT_VERSION: "2.0-2026-07-20",
      LEGAL_CONSENT_EFFECTIVE_DATE: "2026-07-20"
    };
    const config = { getOrThrow: jest.fn((key: string) => values[key]) } as any;
    const archive = {
      ensureSnapshot: jest.fn().mockResolvedValue({})
    } as any;
    const controller = new LegalController(config, archive);

    await controller.onModuleInit();

    expect(archive.ensureSnapshot).toHaveBeenCalledTimes(3);
    expect(archive.ensureSnapshot).toHaveBeenCalledWith(
      "terms",
      "2.0-2026-07-20",
      expect.stringContaining("Talk&Talk 用户协议与平台规则")
    );
    expect(archive.ensureSnapshot).toHaveBeenCalledWith(
      "privacy",
      "2.0-2026-07-20",
      expect.stringContaining("Talk&Talk 隐私政策")
    );
    expect(archive.ensureSnapshot).toHaveBeenCalledWith(
      "platformRules",
      "2.0-2026-07-20",
      expect.stringContaining("Talk&Talk 平台规则")
    );
  });
});
