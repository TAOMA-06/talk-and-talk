import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MetricsService } from "../../metrics/metrics.service";
import { ModerationContext } from "../rule-engine";
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
      return { score: 0.05, reasons: [], available: false };
    }

    const baseUrl = this.config.get<string>("DEEPSEEK_URL", "https://api.deepseek.com").replace(/\/$/, "");
    const model = this.config.get<string>("DEEPSEEK_MODEL", "deepseek-chat");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
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
                "You are a content safety classifier for a companionship chat app. Return JSON only: {\"score\": number between 0 and 1, \"reasons\": string[]}. Higher score means higher risk of private contact, offline meetup, money transfer, harassment, or ads."
            },
            {
              role: "user",
              content: text
            }
          ]
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`DeepSeek moderation failed with status ${response.status}`);
        this.metrics.recordAiFailure();
        return { score: 0.05, reasons: [], available: false };
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as { score?: number; reasons?: string[] };
      const score = typeof parsed.score === "number" ? Math.min(1, Math.max(0, parsed.score)) : 0.05;
      const reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((item): item is string => typeof item === "string")
        : [];

      return { score, reasons, available: true };
    } catch (error) {
      this.logger.warn(`DeepSeek moderation unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      this.metrics.recordAiFailure();
      return { score: 0.05, reasons: [], available: false };
    }
  }
}
