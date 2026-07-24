import { WeChatSubscribeMessageProvider } from "./wechat-subscribe-message.provider";

describe("WeChatSubscribeMessageProvider", () => {
  const input = {
    userId: "customer-1",
    templateKey: "availabilityReminder",
    templateId: "tmpl-reminder",
    title: "有新的可约时段",
    body: "打开小程序查看。"
  };

  const config = (enabled = true) => ({
    get: jest.fn((key: string) => ({
      WECHAT_SUBSCRIBE_MESSAGES_ENABLED: enabled,
      WECHAT_SUBSCRIBE_TEMPLATES: [{
        key: "availabilityReminder",
        templateId: "tmpl-reminder",
        data: { thing1: "{{title}}", thing2: "{{body}}" }
      }],
      WECHAT_MINIPROGRAM_APP_ID: "wx-test-app",
      WECHAT_MINIPROGRAM_APP_SECRET: "test-secret",
      APP_ENV: "test"
    } as Record<string, unknown>)[key])
  }) as any;

  const prisma = () => ({
    authIdentity: { findFirst: jest.fn().mockResolvedValue({ providerId: "openid-1" }) }
  }) as any;

  afterEach(() => jest.restoreAllMocks());

  it("classifies a disabled channel as definitely not attempted", async () => {
    const provider = new WeChatSubscribeMessageProvider(config(false), prisma());

    await expect(provider.send(input)).resolves.toEqual({
      outcome: "skipped",
      attempted: false,
      remoteState: "notAttempted",
      errorCode: "CHANNEL_DISABLED"
    });
  });

  it("classifies an explicit WeChat rejection separately from an unknown remote state", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token", expires_in: 7200 })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ errcode: 43101, errmsg: "user refuse to accept the msg" })
      } as Response);
    const provider = new WeChatSubscribeMessageProvider(config(), prisma());

    await expect(provider.send(input)).resolves.toEqual(expect.objectContaining({
      outcome: "failed",
      attempted: true,
      remoteState: "rejected",
      errorCode: "43101"
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks an acknowledged WeChat response as accepted and preserves its opaque message id", async () => {
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token", expires_in: 7200 })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errcode: 0, msgid: 12345 })
      } as Response);
    const provider = new WeChatSubscribeMessageProvider(config(), prisma());

    await expect(provider.send(input)).resolves.toEqual({
      outcome: "sent",
      attempted: true,
      remoteState: "accepted",
      providerMessageId: "12345"
    });
  });

  it("marks a post-token network failure as unknown instead of retryable", async () => {
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token", expires_in: 7200 })
      } as Response)
      .mockRejectedValueOnce(new Error("socket reset"));
    const provider = new WeChatSubscribeMessageProvider(config(), prisma());

    await expect(provider.send(input)).resolves.toEqual(expect.objectContaining({
      outcome: "failed",
      attempted: true,
      remoteState: "unknown",
      errorCode: "DELIVERY_UNKNOWN"
    }));
  });
});
