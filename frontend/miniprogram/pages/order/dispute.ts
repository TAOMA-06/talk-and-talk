import {
  AttendanceDispute,
  AttendanceIssue,
  AttendancePolicy,
  attendanceDisputesApi
} from "../../utils/attendance-disputes-api";
import { api, ensureSession } from "../../utils/api";
import { Order } from "../../utils/models";
import {
  approvedControlledEvidenceIds,
  chooseEvidenceAudio,
  chooseEvidenceImage,
  ControlledEvidenceDraft,
  loadControlledEvidenceDrafts,
  LocalEvidenceFile,
  refreshControlledEvidenceDrafts,
  saveControlledEvidenceDrafts,
  uploadControlledEvidence
} from "../../utils/controlled-evidence";

const ISSUE_OPTIONS: Array<{ value: AttendanceIssue; label: string; help: string }> = [
  { value: "companionAbsent", label: "陪伴者未到场", help: "已按规则等待，但陪伴者没有进入服务房间" },
  { value: "customerAbsent", label: "客户未到场", help: "预约客户没有进入服务房间" },
  { value: "lateArrival", label: "迟到", help: "一方晚于预约时间进入" },
  { value: "technicalFailure", label: "技术故障", help: "平台或网络问题导致无法正常服务" },
  { value: "earlyExit", label: "提前离开", help: "服务在约定时长前结束" },
  { value: "serviceMismatch", label: "服务不符", help: "实际履约与订单商品快照不一致" },
  { value: "safetyBoundary", label: "安全边界", help: "出现越界、骚扰或紧急安全问题" },
  { value: "other", label: "其他履约问题", help: "不属于以上类别的预约履约问题" }
];

const STATUS_TEXT: Record<string, string> = {
  evidenceCollection: "补充事实",
  counterpartyResponse: "等待对方答辩",
  review: "平台复核",
  decided: "初审已决定，可申诉",
  appealed: "申诉复核",
  final: "案件已终结"
};

const ROLE_TEXT: Record<string, string> = { customer: "客户", companion: "陪伴者" };
const STATEMENT_KIND_TEXT: Record<string, string> = {
  initial: "首次陈述",
  evidence: "补充事实",
  counterpartyResponse: "对方答辩",
  appeal: "申诉理由",
  appealResponse: "申诉答辩"
};
const REFUND_STATUS_TEXT: Record<string, string> = {
  pendingReview: "待退款复核",
  pending: "渠道已受理",
  processing: "渠道处理中",
  success: "渠道确认成功",
  failed: "渠道处理失败",
  rejected: "退款未批准"
};

function timeText(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")} ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function present(dispute: AttendanceDispute | null) {
  if (!dispute) return null;
  const deadlineOpen = (value?: string | null) => {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) && timestamp > Date.now();
  };
  const canCompleteEvidence = dispute.status === "evidenceCollection" && dispute.viewerRole === dispute.openedByRole;
  const canRespond = dispute.status === "counterpartyResponse"
    && dispute.viewerRole !== dispute.openedByRole
    && deadlineOpen(dispute.deadlines.counterpartyResponseDueAt);
  const canAddEvidence = ["evidenceCollection", "counterpartyResponse"].includes(dispute.status)
    && dispute.viewerRole === dispute.openedByRole
    && deadlineOpen(dispute.deadlines.evidenceDueAt);
  const adverselyAffectedRole = dispute.decision?.outcome === "fullRefund" ? "companion" : "customer";
  const canAppeal = dispute.status === "decided"
    && dispute.viewerRole === adverselyAffectedRole
    && deadlineOpen(dispute.deadlines.appealDeadlineAt);
  const canAppealRespond = dispute.status === "appealed"
    && dispute.appeal?.appealedByRole !== dispute.viewerRole
    && deadlineOpen(dispute.deadlines.appealResponseDueAt);
  return {
    statusText: STATUS_TEXT[dispute.status] || dispute.status,
    issueText: ISSUE_OPTIONS.find((item) => item.value === dispute.issue)?.label || dispute.issue,
    viewerRoleText: ROLE_TEXT[dispute.viewerRole],
    evidenceDueText: timeText(dispute.deadlines.evidenceDueAt),
    responseDueText: timeText(dispute.deadlines.counterpartyResponseDueAt),
    appealDueText: timeText(dispute.deadlines.appealDeadlineAt),
    appealResponseDueText: timeText(dispute.deadlines.appealResponseDueAt),
    refundText: dispute.refund
      ? `${REFUND_STATUS_TEXT[dispute.refund.status] || dispute.refund.status} · ¥${(dispute.refund.amountCents / 100).toFixed(2)}`
      : "尚未创建退款交易",
    canCompleteEvidence,
    canRespond,
    canAddEvidence,
    canAppeal,
    canAppealRespond,
    statements: dispute.statements.map((item) => ({
      ...item,
      roleText: ROLE_TEXT[item.participantRole],
      kindText: STATEMENT_KIND_TEXT[item.kind] || item.kind,
      timeText: timeText(item.createdAt)
    })),
    customer: {
      ...dispute.attendanceSummary.customer,
      firstJoinedText: timeText(dispute.attendanceSummary.customer.firstJoinedAt),
      lastLeftText: timeText(dispute.attendanceSummary.customer.lastLeftAt)
    },
    companion: {
      ...dispute.attendanceSummary.companion,
      firstJoinedText: timeText(dispute.attendanceSummary.companion.firstJoinedAt),
      lastLeftText: timeText(dispute.attendanceSummary.companion.lastLeftAt)
    }
  };
}

Page({
  data: {
    orderId: "",
    dispute: null as AttendanceDispute | null,
    view: null as ReturnType<typeof present>,
    policy: null as AttendancePolicy | null,
    policyState: "loading" as "loading" | "available" | "error",
    policyError: "",
    eligibility: null as Order["attendanceDisputeEligibility"] | null,
    eligibilityState: "loading" as "loading" | "available" | "error",
    eligibilityDeadlineText: "",
    issues: ISSUE_OPTIONS,
    issue: "technicalFailure" as AttendanceIssue,
    statement: "",
    loading: true,
    action: "",
    error: "",
    evidenceDrafts: [] as ControlledEvidenceDraft[],
    evidenceUploading: false
  },
  orderId: "",
  disputeId: "",
  onLoad(options: Record<string, string | undefined>) {
    this.orderId = String(options.orderId || "").trim();
    this.disputeId = String(options.id || "").trim();
    this.setData({ orderId: this.orderId });
  },
  onShow() { void this.load(); },
  async load() {
    this.setData({
      loading: true,
      error: "",
      policy: null,
      policyState: "loading",
      policyError: "",
      eligibility: null,
      eligibilityState: "loading",
      eligibilityDeadlineText: ""
    });
    try {
      await ensureSession();
      const policyPromise = attendanceDisputesApi.policy()
        .then((policy) => ({ policy, available: true }))
        .catch(() => ({ policy: null as AttendancePolicy | null, available: false }));
      let dispute: AttendanceDispute | null = null;
      if (this.disputeId) {
        dispute = await attendanceDisputesApi.get(this.disputeId);
      } else {
        const mine = await attendanceDisputesApi.mineByOrder(this.orderId);
        dispute = mine.item;
        if (dispute) this.disputeId = dispute.id;
      }
      const resolvedOrderId = this.orderId || dispute?.order.id || "";
      if (resolvedOrderId && !this.orderId) {
        this.orderId = resolvedOrderId;
        this.setData({ orderId: resolvedOrderId });
      }
      const orderResult = resolvedOrderId
        ? await api.order(resolvedOrderId)
          .then((order) => ({ order, available: true as const }))
          .catch(() => ({ order: null as Order | null, available: false as const }))
        : { order: null as Order | null, available: false as const };
      const policyResult = await policyPromise;
      const evidenceDrafts = dispute
        ? await refreshControlledEvidenceDrafts(loadControlledEvidenceDrafts(this.evidenceStorageKey(dispute.id)))
        : [];
      if (dispute) saveControlledEvidenceDrafts(this.evidenceStorageKey(dispute.id), evidenceDrafts);
      this.setData({
        dispute,
        view: present(dispute),
        policy: policyResult.policy,
        policyState: policyResult.available ? "available" : "error",
        policyError: policyResult.available
          ? ""
          : "履约规则暂时无法读取。这不代表没有规则；为避免在未知期限下提交，新建入口已关闭。",
        eligibility: orderResult.order?.attendanceDisputeEligibility || null,
        eligibilityState: dispute ? "available" : orderResult.available ? "available" : "error",
        eligibilityDeadlineText: timeText(orderResult.order?.attendanceDisputeEligibility?.createDeadlineAt),
        evidenceDrafts,
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false, error: (error as Error).message || "案件暂时无法加载" });
    }
  },
  async retryPolicy() {
    if (this.data.policyState === "loading") return;
    this.setData({ policy: null, policyState: "loading", policyError: "" });
    try {
      const policy = await attendanceDisputesApi.policy();
      this.setData({ policy, policyState: "available", policyError: "" });
    } catch {
      this.setData({
        policy: null,
        policyState: "error",
        policyError: "履约规则暂时无法读取。这不代表没有规则；为避免在未知期限下提交，新建入口已关闭。"
      });
    }
  },
  chooseIssue(event: any) {
    this.setData({ issue: event.detail.value as AttendanceIssue });
  },
  inputStatement(event: any) {
    this.setData({ statement: String(event.detail.value || "") });
  },
  async createCase() {
    if (!this.orderId || this.data.policyState !== "available" || this.data.eligibility?.eligible !== true) return;
    await this.run("create", async () => {
      const dispute = await attendanceDisputesApi.create(this.orderId, this.data.issue, this.data.statement);
      this.disputeId = dispute.id;
      this.setData({ dispute, view: present(dispute), statement: "" });
      wx.showToast({ title: "案件已提交", icon: "success" });
    });
  },
  async completeEvidence() {
    if (this.data.evidenceDrafts.length) {
      wx.showToast({ title: "请先提交或移除待绑定证据", icon: "none" });
      return;
    }
    await this.run("complete", async () => {
      const dispute = await attendanceDisputesApi.completeEvidence(this.disputeId);
      this.setData({ dispute, view: present(dispute) });
    });
  },
  async submitStatement() {
    if (this.data.statement.trim().length < 5) {
      wx.showToast({ title: "请至少填写 5 个字", icon: "none" });
      return;
    }
    if (this.data.evidenceDrafts.some((item) => item.status !== "approved")) {
      wx.showToast({ title: "请等待证据审核，或移除失败文件", icon: "none" });
      return;
    }
    await this.run("statement", async () => {
      const dispute = await attendanceDisputesApi.statement(
        this.disputeId,
        this.data.statement,
        approvedControlledEvidenceIds(this.data.evidenceDrafts)
      );
      saveControlledEvidenceDrafts(this.evidenceStorageKey(), []);
      this.setData({ dispute, view: present(dispute), statement: "", evidenceDrafts: [] });
      wx.showToast({ title: "陈述已提交", icon: "success" });
    });
  },
  async appeal() {
    if (this.data.statement.trim().length < 5) {
      wx.showToast({ title: "请填写申诉理由", icon: "none" });
      return;
    }
    if (this.data.evidenceDrafts.some((item) => item.status !== "approved")) {
      wx.showToast({ title: "请等待证据审核，或移除失败文件", icon: "none" });
      return;
    }
    await this.run("appeal", async () => {
      const dispute = await attendanceDisputesApi.appeal(
        this.disputeId,
        this.data.statement,
        approvedControlledEvidenceIds(this.data.evidenceDrafts)
      );
      saveControlledEvidenceDrafts(this.evidenceStorageKey(), []);
      this.setData({ dispute, view: present(dispute), statement: "", evidenceDrafts: [] });
      wx.showToast({ title: "申诉已提交", icon: "success" });
    });
  },
  async run(action: string, callback: () => Promise<void>) {
    if (this.data.action) return;
    this.setData({ action });
    try {
      await callback();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "操作失败", icon: "none" });
    } finally {
      this.setData({ action: "" });
    }
  },
  async addEvidenceImage() {
    const file = await chooseEvidenceImage();
    if (file) await this.uploadEvidence(file);
  },
  async addEvidenceAudio() {
    const file = await chooseEvidenceAudio();
    if (file) await this.uploadEvidence(file);
  },
  async uploadEvidence(file: LocalEvidenceFile) {
    if (!this.disputeId || this.data.evidenceUploading || this.data.evidenceDrafts.length >= 3) return;
    this.setData({ evidenceUploading: true });
    try {
      let pendingId = "";
      const draft = await uploadControlledEvidence(
        file,
        (input) => api.reserveAttendanceEvidenceUpload(this.disputeId, input),
        (next) => {
          pendingId ||= next.assetId;
          const drafts = this.data.evidenceDrafts.filter((item) => item.assetId !== pendingId);
          drafts.push(next);
          saveControlledEvidenceDrafts(this.evidenceStorageKey(), drafts);
          this.setData({ evidenceDrafts: drafts });
        }
      );
      if (draft.status !== "approved") wx.showToast({ title: draft.statusText, icon: "none" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "证据上传失败", icon: "none" });
    } finally {
      this.setData({ evidenceUploading: false });
    }
  },
  async refreshEvidence() {
    const evidenceDrafts = await refreshControlledEvidenceDrafts(this.data.evidenceDrafts);
    saveControlledEvidenceDrafts(this.evidenceStorageKey(), evidenceDrafts);
    this.setData({ evidenceDrafts });
  },
  removeEvidence(event: any) {
    const assetId = String(event.currentTarget.dataset.id || "");
    const evidenceDrafts = this.data.evidenceDrafts.filter((item) => item.assetId !== assetId);
    saveControlledEvidenceDrafts(this.evidenceStorageKey(), evidenceDrafts);
    this.setData({ evidenceDrafts });
  },
  async openBoundEvidence(event: any) {
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
  evidenceStorageKey(id?: string) {
    return `talkandtalk.caseEvidence.attendance.${id || this.disputeId}`;
  }
});
