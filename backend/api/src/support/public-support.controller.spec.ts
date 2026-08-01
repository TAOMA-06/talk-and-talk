import { ConfigService } from "@nestjs/config";

import { PublicSupportController } from "./public-support.controller";

describe("PublicSupportController", () => {
  it("publishes only login-independent contact and service metadata", () => {
    const values: Record<string, unknown> = {
      LEGAL_OPERATOR_NAME: "上海示例网络科技有限公司",
      LEGAL_COMPLAINT_CHANNEL: "小程序内客服工单",
      LEGAL_CONTACT_EMAIL: "support@example.com",
      LEGAL_CONTACT_PHONE: "021-12345678",
      SUPPORT_PUBLIC_SERVICE_HOURS: "每天 09:00-21:00（北京时间）",
      SUPPORT_RESPONSE_HOURS: 24,
      SUPPORT_PUBLIC_STATUS_URL: "https://status.example.com"
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (!(key in values)) throw new Error(`missing ${key}`);
        return values[key];
      }),
      get: jest.fn((key: string) => values[key])
    };
    const controller = new PublicSupportController(config as unknown as ConfigService);

    expect(controller.info()).toEqual({
      operatorName: "上海示例网络科技有限公司",
      channel: "小程序内客服工单",
      email: "support@example.com",
      phone: "021-12345678",
      serviceHours: "每天 09:00-21:00（北京时间）",
      expectedFirstResponseHours: 24,
      statusUrl: "https://status.example.com",
      authenticatedTicketPath: "/support/tickets",
      ticketAccessRequiresLogin: true,
      emergencyBoundary: expect.stringContaining("不是急救")
    });
  });

  it("does not invent a status page when none is configured", () => {
    const values: Record<string, unknown> = {
      LEGAL_OPERATOR_NAME: "开发主体",
      LEGAL_COMPLAINT_CHANNEL: "站内工单",
      LEGAL_CONTACT_EMAIL: "",
      LEGAL_CONTACT_PHONE: "",
      SUPPORT_PUBLIC_SERVICE_HOURS: "工作日 09:00-18:00（北京时间）",
      SUPPORT_RESPONSE_HOURS: 24,
      SUPPORT_PUBLIC_STATUS_URL: ""
    };
    const config = {
      getOrThrow: jest.fn((key: string) => values[key]),
      get: jest.fn((key: string) => values[key])
    };

    expect(
      new PublicSupportController(config as unknown as ConfigService).info().statusUrl
    ).toBeNull();
  });
});
