import { api, ApiError, currentUser, ensureSession } from "../../../utils/api";
import {
  approvedControlledEvidenceIds,
  chooseEvidenceAudio,
  chooseEvidenceImage,
  controlledEvidenceEnabled,
  ControlledEvidenceDraft,
  loadControlledEvidenceDrafts,
  LocalEvidenceFile,
  refreshControlledEvidenceDrafts,
  saveControlledEvidenceDrafts,
  uploadControlledEvidence,
  TEXT_ONLY_EVIDENCE_MESSAGE
} from "../../../utils/controlled-evidence";
import {
  CompanionIncident,
  SupportTicket,
  companionCommercialApi
} from "../../../utils/companion-commercial-api";

const INCIDENT_CATEGORIES = [
  { value: "technicalIssue", label: "技术故障" },
  { value: "lateArrival", label: "迟到" },
  { value: "noShow", label: "未出现" },
  { value: "harassment", label: "骚扰" },
  { value: "safetyBoundary", label: "安全或服务边界" },
  { value: "other", label: "其他" }
] as const;

const SUPPORT_CATEGORIES = [
  { value: "orderIssue", label: "订单履约" },
  { value: "safety", label: "安全事件" },
  { value: "privacy", label: "隐私问题" },
  { value: "general", label: "其他支持" }
] as const;

function formatDateTime(value?: string | null): string {
  if (!value) return "时间待确认";
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return "时间待确认";
  const date = new Date(source.getTime() + 8 * 60 * 60_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    ORDER_NOT_FOUND: "订单不存在或不属于当前陪伴者，平台不会接受越权举证。",
    SUPPORT_OPEN_LIMIT_REACHED: "未结工单数量已达到上限。安全类事件仍可提交，请先等待或处理现有普通工单。",
    SUPPORT_ORDER_FACT_SENSITIVE_CONTENT: "事实补充中疑似包含身份、联系方式、证件或健康隐私，请删除后重试。",
    SUPPORT_ORDER_FACT_INVALID: "请至少用5个字描述可核验的订单事实。",
    SUPPORT_TICKET_CLOSED: "该工单已经结束，不能继续补充事实。",
    SUPPORT_TICKET_NOT_FOUND: "工单不存在、不属于当前账号或不支持补充订单事实。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

Page({
  data: {
    loading: true,
    error: "",
    suspended: false,
    incidentCategories: INCIDENT_CATEGORIES,
    supportCategories: SUPPORT_CATEGORIES,
    incidentCategoryIndex: 0,
    incidentOrderId: "",
    incidentSummary: "",
    textOnly: !controlledEvidenceEnabled(),
    incidentEvidenceDrafts: [] as ControlledEvidenceDraft[],
    incidentEvidenceUploading: false,
    supportCategoryIndex: 0,
    supportOrderId: "",
    supportSubject: "",
    supportBody: "",
    incidents: [] as Array<CompanionIncident & {
      categoryText: string;
      statusText: string;
      createdText: string;
    }>,
    incidentPage: 1,
    incidentTotalPages: 1,
    incidentTotal: 0,
    tickets: [] as Array<SupportTicket & {
      categoryText: string;
      statusText: string;
      createdText: string;
      dueText: string;
    }>,
    ticketPage: 1,
    ticketTotalPages: 1,
    ticketTotal: 0,
    saving: false,
    factTicketId: "",
    factStatement: "",
    savingFact: false,
    factEvidenceDrafts: [] as ControlledEvidenceDraft[],
    factEvidenceUploading: false
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [incidents, tickets, overview] = await Promise.all([
        companionCommercialApi.incidents({ page: this.data.incidentPage, pageSize: 20 }),
        companionCommercialApi.supportTickets({ page: this.data.ticketPage, pageSize: 20 }),
        companionCommercialApi.overview()
      ]);
      const incidentLabels = Object.fromEntries(INCIDENT_CATEGORIES.map((item) => [item.value, item.label]));
      const supportLabels = Object.fromEntries(SUPPORT_CATEGORIES.map((item) => [item.value, item.label]));
      const statusLabels: Record<string, string> = {
        open: "已受理待处理",
        inReview: "处理中",
        resolved: "已解决",
        closed: "已关闭"
      };
      const evidenceEnabled = controlledEvidenceEnabled();
      const incidentEvidenceDrafts = evidenceEnabled
        ? await refreshControlledEvidenceDrafts(loadControlledEvidenceDrafts(this.incidentEvidenceStorageKey()))
        : [];
      saveControlledEvidenceDrafts(this.incidentEvidenceStorageKey(), incidentEvidenceDrafts);
      this.setData({
        loading: false,
        suspended: overview.commercialProfile.status === "suspended",
        incidents: incidents.items.map((item) => ({
          ...item,
          evidenceAttachments: evidenceEnabled ? item.evidenceAttachments : [],
          categoryText: incidentLabels[item.category] || item.category,
          statusText: statusLabels[item.status] || item.status,
          createdText: formatDateTime(item.createdAt)
        })),
        incidentPage: incidents.pagination.page,
        incidentTotalPages: incidents.pagination.totalPages,
        incidentTotal: incidents.pagination.total,
        incidentEvidenceDrafts,
        tickets: tickets.items.map((item) => ({
          ...item,
          categoryText: supportLabels[item.category] || item.category,
          statusText: statusLabels[item.status] || item.status,
          createdText: formatDateTime(item.createdAt),
          dueText: formatDateTime(item.dueAt)
        })),
        ticketPage: tickets.pagination.page,
        ticketTotalPages: tickets.pagination.totalPages,
        ticketTotal: tickets.pagination.total
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: errorMessage(error, "安全支持状态暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  previousIncidentPage() {
    if (this.data.incidentPage <= 1) return;
    this.setData({ incidentPage: this.data.incidentPage - 1 });
    void this.load();
  },
  nextIncidentPage() {
    if (this.data.incidentPage >= this.data.incidentTotalPages) return;
    this.setData({ incidentPage: this.data.incidentPage + 1 });
    void this.load();
  },
  previousTicketPage() {
    if (this.data.ticketPage <= 1) return;
    this.setData({ ticketPage: this.data.ticketPage - 1 });
    void this.load();
  },
  nextTicketPage() {
    if (this.data.ticketPage >= this.data.ticketTotalPages) return;
    this.setData({ ticketPage: this.data.ticketPage + 1 });
    void this.load();
  },
  setIncidentCategory(event: any) { this.setData({ incidentCategoryIndex: Number(event.detail.value) }); },
  setIncidentOrderId(event: any) { this.setData({ incidentOrderId: event.detail.value }); },
  setIncidentSummary(event: any) { this.setData({ incidentSummary: event.detail.value }); },
  setSupportCategory(event: any) { this.setData({ supportCategoryIndex: Number(event.detail.value) }); },
  setSupportOrderId(event: any) { this.setData({ supportOrderId: event.detail.value }); },
  setSupportSubject(event: any) { this.setData({ supportSubject: event.detail.value }); },
  setSupportBody(event: any) { this.setData({ supportBody: event.detail.value }); },
  async createIncident() {
    if (this.data.saving) return;
    const summary = this.data.incidentSummary.trim();
    if (summary.length < 10) {
      this.setData({ error: "请至少用10个字说明时间、发生了什么以及当前影响。" });
      return;
    }
    if (this.data.incidentEvidenceDrafts.some((item) => item.status !== "approved")) {
      this.setData({ error: "请等待证据安全审核，或移除失败文件后再提交。" });
      return;
    }
    this.setData({ saving: true, error: "" });
    try {
      const category = INCIDENT_CATEGORIES[this.data.incidentCategoryIndex]?.value || "other";
      await companionCommercialApi.createIncident({
        ...(this.data.incidentOrderId.trim() ? { orderId: this.data.incidentOrderId.trim() } : {}),
        category,
        summary,
        evidenceAssetIds: approvedControlledEvidenceIds(this.data.incidentEvidenceDrafts)
      });
      wx.showModal({
        title: "事件已记录为待处理",
        content: "平台已保存事件记录和通过审核的受控证据；这不代表已经判责、退款或解决。后续状态和处理结论会显示在事件卡中。",
        showCancel: false
      });
      saveControlledEvidenceDrafts(this.incidentEvidenceStorageKey(), []);
      this.setData({ incidentSummary: "", incidentEvidenceDrafts: [] });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "提交履约事件失败，请稍后重试。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  async addIncidentEvidenceImage() {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const file = await chooseEvidenceImage();
    if (file) await this.uploadIncidentEvidence(file);
  },
  async addIncidentEvidenceAudio() {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const file = await chooseEvidenceAudio();
    if (file) await this.uploadIncidentEvidence(file);
  },
  async uploadIncidentEvidence(file: LocalEvidenceFile) {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    if (this.data.incidentEvidenceUploading || this.data.incidentEvidenceDrafts.length >= 3) return;
    this.setData({ incidentEvidenceUploading: true });
    try {
      let pendingId = "";
      const draft = await uploadControlledEvidence(
        file,
        (input) => api.reserveCompanionIncidentEvidenceUpload(input),
        (next) => {
          pendingId ||= next.assetId;
          const drafts = this.data.incidentEvidenceDrafts.filter((item) => item.assetId !== pendingId);
          drafts.push(next);
          saveControlledEvidenceDrafts(this.incidentEvidenceStorageKey(), drafts);
          this.setData({ incidentEvidenceDrafts: drafts });
        }
      );
      if (draft.status !== "approved") wx.showToast({ title: draft.statusText, icon: "none" });
    } catch (error) {
      this.setData({ error: errorMessage(error, "证据上传失败，请稍后重试。") });
    } finally {
      this.setData({ incidentEvidenceUploading: false });
    }
  },
  async refreshIncidentEvidence() {
    if (!controlledEvidenceEnabled()) {
      this.setData({ incidentEvidenceDrafts: [] });
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const incidentEvidenceDrafts = await refreshControlledEvidenceDrafts(this.data.incidentEvidenceDrafts);
    saveControlledEvidenceDrafts(this.incidentEvidenceStorageKey(), incidentEvidenceDrafts);
    this.setData({ incidentEvidenceDrafts });
  },
  removeIncidentEvidence(event: any) {
    if (!controlledEvidenceEnabled()) {
      this.setData({ incidentEvidenceDrafts: [] });
      return;
    }
    const assetId = String(event.currentTarget.dataset.id || "");
    const incidentEvidenceDrafts = this.data.incidentEvidenceDrafts.filter((item) => item.assetId !== assetId);
    saveControlledEvidenceDrafts(this.incidentEvidenceStorageKey(), incidentEvidenceDrafts);
    this.setData({ incidentEvidenceDrafts });
  },
  async createSupportTicket() {
    if (this.data.saving) return;
    const subject = this.data.supportSubject.trim();
    const body = this.data.supportBody.trim();
    if (subject.length < 3 || body.length < 10) {
      this.setData({ error: "请填写清晰的工单主题，并至少用10个字描述所需支持。" });
      return;
    }
    this.setData({ saving: true, error: "" });
    try {
      const category = SUPPORT_CATEGORIES[this.data.supportCategoryIndex]?.value || "general";
      const ticket = await companionCommercialApi.createSupportTicket({
        ...(this.data.supportOrderId.trim() ? { orderId: this.data.supportOrderId.trim() } : {}),
        category,
        subject,
        body
      });
      wx.showModal({
        title: "客服工单已创建",
        content: `工单 ${ticket.id} 当前为 ${ticket.status}。目标响应时间：${formatDateTime(ticket.dueAt)}。创建工单不代表平台已经解决或批准退款。`,
        showCancel: false
      });
      this.setData({ supportSubject: "", supportBody: "" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "创建客服工单失败，请稍后重试。") });
    } finally {
      this.setData({ saving: false });
    }
  },
  async openFact(event: any) {
    const factTicketId = event.currentTarget.dataset.id as string;
    // Open synchronously so callers and UI events can immediately type/submit;
    // draft-status recovery continues without turning the modal into a network gate.
    this.setData({ factTicketId, factStatement: "", factEvidenceDrafts: [], error: "" });
    const factEvidenceDrafts = controlledEvidenceEnabled()
      ? await refreshControlledEvidenceDrafts(loadControlledEvidenceDrafts(this.factEvidenceStorageKey(factTicketId)))
      : [];
    saveControlledEvidenceDrafts(this.factEvidenceStorageKey(factTicketId), factEvidenceDrafts);
    if (this.data.factTicketId === factTicketId) this.setData({ factEvidenceDrafts });
  },
  closeFact() {
    if (this.data.savingFact) return;
    this.setData({ factTicketId: "", factStatement: "", factEvidenceDrafts: [] });
  },
  setFactStatement(event: any) { this.setData({ factStatement: event.detail.value }); },
  async addFact() {
    if (!this.data.factTicketId || this.data.savingFact) return;
    if (this.data.factEvidenceDrafts.some((item) => item.status !== "approved")) {
      this.setData({ error: "请等待证据审核，或移除失败文件后再保存。" });
      return;
    }
    this.setData({ savingFact: true, error: "" });
    try {
      await companionCommercialApi.addOrderFact(
        this.data.factTicketId,
        this.data.factStatement.trim(),
        approvedControlledEvidenceIds(this.data.factEvidenceDrafts)
      );
      wx.showModal({
        title: "事实补充已保存",
        content: "这条内容只作为当前工单的请求方陈述，不会自动改变订单、退款或结算状态。",
        showCancel: false
      });
      saveControlledEvidenceDrafts(this.factEvidenceStorageKey(), []);
      this.setData({ factTicketId: "", factStatement: "", factEvidenceDrafts: [] });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "补充订单事实失败。") });
    } finally {
      this.setData({ savingFact: false });
    }
  },
  async addFactEvidenceImage() {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const file = await chooseEvidenceImage();
    if (file) await this.uploadFactEvidence(file);
  },
  async addFactEvidenceAudio() {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const file = await chooseEvidenceAudio();
    if (file) await this.uploadFactEvidence(file);
  },
  async uploadFactEvidence(file: LocalEvidenceFile) {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    if (!this.data.factTicketId || this.data.factEvidenceUploading || this.data.factEvidenceDrafts.length >= 3) return;
    this.setData({ factEvidenceUploading: true });
    try {
      let pendingId = "";
      const draft = await uploadControlledEvidence(
        file,
        (input) => api.reserveSupportEvidenceUpload(this.data.factTicketId, input),
        (next) => {
          pendingId ||= next.assetId;
          const drafts = this.data.factEvidenceDrafts.filter((item) => item.assetId !== pendingId);
          drafts.push(next);
          saveControlledEvidenceDrafts(this.factEvidenceStorageKey(), drafts);
          this.setData({ factEvidenceDrafts: drafts });
        }
      );
      if (draft.status !== "approved") wx.showToast({ title: draft.statusText, icon: "none" });
    } catch (error) {
      this.setData({ error: errorMessage(error, "证据上传失败，请稍后重试。") });
    } finally {
      this.setData({ factEvidenceUploading: false });
    }
  },
  async refreshFactEvidence() {
    if (!controlledEvidenceEnabled()) {
      this.setData({ factEvidenceDrafts: [] });
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const factEvidenceDrafts = await refreshControlledEvidenceDrafts(this.data.factEvidenceDrafts);
    saveControlledEvidenceDrafts(this.factEvidenceStorageKey(), factEvidenceDrafts);
    this.setData({ factEvidenceDrafts });
  },
  removeFactEvidence(event: any) {
    if (!controlledEvidenceEnabled()) {
      this.setData({ factEvidenceDrafts: [] });
      return;
    }
    const assetId = String(event.currentTarget.dataset.id || "");
    const factEvidenceDrafts = this.data.factEvidenceDrafts.filter((item) => item.assetId !== assetId);
    saveControlledEvidenceDrafts(this.factEvidenceStorageKey(), factEvidenceDrafts);
    this.setData({ factEvidenceDrafts });
  },
  async openBoundEvidence(event: any) {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    try {
      const result = await api.caseEvidenceReadUrl(String(event.currentTarget.dataset.id || ""));
      if (result.kind === "image") {
        wx.previewImage({ current: result.url, urls: [result.url] });
      } else {
        const audio = wx.createInnerAudioContext();
        audio.src = result.url;
        audio.onError(() => wx.showToast({ title: "音频暂时无法播放", icon: "none" }));
        audio.play();
      }
    } catch (error) {
      this.setData({ error: errorMessage(error, "证据暂时无法查看。") });
    }
  },
  incidentEvidenceStorageKey() {
    return `talkandtalk.caseEvidence.companionIncident.${currentUser()?.id || "unknown"}`;
  },
  factEvidenceStorageKey(ticketId?: string) {
    return `talkandtalk.caseEvidence.support.${ticketId || this.data.factTicketId}`;
  },
  retry() { void this.load(); }
});
