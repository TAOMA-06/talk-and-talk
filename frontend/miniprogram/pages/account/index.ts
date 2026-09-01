import {
  api,
  ApiError,
  downloadDataRightsExport,
  ensureLegalRecoverySession,
  ensureSession,
  logout,
  logoutLegalRecovery
} from "../../utils/api";
import {
  AccountDeletionPolicy,
  AccountDeletionRequest,
  AccountSession,
  AuthUser,
  Conversation,
  DataRightsFollowUp,
  DataRightsRequest,
  DataRightsRequestType,
  InvoiceCandidateOrder,
  InvoiceRequest,
  Order,
  UserAccountAction
} from "../../utils/models";
import { formatCny, formatShanghaiDateTime, orderServiceName } from "../../utils/order-display";
import { currentLegalConsent, openLegalDocument, withdrawLegalConsent } from "../../utils/privacy";
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
  TEXT_ONLY_EVIDENCE_MESSAGE,
  uploadControlledEvidence
} from "../../utils/controlled-evidence";

type LoadState = "loading" | "available" | "empty" | "error";

type BillItem = {
  id: string;
  serviceName: string;
  amountText: string;
  statusText: string;
  timeText: string;
  refunded: boolean;
};

type BlockedConversation = Conversation & { name: string };
type SessionView = AccountSession & {
  lastUsedText: string;
  createdText: string;
  expiresText: string;
};
type DataRightsView = DataRightsRequest & {
  typeText: string;
  statusText: string;
  updatedText: string;
  resolvedText: string;
  canDownload: boolean;
  followUps: Array<DataRightsFollowUp & { createdText: string }>;
};
type InvoiceView = InvoiceRequest & {
  statusText: string;
  amountText: string;
  updatedText: string;
  issuedText: string;
  voidedText: string;
  cancelledText: string;
  serviceText: string;
};
type InvoiceOrderOption = {
  id: string;
  label: string;
};
type AccountActionView = UserAccountAction & {
  kindText: string;
  stateText: string;
  startsText: string;
  endsText: string;
  appealDeadlineText: string;
  appealReviewDueText: string;
  appealResolvedText: string;
};
type AccountDeletionView = AccountDeletionRequest & {
  statusText: string;
  createdText: string;
  updatedText: string;
  dueText: string;
  completedText: string;
  cancelledText: string;
  reactivationMessage: string;
};

const BILL_STATUS: Record<string, string> = {
  pending: "未支付",
  paying: "支付确认中",
  paid: "已支付",
  inService: "已支付 · 服务中",
  completed: "已支付 · 已完成",
  cancelled: "已取消",
  refunded: "已退款"
};

const DATA_RIGHT_OPTIONS: Array<{ value: DataRightsRequestType; label: string }> = [
  { value: "access", label: "访问我的平台数据" },
  { value: "export", label: "导出我的平台数据" },
  { value: "correction", label: "更正其他个人数据" },
  { value: "deletion", label: "删除特定个人数据" }
];

const DATA_RIGHT_STATUS: Record<DataRightsRequest["status"], string> = {
  submitted: "已提交",
  inReview: "处理中",
  needsInformation: "待补充信息",
  completed: "已完成",
  rejected: "未通过"
};

const INVOICE_STATUS: Record<InvoiceRequest["status"], string> = {
  submitted: "已提交",
  inReview: "开票处理中",
  issued: "已开具",
  rejected: "未通过",
  voided: "已作废",
  cancelled: "已撤回"
};

const ACCOUNT_ACTION_KIND: Record<string, string> = {
  restriction: "账号限制",
  ban: "账号封禁"
};

const ACCOUNT_APPEAL_STATUS: Record<string, string> = {
  pending: "申诉复核中",
  upheld: "维持原处置",
  overturned: "已撤销原处置",
  dismissed: "申诉已关闭"
};

const DELETION_STATUS: Record<string, string> = {
  pending: "待开始处理",
  processing: "处理中",
  completed: "已完成",
  cancelled: "已取消"
};

function maskPhone(value?: string | null): string {
  if (!value) return "未绑定可展示手机号";
  const normalized = value.trim();
  if (normalized.length < 7) return "已绑定（已隐藏）";
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function billItem(order: Order): BillItem {
  return {
    id: order.id,
    serviceName: orderServiceName(order),
    amountText: formatCny(order.amountCents),
    statusText: order.refund
      ? `退款：${order.refund.status}`
      : BILL_STATUS[order.status] || "状态更新中",
    timeText: formatShanghaiDateTime(order.paidAt || order.createdAt),
    refunded: order.status === "refunded" || order.refund?.status === "success"
  };
}

function sessionView(item: AccountSession): SessionView {
  return {
    ...item,
    lastUsedText: formatShanghaiDateTime(item.lastUsedAt),
    createdText: formatShanghaiDateTime(item.createdAt),
    expiresText: formatShanghaiDateTime(item.expiresAt)
  };
}

function dataRightsView(item: DataRightsRequest): DataRightsView {
  return {
    ...item,
    typeText: DATA_RIGHT_OPTIONS.find((option) => option.value === item.type)?.label || "数据权利请求",
    statusText: DATA_RIGHT_STATUS[item.status] || "状态更新中",
    updatedText: formatShanghaiDateTime(item.updatedAt),
    resolvedText: formatShanghaiDateTime(item.resolvedAt),
    canDownload:
      item.type === "export"
      && item.status === "completed"
      && item.resolutionEvidenceAvailable,
    followUps: (item.followUps || []).map((followUp) => ({
      ...followUp,
      createdText: formatShanghaiDateTime(followUp.createdAt)
    }))
  };
}

function requestAmount(item: InvoiceRequest): string {
  return item.currency === "CNY"
    ? formatCny(item.amountCents)
    : `${item.currency} ${(Math.max(0, item.amountCents) / 100).toFixed(2)}`;
}

function invoiceView(item: InvoiceRequest): InvoiceView {
  return {
    ...item,
    statusText: INVOICE_STATUS[item.status] || "状态更新中",
    amountText: requestAmount(item),
    updatedText: formatShanghaiDateTime(item.updatedAt),
    issuedText: formatShanghaiDateTime(item.issuedAt),
    voidedText: formatShanghaiDateTime(item.voidedAt),
    cancelledText: formatShanghaiDateTime(item.cancelledAt),
    serviceText: `${item.service.title} · ${item.service.durationMinutes} 分钟 · ${item.service.companionName}`
  };
}

function accountActionView(item: UserAccountAction): AccountActionView {
  return {
    ...item,
    kindText: ACCOUNT_ACTION_KIND[item.kind] || "账号处置",
    stateText: item.revokedAt
      ? "处置已撤销"
      : item.appeal
        ? (ACCOUNT_APPEAL_STATUS[item.appeal.status] || "申诉状态更新中")
        : "处置生效中",
    startsText: formatShanghaiDateTime(item.startsAt),
    endsText: formatShanghaiDateTime(item.endsAt),
    appealDeadlineText: formatShanghaiDateTime(item.appealDeadlineAt),
    appealReviewDueText: formatShanghaiDateTime(item.appeal?.reviewDueAt),
    appealResolvedText: formatShanghaiDateTime(item.appeal?.resolvedAt)
  };
}

function deletionView(item: AccountDeletionRequest): AccountDeletionView {
  return {
    ...item,
    statusText: DELETION_STATUS[item.status] || "状态更新中",
    createdText: formatShanghaiDateTime(item.createdAt),
    updatedText: formatShanghaiDateTime(item.updatedAt),
    dueText: formatShanghaiDateTime(item.dueAt),
    completedText: formatShanghaiDateTime(item.completedAt),
    cancelledText: formatShanghaiDateTime(item.cancelledAt),
    reactivationMessage: item.companionReactivationRequired
      ? "陪伴者供给仍保持暂停。请重新提交商业资料，并在账号状态、成年资格、服务协议、服务项目和档期全部复核通过后由运营重新上架；旧供给不会自动恢复。"
      : ""
  };
}

function invoiceOrderOptions(orders: InvoiceCandidateOrder[]): InvoiceOrderOption[] {
  return orders
    .filter((order) => order.eligible)
    .map((order) => ({
      id: order.id,
      label: `${order.serviceTitle} · ${formatCny(order.amountCents)} · ${formatShanghaiDateTime(order.scheduledAt)}`
    }));
}

Page({
  data: {
    motionOff: false,
    user: null as AuthUser | null,
    avatarText: "我",
    displayName: "微信用户",
    verificationText: "身份状态未核验",
    maskedPhone: "",
    bills: [] as BillItem[],
    billPage: 1,
    billTotalPages: 1,
    billTotal: 0,
    billsLoadingMore: false,
    billsLoadMoreError: "",
    blockedConversations: [] as BlockedConversation[],
    blockedConversationPage: 1,
    blockedConversationTotalPages: 1,
    blockedConversationTotal: 0,
    blockedConversationsLoadingMore: false,
    blockedConversationsLoadMoreError: "",
    loading: true,
    error: "",
    limitedAccountMode: false,
    limitedAccountMessage: "",
    partialWarning: "",
    legalRecoveryMode: false,
    accountStatus: "active",
    accountActions: [] as AccountActionView[],
    accountActionsState: "loading" as LoadState,
    accountActionsError: "",
    accountActionsPage: 1,
    accountActionsTotalPages: 1,
    accountActionsTotal: 0,
    focusAccountActionId: "",
    focusAccountAppealId: "",
    accountAppealActionId: "",
    accountAppealStatement: "",
    accountAppealEvidenceDrafts: [] as ControlledEvidenceDraft[],
    accountAppealEvidenceUploading: false,
    accountAppealTextOnly: !controlledEvidenceEnabled(),
    accountAppealSubmitting: false,
    sessions: [] as SessionView[],
    sessionState: "loading" as LoadState,
    sessionError: "",
    revokingSessionId: "",
    revokingOtherSessions: false,
    sessionPage: 1,
    sessionHasMore: false,
    sessionLoadingMore: false,
    otherSessionCount: 0,
    dataRights: [] as DataRightsView[],
    dataRightsState: "loading" as LoadState,
    dataRightsError: "",
    dataRightsPage: 1,
    dataRightsTotalPages: 1,
    dataRightsTotal: 0,
    dataRightTypeLabels: DATA_RIGHT_OPTIONS.map((item) => item.label),
    dataRightTypeIndex: 1,
    dataRightType: "export" as DataRightsRequestType,
    dataRightDescription: "",
    dataRightFormOpen: false,
    dataRightSubmitting: false,
    dataRightFollowUpRequestId: "",
    dataRightFollowUpStatement: "",
    dataRightFollowUpSubmitting: false,
    downloadingDataRightId: "",
    invoices: [] as InvoiceView[],
    invoiceState: "loading" as LoadState,
    invoiceError: "",
    invoicePage: 1,
    invoiceTotalPages: 1,
    invoiceTotal: 0,
    invoiceOrderOptions: [] as InvoiceOrderOption[],
    invoiceCandidatePage: 1,
    invoiceCandidateTotalPages: 1,
    invoiceCandidateTotal: 0,
    invoiceCandidatesLoadingMore: false,
    invoiceCandidatesLoadMoreError: "",
    invoiceOrderLabels: [] as string[],
    invoiceOrderIndex: 0,
    invoiceOrderId: "",
    invoiceTitle: "",
    invoiceFormOpen: false,
    invoiceSubmitting: false,
    cancellingInvoiceId: "",
    deletionRequest: null as AccountDeletionView | null,
    deletionPolicy: null as AccountDeletionPolicy | null,
    deletionCanRequest: true,
    deletionState: "loading" as LoadState,
    deletionError: "",
    deletionMessage: "",
    deletionSubmitting: false,
    deletionCancelling: false
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      legalRecoveryMode: options?.recovery === "1" || !currentLegalConsent(),
      focusAccountActionId: options?.actionId || "",
      focusAccountAppealId: options?.appealId || "",
      accountActionsPage: 1
    });
  },
  onShow() { void this.load(); },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.setData({
      loading: true,
      error: "",
      limitedAccountMode: false,
      limitedAccountMessage: "",
      partialWarning: "",
      accountActionsState: "loading",
      accountActionsError: ""
    });
    try {
      if (this.data.legalRecoveryMode || !currentLegalConsent()) {
        this.setData({
          legalRecoveryMode: true,
          limitedAccountMode: true,
          limitedAccountMessage: "你正在使用不依赖平台协议同意的受限恢复通道。这里只能核验微信身份并处理账号申诉、个人信息权利与注销；订单、聊天、推荐等业务保持关闭。"
        });
        await ensureLegalRecoverySession();
        await Promise.all([
          this.loadAccountActions(),
          this.loadDataRights(),
          this.loadDeletionRequest()
        ]);
        this.setData({ loading: false });
        return;
      }
      await ensureSession();
      const actionsResult = await api.accountActions({
        page: this.data.accountActionsPage,
        pageSize: 20,
        actionId: this.data.focusAccountActionId || undefined,
        appealId: this.data.focusAccountAppealId || undefined
      })
        .then((value) => ({ ok: true as const, value }))
        .catch((error: ApiError) => ({ ok: false as const, error }));
      if (actionsResult.ok) {
        const actions = (actionsResult.value.items || [])
          .map(accountActionView)
          .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt));
        this.setData({
          accountStatus: actionsResult.value.accountStatus,
          accountActions: actions,
          accountActionsState: actions.length ? "available" : "empty",
          accountActionsPage: actionsResult.value.pagination.page,
          accountActionsTotalPages: actionsResult.value.pagination.totalPages,
          accountActionsTotal: actionsResult.value.pagination.total
        });
        if (actionsResult.value.accountStatus === "banned") {
          this.setData({
            loading: false,
            limitedAccountMode: true,
            limitedAccountMessage: "账号当前处于封禁状态。订单、消息与社区功能不可用，但你仍可查看正式处置、提交申诉、行使数据权利或申请注销。"
          });
          await Promise.all([this.loadDataRights(), this.loadDeletionRequest()]);
          return;
        }
      } else {
        this.setData({
          accountActions: [],
          accountActionsState: "error",
          accountActionsError: actionsResult.error.message || "账号处置记录暂时无法读取"
        });
      }
      const [user, ordersResult, conversationsResult, invoiceCandidatesResult] = await Promise.all([
        api.fetchMe(),
        api.orders({ page: 1, pageSize: 20, view: "all" }).then((value) => ({ ok: true as const, value }))
          .catch(() => ({ ok: false as const, value: { items: [] as Order[], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })),
        api.conversations({ page: 1, pageSize: 20, blockedByYou: true }).then((value) => ({ ok: true as const, value }))
          .catch(() => ({ ok: false as const, value: { conversations: [] as Conversation[], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } })),
        api.invoiceCandidateOrders({ page: 1, pageSize: 20 }).then((value) => ({ ok: true as const, value }))
          .catch(() => ({ ok: false as const, value: { items: [] as InvoiceCandidateOrder[], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } }))
      ]);
      const orders = ordersResult.value.items || [];
      const candidates = invoiceCandidatesResult.value.items || [];
      const options = invoiceOrderOptions(candidates);
      const selectedOrderId = options.some((item) => item.id === this.data.invoiceOrderId)
        ? this.data.invoiceOrderId
        : options[0]?.id || "";
      const selectedIndex = Math.max(0, options.findIndex((item) => item.id === selectedOrderId));
      const missing = [
        ordersResult.ok ? "" : "账单记录",
        conversationsResult.ok ? "" : "会话安全设置",
        invoiceCandidatesResult.ok ? "" : "可开发票订单"
      ].filter(Boolean);
      this.setData({
        user,
        avatarText: (user.profile?.displayName || "我").slice(0, 1),
        displayName: user.profile?.displayName || "微信用户",
        verificationText: user.profile?.isVerified ? "身份状态已核验" : "身份状态未核验",
        maskedPhone: maskPhone(user.profile?.phone),
        bills: orders.map(billItem),
        billPage: ordersResult.value.pagination.page,
        billTotalPages: ordersResult.value.pagination.totalPages,
        billTotal: ordersResult.value.pagination.total,
        billsLoadMoreError: "",
        blockedConversations: (conversationsResult.value.conversations || [])
          .map((item) => ({ ...item, name: item.participant?.name || "平台会话" })),
        blockedConversationPage: conversationsResult.value.pagination.page,
        blockedConversationTotalPages: conversationsResult.value.pagination.totalPages,
        blockedConversationTotal: conversationsResult.value.pagination.total,
        blockedConversationsLoadMoreError: "",
        invoiceOrderOptions: options,
        invoiceOrderLabels: options.map((item) => item.label),
        invoiceOrderId: selectedOrderId,
        invoiceOrderIndex: selectedIndex,
        invoiceCandidatePage: invoiceCandidatesResult.value.pagination.page,
        invoiceCandidateTotalPages: invoiceCandidatesResult.value.pagination.totalPages,
        invoiceCandidateTotal: invoiceCandidatesResult.value.pagination.total,
        invoiceCandidatesLoadMoreError: "",
        partialWarning: missing.length
          ? `${missing.join("、")}暂时未能读取；页面未用空列表冒充完整结果。`
          : "",
        loading: false
      });
      await Promise.all([
        this.loadSessions(),
        this.loadDataRights(),
        this.loadInvoices(),
        this.loadDeletionRequest()
      ]);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code === "ACCOUNT_BANNED") {
        this.setData({
          loading: false,
          error: "",
          limitedAccountMode: true,
          limitedAccountMessage: "账号当前处于封禁状态。常规资料读取已停止，但正式申诉、数据权利与注销入口仍保持可用。"
        });
        await Promise.all([
          this.loadAccountActions(),
          this.loadDataRights(),
          this.loadDeletionRequest()
        ]);
        return;
      }
      const message = (error as Error).message || "账户中心暂时无法加载";
      this.setData({
        loading: false,
        error: message,
        sessionState: "error",
        sessionError: message,
        dataRightsState: "error",
        dataRightsError: message,
        accountActionsState: "error",
        accountActionsError: message,
        deletionState: "error",
        deletionError: message,
        invoiceState: "error",
        invoiceError: message
      });
    } finally {
      if (stopRefresh) wx.stopPullDownRefresh();
    }
  },
  async loadMoreBills() {
    if (this.data.billsLoadingMore || this.data.billPage >= this.data.billTotalPages) return;
    const page = this.data.billPage + 1;
    this.setData({ billsLoadingMore: true, billsLoadMoreError: "" });
    try {
      const result = await api.orders({ page, pageSize: 20, view: "all" });
      const incoming = (result.items || []).map(billItem);
      const byId = new Map(this.data.bills.map((item) => [item.id, item]));
      incoming.forEach((item) => byId.set(item.id, item));
      this.setData({
        bills: [...byId.values()],
        billPage: result.pagination.page,
        billTotalPages: result.pagination.totalPages,
        billTotal: result.pagination.total,
        billsLoadMoreError: ""
      });
    } catch (error) {
      this.setData({ billsLoadMoreError: (error as Error).message || "更多账单暂时无法读取；已加载账单仍保留。" });
    } finally {
      this.setData({ billsLoadingMore: false });
    }
  },
  async loadMoreBlockedConversations() {
    if (
      this.data.blockedConversationsLoadingMore
      || this.data.blockedConversationPage >= this.data.blockedConversationTotalPages
    ) return;
    const page = this.data.blockedConversationPage + 1;
    this.setData({ blockedConversationsLoadingMore: true, blockedConversationsLoadMoreError: "" });
    try {
      const result = await api.conversations({ page, pageSize: 20, blockedByYou: true });
      const incoming = (result.conversations || []).map((item) => ({
        ...item,
        name: item.participant?.name || "平台会话"
      }));
      const byId = new Map(this.data.blockedConversations.map((item) => [item.id, item]));
      incoming.forEach((item) => byId.set(item.id, item));
      this.setData({
        blockedConversations: [...byId.values()],
        blockedConversationPage: result.pagination.page,
        blockedConversationTotalPages: result.pagination.totalPages,
        blockedConversationTotal: result.pagination.total,
        blockedConversationsLoadMoreError: ""
      });
    } catch (error) {
      this.setData({ blockedConversationsLoadMoreError: (error as Error).message || "更多已拉黑会话暂时无法读取；已加载设置仍保留。" });
    } finally {
      this.setData({ blockedConversationsLoadingMore: false });
    }
  },
  async loadMoreInvoiceCandidates() {
    if (this.data.invoiceCandidatesLoadingMore || this.data.invoiceCandidatePage >= this.data.invoiceCandidateTotalPages) return;
    const page = this.data.invoiceCandidatePage + 1;
    this.setData({ invoiceCandidatesLoadingMore: true, invoiceCandidatesLoadMoreError: "" });
    try {
      const result = await api.invoiceCandidateOrders({ page, pageSize: 20 });
      const incoming = invoiceOrderOptions(result.items || []);
      const currentOptions = this.data.invoiceOrderOptions as InvoiceOrderOption[];
      const byId = new Map<string, InvoiceOrderOption>(currentOptions.map((item) => [item.id, item]));
      incoming.forEach((item) => byId.set(item.id, item));
      const options = [...byId.values()];
      const selectedOrderId = options.some((item) => item.id === this.data.invoiceOrderId)
        ? this.data.invoiceOrderId
        : options[0]?.id || "";
      this.setData({
        invoiceOrderOptions: options,
        invoiceOrderLabels: options.map((item) => item.label),
        invoiceOrderId: selectedOrderId,
        invoiceOrderIndex: Math.max(0, options.findIndex((item) => item.id === selectedOrderId)),
        invoiceCandidatePage: result.pagination.page,
        invoiceCandidateTotalPages: result.pagination.totalPages,
        invoiceCandidateTotal: result.pagination.total,
        invoiceCandidatesLoadMoreError: ""
      });
    } catch (error) {
      this.setData({ invoiceCandidatesLoadMoreError: (error as Error).message || "更多可开票订单暂时无法核对；已加载选项仍保留。" });
    } finally {
      this.setData({ invoiceCandidatesLoadingMore: false });
    }
  },
  async loadAccountActions() {
    this.setData({ accountActionsState: "loading", accountActionsError: "" });
    try {
      const result = await api.accountActions({
        page: this.data.accountActionsPage,
        pageSize: 20,
        actionId: this.data.focusAccountActionId || undefined,
        appealId: this.data.focusAccountAppealId || undefined
      });
      const items = (result.items || [])
        .map(accountActionView)
        .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt));
      this.setData({
        accountStatus: result.accountStatus,
        accountActions: items,
        accountActionsState: items.length ? "available" : "empty",
        accountActionsPage: result.pagination.page,
        accountActionsTotalPages: result.pagination.totalPages,
        accountActionsTotal: result.pagination.total,
        limitedAccountMode: result.accountStatus === "banned" || this.data.limitedAccountMode
      });
    } catch (error) {
      this.setData({
        accountActions: [],
        accountActionsState: "error",
        accountActionsError: (error as Error).message || "账号处置记录暂时无法读取"
      });
    }
  },
  previousAccountActionsPage() {
    if (this.data.accountActionsPage <= 1) return;
    this.setData({ accountActionsPage: this.data.accountActionsPage - 1 });
    void this.loadAccountActions();
  },
  nextAccountActionsPage() {
    if (this.data.accountActionsPage >= this.data.accountActionsTotalPages) return;
    this.setData({ accountActionsPage: this.data.accountActionsPage + 1 });
    void this.loadAccountActions();
  },
  clearAccountActionFocus() {
    this.setData({ focusAccountActionId: "", focusAccountAppealId: "", accountActionsPage: 1 });
    void this.loadAccountActions();
  },
  async openAccountAppeal(event: any) {
    if (this.data.accountAppealSubmitting) return;
    const id = String(event.currentTarget.dataset.id || "");
    const action = this.data.accountActions.find((item) => item.id === id);
    if (!action?.canAppeal || action.appeal || action.revokedAt) return;
    const transport = this.accountAppealEvidenceTransport(id);
    const drafts = controlledEvidenceEnabled()
      ? await refreshControlledEvidenceDrafts(
          loadControlledEvidenceDrafts(this.accountAppealEvidenceStorageKey(id)),
          transport
        )
      : [];
    this.setData({
      accountAppealActionId: id,
      accountAppealStatement: "",
      accountAppealEvidenceDrafts: drafts
    });
  },
  closeAccountAppeal() {
    if (this.data.accountAppealSubmitting) return;
    this.setData({
      accountAppealActionId: "",
      accountAppealStatement: "",
      accountAppealEvidenceDrafts: []
    });
  },
  setAccountAppealStatement(event: any) {
    this.setData({
      accountAppealStatement: String(event.detail?.value || "").slice(0, 1000)
    });
  },
  async submitAccountAppeal() {
    const actionId = this.data.accountAppealActionId;
    const statement = this.data.accountAppealStatement.trim();
    const action = this.data.accountActions.find((item) => item.id === actionId);
    if (!action?.canAppeal || action.appeal || this.data.accountAppealSubmitting) return;
    if (statement.length < 10 || statement.length > 1000) {
      wx.showToast({ title: "请填写 10–1000 字申诉说明", icon: "none" });
      return;
    }
    if (this.data.accountAppealEvidenceDrafts.some((item) => item.status !== "approved")) {
      wx.showToast({ title: "请等待证据审核，或移除未通过文件", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "提交账号处置申诉",
      content: `你正在就“${action.kindText}”提交正式复核。提交成功不代表原处置已撤销，结果以独立复核结论为准。`,
      confirmText: "确认提交",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ accountAppealSubmitting: true });
    try {
      await api.createAccountActionAppeal(
        actionId,
        statement,
        approvedControlledEvidenceIds(this.data.accountAppealEvidenceDrafts)
      );
      saveControlledEvidenceDrafts(this.accountAppealEvidenceStorageKey(actionId), []);
      this.setData({
        accountAppealActionId: "",
        accountAppealStatement: "",
        accountAppealEvidenceDrafts: []
      });
      wx.showToast({ title: "申诉已提交", icon: "success" });
      await this.loadAccountActions();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "申诉提交失败", icon: "none" });
    } finally {
      this.setData({ accountAppealSubmitting: false });
    }
  },
  async addAccountAppealEvidenceImage() {
    const file = await chooseEvidenceImage();
    if (file) await this.uploadAccountAppealEvidence(file);
  },
  async addAccountAppealEvidenceAudio() {
    const file = await chooseEvidenceAudio();
    if (file) await this.uploadAccountAppealEvidence(file);
  },
  async uploadAccountAppealEvidence(file: LocalEvidenceFile) {
    const actionId = this.data.accountAppealActionId;
    if (
      !actionId
      || this.data.accountAppealEvidenceUploading
      || this.data.accountAppealEvidenceDrafts.length >= 3
    ) return;
    this.setData({ accountAppealEvidenceUploading: true });
    try {
      let pendingId = "";
      const storageKey = this.accountAppealEvidenceStorageKey(actionId);
      const draft = await uploadControlledEvidence(
        file,
        (input) => api.reserveAccountActionAppealEvidenceUpload(actionId, input),
        (next) => {
          pendingId ||= next.assetId;
          const drafts = this.data.accountAppealEvidenceDrafts
            .filter((item) => item.assetId !== pendingId);
          drafts.push(next);
          saveControlledEvidenceDrafts(storageKey, drafts);
          this.setData({ accountAppealEvidenceDrafts: drafts });
        },
        this.accountAppealEvidenceTransport(actionId)
      );
      if (draft.status !== "approved") {
        wx.showToast({ title: draft.statusText, icon: "none" });
      }
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "证据上传失败", icon: "none" });
    } finally {
      this.setData({ accountAppealEvidenceUploading: false });
    }
  },
  async refreshAccountAppealEvidence() {
    const actionId = this.data.accountAppealActionId;
    if (!actionId || !controlledEvidenceEnabled()) return;
    const drafts = await refreshControlledEvidenceDrafts(
      this.data.accountAppealEvidenceDrafts,
      this.accountAppealEvidenceTransport(actionId)
    );
    saveControlledEvidenceDrafts(this.accountAppealEvidenceStorageKey(actionId), drafts);
    this.setData({ accountAppealEvidenceDrafts: drafts });
  },
  removeAccountAppealEvidence(event: any) {
    const assetId = String(event.currentTarget.dataset.id || "");
    const drafts = this.data.accountAppealEvidenceDrafts
      .filter((item) => item.assetId !== assetId);
    saveControlledEvidenceDrafts(
      this.accountAppealEvidenceStorageKey(this.data.accountAppealActionId),
      drafts
    );
    this.setData({ accountAppealEvidenceDrafts: drafts });
  },
  async openAccountAppealEvidence(event: any) {
    if (!controlledEvidenceEnabled()) {
      wx.showToast({ title: TEXT_ONLY_EVIDENCE_MESSAGE, icon: "none" });
      return;
    }
    const actionId = String(event.currentTarget.dataset.actionId || "");
    const attachmentId = String(event.currentTarget.dataset.id || "");
    try {
      const result = await api.accountActionAppealEvidenceReadUrl(actionId, attachmentId);
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
  accountAppealEvidenceTransport(actionId: string) {
    return {
      complete: (assetId: string) => api.completeAccountActionAppealEvidenceUpload(actionId, assetId),
      status: (assetId: string) => api.accountActionAppealEvidenceUploadStatus(actionId, assetId)
    };
  },
  accountAppealEvidenceStorageKey(actionId: string) {
    return `talkandtalk.caseEvidence.userAccountAppeal.${actionId}`;
  },
  async loadSessions(pageOrEvent: number | unknown = 1, append = false) {
    const page = typeof pageOrEvent === "number" ? pageOrEvent : 1;
    if (append && (this.data.sessionLoadingMore || !this.data.sessionHasMore)) return;
    this.setData(append
      ? { sessionLoadingMore: true, sessionError: "" }
      : { sessionState: "loading", sessionError: "", sessionPage: 1 });
    try {
      await ensureSession();
      const result = await api.accountSessions({ page, pageSize: 20 });
      const sessionsById = new Map<string, SessionView>(
        (append ? this.data.sessions : []).map((session) => [session.id, session])
      );
      (result.items || []).map(sessionView).forEach((session) => sessionsById.set(session.id, session));
      const sessions = [...sessionsById.values()]
        .sort((left, right) => Number(right.current) - Number(left.current)
          || Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt)
          || Date.parse(right.createdAt) - Date.parse(left.createdAt)
          || right.id.localeCompare(left.id));
      const total = result.pagination?.total ?? sessions.length;
      this.setData({
        sessions,
        sessionPage: page,
        sessionHasMore: page * 20 < total,
        otherSessionCount: Math.max(0, total - 1),
        sessionState: sessions.length ? "available" : "empty",
        sessionLoadingMore: false
      });
    } catch (error) {
      this.setData({
        ...(append ? {} : { sessions: [] }),
        sessionState: "error",
        sessionError: (error as Error).message || "登录设备暂时无法读取",
        sessionLoadingMore: false
      });
    }
  },
  loadMoreSessions() {
    void this.loadSessions(this.data.sessionPage + 1, true);
  },
  async revokeSession(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const session = this.data.sessions.find((item) => item.id === id);
    if (!session || session.current || this.data.revokingSessionId) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "下线这台设备",
      content: `将撤销“${session.sessionLabel || session.clientPlatform || "其他设备"}”的登录会话。该设备需要重新登录，订单、消息和案件不会删除。`,
      confirmText: "确认下线",
      confirmColor: "#A94458",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ revokingSessionId: id });
    try {
      const result = await api.revokeAccountSession(id);
      if (!result.success || result.id !== id) throw new Error("服务端未确认设备下线");
      wx.showToast({ title: "该设备已下线", icon: "success" });
      await this.loadSessions();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "设备下线失败", icon: "none" });
    } finally {
      this.setData({ revokingSessionId: "" });
    }
  },
  async revokeOtherSessions() {
    if (this.data.revokingOtherSessions || this.data.revokingSessionId || this.data.otherSessionCount < 1) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "下线其他所有设备",
      content: `将撤销其他 ${this.data.otherSessionCount} 个登录会话，当前设备保持登录。订单、消息和案件不会删除。`,
      confirmText: "全部下线",
      confirmColor: "#A94458",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ revokingOtherSessions: true });
    try {
      const result = await api.revokeOtherAccountSessions();
      if (!result.success) throw new Error("服务端未确认设备下线");
      wx.showToast({
        title: result.revokedCount ? `已下线 ${result.revokedCount} 台` : "没有其他在线设备",
        icon: result.revokedCount ? "success" : "none"
      });
      await this.loadSessions();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "批量下线失败", icon: "none" });
    } finally {
      this.setData({ revokingOtherSessions: false });
    }
  },
  async loadDataRights() {
    this.setData({ dataRightsState: "loading", dataRightsError: "" });
    try {
      const result = await api.dataRightsRequests({ page: this.data.dataRightsPage, pageSize: 20 });
      const items = (result.items || [])
        .map(dataRightsView)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      this.setData({
        dataRights: items,
        dataRightsState: items.length ? "available" : "empty",
        dataRightsPage: result.pagination.page,
        dataRightsTotalPages: result.pagination.totalPages,
        dataRightsTotal: result.pagination.total
      });
    } catch (error) {
      this.setData({
        dataRights: [],
        dataRightsState: "error",
        dataRightsError: (error as Error).message || "数据权利请求暂时无法读取"
      });
    }
  },
  previousDataRightsPage() {
    if (this.data.dataRightsPage <= 1) return;
    this.setData({ dataRightsPage: this.data.dataRightsPage - 1 });
    void this.loadDataRights();
  },
  nextDataRightsPage() {
    if (this.data.dataRightsPage >= this.data.dataRightsTotalPages) return;
    this.setData({ dataRightsPage: this.data.dataRightsPage + 1 });
    void this.loadDataRights();
  },
  toggleDataRightForm() {
    if (this.data.dataRightSubmitting) return;
    this.setData({ dataRightFormOpen: !this.data.dataRightFormOpen });
  },
  selectDataRightType(event: any) {
    const index = Number(event.detail?.value || 0);
    const option = DATA_RIGHT_OPTIONS[index] || DATA_RIGHT_OPTIONS[0];
    this.setData({ dataRightTypeIndex: index, dataRightType: option.value });
  },
  setDataRightDescription(event: any) {
    this.setData({ dataRightDescription: String(event.detail?.value || "").slice(0, 500) });
  },
  async submitDataRightRequest() {
    if (this.data.dataRightSubmitting) return;
    const description = this.data.dataRightDescription.trim();
    if (description.length < 5) {
      wx.showToast({ title: "请至少填写 5 个字的请求说明", icon: "none" });
      return;
    }
    const selected = DATA_RIGHT_OPTIONS.find((item) => item.value === this.data.dataRightType);
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "提交数据权利请求",
      content: `请求类型：${selected?.label || "数据权利请求"}。提交只代表平台收到请求，不表示数据包已生成或数据已删除。`,
      confirmText: "确认提交",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ dataRightSubmitting: true });
    try {
      await api.createDataRightsRequest({
        type: this.data.dataRightType,
        description
      });
      this.setData({ dataRightDescription: "", dataRightFormOpen: false });
      wx.showToast({ title: "请求已提交", icon: "success" });
      await this.loadDataRights();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "请求提交失败", icon: "none" });
    } finally {
      this.setData({ dataRightSubmitting: false });
    }
  },
  openDataRightFollowUp(event: any) {
    if (this.data.dataRightFollowUpSubmitting) return;
    const id = String(event.currentTarget.dataset.id || "");
    const request = this.data.dataRights.find((item) => item.id === id);
    if (!request || request.status !== "needsInformation") return;
    this.setData({ dataRightFollowUpRequestId: id, dataRightFollowUpStatement: "" });
  },
  closeDataRightFollowUp() {
    if (this.data.dataRightFollowUpSubmitting) return;
    this.setData({ dataRightFollowUpRequestId: "", dataRightFollowUpStatement: "" });
  },
  setDataRightFollowUpStatement(event: any) {
    this.setData({ dataRightFollowUpStatement: String(event.detail?.value || "").slice(0, 500) });
  },
  async submitDataRightFollowUp() {
    const id = this.data.dataRightFollowUpRequestId;
    const statement = this.data.dataRightFollowUpStatement.trim();
    const request = this.data.dataRights.find((item) => item.id === id);
    if (!request || request.status !== "needsInformation" || this.data.dataRightFollowUpSubmitting) return;
    if (statement.length < 5 || statement.length > 500) {
      wx.showToast({ title: "请填写 5–500 字补充说明", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "提交补充信息",
      content: "补充内容会进入这条数据权利请求的处理记录；提交不表示请求已经完成。",
      confirmText: "确认提交",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ dataRightFollowUpSubmitting: true });
    try {
      await api.addDataRightsRequestFollowUp(id, statement);
      this.setData({ dataRightFollowUpRequestId: "", dataRightFollowUpStatement: "" });
      wx.showToast({ title: "补充信息已提交", icon: "success" });
      await this.loadDataRights();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "补充信息提交失败", icon: "none" });
    } finally {
      this.setData({ dataRightFollowUpSubmitting: false });
    }
  },
  async downloadDataRightExport(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const request = this.data.dataRights.find((item) => item.id === id);
    if (!request?.canDownload || this.data.downloadingDataRightId) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "下载个人数据副本",
      content: "数据包可能包含个人资料、订单和平台互动记录。下载后将打开微信文件界面，请只保存到自己的设备或发送给可信账号。",
      confirmText: "安全下载",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;

    this.setData({ downloadingDataRightId: id });
    try {
      const file = await downloadDataRightsExport(id);
      if (file.contentType === "application/pdf" && wx.openDocument) {
        await new Promise<void>((resolve, reject) => wx.openDocument({
          filePath: file.tempFilePath,
          fileType: "pdf",
          showMenu: true,
          success: () => resolve(),
          fail: reject
        }));
      } else if (wx.shareFileMessage) {
        await new Promise<void>((resolve, reject) => wx.shareFileMessage({
          filePath: file.tempFilePath,
          fileName: file.fileName,
          success: () => resolve(),
          fail: reject
        }));
      } else if (wx.saveFile) {
        await new Promise<void>((resolve, reject) => wx.saveFile({
          tempFilePath: file.tempFilePath,
          success: () => {
            wx.showModal({
              title: "数据包已保存",
              content: "当前微信版本不支持直接打开该格式，数据包已保存到本小程序的私有文件目录。如需转存，请通过公开客服渠道联系平台。",
              showCancel: false
            });
            resolve();
          },
          fail: reject
        }));
      } else {
        throw new Error("当前微信版本不支持文件交付，请升级微信后重试");
      }
    } catch (error) {
      const message = (error as any)?.errMsg || (error as Error).message || "数据包下载失败";
      if (!/cancel/i.test(message)) {
        wx.showToast({ title: message, icon: "none" });
      }
    } finally {
      this.setData({ downloadingDataRightId: "" });
    }
  },
  async loadInvoices() {
    this.setData({ invoiceState: "loading", invoiceError: "" });
    try {
      await ensureSession();
      const result = await api.invoiceRequests({ page: this.data.invoicePage, pageSize: 20 });
      const items = (result.items || [])
        .map(invoiceView)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      this.setData({
        invoices: items,
        invoiceState: items.length ? "available" : "empty",
        invoicePage: result.pagination.page,
        invoiceTotalPages: result.pagination.totalPages,
        invoiceTotal: result.pagination.total
      });
    } catch (error) {
      this.setData({
        invoices: [],
        invoiceState: "error",
        invoiceError: (error as Error).message || "发票申请暂时无法读取"
      });
    }
  },
  previousInvoicePage() {
    if (this.data.invoicePage <= 1) return;
    this.setData({ invoicePage: this.data.invoicePage - 1 });
    void this.loadInvoices();
  },
  nextInvoicePage() {
    if (this.data.invoicePage >= this.data.invoiceTotalPages) return;
    this.setData({ invoicePage: this.data.invoicePage + 1 });
    void this.loadInvoices();
  },
  toggleInvoiceForm() {
    if (this.data.invoiceSubmitting) return;
    if (!this.data.invoiceOrderOptions.length) {
      wx.showToast({
        title: this.data.invoiceCandidatePage < this.data.invoiceCandidateTotalPages
          ? "请先继续核对更多可开票订单"
          : "已遍历全部订单，当前没有可申请发票的订单",
        icon: "none"
      });
      return;
    }
    this.setData({ invoiceFormOpen: !this.data.invoiceFormOpen });
  },
  selectInvoiceOrder(event: any) {
    const index = Number(event.detail?.value || 0);
    const option = this.data.invoiceOrderOptions[index];
    if (!option) return;
    this.setData({ invoiceOrderIndex: index, invoiceOrderId: option.id });
  },
  setInvoiceTitle(event: any) {
    this.setData({ invoiceTitle: String(event.detail?.value || "").slice(0, 100) });
  },
  async submitInvoiceRequest() {
    if (this.data.invoiceSubmitting) return;
    const orderId = this.data.invoiceOrderId;
    const invoiceTitle = this.data.invoiceTitle.trim();
    if (!orderId) {
      wx.showToast({ title: "请选择一笔已支付订单", icon: "none" });
      return;
    }
    if (invoiceTitle.length < 2) {
      wx.showToast({ title: "请填写至少 2 个字的发票抬头", icon: "none" });
      return;
    }
    const option = this.data.invoiceOrderOptions.find((item) => item.id === orderId);
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认提交发票申请",
      content: `${option?.label || "所选订单"}\n抬头：${invoiceTitle}\n提交后以平台审核状态为准。`,
      confirmText: "确认提交",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ invoiceSubmitting: true });
    try {
      await api.createInvoiceRequest({ orderId, invoiceTitle });
      this.setData({ invoiceTitle: "", invoiceFormOpen: false });
      wx.showToast({ title: "发票申请已提交", icon: "success" });
      await this.loadInvoices();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "发票申请提交失败", icon: "none" });
    } finally {
      this.setData({ invoiceSubmitting: false });
    }
  },
  async cancelInvoiceRequest(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const invoice = this.data.invoices.find((item) => item.id === id);
    if (!invoice || invoice.status !== "submitted" || this.data.cancellingInvoiceId) return;
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "撤回发票申请",
      content: "仅撤回尚未进入审核的发票申请，不会取消订单、改变支付结果或自动发起退款。",
      confirmText: "确认撤回",
      confirmColor: "#A94458",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ cancellingInvoiceId: id });
    try {
      await api.cancelInvoiceRequest(id);
      wx.showToast({ title: "发票申请已撤回", icon: "success" });
      await this.loadInvoices();
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "发票申请撤回失败", icon: "none" });
    } finally {
      this.setData({ cancellingInvoiceId: "" });
    }
  },
  async loadDeletionRequest() {
    this.setData({ deletionState: "loading", deletionError: "" });
    try {
      const result = await api.deletionRequest();
      this.setData({
        deletionRequest: result.request ? deletionView(result.request) : null,
        deletionPolicy: result.policy,
        deletionCanRequest: !result.request || !["pending", "processing", "completed"].includes(result.request.status),
        deletionState: result.request ? "available" : "empty"
      });
    } catch (error) {
      this.setData({
        deletionRequest: null,
        deletionCanRequest: false,
        deletionState: "error",
        deletionError: (error as Error).message || "注销申请状态暂时无法读取"
      });
    }
  },
  openProfile() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  openNotificationCenter() {
    wx.navigateTo({ url: "/pages/notifications/index" });
  },
  openSupportCenter() {
    wx.navigateTo({ url: "/pages/support/index" });
  },
  openAdultEligibility() {
    wx.navigateTo({ url: "/pages/account/adult-eligibility" });
  },
  openPrivacyRequest() {
    this.setData({
      dataRightTypeIndex: 1,
      dataRightType: "export",
      dataRightFormOpen: true
    });
  },
  openInvoiceRequest() {
    this.toggleInvoiceForm();
  },
  openBill(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/order/detail?id=${encodeURIComponent(id)}` });
  },
  openBlockedConversation(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(id)}` });
  },
  openPrivacy() { openLegalDocument("privacy"); },
  openTerms() { openLegalDocument("terms"); },
  async signOut() {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "退出当前账号",
      content: "只会退出当前小程序登录，不会删除订单、消息、客服案件或账号。",
      confirmText: "确认退出",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    if (this.data.legalRecoveryMode) await logoutLegalRecovery();
    else await logout();
    wx.reLaunch({ url: "/pages/consent/index" });
  },
  async requestDeletion() {
    if (this.data.deletionSubmitting || ["pending", "processing"].includes(this.data.deletionRequest?.status || "")) {
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "申请注销账号",
      content: "平台会先核对未完成订单、退款、案件和结算。提交申请不代表账号已经立即删除。",
      confirmText: "提交注销申请",
      confirmColor: "#A94458",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ deletionSubmitting: true });
    try {
      const result = await api.requestDeletion();
      this.setData({
        deletionMessage: result.message || `注销申请状态：${DELETION_STATUS[result.status] || result.status}`,
        deletionRequest: deletionView(result),
        deletionPolicy: result.policy,
        deletionCanRequest: false,
        deletionState: "available"
      });
      wx.showToast({ title: "注销申请已提交", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "注销申请提交失败", icon: "none" });
    } finally {
      this.setData({ deletionSubmitting: false });
    }
  },
  async cancelDeletionRequest() {
    if (
      this.data.deletionCancelling
      || this.data.deletionRequest?.status !== "pending"
      || this.data.deletionRequest?.canCancel !== true
    ) return;
    const companionWarning = this.data.user?.role === "companion"
      ? "取消后陪伴者服务、档期和公开资料不会自动恢复，需要重新完成商业资格复核和上架。"
      : "";
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "取消注销申请",
      content: `仅能取消尚未进入处理阶段的申请。${companionWarning}其他独立封禁或处罚不会被撤销。`,
      confirmText: "确认取消注销",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    this.setData({ deletionCancelling: true });
    try {
      const result = await api.cancelDeletionRequest();
      this.setData({
        deletionMessage: result.message,
        deletionRequest: deletionView(result),
        deletionPolicy: result.policy,
        deletionCanRequest: true,
        deletionState: "available"
      });
      wx.showToast({ title: "注销申请已取消", icon: "success" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "注销申请取消失败", icon: "none" });
      await this.loadDeletionRequest();
    } finally {
      this.setData({ deletionCancelling: false });
    }
  },
  async withdrawConsent() {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "撤回协议同意并退出",
      content: "撤回后会退出账号，重新同意前无法使用平台。已有订单、退款、举报和客服记录不会因此被删除。",
      confirmText: "确认撤回",
      confirmColor: "#A94458",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation.confirm) return;
    try {
      await api.withdrawLegalConsent();
      await logoutLegalRecovery();
      withdrawLegalConsent();
      wx.reLaunch({ url: "/pages/consent/index" });
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "撤回失败，请稍后重试", icon: "none" });
    }
  }
});
