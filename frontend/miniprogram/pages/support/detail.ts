import { api, ApiError, ensureSession } from "../../utils/api";
import { ReporterCase, SupportTicket } from "../../utils/models";
import { formatShanghaiDateTime } from "../../utils/order-display";
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
} from "../../utils/controlled-evidence";

const SENSITIVE_CONTENT = /(?:\b\d{15}\b|\b\d{17}[\dXx]\b|1[3-9]\d{9}|身份证|护照|银行卡|病历|诊断|微信号|手机号)/;

const SUPPORT_STATUS: Record<string, string> = {
  open: "待受理",
  inProgress: "处理中",
  resolved: "已处理",
  closed: "已关闭"
};

const OUTCOME_STATUS: Record<string, string> = {
  received: "已收到",
  reviewing: "独立审核中",
  actionTaken: "已复核并处置",
  closed: "已关闭"
};

Page({
  data: {
    kind: "support" as "support" | "safety",
    ticket: null as SupportTicket | null,
    safetyCase: null as ReporterCase | null,
    statusText: "",
    createdText: "",
    dueText: "",
    resolvedText: "",
    loading: true,
    error: "",
    followUp: "",
    submitting: false,
    canAdd: false,
    textOnly: !controlledEvidenceEnabled(),
    evidenceDrafts: [] as ControlledEvidenceDraft[],
    evidenceUploading: false
  },
  itemId: "",
  onLoad(options: Record<string, string | undefined>) {
    this.itemId = String(options.id || "").trim();
    const kind = options.kind === "safety" ? "safety" : "support";
    this.setData({ kind });
    if (!this.itemId) {
      this.setData({ loading: false, error: "缺少案件编号，请从案件中心重新进入。" });
    }
  },
  onShow() {
    if (this.itemId) void this.load();
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      if (this.data.kind === "safety") {
        const item = await api.reporterCase(this.itemId);
        this.setData({
          safetyCase: item,
          ticket: null,
          statusText: OUTCOME_STATUS[item.outcome] || "状态更新中",
          createdText: formatShanghaiDateTime(item.createdAt),
          dueText: formatShanghaiDateTime(item.dueAt),
          resolvedText: formatShanghaiDateTime(item.resolvedAt),
          canAdd: ["received", "reviewing"].includes(item.outcome) && (item.followUps || []).length < 5,
          loading: false
        });
        return;
      }
      const ticket = await api.supportTicket(this.itemId);
      const evidenceEnabled = controlledEvidenceEnabled();
      const storedDrafts = evidenceEnabled ? loadControlledEvidenceDrafts(this.evidenceStorageKey()) : [];
      const evidenceDrafts = storedDrafts.length
        ? await refreshControlledEvidenceDrafts(storedDrafts)
        : [];
      saveControlledEvidenceDrafts(this.evidenceStorageKey(), evidenceDrafts);
      const displayTicket = evidenceEnabled ? ticket : {
        ...ticket,
        orderFacts: (ticket.orderFacts || []).map((fact) => ({ ...fact, evidenceAttachments: [] }))
      };
      this.setData({
        ticket: displayTicket,
        safetyCase: null,
        statusText: SUPPORT_STATUS[ticket.status] || "状态更新中",
        createdText: formatShanghaiDateTime(ticket.updatedAt),
        dueText: formatShanghaiDateTime(ticket.dueAt),
        resolvedText: "",
        canAdd: Boolean(
          ticket.orderId
          && ["orderIssue", "refund"].includes(ticket.category)
          && ["open", "inProgress"].includes(ticket.status)
          && (ticket.orderFacts || []).length < 10
        ),
        evidenceDrafts,
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false, error: (error as Error).message || "案件详情暂时无法加载" });
    }
  },
  setFollowUp(event: any) {
    this.setData({ followUp: String(event.detail?.value || "").slice(0, this.data.kind === "safety" ? 500 : 1200) });
  },
  async addFollowUp() {
    if (!this.data.canAdd || this.data.submitting) return;
    const statement = this.data.followUp.trim();
    if (statement.length < 5) {
      wx.showToast({ title: "请至少补充 5 个字", icon: "none" });
      return;
    }
    if (this.data.kind === "support" && SENSITIVE_CONTENT.test(statement)) {
      wx.showToast({ title: "请勿填写证件、联系方式、银行卡或健康材料", icon: "none" });
      return;
    }
    if (this.data.kind === "support" && this.data.evidenceDrafts.some((item) => item.status !== "approved")) {
      wx.showToast({ title: "请等待证据审核，或移除失败文件", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      if (this.data.kind === "safety") {
        await api.addReporterCaseFollowUp(this.itemId, statement);
      } else {
        await api.addOrderSupportFact(
          this.itemId,
          statement,
          approvedControlledEvidenceIds(this.data.evidenceDrafts)
        );
      }
      saveControlledEvidenceDrafts(this.evidenceStorageKey(), []);
      this.setData({ followUp: "", evidenceDrafts: [] });
      wx.showToast({ title: "补充信息已提交", icon: "success" });
      await this.load();
    } catch (error) {
      const apiError = error as ApiError;
      const message = apiError.code === "REPORT_CASE_CLOSED" || apiError.code === "SUPPORT_TICKET_CLOSED"
        ? "案件已经结束，不能继续补充"
        : apiError.message || "补充失败";
      wx.showToast({ title: message, icon: "none" });
      if (apiError.statusCode === 409) await this.load();
    } finally {
      this.setData({ submitting: false });
    }
  },
  async addEvidenceImage() {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const file = await chooseEvidenceImage();
    if (file) await this.uploadEvidence(file);
  },
  async addEvidenceAudio() {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const file = await chooseEvidenceAudio();
    if (file) await this.uploadEvidence(file);
  },
  async uploadEvidence(file: LocalEvidenceFile) {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    if (this.data.kind !== "support" || this.data.evidenceUploading || this.data.evidenceDrafts.length >= 3) return;
    this.setData({ evidenceUploading: true });
    try {
      let pendingId = "";
      const draft = await uploadControlledEvidence(
        file,
        (input) => api.reserveSupportEvidenceUpload(this.itemId, input),
        (next) => {
          pendingId ||= next.assetId;
          const drafts = this.data.evidenceDrafts.filter((item) => item.assetId !== pendingId);
          drafts.push(next);
          saveControlledEvidenceDrafts(this.evidenceStorageKey(), drafts);
          this.setData({ evidenceDrafts: drafts });
        }
      );
      if (draft.status !== "approved") {
        wx.showToast({ title: draft.statusText, icon: "none" });
      }
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "证据上传失败", icon: "none" });
    } finally {
      this.setData({ evidenceUploading: false });
    }
  },
  async refreshEvidence() {
    if (!controlledEvidenceEnabled()) {
      this.setData({ evidenceDrafts: [] });
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const evidenceDrafts = await refreshControlledEvidenceDrafts(this.data.evidenceDrafts);
    saveControlledEvidenceDrafts(this.evidenceStorageKey(), evidenceDrafts);
    this.setData({ evidenceDrafts });
  },
  removeEvidence(event: any) {
    if (!controlledEvidenceEnabled()) {
      this.setData({ evidenceDrafts: [] });
      return;
    }
    const assetId = String(event.currentTarget.dataset.id || "");
    const evidenceDrafts = this.data.evidenceDrafts.filter((item) => item.assetId !== assetId);
    saveControlledEvidenceDrafts(this.evidenceStorageKey(), evidenceDrafts);
    this.setData({ evidenceDrafts });
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
      wx.showToast({ title: (error as Error).message || "证据暂时无法查看", icon: "none" });
    }
  },
  evidenceStorageKey() {
    return `talkandtalk.caseEvidence.support.${this.itemId}`;
  },
  openOrder() {
    const orderId = this.data.ticket?.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail?id=${encodeURIComponent(orderId)}` });
  },
  openCenter() {
    wx.redirectTo({ url: "/pages/support/index" });
  }
});
