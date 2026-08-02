import { ConfigService } from "@nestjs/config";

import { DisabledWeChatPayProvider } from "./disabled-wechat-pay.provider";
import { MockWeChatPayProvider } from "./mock-wechat-pay.provider";
import { RealWeChatPayProvider, isWeChatConfigured } from "./real-wechat-pay.provider";
import { WeChatPayProvider } from "./wechat-pay.provider";

export type WeChatPayProviderMode = "real" | "mock" | "disabled";

/** Environments that may select Mock WeChat Pay. Staging/production never do. */
export function allowsMockWeChatPay(appEnv: string, nodeEnv?: string): boolean {
  if (appEnv === "staging" || appEnv === "production") {
    return false;
  }
  return appEnv === "development" || nodeEnv === "test";
}

export function resolveWeChatPayProviderMode(
  appEnv: string,
  configured: boolean,
  nodeEnv?: string,
  mockNotifySecret?: string
): WeChatPayProviderMode {
  if (configured) {
    return "real";
  }
  if (!allowsMockWeChatPay(appEnv, nodeEnv)) {
    return "disabled";
  }
  if ((mockNotifySecret ?? "").trim().length < 32) {
    throw new Error(
      "MOCK_WECHAT_NOTIFY_SECRET must be at least 32 characters when Mock WeChat Pay is enabled"
    );
  }
  return "mock";
}

export function createWeChatPayProvider(config: ConfigService): WeChatPayProvider {
  const appEnv = config.getOrThrow<string>("APP_ENV");
  const nodeEnv = config.get<string>("NODE_ENV") ?? process.env.NODE_ENV ?? "development";
  const env = {
    WECHAT_PAY_APP_ID: config.get<string>("WECHAT_PAY_APP_ID", ""),
    WECHAT_PAY_MCH_ID: config.get<string>("WECHAT_PAY_MCH_ID", ""),
    WECHAT_PAY_API_V3_KEY: config.get<string>("WECHAT_PAY_API_V3_KEY", ""),
    WECHAT_PAY_PRIVATE_KEY: config.get<string>("WECHAT_PAY_PRIVATE_KEY", ""),
    WECHAT_PAY_PRIVATE_KEY_PATH: config.get<string>("WECHAT_PAY_PRIVATE_KEY_PATH", ""),
    WECHAT_PAY_CERT_SERIAL_NO: config.get<string>("WECHAT_PAY_CERT_SERIAL_NO", ""),
    WECHAT_MINIPROGRAM_APP_ID: config.get<string>("WECHAT_MINIPROGRAM_APP_ID", "")
  };

  const notifySecret = config.get<string>("MOCK_WECHAT_NOTIFY_SECRET", "");
  const mode = resolveWeChatPayProviderMode(
    appEnv,
    isWeChatConfigured(env),
    nodeEnv,
    notifySecret
  );

  if (mode === "real") {
    return new RealWeChatPayProvider({
      appId: env.WECHAT_PAY_APP_ID,
      mchId: env.WECHAT_PAY_MCH_ID,
      apiV3Key: env.WECHAT_PAY_API_V3_KEY,
      privateKey: env.WECHAT_PAY_PRIVATE_KEY,
      privateKeyPath: env.WECHAT_PAY_PRIVATE_KEY_PATH,
      certSerialNo: env.WECHAT_PAY_CERT_SERIAL_NO,
      miniProgramAppId: env.WECHAT_MINIPROGRAM_APP_ID,
      // Plaintext notify resources are local/test fixtures only.
      allowPlaintextNotifyResource: allowsMockWeChatPay(appEnv, nodeEnv)
    });
  }

  if (mode === "disabled") {
    return new DisabledWeChatPayProvider();
  }

  return new MockWeChatPayProvider(notifySecret.trim());
}
