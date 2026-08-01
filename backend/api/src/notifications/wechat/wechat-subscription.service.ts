import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../database/prisma.service";
import { WeChatSubscribeTemplate } from "../../config/configuration";

@Injectable()
export class WeChatSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  listTemplates(requestedKeys?: string[]) {
    const requested = new Set((requestedKeys ?? []).filter(Boolean));
    const enabled = this.config.get<boolean>("WECHAT_SUBSCRIBE_MESSAGES_ENABLED") === true;
    const templates = this.config.get<WeChatSubscribeTemplate[]>("WECHAT_SUBSCRIBE_TEMPLATES") ?? [];
    if (!enabled) return { enabled: false, templates: [] };

    return {
      enabled: true,
      templates: templates
        .filter((template) => requested.size === 0 || requested.has(template.key))
        .map((template) => ({ key: template.key, templateId: template.templateId }))
    };
  }

  availabilityReminderChannel() {
    const channelEnabled = this.config.get<boolean>("WECHAT_SUBSCRIBE_MESSAGES_ENABLED") === true;
    const preparationRunnerEnabled =
      this.config.get<boolean>("AVAILABILITY_REMINDER_PREPARATION_ENABLED") === true;
    const deliveryRunnerEnabled =
      this.config.get<boolean>("AVAILABILITY_REMINDER_DELIVERY_ENABLED") === true;
    const templateConfigured = Boolean(this.findTemplate("availabilityReminder"));
    const available = channelEnabled
      && preparationRunnerEnabled
      && deliveryRunnerEnabled
      && templateConfigured;
    const reasonCode = !channelEnabled
      ? "CHANNEL_DISABLED"
      : !templateConfigured
        ? "TEMPLATE_UNAVAILABLE"
        : !preparationRunnerEnabled
          ? "PREPARATION_DISABLED"
          : !deliveryRunnerEnabled
            ? "DELIVERY_DISABLED"
            : null;
    return {
      available,
      channelEnabled,
      preparationRunnerEnabled,
      deliveryRunnerEnabled,
      templateConfigured,
      reasonCode,
      message: available
        ? "可约提醒通道当前可申请微信一次性订阅授权。"
        : "可约提醒通道尚未由平台正式启用；收藏功能仍可使用。"
    };
  }

  async recordGrant(userId: string, templateKey: string, granted: boolean) {
    const enabled = this.config.get<boolean>("WECHAT_SUBSCRIBE_MESSAGES_ENABLED") === true;
    const template = this.findTemplate(templateKey);
    if (!enabled || !template) {
      throw new BadRequestException("This subscription template is not available");
    }
    if (!granted) {
      return { recorded: false, reason: "not_granted" as const };
    }

    const recentCount = await this.prisma.weChatSubscriptionGrant.count({
      where: {
        userId,
        templateKey: template.key,
        templateId: template.templateId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) }
      }
    } as any);
    if (recentCount >= 10) {
      throw new HttpException(
        "Too many subscription authorization records for this template",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const grant = await this.prisma.weChatSubscriptionGrant.create({
      data: { userId, templateKey: template.key, templateId: template.templateId }
    } as any);
    return { recorded: true, grantId: grant.id, grantedAt: grant.grantedAt.toISOString() };
  }

  findTemplate(templateKey: string): WeChatSubscribeTemplate | undefined {
    const templates = this.config.get<WeChatSubscribeTemplate[]>("WECHAT_SUBSCRIBE_TEMPLATES") ?? [];
    return templates.find((template) => template.key === templateKey);
  }
}
