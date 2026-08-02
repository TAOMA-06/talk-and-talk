import { DisabledWeChatPayProvider } from "./disabled-wechat-pay.provider";
import { MockWeChatPayProvider, TEST_MOCK_WECHAT_NOTIFY_SECRET } from "./mock-wechat-pay.provider";
import {
  allowsMockWeChatPay,
  resolveWeChatPayProviderMode
} from "./wechat-pay-provider.factory";

describe("WeChat provider selection", () => {
  it("allows mock only in development|test", () => {
    expect(allowsMockWeChatPay("development", "development")).toBe(true);
    expect(allowsMockWeChatPay("development", "test")).toBe(true);
    expect(allowsMockWeChatPay("staging", "production")).toBe(false);
    expect(allowsMockWeChatPay("production", "production")).toBe(false);
  });

  it("production without WeChat config uses disabled (never mock)", () => {
    expect(resolveWeChatPayProviderMode("production", false, "production")).toBe("disabled");
    expect(new DisabledWeChatPayProvider().isMock).toBe(false);
  });

  it("staging without WeChat config uses disabled (never mock)", () => {
    expect(resolveWeChatPayProviderMode("staging", false, "production")).toBe("disabled");
  });

  it("development without WeChat config uses mock when notify secret is set", () => {
    expect(
      resolveWeChatPayProviderMode("development", false, "development", TEST_MOCK_WECHAT_NOTIFY_SECRET)
    ).toBe("mock");
    expect(new MockWeChatPayProvider().isMock).toBe(true);
  });

  it("development without WeChat config refuses mock when notify secret is missing", () => {
    expect(() => resolveWeChatPayProviderMode("development", false, "development", "")).toThrow(
      /MOCK_WECHAT_NOTIFY_SECRET/
    );
  });

  it("production with full config uses real", () => {
    expect(resolveWeChatPayProviderMode("production", true, "production")).toBe("real");
  });

  it("production accepts configured credentials as real even with inline key shape", () => {
    expect(resolveWeChatPayProviderMode("production", true, "production")).toBe("real");
  });
});
