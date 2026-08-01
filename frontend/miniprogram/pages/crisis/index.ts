import { api } from "../../utils/api";
import {
  clearPendingCrisisRoute,
  pendingCrisisRoute,
  rememberPendingCrisisIntervention
} from "../../utils/crisis-gate";
import {
  CrisisInterventionRiskCode,
  CrisisInterventionSource,
  CrisisResource,
  CrisisResourceCatalog
} from "../../utils/models";

const SOURCES: CrisisInterventionSource[] = [
  "homeIntent", "homeBrowseAll", "homeRecommendation", "discover",
  "companionDetail", "order", "chatSafetyRule", "directEmergencyHelp"
];
const RISK_CODES: CrisisInterventionRiskCode[] = [
  "userRequested", "selfHarmSignal", "violenceSignal", "immediateDangerSignal", "chatSafetyRule"
];

const FALLBACK_RESOURCES: CrisisResource[] = [
  {
    code: "110",
    name: "公安报警电话",
    kind: "policeEmergency",
    phone: "110",
    region: "CN",
    availability: "紧急情况请立即拨打，以所在地接通情况为准",
    officialSourceOrganization: "北京市通信管理局（工业和信息化部属地管理机构）",
    officialSourceTitle: "我国常用公益服务号码说明",
    officialSourceUrl: "https://bjca.miit.gov.cn/zwgk/tzgg/art/2022/art_8d4eb93ee3424f30826c97ee400e8937.html",
    lastVerifiedOn: "2026-08-01"
  },
  {
    code: "120",
    name: "医疗急救电话",
    kind: "medicalEmergency",
    phone: "120",
    region: "CN",
    availability: "需要紧急医疗救助时请立即拨打，以所在地接通情况为准",
    officialSourceOrganization: "国家卫生健康委员会",
    officialSourceTitle: "院前医疗急救管理办法",
    officialSourceUrl: "https://www.nhc.gov.cn/wjw/c100175/200405/e92b87688a3447298d83aeed79f3cdab.shtml",
    lastVerifiedOn: "2026-08-01"
  }
];

const FALLBACK_CATALOG: CrisisResourceCatalog = {
  policyVersion: "cn-emergency-resources-2026-08-01",
  requestedRegion: "CN",
  coverageRegion: "CN",
  coverageStatus: "emergencyBaselineOnly",
  approved: false,
  coverageStatement: "当前仅提供110、120全国基础紧急号码，不代表完整地区资源覆盖；完整资源目录尚未获得发布审批。",
  disclaimers: {
    platformCannotDispatch: true,
    platformCannotDispatchText: "Talk&Talk 不会代替你报警、呼叫救护车或实施现场救援。",
    ordinarySupportNotEmergencyText: "普通客服工单不是紧急服务，不能保证即时响应。"
  },
  resources: FALLBACK_RESOURCES
};

Page({
  data: {
    region: "CN",
    coverageStatement: FALLBACK_CATALOG.coverageStatement,
    approved: false,
    resources: FALLBACK_RESOURCES,
    loading: true,
    loadNotice: "正在核验最新资源；基础紧急号码已可使用。",
    completing: false,
    completionError: "",
    platformCannotDispatchText: FALLBACK_CATALOG.disclaimers.platformCannotDispatchText,
    ordinarySupportNotEmergencyText: FALLBACK_CATALOG.disclaimers.ordinarySupportNotEmergencyText
  },
  interventionId: "",
  source: "directEmergencyHelp" as CrisisInterventionSource,
  riskCode: "userRequested" as CrisisInterventionRiskCode,
  onLoad(query: Record<string, string | undefined>) {
    const local = pendingCrisisRoute();
    this.source = SOURCES.includes(query.source as CrisisInterventionSource)
      ? query.source as CrisisInterventionSource
      : local?.source || "directEmergencyHelp";
    this.riskCode = RISK_CODES.includes(query.riskCode as CrisisInterventionRiskCode)
      ? query.riskCode as CrisisInterventionRiskCode
      : local?.riskCode || "userRequested";
    this.interventionId = String(query.id || local?.id || "");
    const region = /^CN(?:-[0-9]{2})?$/.test(String(query.region || local?.region || ""))
      ? String(query.region || local?.region)
      : "CN";
    this.setData({ region });
    void this.load(region);
  },
  async load(region: string) {
    this.setData({ loading: true, loadNotice: "正在核验最新资源；基础紧急号码已可使用。" });
    try {
      const catalog = await api.crisisResources(region);
      this.setData({
        region: catalog.requestedRegion,
        coverageStatement: catalog.coverageStatement,
        approved: catalog.approved,
        resources: catalog.resources,
        platformCannotDispatchText: catalog.disclaimers.platformCannotDispatchText,
        ordinarySupportNotEmergencyText: catalog.disclaimers.ordinarySupportNotEmergencyText,
        loadNotice: ""
      });
    } catch {
      this.setData({
        region,
        approved: false,
        resources: FALLBACK_RESOURCES,
        coverageStatement: FALLBACK_CATALOG.coverageStatement,
        loadNotice: "网络暂不可用，当前显示已内置的110、120基础紧急号码。"
      });
    } finally {
      this.setData({ loading: false });
    }
    await this.ensureIntervention(region);
  },
  async ensureIntervention(region: string) {
    if (this.interventionId) {
      try {
        const intervention = await api.crisisIntervention(this.interventionId);
        if (intervention.status === "resourcesPending") rememberPendingCrisisIntervention(intervention);
      } catch { /* Public resources remain available without an authenticated fact read. */ }
      return;
    }
    try {
      const intervention = await api.createCrisisIntervention({
        source: this.source,
        riskCode: this.riskCode,
        region
      });
      this.interventionId = intervention.id;
      rememberPendingCrisisIntervention(intervention);
    } catch { /* The embedded emergency baseline must never wait on authentication or network. */ }
  },
  callResource(event: any) {
    const phoneNumber = String(event.currentTarget.dataset.phone || "");
    if (!/^\d{3,6}$/.test(phoneNumber)) return;
    wx.makePhoneCall({ phoneNumber });
  },
  copyOfficialSource(event: any) {
    const url = String(event.currentTarget.dataset.url || "");
    if (!url.startsWith("https://")) return;
    wx.setClipboardData({ data: url });
  },
  async completeResourceView() {
    if (this.data.completing) return;
    this.setData({ completing: true, completionError: "" });
    try {
      const serverRecorded = Boolean(this.interventionId);
      if (serverRecorded) await api.completeCrisisResourceView(this.interventionId);
      clearPendingCrisisRoute();
      wx.showToast({ title: serverRecorded ? "已记录你查看了资源" : "已查看这些资源", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: "/pages/home/index" })
        });
      }, 300);
    } catch (error) {
      this.setData({ completionError: (error as Error).message || "暂时无法记录，请稍后重试" });
    } finally {
      this.setData({ completing: false });
    }
  }
});
