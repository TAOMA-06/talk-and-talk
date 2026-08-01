import { ApiError, ensureSession } from "../../../utils/api";
import {
  CompanionAccountAction,
  CompanionQuality,
  TrainingModule,
  companionCommercialApi
} from "../../../utils/companion-commercial-api";

type DisplayTrainingModule = TrainingModule & {
  expanded: boolean;
  answers: string[];
  statusText: string;
  expiryText: string;
};

function formatDate(value: string | null): string {
  if (!value) return "无";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function metricText(value: number | null): string {
  return value === null ? "证据不足" : `${value.toFixed(1)}%`;
}

function errorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  const messages: Record<string, string> = {
    TRAINING_ANSWERS_INCOMPLETE: "请回答本课程的全部问题。",
    TRAINING_MODULE_NOT_FOUND: "课程版本已经更新，请刷新后重新作答。",
    COMPANION_ACTION_APPEAL_EXISTS: "这项处置已经提交过申诉，请等待处理结果。",
    COMPANION_ACTION_NOT_FOUND: "处置记录已不存在或不属于当前账号。",
    COMPANION_ACTION_APPEAL_WINDOW_CLOSED: "这项处置已超过页面公示的申诉期限。",
    COMPANION_ACTION_ALREADY_REVOKED: "这项处置已经撤销，无需再次申诉。"
  };
  return (apiError.code && messages[apiError.code]) || apiError.message || fallback;
}

function displayModule(module: TrainingModule): DisplayTrainingModule {
  const statuses: Record<string, string> = {
    inProgress: "待通过",
    passed: "已通过",
    expired: "已到期"
  };
  return {
    ...module,
    expanded: false,
    answers: module.questions.map(() => ""),
    statusText: module.record ? statuses[module.record.status] || module.record.status : "未开始",
    expiryText: module.record?.expiresAt ? `有效至 ${formatDate(module.record.expiresAt)}` : `通过后有效 ${module.validityDays} 天`
  };
}

Page({
  data: {
    loading: true,
    error: "",
    modules: [] as DisplayTrainingModule[],
    trainingComplete: false,
    quality: null as CompanionQuality | null,
    qualityCards: [] as Array<{ label: string; value: string; note: string }>,
    actions: [] as CompanionAccountAction[],
    actionsPage: 1,
    actionsTotalPages: 1,
    actionsTotal: 0,
    focusActionId: "",
    focusAppealId: "",
    activeRestriction: false,
    submittingModuleCode: "",
    appealActionId: "",
    appealStatement: "",
    appealEvidenceReferences: "",
    submittingAppeal: false
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      focusActionId: options?.actionId || "",
      focusAppealId: options?.appealId || "",
      actionsPage: 1
    });
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [training, quality, actions] = await Promise.all([
        companionCommercialApi.training(),
        companionCommercialApi.quality(),
        companionCommercialApi.actions({
          page: this.data.actionsPage,
          pageSize: 20,
          actionId: this.data.focusActionId || undefined
        })
      ]);
      this.setData({
        loading: false,
        modules: training.modules.map(displayModule),
        trainingComplete: training.complete,
        quality,
        qualityCards: [
          {
            label: "按时接受",
            value: metricText(quality.acceptedWithinDeadline.value),
            note: `${quality.acceptedWithinDeadline.numerator}/${quality.acceptedWithinDeadline.denominator} 笔`
          },
          {
            label: "准时开始",
            value: metricText(quality.startedWithinTenMinutes.value),
            note: `${quality.startedWithinTenMinutes.numerator}/${quality.startedWithinTenMinutes.denominator} 笔`
          },
          {
            label: "完成率",
            value: metricText(quality.completion.value),
            note: `${quality.completion.numerator}/${quality.completion.denominator} 笔`
          },
          {
            label: "退款率",
            value: metricText(quality.refund.value),
            note: `${quality.refund.numerator}/${quality.refund.denominator} 笔`
          }
        ],
        actions: actions.items,
        actionsPage: actions.pagination.page,
        actionsTotalPages: actions.pagination.totalPages,
        actionsTotal: actions.pagination.total,
        activeRestriction: actions.items.some((action) =>
          action.active && (action.kind === "serviceRestriction" || action.kind === "suspension")
        )
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: errorMessage(error, "培训与质量数据暂时无法加载，请稍后重试。")
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  previousActionsPage() {
    if (this.data.actionsPage <= 1) return;
    this.setData({ actionsPage: this.data.actionsPage - 1 });
    void this.load();
  },
  nextActionsPage() {
    if (this.data.actionsPage >= this.data.actionsTotalPages) return;
    this.setData({ actionsPage: this.data.actionsPage + 1 });
    void this.load();
  },
  clearActionFocus() {
    this.setData({ focusActionId: "", focusAppealId: "", actionsPage: 1 });
    void this.load();
  },
  toggleModule(event: any) {
    const code = event.currentTarget.dataset.code as string;
    const index = this.data.modules.findIndex((module) => module.code === code);
    if (index < 0) return;
    this.setData({ [`modules[${index}].expanded`]: !this.data.modules[index].expanded });
  },
  selectAnswer(event: any) {
    const code = event.currentTarget.dataset.code as string;
    const questionIndex = Number(event.currentTarget.dataset.questionIndex);
    const moduleIndex = this.data.modules.findIndex((module) => module.code === code);
    if (moduleIndex < 0 || !Number.isInteger(questionIndex)) return;
    this.setData({ [`modules[${moduleIndex}].answers[${questionIndex}]`]: event.detail.value });
  },
  async submitTraining(event: any) {
    const code = event.currentTarget.dataset.code as string;
    const module = this.data.modules.find((candidate) => candidate.code === code);
    if (!module || this.data.submittingModuleCode) return;
    if (module.answers.some((answer) => !answer)) {
      wx.showToast({ title: "请回答全部问题", icon: "none" });
      return;
    }
    this.setData({ submittingModuleCode: code, error: "" });
    try {
      const result = await companionCommercialApi.submitTrainingAttempt(
        module.code,
        module.version,
        module.answers
      );
      if (result.passed) {
        wx.showToast({ title: `已通过 · ${result.score}分`, icon: "success" });
      } else {
        wx.showModal({
          title: `本次 ${result.score} 分`,
          content: `通过线为 ${result.passScore} 分。平台已记录本次尝试，但不会把未通过状态显示为完成，请复习后重试。`,
          showCancel: false
        });
      }
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "提交考试失败，请稍后重试。") });
    } finally {
      this.setData({ submittingModuleCode: "" });
    }
  },
  openAppeal(event: any) {
    this.setData({
      appealActionId: event.currentTarget.dataset.id as string,
      appealStatement: "",
      appealEvidenceReferences: "",
      error: ""
    });
  },
  closeAppeal() {
    if (this.data.submittingAppeal) return;
    this.setData({ appealActionId: "", appealStatement: "", appealEvidenceReferences: "" });
  },
  setAppealStatement(event: any) { this.setData({ appealStatement: event.detail.value }); },
  setAppealEvidence(event: any) { this.setData({ appealEvidenceReferences: event.detail.value }); },
  async submitAppeal() {
    if (!this.data.appealActionId || this.data.submittingAppeal) return;
    const statement = this.data.appealStatement.trim();
    if (statement.length < 10) {
      this.setData({ error: "请至少用10个字说明申诉事实和希望复核的内容。" });
      return;
    }
    const evidenceReferences: string[] = [...new Set<string>(
      this.data.appealEvidenceReferences.split(/[,，\n]/).map((item: string) => item.trim()).filter(Boolean)
    )];
    this.setData({ submittingAppeal: true, error: "" });
    try {
      await companionCommercialApi.appealAction(this.data.appealActionId, statement, evidenceReferences);
      wx.showToast({ title: "申诉已进入待处理", icon: "success" });
      this.setData({ appealActionId: "", appealStatement: "", appealEvidenceReferences: "" });
      await this.load();
    } catch (error) {
      this.setData({ error: errorMessage(error, "提交申诉失败，请稍后重试。") });
    } finally {
      this.setData({ submittingAppeal: false });
    }
  },
  retry() { void this.load(); }
});
