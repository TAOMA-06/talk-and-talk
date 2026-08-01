import { api, ensureSession } from "../../utils/api";
import { CatalogDisplay, withCatalogDisplays } from "../../utils/catalog";
import { openCrisisResources, passCrisisGate } from "../../utils/crisis-gate";
import { CrisisInterventionRiskCode, RecommendedCompanion } from "../../utils/models";

type Scenario = {
  id: string;
  topicId: string;
  title: string;
  description: string;
  selected: boolean;
};

type HomeCompanion = CatalogDisplay<RecommendedCompanion>;

const SCENARIOS: Array<Omit<Scenario, "selected">> = [
  { id: "emotion", topicId: "t1", title: "想找人听我说", description: "情绪倾听" },
  { id: "work", topicId: "t2", title: "工作压力很大", description: "职场减压" },
  { id: "sleep", topicId: "t3", title: "睡前想有人陪", description: "睡前语音" },
  { id: "study", topicId: "t4", title: "需要一起专注", description: "学习陪伴" },
  { id: "exercise", topicId: "t5", title: "想获得一点鼓励", description: "运动鼓励" },
  { id: "interest", topicId: "t6", title: "随便聊聊兴趣", description: "兴趣聊天" }
];

const RISK_PATTERNS: Array<{ riskCode: CrisisInterventionRiskCode; pattern: RegExp }> = [
  { riskCode: "selfHarmSignal", pattern: /自杀|轻生|不想活|结束生命|伤害自己|自残/ },
  { riskCode: "violenceSignal", pattern: /杀(?:了|掉)?(?:他|她|人)|伤害别人|被打|家暴|暴力|强迫|绑架|勒索|威胁|跟踪/ },
  { riskCode: "immediateDangerSignal", pattern: /立即危险|现在危险|救命|报警/ }
];

const TOPIC_PATTERNS: Array<{ topicId: string; pattern: RegExp }> = [
  { topicId: "t2", pattern: /工作|职场|老板|同事|加班|面试|沟通|压力/ },
  { topicId: "t3", pattern: /睡不着|失眠|睡前|夜里|晚上/ },
  { topicId: "t4", pattern: /学习|考试|考研|专注|复习|作业/ },
  { topicId: "t5", pattern: /运动|健身|跑步|减脂|锻炼/ },
  { topicId: "t6", pattern: /电影|旅行|摄影|兴趣|游戏|随便聊|聊天/ },
  { topicId: "t1", pattern: /情绪|难过|委屈|孤独|失恋|焦虑|烦|倾听/ }
];

function displayScenarios(selectedId: string): Scenario[] {
  return SCENARIOS.map((item) => ({ ...item, selected: item.id === selectedId }));
}

function inferredTopic(value: string): string {
  return TOPIC_PATTERNS.find((item) => item.pattern.test(value))?.topicId || "";
}

Page({
  data: {
    intentInput: "",
    scenarios: displayScenarios(""),
    selectedScenarioId: "",
    selectedTopicId: "",
    riskDetected: false,
    detectedRiskCode: "" as CrisisInterventionRiskCode | "",
    riskAcknowledged: false,
    loading: true,
    error: "",
    recommendationsState: "loading" as "loading" | "available" | "empty" | "error",
    recommendationsError: "",
    recommendations: [] as HomeCompanion[],
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({
      loading: true,
      error: "",
      recommendations: [],
      recommendationsState: "loading",
      recommendationsError: ""
    });
    try {
      await ensureSession();
      await this.loadRecommendations();
      this.setData({
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: (error as Error).message || "首页暂时无法加载",
        recommendationsState: "error",
        recommendationsError: "登录状态尚未确认，无法读取推荐。"
      });
    }
  },
  async loadRecommendations() {
    this.setData({ recommendations: [], recommendationsState: "loading", recommendationsError: "" });
    try {
      const response = await api.recommendedCompanions({ placement: "discoverHome", pageSize: 4 });
      const recommendations = withCatalogDisplays(response.items || []);
      this.setData({
        recommendations,
        recommendationsState: recommendations.length ? "available" : "empty",
        recommendationsError: ""
      });
    } catch {
      this.setData({
        recommendations: [],
        recommendationsState: "error",
        recommendationsError: "当前推荐暂时无法读取。这不代表没有可约服务，你仍可进入发现页手动筛选。"
      });
    }
  },
  async retryRecommendations() {
    if (this.data.recommendationsState === "loading") return;
    await this.loadRecommendations();
  },
  setIntent(event: any) {
    const intentInput = String(event.detail?.value || "").slice(0, 120);
    const normalized = intentInput.trim();
    const detectedRiskCode = RISK_PATTERNS.find((item) => item.pattern.test(normalized))?.riskCode || "";
    const riskDetected = Boolean(detectedRiskCode);
    const selectedTopicId = riskDetected ? "" : inferredTopic(normalized);
    this.setData({
      intentInput,
      riskDetected,
      detectedRiskCode,
      riskAcknowledged: false,
      selectedTopicId,
      selectedScenarioId: "",
      scenarios: displayScenarios("")
    });
  },
  selectScenario(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (!scenario) return;
    const selected = this.data.selectedScenarioId === id ? null : scenario;
    this.setData({
      selectedScenarioId: selected?.id || "",
      selectedTopicId: selected?.topicId || "",
      scenarios: displayScenarios(selected?.id || ""),
      riskDetected: false,
      detectedRiskCode: "",
      riskAcknowledged: false
    });
  },
  acknowledgeNonEmergency() {
    this.setData({ riskAcknowledged: true });
  },
  openEmergencyHelp() {
    openCrisisResources({
      source: "homeIntent",
      riskCode: this.data.detectedRiskCode || "immediateDangerSignal"
    });
  },
  openDirectEmergencyHelp() {
    openCrisisResources({ source: "directEmergencyHelp", riskCode: "userRequested" });
  },
  openSafetyCenter() {
    wx.navigateTo({ url: "/pages/safety/index" });
  },
  async continueDiscovery() {
    if (this.data.riskDetected && !this.data.riskAcknowledged) {
      this.openEmergencyHelp();
      return;
    }
    if (!await passCrisisGate("homeIntent")) return;
    getApp().globalData.discoveryIntent = {
      ...(this.data.selectedTopicId ? { topicId: this.data.selectedTopicId } : {}),
      availableWithinDays: 3,
      sortBy: "soonestAvailable"
    };
    wx.switchTab({ url: "/pages/discover/index" });
  },
  async browseAll() {
    if (this.data.riskDetected && !this.data.riskAcknowledged) {
      openCrisisResources({
        source: "homeBrowseAll",
        riskCode: this.data.detectedRiskCode || "immediateDangerSignal"
      });
      return;
    }
    if (!await passCrisisGate("homeBrowseAll")) return;
    getApp().globalData.discoveryIntent = null;
    wx.switchTab({ url: "/pages/discover/index" });
  },
  async openCompanion(event: any) {
    if (this.data.riskDetected && !this.data.riskAcknowledged) {
      openCrisisResources({
        source: "homeRecommendation",
        riskCode: this.data.detectedRiskCode || "immediateDangerSignal"
      });
      return;
    }
    if (!await passCrisisGate("homeRecommendation")) return;
    const id = String(event.currentTarget.dataset.id || "");
    const impressionId = String(event.currentTarget.dataset.impressionId || "");
    const themeId = String(event.currentTarget.dataset.themeId || "");
    if (!id) return;
    const query = [
      `id=${encodeURIComponent(id)}`,
      impressionId ? `rid=${encodeURIComponent(impressionId)}` : "",
      themeId ? `themeId=${encodeURIComponent(themeId)}` : ""
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${query}` });
  }
});
