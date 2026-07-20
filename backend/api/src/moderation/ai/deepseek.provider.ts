import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MetricsService } from "../../metrics/metrics.service";
import { ModerationCategory, ModerationContext } from "../rule-engine";
import { AIModerationResult, AIProvider } from "./ai-provider.interface";

@Injectable()
export class DeepSeekAIProvider implements AIProvider {
  private readonly logger = new Logger(DeepSeekAIProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService
  ) {}

  async moderate(text: string, _context?: ModerationContext): Promise<AIModerationResult> {
    const apiKey = this.config.get<string>("DEEPSEEK_API_KEY")?.trim();
    if (!apiKey) {
      return { score: 0.05, reasons: [], categories: [], provider: "deepseek", available: false };
    }

    const baseUrl = this.config.get<string>("DEEPSEEK_URL", "https://api.deepseek.com").replace(/\/$/, "");
    const model = this.config.get<string>("DEEPSEEK_MODEL", "deepseek-chat");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a content safety classifier for a companionship chat app. Return JSON only: {\"score\": number between 0 and 1, \"reasons\": string[], \"categories\": string[]}. Categories must be drawn from privateContact, offlineMeetup, privatePayment, fraudOrSpam, sexualContent, harassmentOrHate, privacy, selfHarm, violence, normal. Higher score means higher risk."
            },
            {
              role: "user",
              content: text
            }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        this.logger.warn(`DeepSeek moderation failed with status ${response.status}`);
        this.metrics.recordAiFailure();
        return { score: 0.05, reasons: [], categories: [], provider: "deepseek", available: false };
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as { score?: number; reasons?: string[]; categories?: string[] };
      const allowedCategories = new Set<ModerationCategory>([
        "privateContact", "offlineMeetup", "privatePayment", "fraudOrSpam", "sexualContent",
        "harassmentOrHate", "privacy", "selfHarm", "violence", "normal"
      ]);
      if (
        typeof parsed.score !== "number" ||
        !Number.isFinite(parsed.score) ||
        parsed.score < 0 ||
        parsed.score > 1 ||
        !Array.isArray(parsed.reasons) ||
        parsed.reasons.some((item) => typeof item !== "string") ||
        !Array.isArray(parsed.categories) ||
        parsed.categories.some((item) => typeof item !== "string" || !allowedCategories.has(item as ModerationCategory))
      ) {
        throw new Error("provider returned an invalid moderation schema");
      }
      const score = parsed.score;
      const reasons = parsed.reasons;
      const categories = parsed.categories as ModerationCategory[];

      return { score, reasons, categories, provider: "deepseek", providerVersion: model, available: true };
    } catch (error) {
      this.logger.warn(`DeepSeek moderation unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      this.metrics.recordAiFailure();
      return { score: 0.05, reasons: [], categories: [], provider: "deepseek", available: false };
    } finally {
      clearTimeout(timeout);
    }
  }
}
