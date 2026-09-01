import { api, ensureSession } from "../../utils/api";
import {
  CustomerAdultEligibilityMethod,
  CustomerAdultEligibilityStatus
} from "../../utils/models";
import { formatShanghaiDateTime } from "../../utils/order-display";

type LoadState = "loading" | "available" | "error";

const METHOD_OPTIONS: Array<{
  value: CustomerAdultEligibilityMethod;
  label: string;
  help: string;
}> = [
  {
    value: "externalProvider",
    label: "平台接入的外部核验服务",
    help: "填写外部核验流程完成后签发的不透明引用。"
  },
  {
    value: "governmentNetworkIdentity",
    label: "国家网络身份认证",
    help: "仅填写平台已接入流程返回的不透明业务引用。"
  },
  {
    value: "secureManualReview",
    label: "平台安全人工核验",
    help: "先通过客服取得受控核验引用；本页不接收证件图片。"
  }
];

const STATUS_TEXT: Record<CustomerAdultEligibilityStatus["status"], string> = {
  notSubmitted: "尚未提交",
  pending: "等待独立复核",
  adult: "成年资格当前有效",
  expired: "核验已过期",
  ineligible: "当前不满足付费服务资格"
};

function statusTone(status: CustomerAdultEligibilityStatus["status"]): string {
  if (status === "adult") return "success";
  if (status === "pending") return "pending";
  if (status === "notSubmitted") return "neutral";
  return "warning";
}

function viewModel(status: CustomerAdultEligibilityStatus) {
  return {
    ...status,
    statusText: STATUS_TEXT[status.status],
    tone: statusTone(status.status),
    methodText: METHOD_OPTIONS.find((item) => item.value === status.verificationMethod)?.label || "—",
    submittedText: formatShanghaiDateTime(status.submittedAt),
    verifiedText: formatShanghaiDateTime(status.verifiedAt),
    validUntilText: formatShanghaiDateTime(status.validUntil)
  };
}

Page({
  data: {
    motionOff: false,
    state: "loading" as LoadState,
    error: "",
    status: null as ReturnType<typeof viewModel> | null,
    methodLabels: METHOD_OPTIONS.map((item) => item.label),
    methodIndex: 0,
    methodHelp: METHOD_OPTIONS[0].help,
    evidenceReference: "",
    evidenceProcessingConfirmed: false,
    formOpen: false,
    submitting: false
  },
  onShow() {
    void this.load();
  },
  onPullDownRefresh() {
    void this.load(true);
  },
  async load(stopRefresh = false) {
    this.setData({ state: "loading", error: "" });
    try {
      await ensureSession();
      const status = await api.customerAdultEligibility();
      this.setData({
        state: "available",
        status: viewModel(status),
        formOpen: this.data.formOpen && status.canSubmit
      });
    } catch (error) {
      this.setData({
        state: "error",
        error: (error as Error).message || "成年资格状态暂时无法读取"
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  toggleForm() {
    if (!this.data.status?.canSubmit || this.data.submitting) return;
    this.setData({ formOpen: !this.data.formOpen });
  },
  selectMethod(event: any) {
    const methodIndex = Number(event.detail?.value || 0);
    const option = METHOD_OPTIONS[methodIndex] || METHOD_OPTIONS[0];
    this.setData({ methodIndex, methodHelp: option.help });
  },
  setEvidenceReference(event: any) {
    this.setData({ evidenceReference: String(event.detail?.value || "").slice(0, 160) });
  },
  setEvidenceConfirmation(event: any) {
    const values = Array.isArray(event.detail?.value) ? event.detail.value : [];
    this.setData({ evidenceProcessingConfirmed: values.includes("confirmed") });
  },
  async submit() {
    if (this.data.submitting || !this.data.status?.canSubmit) return;
    const evidenceReference = this.data.evidenceReference.trim();
    if (!/^(?!.*\d{10,})[A-Za-z][A-Za-z0-9._-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{4,127}$/.test(evidenceReference)) {
      wx.showToast({ title: "请填写核验流程签发的不透明引用", icon: "none" });
      return;
    }
    if (!this.data.evidenceProcessingConfirmed) {
      wx.showToast({ title: "请确认资料处理边界", icon: "none" });
      return;
    }
    const method = METHOD_OPTIONS[this.data.methodIndex] || METHOD_OPTIONS[0];
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "提交独立成年资格复核",
      content: "本页只提交受控流程签发的不透明引用，不会上传证件图片。提交后仍须由另一名授权人员复核，结果为“成年且有效”前不能新建付费服务。",
      confirmText: "确认提交",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ submitting: true });
    try {
      const status = await api.submitCustomerAdultEligibility({
        verificationMethod: method.value,
        evidenceReference,
        evidenceProcessingConfirmed: true
      });
      this.setData({
        status: viewModel(status),
        formOpen: false,
        evidenceReference: "",
        evidenceProcessingConfirmed: false
      });
      wx.showToast({ title: "已进入独立复核", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "提交失败", icon: "none" });
      await this.load();
    } finally {
      this.setData({ submitting: false });
    }
  },
  openSupport() {
    wx.navigateTo({ url: "/pages/support/index" });
  }
});
