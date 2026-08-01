import { LegalController } from "./legal.controller";

describe("LegalController startup publication", () => {
  it("archives all current legal documents before the application accepts traffic", async () => {
    const values: Record<string, unknown> = {
      REFUND_REQUEST_WINDOW_HOURS: 72,
      REFUND_POLICY_VERSION: "2026.08-v1",
      COMPANION_SETTLEMENT_HOLD_HOURS: 96,
      LEGAL_PRIVACY_RETENTION_DAYS: 1095,
      LEGAL_OPERATOR_NAME: "示例运营主体",
      LEGAL_CONTACT_EMAIL: "legal@operator.test",
      LEGAL_CONTACT_PHONE: "4000000000",
      LEGAL_COMPLAINT_CHANNEL: "小程序客服工单",
      LEGAL_PLATFORM_RULES_URL: "https://api.operator.test/api/v1/legal/platform-rules",
      LEGAL_CONSENT_VERSION: "2.2-2026-08-01",
      LEGAL_CONSENT_EFFECTIVE_DATE: "2026-08-01"
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
      "2.2-2026-08-01",
      expect.stringMatching(/Talk&Talk 用户协议与平台规则[\s\S]*规则版本为 2026\.08-v1[\s\S]*服务完成后 72 小时[\s\S]*订单创建时会固定该规则版本和小时数/)
    );
    expect(archive.ensureSnapshot).toHaveBeenCalledWith(
      "privacy",
      "2.2-2026-08-01",
      expect.stringMatching(/内容安全处理边界[\s\S]*不会把上述用户原文[\s\S]*DeepSeek（深度求索）[\s\S]*代码配置不能替代合资格法律顾问的判断[\s\S]*实时音视频 TRTC SDK[\s\S]*深圳市腾讯计算机系统有限公司[\s\S]*只有当前版本《隐私政策》已同意[\s\S]*不启用云端录制/)
    );
    expect(archive.ensureSnapshot).toHaveBeenCalledWith(
      "platformRules",
      "2.2-2026-08-01",
      expect.stringContaining("Talk&Talk 平台规则")
    );
  });
});
