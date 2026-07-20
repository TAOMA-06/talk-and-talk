import { ConfigService } from "@nestjs/config";

import { DeepSeekAIProvider } from "./deepseek.provider";

describe("DeepSeekAIProvider", () => {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => ({
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_URL: "https://moderation.example",
      DEEPSEEK_MODEL: "review-model-v1"
    } as Record<string, unknown>)[key] ?? fallback)
  } as unknown as ConfigService;
  const metrics = { recordAiFailure: jest.fn() } as any;
  let provider: DeepSeekAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new DeepSeekAIProvider(config, metrics);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts only a complete, bounded classifier response", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          score: 0.7,
          reasons: ["疑似隐私索取"],
          categories: ["privacy"]
        }) } }]
      })
    } as Response);

    await expect(provider.moderate("请发我地址")).resolves.toEqual({
      score: 0.7,
      reasons: ["疑似隐私索取"],
      categories: ["privacy"],
      provider: "deepseek",
      providerVersion: "review-model-v1",
      available: true
    });
    expect(metrics.recordAiFailure).not.toHaveBeenCalled();
  });

  it("marks malformed or out-of-range model output unavailable instead of defaulting safe", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          score: 1.5,
          reasons: [],
          categories: ["invented-category"]
        }) } }]
      })
    } as Response);

    await expect(provider.moderate("普通内容")).resolves.toEqual({
      score: 0.05,
      reasons: [],
      categories: [],
      provider: "deepseek",
      available: false
    });
    expect(metrics.recordAiFailure).toHaveBeenCalledTimes(1);
  });
});
