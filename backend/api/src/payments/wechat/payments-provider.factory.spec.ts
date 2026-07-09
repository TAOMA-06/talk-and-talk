import { ConfigService } from "@nestjs/config";

import { DisabledWeChatPayProvider } from "./disabled-wechat-pay.provider";
import { MockWeChatPayProvider } from "./mock-wechat-pay.provider";

/**
 * Mirrors payments.module.ts factory selection logic for unit coverage
 * without bootstrapping the full Nest module graph.
 */
function selectWeChatProvider(config: ConfigService) {
  const appEnv = config.getOrThrow<string>("APP_ENV");
  const env = {
    WECHAT_PAY_APP_ID: config.get<string>("WECHAT_PAY_APP_ID", ""),
    WECHAT_PAY_MCH_ID: config.get<string>("WECHAT_PAY_MCH_ID", ""),
    WECHAT_PAY_API_V3_KEY: config.get<string>("WECHAT_PAY_API_V3_KEY", ""),
    WECHAT_PAY_PRIVATE_KEY_PATH: config.get<string>("WECHAT_PAY_PRIVATE_KEY_PATH", ""),
    WECHAT_PAY_CERT_SERIAL_NO: config.get<string>("WECHAT_PAY_CERT_SERIAL_NO", "")
  };

  const configured = Boolean(
    env.WECHAT_PAY_APP_ID &&
      env.WECHAT_PAY_MCH_ID &&
      env.WECHAT_PAY_API_V3_KEY &&
      env.WECHAT_PAY_PRIVATE_KEY_PATH &&
      env.WECHAT_PAY_CERT_SERIAL_NO
  );

  if (appEnv === "production") {
    if (configured) {
      return "real";
    }
    return "disabled";
  }

  if (configured) {
    return "real";
  }
  return "mock";
}

describe("WeChat provider selection", () => {
  function makeConfig(map: Record<string, string>): ConfigService {
    return {
      getOrThrow: (key: string) => {
        if (!(key in map)) throw new Error(key);
        return map[key];
      },
      get: (key: string, fallback = "") => map[key] ?? fallback
    } as unknown as ConfigService;
  }

  it("production without WeChat config uses disabled (never mock)", () => {
    expect(selectWeChatProvider(makeConfig({ APP_ENV: "production" }))).toBe("disabled");
    expect(new DisabledWeChatPayProvider().isMock).toBe(false);
  });

  it("staging without WeChat config uses mock", () => {
    expect(selectWeChatProvider(makeConfig({ APP_ENV: "staging" }))).toBe("mock");
    expect(new MockWeChatPayProvider().isMock).toBe(true);
  });

  it("production with full config uses real", () => {
    expect(
      selectWeChatProvider(
        makeConfig({
          APP_ENV: "production",
          WECHAT_PAY_APP_ID: "wx",
          WECHAT_PAY_MCH_ID: "m",
          WECHAT_PAY_API_V3_KEY: "k".repeat(32),
          WECHAT_PAY_PRIVATE_KEY_PATH: "/run/secrets/wechat_private_key.pem",
          WECHAT_PAY_CERT_SERIAL_NO: "ser"
        })
      )
    ).toBe("real");
  });
});
