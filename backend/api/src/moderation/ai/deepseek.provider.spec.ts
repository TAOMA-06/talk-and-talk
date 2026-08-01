import { DeepSeekAIProvider } from "./deepseek.provider";

describe("DeepSeekAIProvider privacy boundary", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    "今天有点难过，想找人聊聊",
    "我最近在吃抗抑郁药",
    "我不想活了",
    "这是我的手机号 13800138000",
    "我的名字是小林",
    "普通问候"
  ])("never transmits user-authored text to the generic DeepSeek service: %s", async (text) => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const provider = new DeepSeekAIProvider();

    await expect(provider.moderate(text)).resolves.toEqual({
      score: 0.05,
      reasons: [],
      categories: [],
      provider: "deepseek",
      available: false,
      skippedForPrivacy: true
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
