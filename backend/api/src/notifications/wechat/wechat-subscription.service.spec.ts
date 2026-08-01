import { HttpStatus } from "@nestjs/common";

import { WeChatSubscriptionService } from "./wechat-subscription.service";

describe("WeChatSubscriptionService", () => {
  const prisma = {
    weChatSubscriptionGrant: {
      count: jest.fn(),
      create: jest.fn()
    }
  } as any;
  const templates = [
    { key: "orderConfirmed", templateId: "tmpl-confirmed" },
    { key: "paymentSuccess", templateId: "tmpl-paid" }
  ];
  const config = {
    get: jest.fn((key: string) => {
      if (key === "WECHAT_SUBSCRIBE_MESSAGES_ENABLED") return true;
      if (key === "WECHAT_SUBSCRIBE_TEMPLATES") return templates;
      return undefined;
    })
  } as any;
  let service: WeChatSubscriptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WeChatSubscriptionService(prisma, config);
  });

  it("only exposes requested, configured subscription templates", () => {
    expect(service.listTemplates(["paymentSuccess", "notConfigured"])).toEqual({
      enabled: true,
      templates: [{ key: "paymentSuccess", templateId: "tmpl-paid" }]
    });
  });

  it("fails closed until the complete availability-reminder channel is enabled", () => {
    config.get.mockImplementation((key: string) => {
      if (key === "WECHAT_SUBSCRIBE_MESSAGES_ENABLED") return true;
      if (key === "WECHAT_SUBSCRIBE_TEMPLATES") return [
        ...templates,
        { key: "availabilityReminder", templateId: "tmpl-reminder" }
      ];
      if (key === "AVAILABILITY_REMINDER_PREPARATION_ENABLED") return true;
      if (key === "AVAILABILITY_REMINDER_DELIVERY_ENABLED") return false;
      return undefined;
    });

    expect(service.availabilityReminderChannel()).toEqual(expect.objectContaining({
      available: false,
      channelEnabled: true,
      preparationRunnerEnabled: true,
      deliveryRunnerEnabled: false,
      templateConfigured: true,
      reasonCode: "DELIVERY_DISABLED"
    }));
  });

  it("reports availability reminders available only when channel, template and both runners are present", () => {
    config.get.mockImplementation((key: string) => {
      if (key === "WECHAT_SUBSCRIBE_MESSAGES_ENABLED") return true;
      if (key === "WECHAT_SUBSCRIBE_TEMPLATES") return [
        ...templates,
        { key: "availabilityReminder", templateId: "tmpl-reminder" }
      ];
      if (key === "AVAILABILITY_REMINDER_PREPARATION_ENABLED") return true;
      if (key === "AVAILABILITY_REMINDER_DELIVERY_ENABLED") return true;
      return undefined;
    });

    expect(service.availabilityReminderChannel()).toEqual(expect.objectContaining({
      available: true,
      reasonCode: null
    }));
  });

  it("records an explicit user grant for a configured template", async () => {
    prisma.weChatSubscriptionGrant.count.mockResolvedValue(0);
    prisma.weChatSubscriptionGrant.create.mockResolvedValue({
      id: "grant-1",
      grantedAt: new Date("2026-07-20T00:00:00.000Z")
    });

    const result = await service.recordGrant("user-1", "orderConfirmed", true);

    expect(result).toEqual({ recorded: true, grantId: "grant-1", grantedAt: "2026-07-20T00:00:00.000Z" });
    expect(prisma.weChatSubscriptionGrant.create).toHaveBeenCalledWith({
      data: { userId: "user-1", templateKey: "orderConfirmed", templateId: "tmpl-confirmed" }
    });
  });

  it("rate limits recorded grants per user and template", async () => {
    prisma.weChatSubscriptionGrant.count.mockResolvedValue(10);

    await expect(service.recordGrant("user-1", "orderConfirmed", true)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS
    });
    expect(prisma.weChatSubscriptionGrant.create).not.toHaveBeenCalled();
  });
});
