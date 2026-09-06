import type { ConfigService } from "@nestjs/config";

export const PARTNER_CHAT_IDS = ["partner-chat-customer-a", "partner-chat-customer-b"];

export function partnerPreviewActive(config?: ConfigService): boolean {
  return config?.get<string>("APP_ENV") === "staging"
    && (config.get<string>("WEB_GATEWAY_SECRET", "").length >= 32)
    && /^[a-f0-9]{64}$/.test(config.get<string>("PARTNER_ACCESS_CODE_SHA256", ""))
    && Date.parse(config.get<string>("PARTNER_ACCESS_EXPIRES_AT", "")) > Date.now();
}

export function isPartnerChat(config: ConfigService | undefined, conversation: { id: string; userId: string; companionId: string }): boolean {
  return partnerPreviewActive(config) && conversation.companionId === "c1"
    && ["partner-customer-a", "partner-customer-b"].includes(conversation.userId)
    && conversation.id === conversation.userId.replace("partner-customer-", "partner-chat-customer-");
}
