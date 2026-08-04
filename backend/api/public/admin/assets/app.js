(() => {
  "use strict";

  const API_BASE = window.ADMIN_API_BASE_URL || "/api/v1";
  const storageKeys = {
    access: "talk_and_talk_admin_access_token",
    refresh: "talk_and_talk_admin_refresh_token",
    user: "talk_and_talk_admin_identity"
  };
  const state = {
    accessToken: sessionStorage.getItem(storageKeys.access) || "",
    refreshToken: sessionStorage.getItem(storageKeys.refresh) || "",
    user: parseStored(storageKeys.user),
    context: null,
    currentView: "overview",
    routeDetail: null,
    mutationsEnabled: false,
    loading: false,
    action: null,
    pages: { companions: 1, supportAssigned: 1, supportClaimable: 1, earnings: 1, recoveries: 1, training: 1, reviewDue: 1, accountActions: 1, incidents: 1, withdrawals: 1, voiceIntros: 1, orders: 1, refunds: 1, paymentReconciliationRuns: 1, paymentReconciliationIssues: 1, merchantBillImports: 1, cashLedgerClassifications: 1, paymentDisputes: 1, attendanceDisputes: 1, companionAppeals: 1, users: 1, accountAppeals: 1, deletions: 1, legalHolds: 1, dataRights: 1, dataRightsClaimable: 1, identityVerification: 1, customerAdultEligibility: 1, invoices: 1, staffCredentials: 1, audit: 1 },
    records: {
      companion: new Map(),
      identityVerification: new Map(),
      customerAdultEligibility: new Map(),
      order: new Map(),
      support: new Map(),
      attendanceDispute: new Map(),
      refund: new Map(),
      paymentReconciliationRun: new Map(),
      paymentReconciliationIssue: new Map(),
      merchantBillImport: new Map(),
      cashLedgerEntry: new Map(),
      paymentDispute: new Map(),
      earning: new Map(),
      recovery: new Map(),
      incident: new Map(),
      withdrawal: new Map(),
      companionAppeal: new Map(),
      voiceIntro: new Map(),
      training: new Map(),
      reviewDue: new Map(),
      accountAction: new Map(),
      accountAppeal: new Map(),
      user: new Map(),
      staffCredential: new Map(),
      deletion: new Map(),
      legalHold: new Map(),
      dataRight: new Map(),
      invoice: new Map()
    },
    admins: [],
    deletionSettlements: new Map(),
    legalHoldPolicy: null,
    legalHoldHistory: { retentionRecordId: "", page: 1 },
    voiceIntroReads: new Map()
  };

  const viewCopy = {
    overview: ["OPERATING TRUTH", "经营驾驶舱", "代码就绪不等于业务可放行；这里汇总当前环境的真实运行门禁。"],
    companions: ["SUPPLY CONTROL", "陪伴者与核验", "商业档案、实名、协议、公开状态与处罚必须各自留下独立事实。"],
    orders: ["FULFILLMENT", "订单与履约", "只读查看订单、支付、退款与未结客服事实，不在后台伪造履约状态。"],
    support: ["CASE MANAGEMENT", "客服工单", "按优先级和 SLA 认领、处理、退款或关闭，用户说明与内部依据保持分离。"],
    refunds: ["PAYMENT EXCEPTIONS", "退款异常", "审核、重试与渠道同步均以权威交易状态为准。"],
    complaints: ["CONSUMER COMPLAINTS", "支付投诉", "处理微信支付消费者投诉、SLA、资金冻结与主动对账，不把平台受理误写成业务完结。"],
    settlements: ["LEDGER CONTROL", "结算与追偿", "人工转账采用认领、证据与第二人复核；退款后追偿同样职责分离。"],
    lifecycle: ["PROVIDER HEALTH", "质量与生命周期", "培训之后仍需持续管理事件、处罚申诉、语音介绍和提现请求。"],
    growth: ["DISCOVERY CONTROL", "推荐与触达", "推荐曝光、策略治理与可约提醒通道必须分别有指标、门禁和受控恢复证据。"],
    accounts: ["ACCOUNT GOVERNANCE", "账号与注销", "账号限制、实名与注销结算都需要原因、证据和不可逆边界。"],
    audit: ["ACCESS & AUDIT", "权限与审计", "查看当前商业权限与脱敏运营日志；独立审核数据不在此身份域。"]
  };

  const allowedStaffRoles = new Set(["support", "finance", "supply", "operations", "admin"]);
  const viewCapabilities = {
    overview: [],
    companions: ["companion.commercial.manage", "companion.verification.manage"],
    orders: [
      "order.read.all",
      "order.read.financial",
      "order.read.operational-redacted",
      "support.order.assigned.read"
    ],
    support: [
      "support.ticket.all.read",
      "support.ticket.assigned.read",
      "support.ticket.claimable-summary.read"
    ],
    refunds: ["refund.manage", "payment-reconciliation.manage"],
    complaints: [
      "payment-dispute.queue.read",
      "payment-dispute.financial.read",
      "payment-dispute.all.read"
    ],
    settlements: ["settlement.manage", "recovery.manage", "invoice.manage"],
    lifecycle: [
      "companion.lifecycle.supply.manage",
      "companion.withdrawal.manage",
      "companion.lifecycle.manage"
    ],
    growth: ["commercial.readiness.read"],
    accounts: [
      "account.manage",
      "customer.adult-eligibility.manage",
      "data-rights.manage.all",
      "data-rights.assigned.manage",
      "data-rights.claimable-summary.read"
    ],
    audit: ["audit.read"]
  };
  const adminViews = new Set(Object.keys(viewCopy));
  const adminDetailKinds = new Map([
    ["support", { view: "support", endpoint: (id) => `/admin/commercial/support/tickets/${encodeURIComponent(id)}`, container: "#supportList", title: "客服工单详情" }],
    ["attendanceDispute", { view: "support", endpoint: (id) => `/admin/commercial/attendance-disputes/${encodeURIComponent(id)}`, container: "#attendanceDisputeList", title: "履约争议详情" }]
  ]);

  const blockerLabels = {
    orderIntakeDisabled: "订单入口已关闭",
    payoutClaimsDisabled: "结算认领已关闭",
    paymentDisputeIntakeDisabled: "微信支付投诉接入已关闭",
    wechatDailyBillReconciliationDisabled: "微信日账单对账未完成配置",
    wechatDailyBillReconciliationIncomplete: "微信日账单覆盖不完整",
    wechatDailyBillOpenIssues: "微信日账单差异未结",
    wechatDailyBillPendingApprovals: "微信日账单差异待独立复核",
    wechatDailyBillProviderTimeUnknown: "微信渠道交易时间缺失",
    wechatCashLedgerUnclassified: "微信现金台账存在未分类流水，需财务归类并复核",
    pendingBillImportApprovals: "微信账单导入待第二人批准",
    unclassifiedCashLedgerEntries: "微信资金流水待归类并绑定本地业务对象",
    failedRefunds: "退款失败",
    staleRefunds: "退款状态陈旧",
    overdueSupport: "客服工单超时",
    overdueAccountDeletions: "账号注销处理超时",
    accountDeletionExecutionFailed: "账号注销分阶段擦除终态失败，需受控重试",
    accountDeletionExecutionExpiredLeases: "账号注销擦除租约过期或缺失",
    accountDeletionExecutionBacklogSlaBreached: "账号注销到期擦除积压超过 5 分钟",
    accountDeletionPendingErasure: "账号注销数据待实际擦除",
    accountDeletionRetentionApprovalBacklog: "账号注销保留分类待法律批准入账",
    accountDeletionRetentionPolicyUnapproved: "账号注销保留政策未获外部法律批准",
    dataRetentionLegalHoldPolicyUnapproved: "数据法律留置政策未获批准或受控目录无效",
    dataRetentionLegalHoldPendingActions: "数据法律留置申请待另一名管理员复核",
    accountDeletionAuthTombstoneCoverageGaps: "账号注销登录标识保护摘要覆盖不完整，禁止继续擦除",
    accountDeletionAuthTombstoneUnknownKeys: "存在当前密钥环无法验证的登录标识保护摘要，新身份注册已关闭",
    overdueUserAccountAppeals: "普通用户账号申诉复核超时",
    overdueCompanionAccountAppeals: "陪伴者账号申诉复核超时",
    failedNotifications: "用户通知失败",
    staleNotificationLeases: "通知任务租约过期",
    notificationDeliveryDisabledWithPending: "通知队列有待投递任务，但投递工作进程未启用",
    notificationDeliveryOverduePending: "通知队列超过投递时效",
    availabilityReminderFanoutFailed: "可约提醒展开失败，请通过提醒就绪接口审查并重试",
    availabilityReminderFanoutExpiredLeases: "可约提醒展开任务租约过期，请检查工作进程",
    availabilityReminderFanoutBacklogSlaBreached: "可约提醒展开到期积压超过 5 分钟",
    availabilityReminderFanoutRunnerDisabledWithDueBacklog: "可约提醒准备 runner 未启用且存在到期展开任务",
    availabilityReminderPreparationFailures: "可约提醒准备阶段失败",
    availabilityReminderReservationFailures: "可约提醒预留阶段失败",
    availabilityReminderDeliveryFailures: "可约提醒投递工作阶段失败",
    availabilityReminderPreparationExpiredLeases: "可约提醒准备 claim 租约过期",
    availabilityReminderReservationExpiredLeases: "可约提醒预留 claim 租约过期",
    availabilityReminderDeliveryClaimExpiredLeases: "可约提醒投递 claim 租约过期",
    availabilityReminderAttemptExpiredLeases: "可约提醒发送租约过期或缺失，需恢复",
    availabilityReminderPipelineBacklogSlaBreached: "可约提醒到期流水线积压超过 5 分钟",
    availabilityReminderPreparationRunnerDisabledWithDueBacklog: "可约提醒准备 runner 未启用且存在到期任务",
    availabilityReminderDeliveryRunnerDisabledWithDueBacklog: "可约提醒投递 runner 未启用且存在到期任务",
    availabilityReminderTerminalUnresolved: "可约提醒渠道终态尚未人工核对，不得自动重试",
    pendingCommercialProfiles: "陪伴者商业档案待审",
    unresolvedRecoveries: "退款后追偿未结",
    stalePayoutClaims: "结算认领超时",
    moderationProviderUnavailable: "审核服务不可用",
    criticalModeration: "紧急审核积压",
    overdueModeration: "审核案件超时",
    mediaDeletionBacklog: "媒体删除积压",
    overdueRetainedExpiryBacklog: "法定留存到期后的擦除任务已超时",
    retainedExpiryFailures: "法定留存到期擦除失败，需按失败记录重试",
    retentionExpiry: "法定留存到期处置尚未清零",
    stalePrepays: "预支付状态陈旧",
    overduePaymentDisputes: "支付投诉处理超时",
    paymentDisputeSyncFailures: "支付投诉同步失败",
    expiredOrderRequests: "陪伴者响应超时",
    expiredPaymentReservations: "支付保留超时",
    expiredPaidServiceWindows: "已支付服务窗口超时",
    staleInService: "服务中订单陈旧",
    voiceRoomControlDisabled: "语音房控制未开启",
    voiceEmergencyStopActive: "语音紧急停服开启",
    voiceTerminationBacklog: "语音房关闭积压",
    voiceEmergencyDrainPending: "语音紧急清场未完成"
  };

  const statusLabels = {
    attentionRequired: "需要处理",
    clear: "已清零",
    pendingReview: "待复核",
    verified: "已核验",
    suspended: "已暂停",
    upheld: "维持处置",
    overturned: "撤销处置",
    dismissed: "已关闭",
    active: "正常",
    restricted: "受限",
    banned: "封禁",
    pending: "待处理",
    approved: "已批准",
    processed: "已完结",
    pendingSync: "待同步",
    paying: "支付确认中",
    paid: "已支付",
    success: "成功",
    failed: "失败",
    processing: "处理中",
    noStatement: "微信无账单",
    reconciled: "已完成账实核对",
    investigating: "调查中",
    acceptedException: "有证据接受例外",
    tradeAll: "交易账单",
    fundBasic: "基本账户资金账单",
    fundOperation: "运营账户资金账单",
    fundFees: "手续费账户资金账单",
    providerStatementMissingWithLocalActivity: "微信无账单但本地有活动",
    providerPaymentMissingLocally: "微信支付本地缺失",
    localPaymentMissingProviderBill: "本地支付账单缺失",
    paymentAmountMismatch: "支付金额不一致",
    paymentTransactionIdMismatch: "微信交易号不一致",
    providerPaidLocalUnsettled: "微信成功本地未入账",
    localPaymentSuccessProviderNotPaid: "本地支付成功但微信未支付",
    providerRefundMissingLocally: "微信退款本地缺失",
    localRefundMissingProviderBill: "本地退款账单缺失",
    refundAmountMismatch: "退款金额不一致",
    refundProviderIdMismatch: "微信退款号不一致",
    refundProviderIdMissingLocally: "本地缺少微信退款号",
    refundProviderTimeMismatch: "退款渠道时间冲突",
    providerRefundedLocalUnsettled: "微信退款成功但本地未入账",
    providerFundReferenceMissingLocally: "资金流水本地缺失",
    providerFundBusinessTypeUnreviewed: "资金流水业务类型未纳入规则",
    providerFundAmountNotLocallyVerifiable: "资金流水金额缺少独立本地台账",
    providerFundBusinessBindingMismatch: "资金流水业务与本地对象不匹配",
    providerFundAccountMismatch: "资金流水账户类型不匹配",
    providerFundDirectionMismatch: "资金流水收支方向不匹配",
    providerFundAmountMismatch: "资金流水金额不匹配",
    providerFundLocalUnsettled: "资金流水对应本地交易未结",
    localPaymentMissingProviderFundBill: "本地支付在资金账单缺失",
    localRefundMissingProviderFundBill: "本地退款在资金账单缺失",
    localCashLedgerMissingProviderFundBill: "本地现金台账在资金账单缺失",
    UNCLASSIFIED: "待分类",
    BASIC: "基本账户",
    OPERATION: "运营账户",
    FEES: "手续费账户",
    inProgress: "处理中",
    resolved: "已解决",
    closed: "已关闭",
    rejected: "已拒绝",
    available: "可结算",
    held: "冻结/复核",
    due: "待追偿",
    pendingVerification: "待复核",
    recovered: "已追回",
    recoveryRequired: "待追偿",
    released: "已释放",
    none: "未保全",
    placementPending: "待批准保全",
    releasePending: "待批准释放",
    partiallyErased: "已部分处置",
    unlinked: "待关联",
    syncFailed: "同步失败",
    outcomeUnknown: "渠道结果未知",
    requested: "已申请",
    submitted: "已提交",
    reviewing: "复核中",
    inReview: "复核中",
    needsInformation: "待补充",
    issued: "已开具",
    voided: "已作废",
    approved: "已批准",
    cancelled: "已取消",
    inService: "服务中",
    completed: "已完成",
    refunded: "已退款",
    open: "待处理",
    actionTaken: "已采取措施",
    dismissed: "已放行",
    humanReview: "人工复核",
    autoReviewing: "自动复核",
    notSubmitted: "未提交",
    passed: "已通过",
    expired: "已过期",
    warning: "警告",
    serviceRestriction: "限制接单",
    suspension: "暂停资格",
    upheld: "维持处置",
    overturned: "已推翻",
    evidenceCollection: "补充材料",
    counterpartyResponse: "等待对方回应",
    review: "待裁决",
    decided: "申诉期",
    appealed: "申诉复核",
    final: "已终局",
    noRefund: "不退款",
    fullRefund: "全额退款",
    companionAbsent: "陪伴者未出席",
    customerAbsent: "用户未出席",
    lateArrival: "迟到",
    technicalFailure: "技术故障",
    earlyExit: "提前离开",
    serviceMismatch: "服务不符",
    safetyBoundary: "安全边界",
    other: "其他",
    customer: "用户",
    companion: "陪伴者",
    evidence: "发起方材料",
    appeal: "申诉材料",
    appealResponse: "申诉回应"
  };

  const retentionCategoryLabels = {
    identity_authentication_profile: "身份与认证资料",
    preferences_behavior_notifications: "偏好、行为与通知",
    public_user_content: "公开用户内容",
    transactions_tax_invoices: "交易、税务与发票",
    support_disputes_safety: "客服、争议与安全",
    consent_rights_account_governance: "同意、权利与账号治理",
    deletion_audit_evidence: "注销审计证据"
  };

  const elements = {
    loginView: document.querySelector("#loginView"),
    portalView: document.querySelector("#portalView"),
    loginForm: document.querySelector("#loginForm"),
    loginButton: document.querySelector("#loginButton"),
    loginMessage: document.querySelector("#loginMessage"),
    operatorName: document.querySelector("#operatorName"),
    operatorRole: document.querySelector("#operatorRole"),
    operatorInitials: document.querySelector("#operatorInitials"),
    controlledModeButton: document.querySelector("#controlledModeButton"),
    logoutButton: document.querySelector("#logoutButton"),
    refreshButton: document.querySelector("#refreshButton"),
    sessionCountdown: document.querySelector("#sessionCountdown"),
    lastUpdated: document.querySelector("#lastUpdated"),
    pageEyebrow: document.querySelector("#pageEyebrow"),
    pageTitle: document.querySelector("#pageTitle"),
    pageDescription: document.querySelector("#pageDescription"),
    globalError: document.querySelector("#globalError"),
    actionDialog: document.querySelector("#actionDialog"),
    actionForm: document.querySelector("#actionForm"),
    actionRisk: document.querySelector("#actionRisk"),
    actionTitle: document.querySelector("#actionTitle"),
    actionDescription: document.querySelector("#actionDescription"),
    actionResource: document.querySelector("#actionResource"),
    actionOperationId: document.querySelector("#actionOperationId"),
    actionFields: document.querySelector("#actionFields"),
    actionReason: document.querySelector("#actionReason"),
    actionConfirmation: document.querySelector("#actionConfirmation"),
    actionConfirmationHelp: document.querySelector("#actionConfirmationHelp"),
    actionMessage: document.querySelector("#actionMessage"),
    actionCancelButton: document.querySelector("#actionCancelButton"),
    actionSubmitButton: document.querySelector("#actionSubmitButton"),
    toast: document.querySelector("#toast")
  };

  function parseStored(key) {
    try {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function formatDateTimeLong(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  }

  function money(cents, currency = "CNY") {
    if (!Number.isFinite(Number(cents))) return "—";
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: currency || "CNY",
      minimumFractionDigits: 2
    }).format(Number(cents) / 100);
  }

  function percent(rate) {
    if (!Number.isFinite(Number(rate))) return "—";
    return `${(Number(rate) * 100).toFixed(1)}%`;
  }

  function maskId(value) {
    const text = String(value ?? "");
    if (!text) return "—";
    if (text.length <= 10) return `${text.slice(0, 2)}••${text.slice(-2)}`;
    return `${text.slice(0, 6)}••••${text.slice(-4)}`;
  }

  function maskReference(value) {
    const text = String(value ?? "");
    if (!text) return "—";
    if (text.includes("*") || text.includes("•")) return text;
    return maskId(text);
  }

  function safeNavigationUrl(value) {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") return parsed.href;
    } catch {
      return null;
    }
    return null;
  }

  function hasCapability(capability) {
    return Boolean(state.context?.capabilities?.includes(capability));
  }

  function canAccessView(view) {
    const required = viewCapabilities[view] || [];
    return required.length === 0 || required.some(hasCapability);
  }

  function applyCapabilityNavigation() {
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      const allowed = canAccessView(button.dataset.viewTarget);
      button.classList.toggle("hidden", !allowed);
      button.disabled = !allowed;
      button.setAttribute("aria-hidden", String(!allowed));
    });
    renderPermissions();
  }

  function statusLabel(value) {
    return statusLabels[value] || value || "未知";
  }

  function statusTone(value) {
    if (["active", "verified", "paid", "success", "resolved", "recovered", "clear", "completed"].includes(value)) return "good";
    if (["failed", "syncFailed", "outcomeUnknown", "banned", "suspended", "rejected", "urgent", "attentionRequired"].includes(value)) return "bad";
    if (["restricted", "held", "approved", "inService"].includes(value)) return "info";
    return "warn";
  }

  function statusPill(value) {
    return `<span class="status-pill ${escapeHtml(statusTone(value))} ${escapeHtml(value || "")}">${escapeHtml(statusLabel(value))}</span>`;
  }

  function dueText(value) {
    if (!value) return { text: "无 SLA", tone: "" };
    const due = new Date(value).getTime();
    if (!Number.isFinite(due)) return { text: "SLA 未知", tone: "" };
    const diff = due - Date.now();
    const absoluteMinutes = Math.max(1, Math.round(Math.abs(diff) / 60_000));
    if (diff < 0) return { text: `已超时 ${absoluteMinutes} 分钟`, tone: "bad" };
    if (diff <= 60 * 60_000) return { text: `剩余 ${absoluteMinutes} 分钟`, tone: "warn" };
    return { text: `${formatTime(value)} 到期`, tone: "" };
  }

  function setFormMessage(element, message, success = false) {
    element.textContent = message || "";
    element.classList.toggle("success", Boolean(message && success));
  }

  let toastTimer;
  function showToast(message, isError = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3600);
  }

  function showTrace(error, operationId) {
    const parts = [
      error?.code || "REQUEST_FAILED",
      error?.status ? `HTTP ${error.status}` : null,
      operationId || error?.operationId ? `operation=${operationId || error.operationId}` : null,
      error?.requestId ? `request=${error.requestId}` : null,
      error?.message || "请求失败"
    ].filter(Boolean);
    elements.globalError.textContent = parts.join(" · ");
    elements.globalError.classList.remove("hidden");
  }

  function clearTrace() {
    elements.globalError.textContent = "";
    elements.globalError.classList.add("hidden");
  }

  function setContainerState(container, kind, message) {
    container.innerHTML = `<div class="${escapeHtml(kind)}-state">${escapeHtml(message)}</div>`;
  }

  function renderLoadError(container, message, retry) {
    container.innerHTML = `<div class="error-state"><p>${escapeHtml(message)}</p><button class="button small quiet" type="button" data-load-retry>重新读取</button></div>`;
    container.querySelector("[data-load-retry]")?.addEventListener("click", retry);
  }

  function setRecords(kind, items) {
    const map = new Map();
    (items || []).forEach((item) => map.set(String(item.id ?? item.companionId), item));
    state.records[kind] = map;
  }

  function getRecord(kind, id) {
    return state.records[kind]?.get(String(id));
  }

  function actionButton(label, action, kind, id, variant = "quiet") {
    return `<button class="button small ${escapeHtml(variant)}" type="button" data-admin-action="${escapeHtml(action)}" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(id)}" ${state.mutationsEnabled ? "" : "disabled"}>${escapeHtml(label)}</button>`;
  }

  function detailButton(label, kind, id) {
    return `<button class="button small quiet" type="button" data-admin-detail="${escapeHtml(kind)}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
  }

  function safePreview(value) {
    try {
      return JSON.stringify(maskSensitive(value), null, 2).slice(0, 1800);
    } catch {
      return "无法显示结构化数据";
    }
  }

  function maskSensitive(value, key = "") {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map((item) => maskSensitive(item, key));
    if (typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [
        nestedKey,
        maskSensitive(nested, nestedKey)
      ]));
    }
    if (typeof value === "string") {
      const lower = key.toLowerCase();
      if (lower.includes("token") || lower.includes("secret") || lower.includes("password")) return "[REDACTED]";
      if (lower.includes("phone")) return value.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
      if (lower.includes("reference") || lower.endsWith("id") || lower.includes("recipient")) return maskReference(value);
    }
    return value;
  }

  function createOperationId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto?.getRandomValues?.(bytes);
    if (!bytes.some(Boolean)) {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function confirmationCode(resource) {
    const compact = String(resource || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return compact.slice(-6) || "CONFIRM";
  }

  function persistSession(data) {
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    if (data.user) state.user = data.user;
    sessionStorage.setItem(storageKeys.access, state.accessToken);
    sessionStorage.setItem(storageKeys.refresh, state.refreshToken);
    sessionStorage.setItem(storageKeys.user, JSON.stringify(state.user));
  }

  function clearSession() {
    state.accessToken = "";
    state.refreshToken = "";
    state.user = null;
    state.context = null;
    state.mutationsEnabled = false;
    state.deletionSettlements.clear();
    state.legalHoldPolicy = null;
    state.legalHoldHistory = { retentionRecordId: "", page: 1 };
    state.voiceIntroReads.clear();
    sessionStorage.removeItem(storageKeys.access);
    sessionStorage.removeItem(storageKeys.refresh);
    sessionStorage.removeItem(storageKeys.user);
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = body?.error?.code || "REQUEST_FAILED";
      error.details = body?.error?.details;
      error.requestId = response.headers.get("x-request-id") || body?.error?.details?.requestId || null;
      throw error;
    }
    return Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
  }

  async function request(path, options = {}, allowRefresh = true) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (state.accessToken && options.authenticated !== false) headers.Authorization = `Bearer ${state.accessToken}`;
    const endpoint = path.startsWith("http") ? path : `${API_BASE}${path}`;
    try {
      return await parseResponse(await fetch(endpoint, { ...options, headers }));
    } catch (error) {
      if (
        error.status === 401
        && allowRefresh
        && state.refreshToken
        && !path.includes("/auth/refresh")
      ) {
        const refreshed = await refreshSession();
        if (refreshed) return request(path, options, false);
      }
      throw error;
    }
  }

  let refreshPromise = null;
  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const data = await request("/auth/refresh", {
          method: "POST",
          authenticated: false,
          body: JSON.stringify({ refreshToken: state.refreshToken })
        }, false);
        persistSession(data);
        return true;
      } catch {
        clearSession();
        showLogin("运营会话已失效，请重新登录。");
        return false;
      }
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function showLogin(message = "") {
    elements.portalView.classList.add("hidden");
    elements.loginView.classList.remove("hidden");
    setFormMessage(elements.loginMessage, message);
    window.setTimeout(() => document.querySelector("#loginUsername")?.focus(), 0);
  }

  function showPortal() {
    elements.loginView.classList.add("hidden");
    elements.portalView.classList.remove("hidden");
    const name = state.user?.profile?.displayName || "运营管理员";
    elements.operatorName.textContent = name;
    elements.operatorRole.textContent = state.user?.role || "admin";
    elements.operatorInitials.textContent = name.slice(0, 1);
    updateControlledMode();
    updateSessionCountdown();
    applyCapabilityNavigation();
  }

  function sanitizeLocation() {
    const url = new URL(window.location.href);
    let changed = Boolean(url.hash);
    [...url.searchParams.keys()].forEach((key) => {
      if (/token|password|secret|totp|authorization/i.test(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });
    if (url.hash) url.hash = "";
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function parseAdminRoute() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") || "overview";
    if (!adminViews.has(view)) return { invalid: true, reason: "这个运营模块不存在。" };
    const kind = params.get("kind") || "";
    const id = params.get("id") || "";
    if (Boolean(kind) !== Boolean(id)) return { invalid: true, reason: "详情地址不完整。" };
    if (id && (!/^[A-Za-z0-9._:-]+$/.test(id) || id.length > 128)) {
      return { invalid: true, reason: "资源地址格式无效。" };
    }
    if (kind) {
      const detail = adminDetailKinds.get(kind);
      if (!detail || detail.view !== view) return { invalid: true, reason: "资源不属于这个运营模块。" };
    }
    return { invalid: false, view, detail: kind ? { kind, id } : null };
  }

  function writeAdminRoute(replace = false) {
    const params = new URLSearchParams({ view: state.currentView });
    if (state.routeDetail) {
      params.set("kind", state.routeDetail.kind);
      params.set("id", state.routeDetail.id);
    }
    window.history[replace ? "replaceState" : "pushState"](
      null,
      "",
      `${window.location.pathname}?${params.toString()}`
    );
  }

  function renderAdminRouteState(status, title, message) {
    elements.pageEyebrow.textContent = status === 404 ? "NOT FOUND" : "ACCESS DENIED";
    elements.pageTitle.textContent = `${status} · ${title}`;
    elements.pageDescription.textContent = message;
    document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.add("hidden"));
    document.querySelectorAll("[data-view-target]").forEach((button) => button.classList.remove("active"));
    elements.globalError.textContent = `${status} · ${title} · ${message}`;
    elements.globalError.classList.remove("hidden");
  }

  async function loadCanonicalDetail(kind, id) {
    const config = adminDetailKinds.get(kind);
    if (!config || config.view !== state.currentView) return;
    const container = document.querySelector(config.container);
    if (!container) return;
    container.querySelector("[data-canonical-detail]")?.remove();
    const loading = document.createElement("article");
    loading.className = "data-row attention";
    loading.dataset.canonicalDetail = "true";
    loading.innerHTML = `<div class="row-title"><h3>正在读取${escapeHtml(config.title)}</h3><p>详情通过资源主键与当前角色权限独立校验。</p></div>`;
    container.prepend(loading);
    try {
      const item = await request(config.endpoint(id));
      if (!state.routeDetail || state.routeDetail.kind !== kind || state.routeDetail.id !== id) return;
      state.records[kind]?.set(String(id), item);
      loading.className = "data-row info";
      loading.innerHTML = `<div class="row-title"><div>${statusPill(item.status)}</div><h3>${escapeHtml(config.title)} · ${escapeHtml(maskId(id))}</h3><p>刷新、复制地址和浏览器返回均会重新执行服务端角色与分配范围校验。</p></div><details open><summary>受控详情</summary><pre>${escapeHtml(safePreview(item))}</pre></details><div class="row-actions"><button class="button small quiet" type="button" data-close-admin-detail>关闭详情</button></div>`;
    } catch (error) {
      loading.className = "data-row urgent";
      const title = error.status === 404 ? "资源不存在或不在你的分配范围" : error.status === 403 ? "无权读取该资源" : "详情读取失败";
      loading.innerHTML = `<div class="row-title"><div>${statusPill(error.status === 404 ? "closed" : "failed")}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(error.message || "请稍后重试")}</p></div><div class="row-actions"><button class="button small quiet" type="button" data-retry-admin-detail>重新读取</button><button class="button small quiet" type="button" data-close-admin-detail>关闭详情</button></div>`;
      showTrace(error);
    }
  }

  async function restoreAdminRoute() {
    const route = parseAdminRoute();
    if (route.invalid) {
      renderAdminRouteState(404, "运营地址不可用", route.reason);
      return;
    }
    await loadView(route.view, false, route.detail);
  }

  function decodeTokenExpiry(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      return Number(decoded.exp) * 1000;
    } catch {
      return null;
    }
  }

  function updateSessionCountdown() {
    const expiry = decodeTokenExpiry(state.accessToken);
    if (!expiry) {
      elements.sessionCountdown.textContent = "受保护";
      elements.sessionCountdown.parentElement.classList.remove("expiring");
      return;
    }
    const seconds = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    elements.sessionCountdown.textContent = `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    elements.sessionCountdown.parentElement.classList.toggle("expiring", seconds < 180);
  }

  function updateControlledMode() {
    elements.controlledModeButton.classList.toggle("enabled", state.mutationsEnabled);
    elements.controlledModeButton.setAttribute("aria-pressed", String(state.mutationsEnabled));
    const strong = elements.controlledModeButton.querySelector("strong");
    const small = elements.controlledModeButton.querySelector("small");
    strong.textContent = state.mutationsEnabled ? "受控操作模式" : "只读模式";
    small.textContent = state.mutationsEnabled ? "二次确认仍然生效" : "受控操作已锁定";
  }

  async function toggleControlledMode() {
    if (state.mutationsEnabled) {
      state.mutationsEnabled = false;
      updateControlledMode();
      await loadCurrentView(false);
      showToast("已恢复只读模式");
      return;
    }
    const confirmed = window.confirm(
      "开启受控操作模式后，页面会显示可执行按钮。每次操作仍需填写理由和确认码，并由服务端权限与状态机再次校验。确认开启吗？"
    );
    if (!confirmed) return;
    state.mutationsEnabled = true;
    updateControlledMode();
    await loadCurrentView(false);
    showToast("受控操作模式已开启");
  }

  async function handleLogin(event) {
    event.preventDefault();
    const username = document.querySelector("#loginUsername").value.trim();
    const password = document.querySelector("#loginPassword").value;
    const totpCode = document.querySelector("#loginTotp").value.trim();
    if (!username || !password || !/^\d{6}$/.test(totpCode)) {
      setFormMessage(elements.loginMessage, "请填写运营账号、密码和 6 位动态口令。");
      return;
    }
    elements.loginButton.disabled = true;
    setFormMessage(elements.loginMessage, "正在验证商业运营身份…");
    try {
      const data = await request("/auth/staff/login", {
        method: "POST",
        authenticated: false,
        body: JSON.stringify({ username, password, totpCode })
      }, false);
      if (!allowedStaffRoles.has(data.user?.role)) {
        throw Object.assign(new Error("该账号没有商业运营工作台权限。"), {
          code: "STAFF_ROLE_REQUIRED",
          status: 403
        });
      }
      persistSession(data);
      state.context = await request("/admin/operations/context");
      elements.loginForm.reset();
      setFormMessage(elements.loginMessage, "");
      showPortal();
      await restoreAdminRoute();
    } catch (error) {
      clearSession();
      setFormMessage(elements.loginMessage, error.message || "登录失败，请核对运营凭据。");
    } finally {
      elements.loginButton.disabled = false;
    }
  }

  async function logout() {
    const refreshToken = state.refreshToken;
    try {
      if (refreshToken) {
        await request("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken })
        }, false);
      }
    } catch {
      // Removing the local session is correct even when the server is unavailable.
    }
    clearSession();
    showLogin("已退出商业运营会话。");
  }

  function renderActionFields(fields) {
    elements.actionFields.innerHTML = (fields || []).map((field) => {
      const classes = field.wide ? "wide" : "";
      const required = field.required === false ? "" : "required";
      const attributes = [
        field.min !== undefined ? `min="${escapeHtml(field.min)}"` : "",
        field.max !== undefined ? `max="${escapeHtml(field.max)}"` : "",
        field.minlength !== undefined ? `minlength="${escapeHtml(field.minlength)}"` : "",
        field.maxlength !== undefined ? `maxlength="${escapeHtml(field.maxlength)}"` : "",
        field.pattern ? `pattern="${escapeHtml(field.pattern)}"` : ""
      ].filter(Boolean).join(" ");
      let control;
      if (field.type === "select") {
        control = `<select name="${escapeHtml(field.name)}" ${required}>${(field.options || []).map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? statusLabel(option) : option.label;
          return `<option value="${escapeHtml(optionValue)}" ${String(optionValue) === String(field.value ?? "") ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`;
        }).join("")}</select>`;
      } else if (field.type === "textarea") {
        control = `<textarea name="${escapeHtml(field.name)}" ${required} ${attributes} placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(field.value || "")}</textarea>`;
      } else {
        control = `<input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(field.value ?? "")}" ${required} ${attributes} placeholder="${escapeHtml(field.placeholder || "")}" autocomplete="off" />`;
      }
      return `<label class="${classes}"><span>${escapeHtml(field.label)}</span>${control}${field.help ? `<small>${escapeHtml(field.help)}</small>` : ""}</label>`;
    }).join("");
  }

  function openAction(config) {
    if (!state.mutationsEnabled) {
      showToast("当前为只读模式。请先从左下角显式开启受控操作。", true);
      return;
    }
    const operationId = createOperationId();
    const code = confirmationCode(config.resource);
    state.action = { ...config, operationId, code };
    elements.actionRisk.textContent = (config.risk || "HIGH RISK").toUpperCase();
    elements.actionTitle.textContent = config.title;
    elements.actionDescription.textContent = config.description || "";
    elements.actionResource.textContent = config.resource;
    elements.actionOperationId.textContent = operationId;
    elements.actionReason.value = "";
    elements.actionConfirmation.value = "";
    elements.actionConfirmationHelp.textContent = `请输入确认码 ${code}`;
    setFormMessage(elements.actionMessage, "");
    renderActionFields(config.fields || []);
    elements.actionSubmitButton.textContent = config.submitLabel || "确认执行";
    elements.actionSubmitButton.className = `button ${config.variant || "danger"}`;
    elements.actionDialog.showModal();
    window.setTimeout(() => elements.actionReason.focus(), 0);
  }

  function formatActionError(error) {
    const base = `${error.code || "REQUEST_FAILED"} · ${error.message}`;
    if (error.code !== "ACCOUNT_ACTION_HAS_ACTIVE_COMMERCIAL_OBLIGATIONS") return base;
    const labels = {
      orders: "进行中订单",
      refunds: "处理中退款",
      paymentDisputes: "未结支付投诉",
      attendanceDisputes: "未结履约争议",
      supportTickets: "处理中客服工单"
    };
    const counts = error.details?.counts || {};
    const breakdown = Object.entries(labels)
      .map(([key, label]) => [label, Number(counts[key] || 0)])
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label} ${count}`)
      .join("、");
    const total = Number(error.details?.total || 0);
    return breakdown ? `${base}（共 ${total} 项：${breakdown}）` : base;
  }

  async function submitAction(event) {
    event.preventDefault();
    const config = state.action;
    if (!config) return;
    const reason = elements.actionReason.value.trim();
    const confirmation = elements.actionConfirmation.value.trim().toUpperCase();
    const reasonMinLength = Number(config.reasonMinLength || 3);
    if (reason.length < reasonMinLength) {
      setFormMessage(elements.actionMessage, `操作理由至少需要 ${reasonMinLength} 个字符。`);
      elements.actionReason.focus();
      return;
    }
    if (confirmation !== config.code) {
      setFormMessage(elements.actionMessage, `确认码不匹配，请输入 ${config.code}。`);
      elements.actionConfirmation.focus();
      return;
    }
    const formData = new FormData(elements.actionForm);
    const values = Object.fromEntries(formData.entries());
    elements.actionSubmitButton.disabled = true;
    setFormMessage(elements.actionMessage, "正在由服务端重新校验权限与业务状态…");
    try {
      await config.execute(values, reason, config.operationId);
      elements.actionDialog.close();
      state.action = null;
      showToast(`${config.title}已完成`);
      await loadCurrentView(false);
    } catch (error) {
      error.operationId = config.operationId;
      setFormMessage(elements.actionMessage, formatActionError(error));
      showTrace(error, config.operationId);
    } finally {
      elements.actionSubmitButton.disabled = false;
    }
  }

  function actionHeaders(reason, operationId) {
    return {
      "X-Admin-Action-Reason": reason,
      "X-Admin-Operation-Id": operationId
    };
  }

  function mutationRequest(path, method, body, reason, operationId) {
    return request(path, {
      method,
      headers: actionHeaders(reason, operationId),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  }

  async function loadOverview() {
    const readinessList = document.querySelector("#readinessList");
    const funnelStages = document.querySelector("#funnelStages");
    const opsMetricsGrid = document.querySelector("#opsMetricsGrid");
    const capabilityList = document.querySelector("#capabilityList");
    const canReadReadiness = hasCapability("commercial.readiness.read");
    const canReadFunnel = hasCapability("commercial.funnel.read");
    const canReadOpsMetrics = hasCapability("commercial.ops-metrics.read");
    readinessList.closest(".panel")?.classList.toggle("hidden", !canReadReadiness);
    funnelStages.closest(".panel")?.classList.toggle("hidden", !canReadFunnel);
    opsMetricsGrid?.closest(".panel")?.classList.toggle("hidden", !canReadOpsMetrics);
    document.querySelector("#metricReadiness")?.closest(".metric-card")?.classList.toggle("hidden", !canReadReadiness);
    for (const selector of ["#metricRequested", "#metricCollected", "#metricRepeat"]) {
      document.querySelector(selector)?.closest(".metric-card")?.classList.toggle("hidden", !canReadFunnel);
    }
    if (canReadReadiness) setContainerState(readinessList, "loading", "正在检查运行门禁…");
    if (canReadFunnel) setContainerState(funnelStages, "loading", "正在读取订单事实…");
    if (canReadOpsMetrics) setContainerState(opsMetricsGrid, "loading", "正在读取经营聚合…");
    setContainerState(capabilityList, "loading", "正在验证管理员权限…");
    const results = await Promise.allSettled([
      canReadReadiness ? request("/admin/commercial/readiness") : Promise.resolve(null),
      canReadFunnel ? request("/admin/commercial/funnel") : Promise.resolve(null),
      canReadOpsMetrics ? request("/admin/commercial/ops-metrics") : Promise.resolve(null),
      state.context ? Promise.resolve(state.context) : request("/admin/operations/context")
    ]);
    const [readinessResult, funnelResult, opsMetricsResult, contextResult] = results;

    if (canReadReadiness && readinessResult.status === "fulfilled") {
      const readiness = readinessResult.value;
      document.querySelector("#metricReadiness").textContent = readiness.status === "clear" ? "CLEAR" : "ATTENTION";
      document.querySelector("#metricReadinessNote").textContent = `检查于 ${formatTime(readiness.checkedAt)}`;
      const blockers = Object.entries(readiness.blockers || {});
      const active = blockers.filter(([, count]) => Number(count) > 0);
      const deletionExecution = readiness.accountDeletionExecution || {};
      const deletionExecutionDiagnostic = Number(deletionExecution.dueBacklog || 0)
        + Number(deletionExecution.processing || 0)
        + Number(deletionExecution.failed || 0) > 0
        ? `<div class="stack-row"><span>注销擦除进度：到期 ${escapeHtml(deletionExecution.dueBacklog || 0)} · 处理中 ${escapeHtml(deletionExecution.processing || 0)} · 失败 ${escapeHtml(deletionExecution.failed || 0)} · 最早到期 ${escapeHtml(formatTime(deletionExecution.oldestDueAt))}</span><strong>${deletionExecution.backlogSlaBreached ? "SLA 超时" : "诊断"}</strong></div>`
        : "";
      const authTombstones = readiness.accountDeletionAuthTombstones || {};
      const authTombstoneDiagnostic = `<div class="stack-row"><span>注销登录标识保护：覆盖缺口 ${escapeHtml(authTombstones.coverageGaps || 0)} · 未知密钥 ${escapeHtml(authTombstones.unknownKeyBacklog || 0)} · 到期清理 ${escapeHtml(authTombstones.expiredCleanupBacklog || 0)} · 已配置密钥 ${escapeHtml((authTombstones.configuredKeyIds || []).join("、") || "无")}</span><strong>${Number(authTombstones.coverageGaps || 0) + Number(authTombstones.unknownKeyBacklog || 0) > 0 ? "阻断" : "诊断"}</strong></div>`;
      readinessList.innerHTML = (active.length
        ? active.map(([key, count]) => `<div class="stack-row alert"><span>${escapeHtml(blockerLabels[key] || key)}</span><strong>${escapeHtml(count)}</strong></div>`).join("")
        : '<div class="stack-row clear"><span>当前代码可观测阻断项</span><strong>0</strong></div>')
        + deletionExecutionDiagnostic
        + authTombstoneDiagnostic;
    } else if (canReadReadiness) {
      document.querySelector("#metricReadiness").textContent = "不可用";
      document.querySelector("#metricReadinessNote").textContent = "未取得服务端门禁结果";
      setContainerState(readinessList, "error", readinessResult.reason.message || "运行门禁加载失败");
    }

    if (canReadFunnel && funnelResult.status === "fulfilled") {
      const funnel = funnelResult.value;
      document.querySelector("#metricRequested").textContent = String(funnel.stages?.requested ?? 0);
      document.querySelector("#metricCollected").textContent = money(funnel.financials?.netCollectedCents, funnel.financials?.currency);
      document.querySelector("#metricRepeat").textContent = percent(funnel.customers?.repeatCustomerRate);
      document.querySelector("#funnelRange").textContent = `${formatTime(funnel.range?.from)} — ${formatTime(funnel.range?.to)}${funnel.truncated ? " · 已截断" : ""}`;
      const stages = [
        ["请求", funnel.stages?.requested, "100%"],
        ["已接受", funnel.stages?.accepted, percent(funnel.rates?.acceptanceRate)],
        ["已支付", funnel.stages?.paid, percent(funnel.rates?.paymentRateFromRequest)],
        ["已开始", funnel.stages?.started, percent(funnel.rates?.serviceStartRate)],
        ["已完成", funnel.stages?.completed, percent(funnel.rates?.completionRate)],
        ["已评价", funnel.stages?.reviewed, percent(funnel.rates?.reviewRate)]
      ];
      funnelStages.innerHTML = stages.map(([label, count, rate]) => `<div class="funnel-step"><span>${escapeHtml(label)}</span><strong>${escapeHtml(count ?? 0)}</strong><small>${escapeHtml(rate)}</small></div>`).join("");
    } else if (canReadFunnel) {
      document.querySelector("#metricRequested").textContent = "—";
      document.querySelector("#metricCollected").textContent = "—";
      document.querySelector("#metricRepeat").textContent = "—";
      setContainerState(funnelStages, "error", funnelResult.reason.message || "服务漏斗加载失败");
    }

    if (canReadOpsMetrics && opsMetricsResult.status === "fulfilled") {
      const metrics = opsMetricsResult.value;
      document.querySelector("#opsMetricsRange").textContent = `${formatTime(metrics.range?.from)} — ${formatTime(metrics.range?.to)}${metrics.truncated ? " · 已截断" : ""}`;
      const reminder = metrics.availabilityReminders || {};
      const cards = [
        ["确认率", percent(metrics.response?.confirmationRate), `拒单 ${percent(metrics.response?.rejectRate)} · 超时 ${percent(metrics.response?.responseTimeoutRate)}`],
        ["时段占用", percent(metrics.slots?.utilizationRate), `放出 ${metrics.slots?.releasedCapacity ?? 0} · 空闲 ${metrics.slots?.idleCapacity ?? 0}`],
        ["退款单率", percent(metrics.refunds?.refundOrderRate), `成功退款单 ${metrics.refunds?.refundedOrders ?? 0}`],
        ["投诉首响达标", percent(metrics.complaints?.firstResponseHitRate), `逾期首响 ${metrics.complaints?.overdueFirstResponse ?? 0}`],
        ["同陪伴者复购", percent(metrics.repurchase?.sameCompanionRepurchaseRate), `复购对 ${metrics.repurchase?.repeatPairs ?? 0}`],
        ["收藏转化", percent(metrics.bookmarks?.conversionRate), `收藏 ${metrics.bookmarks?.favoritesCreated ?? 0}`],
        ["审核积压", String(metrics.moderation?.openCases ?? 0), `逾期案件 ${metrics.moderation?.overdueCases ?? 0} · 申诉 ${metrics.moderation?.openAppeals ?? 0}`],
        ["可约提醒", String(reminder.status || "—"), `终态待核 ${reminder.pipeline?.unresolvedTerminalAttempts ?? 0} · 投递 ${reminder.pipeline?.deliveryRunnerEnabled ? "开" : "关"}`],
        ["供给已发布", String(metrics.supplyFunnel?.published ?? 0), `核验 ${metrics.supplyFunnel?.profilesVerified ?? 0} · 有未来容量 ${metrics.supplyFunnel?.withFutureCapacity ?? 0}`]
      ];
      opsMetricsGrid.innerHTML = cards.map(([label, value, note]) =>
        `<div class="funnel-step"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`
      ).join("");
    } else if (canReadOpsMetrics) {
      setContainerState(opsMetricsGrid, "error", opsMetricsResult.reason.message || "经营看板加载失败");
    }

    if (contextResult.status === "fulfilled") {
      state.context = contextResult.value;
      capabilityList.innerHTML = [
        ["当前角色", contextResult.value.operator?.role || "—"],
        ["可见能力", (contextResult.value.capabilities || []).join("、") || "无"],
        ["内容审核", "独立身份域"],
        ["默认操作", "只读"]
      ].map(([label, value]) => `<div class="stack-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
      applyCapabilityNavigation();
    } else {
      setContainerState(capabilityList, "error", contextResult.reason.message || "权限上下文加载失败");
    }

    const failed = results.find((result) => result.status === "rejected");
    if (failed) showTrace(failed.reason);
  }

  async function loadCompanions(
    companionPage = state.pages.companions,
    verificationPage = state.pages.identityVerification
  ) {
    state.pages.companions = companionPage;
    state.pages.identityVerification = verificationPage;
    const container = document.querySelector("#companionList");
    const companionPagination = document.querySelector("#companionPagination");
    const verificationPanel = document.querySelector("#identityVerificationPanel");
    const verificationContainer = document.querySelector("#identityVerificationList");
    const verificationPagination = document.querySelector("#identityVerificationPagination");
    const canReviewIdentity = hasCapability("companion.verification.manage");
    verificationPanel?.classList.toggle("hidden", !canReviewIdentity);
    setContainerState(container, "loading", "正在读取陪伴者与商业档案…");
    if (canReviewIdentity) {
      setContainerState(verificationContainer, "loading", "正在读取实名变更复核队列…");
    }
    companionPagination.innerHTML = "";
    verificationPagination.innerHTML = "";
    const status = document.querySelector("#companionStatusFilter").value;
    const verificationStatus = document.querySelector("#identityVerificationStatusFilter").value;
    try {
      const [companionsResult, verificationResult] = await Promise.all([
        request(`/admin/companions?page=${companionPage}&pageSize=50${status ? `&commercialStatus=${encodeURIComponent(status)}` : ""}`),
        canReviewIdentity
          ? request(`/admin/identity-verification-requests?status=${encodeURIComponent(verificationStatus)}&page=${verificationPage}&pageSize=50`)
          : Promise.resolve(null)
      ]);
      const companions = companionsResult.items || companionsResult.companions || [];
      const records = companions;
      setRecords("companion", records);
      if (!records.length) {
        setContainerState(container, "empty", "没有符合当前筛选条件的陪伴者。");
      } else {
        container.innerHTML = records.map((item) => {
          const profile = item.commercialProfile;
          const ownerIsVerified = item.owner?.isVerified === true;
          const commercialStatus = profile?.status || "notSubmitted";
          const profileSummary = profile
            ? `结算 ${escapeHtml(profile.settlementRecipientMasked || "—")} · 税务 ${escapeHtml(maskReference(profile.taxProfileRef))} · 协议 ${escapeHtml(profile.serviceAgreementVersion || "—")}`
            : "尚未提交商业档案";
          const actions = [
            actionButton(profile ? "更新档案" : "提交档案", "submitCommercialProfile", "companion", item.id),
            profile?.status === "pendingReview" ? actionButton("第二人核验", "verifyCommercialProfile", "companion", item.id, "primary") : "",
            profile && profile.status !== "suspended" ? actionButton("暂停商业资格", "suspendCommercialProfile", "companion", item.id, "danger") : "",
            actionButton(
              ownerIsVerified ? "提交撤销实名复核" : "提交实名核验复核",
              "submitCompanionVerification",
              "companion",
              item.id,
              ownerIsVerified ? "warn" : "primary"
            ),
            item.isPublished
              ? actionButton("下架", "unpublishCompanion", "companion", item.id, "warn")
              : actionButton("发布", "publishCompanion", "companion", item.id, "primary"),
            actionButton("账号处置", "companionAccountAction", "companion", item.id, "warn")
          ].join("");
          return `<article class="data-row ${profile?.status === "verified" ? "good" : profile?.status === "suspended" ? "urgent" : "attention"}">
            <div class="row-title"><div>${statusPill(commercialStatus)} ${item.isPublished ? statusPill("active") : ""}</div><h3>${escapeHtml(item.name || item.id)}</h3><p class="masked-id">${escapeHtml(maskId(item.id))} · owner ${escapeHtml(maskId(item.ownerUserId))}</p></div>
            <div class="row-facts"><div><span>商业档案</span><strong title="${profileSummary}">${profileSummary}</strong></div><div><span>实名 / 陪伴资料</span><strong>${ownerIsVerified ? "用户已实名" : "用户未实名"} · ${item.isVerified ? "资料已核验" : "资料未核验"}</strong></div><div><span>最近更新</span><strong>${formatTime(profile?.updatedAt || item.updatedAt)}</strong></div></div>
            <div class="row-actions">${actions}</div>
          </article>`;
        }).join("");
      }
      renderPagination(
        companionPagination,
        companionsResult.pagination,
        (next) => loadCompanions(next, state.pages.identityVerification)
      );
      if (canReviewIdentity) {
        const verificationItems = verificationResult.items || [];
        setRecords("identityVerification", verificationItems);
        renderIdentityVerificationRequests(verificationContainer, verificationItems);
        renderPagination(
          verificationPagination,
          verificationResult.pagination,
          (next) => loadCompanions(state.pages.companions, next)
        );
      }
    } catch (error) {
      renderLoadError(
        container,
        `陪伴者数据加载失败：${error.message}`,
        () => loadCompanions(state.pages.companions, state.pages.identityVerification)
      );
      if (canReviewIdentity) {
        setContainerState(verificationContainer, "error", `实名复核队列加载失败：${error.message}`);
      }
      showTrace(error);
    }
  }

  function renderIdentityVerificationRequests(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const sameOperator = item.submittedBy?.id === state.user?.id;
      const direction = item.requestedIsVerified ? "核验实名" : "撤销实名";
      const actions = item.status === "pending" && !sameOperator
        ? [
            actionButton("批准并应用", "approveIdentityVerification", "identityVerification", item.id, "primary"),
            actionButton("拒绝请求", "rejectIdentityVerification", "identityVerification", item.id, "danger")
          ].join("")
        : "";
      const companion = item.subject?.companion
        ? `${item.subject.companion.name || maskId(item.subject.companion.id)} · ${item.subject.companion.isPublished ? "当前公开" : "当前下架"}`
        : "非陪伴者账号";
      const reviewFact = item.status === "pending"
        ? (sameOperator ? "你是提交人，必须由另一名授权人员复核" : "等待第二人复核")
        : `${item.reviewedBy?.displayName || maskId(item.reviewedBy?.id)} · ${item.reviewReason || "未填写复核结论"}`;
      return `<article class="compact-item ${item.status === "rejected" ? "urgent" : item.status === "approved" ? "good" : "attention"}"><div class="compact-item-head"><h3>${escapeHtml(item.subject?.displayName || maskId(item.userId))} · ${escapeHtml(direction)}</h3>${statusPill(item.status)}</div><p>${escapeHtml(item.reason)} · 证据 ${escapeHtml(maskReference(item.evidenceReference))}</p><div class="compact-meta"><span>状态 ${item.previousIsVerified ? "已核验" : "未核验"} → ${item.requestedIsVerified ? "已核验" : "未核验"}</span><span>当前 ${item.subject?.currentIsVerified ? "已核验" : "未核验"}</span><span>${escapeHtml(companion)}</span><span>提交 ${escapeHtml(item.submittedBy?.displayName || maskId(item.submittedBy?.id))} · ${escapeHtml(formatTime(item.submittedAt))}</span><span>${escapeHtml(reviewFact)}</span></div><div class="compact-actions">${actions}</div></article>`;
    }).join("") : '<div class="empty-state">当前筛选下没有实名变更复核请求。</div>';
  }

  async function loadOrders(page = state.pages.orders) {
    state.pages.orders = page;
    const container = document.querySelector("#orderList");
    const pagination = document.querySelector("#orderPagination");
    setContainerState(container, "loading", "正在读取订单、支付与售后事实…");
    pagination.innerHTML = "";
    const status = document.querySelector("#orderStatusFilter").value;
    const keyword = document.querySelector("#orderKeyword").value.trim();
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) query.set("status", status);
    if (keyword) query.set("keyword", keyword);
    try {
      const supportScoped = hasCapability("support.order.assigned.read")
        && !hasCapability("order.read.all");
      const endpoint = supportScoped
        ? "/admin/operations/support/orders"
        : "/admin/operations/orders";
      const data = await request(`${endpoint}?${query.toString()}`);
      setRecords("order", data.items || []);
      if (!data.items?.length) {
        setContainerState(container, "empty", "没有符合当前条件的订单。");
      } else {
        container.innerHTML = data.items.map((item) => {
          const supportDue = item.activeSupportTickets?.map((ticket) => dueText(ticket.dueAt)).find((due) => due.tone === "bad");
          const supportCount = item.activeSupportTickets?.length ?? item.activeSupportTicketCount ?? 0;
          const customerLabel = item.customer
            ? (item.customer.displayName || maskId(item.customer.id))
            : "当前角色不展示客户身份";
          const tone = item.refund?.status === "failed" || supportDue ? "urgent" : item.status === "completed" ? "good" : "attention";
          return `<article class="data-row ${tone}">
            <div class="row-title"><div>${statusPill(item.status)} ${item.refund ? statusPill(item.refund.status) : ""}</div><h3>${escapeHtml(item.serviceTitle || "未命名服务")}</h3><p class="masked-id">${escapeHtml(maskId(item.id))} · ${escapeHtml(item.deliveryMode || "legacy")}</p></div>
            <div class="row-facts"><div><span>客户 / 陪伴者</span><strong>${escapeHtml(customerLabel)} / ${escapeHtml(item.companion?.name || maskId(item.companion?.id))}</strong></div><div><span>金额 / 时间</span><strong>${escapeHtml(money(item.amountCents, item.currency))} · ${escapeHtml(formatTime(item.scheduledAt))}</strong></div><div><span>交易 / 工单</span><strong>${escapeHtml(item.payment ? `${statusLabel(item.payment.status)} ${item.payment.referenceMasked || ""}` : "无支付")} · ${escapeHtml(supportCount)} 工单</strong></div></div>
            <div class="row-actions"><span class="status-pill ${supportDue ? "bad" : ""}">${supportDue ? escapeHtml(supportDue.text) : `更新 ${escapeHtml(formatTime(item.updatedAt))}`}</span></div>
          </article>`;
        }).join("");
      }
      renderPagination(pagination, data.pagination, (next) => loadOrders(next));
    } catch (error) {
      setContainerState(container, "error", `订单列表加载失败：${error.message}`);
      showTrace(error);
    }
  }

  function renderPagination(container, pagination, onPage) {
    if (!pagination) {
      container.innerHTML = "";
      return;
    }
    const page = Number(pagination.page || 1);
    const totalPages = Math.max(1, Number(pagination.totalPages || 1));
    container.innerHTML = `<span>共 ${escapeHtml(pagination.total || 0)} 条 · 第 ${page}/${totalPages} 页</span><span class="pagination-controls"><button class="button small quiet" type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><button class="button small quiet" type="button" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button></span>`;
    container.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => onPage(Number(button.dataset.page)));
    });
  }

  async function loadSupport(
    assignedPage = state.pages.supportAssigned,
    claimablePage = state.pages.supportClaimable
  ) {
    state.pages.supportAssigned = assignedPage;
    state.pages.supportClaimable = claimablePage;
    const container = document.querySelector("#supportList");
    const claimableContainer = document.querySelector("#supportClaimableList");
    const assignedPagination = document.querySelector("#supportPagination");
    const claimablePagination = document.querySelector("#supportClaimablePagination");
    setContainerState(container, "loading", "正在读取已分配客服队列与 SLA…");
    setContainerState(claimableContainer, "loading", "正在读取待认领匿名队列…");
    assignedPagination.innerHTML = "";
    claimablePagination.innerHTML = "";
    const status = document.querySelector("#supportStatusFilter").value;
    const canAssignAny = hasCapability("support.assign.any");
    const canReadClaimable = hasCapability("support.ticket.claimable-summary.read");
    document.querySelector("#supportClaimablePanel")?.classList.toggle("hidden", !canReadClaimable);
    const results = await Promise.allSettled([
      request(`/admin/commercial/support/tickets?assignedOnly=true&page=${assignedPage}&pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ""}`),
      canReadClaimable
        ? request(`/admin/commercial/support/claimable?page=${claimablePage}&pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ""}`)
        : Promise.resolve({ items: [], pagination: null })
    ]);
    if (results[0].status === "fulfilled") {
      const assignedItems = results[0].value.items || [];
      setRecords("support", assignedItems);
      container.innerHTML = assignedItems.length ? assignedItems.map((item) => {
        const due = dueText(item.dueAt);
        const tone = due.tone === "bad" || item.priority === "urgent" ? "urgent" : item.status === "resolved" ? "good" : "attention";
        const isCurrentAssignee = item.assignedTo?.id === state.user?.id;
        const mutationActions = ["resolved", "closed"].includes(item.status) ? [] : [
          canAssignAny && !isCurrentAssignee ? actionButton("分配给我", "assignSupportSelf", "support", item.id, "primary") : "",
          canAssignAny ? actionButton("分配受理人", "assignSupportOther", "support", item.id) : "",
          isCurrentAssignee && hasCapability("support.resolve.assigned") ? actionButton("解决工单", "resolveSupport", "support", item.id, "primary") : "",
          isCurrentAssignee && item.orderId && hasCapability("support.refund.assigned") ? actionButton("发起退款", "supportRefund", "support", item.id, "danger") : ""
        ];
        const actions = [detailButton("查看详情", "support", item.id), ...mutationActions].join("");
        return `<article class="data-row ${tone}">
          <div class="row-title"><div>${statusPill(item.status)} ${statusPill(item.priority)}</div><h3>${escapeHtml(item.subject)}</h3><p>${escapeHtml(item.body)}</p></div>
          <div class="row-facts"><div><span>请求人</span><strong>${escapeHtml(item.requester?.displayName || maskId(item.requester?.id))}</strong></div><div><span>受理人</span><strong>${escapeHtml(item.assignedTo?.displayName || "未分配")}</strong></div><div><span>SLA / 订单事实</span><strong class="${due.tone}">${escapeHtml(due.text)} · ${escapeHtml(item.orderFacts?.length || 0)} 条</strong></div></div>
          <div class="row-actions">${actions}</div>
        </article>`;
      }).join("") : '<div class="empty-state">当前没有已分配工单。</div>';
      renderPagination(assignedPagination, results[0].value.pagination, (next) => loadSupport(next, state.pages.supportClaimable));
    } else {
      renderLoadError(container, `已分配工单加载失败：${results[0].reason.message}`, () => loadSupport(state.pages.supportAssigned, state.pages.supportClaimable));
    }
    if (canReadClaimable && results[1].status === "fulfilled") {
      const claimableItems = (results[1].value.items || []).map((item) => ({ ...item, claimableSummary: true }));
      claimableItems.forEach((item) => state.records.support.set(String(item.id), item));
      claimableContainer.innerHTML = claimableItems.length ? claimableItems.map((item) => {
        const due = dueText(item.dueAt);
        const tone = due.tone === "bad" || item.priority === "urgent" ? "urgent" : "attention";
        const claimAction = hasCapability("support.claim.self")
          ? actionButton("认领后查看", "claimSupportSelf", "support", item.id, "primary")
          : "";
        return `<article class="data-row ${tone}">
          <div class="row-title"><div>${statusPill(item.priority)}</div><h3>待认领 ${escapeHtml(item.category)}</h3><p>正文、请求人与订单事实将在并发安全认领后开放。</p></div>
          <div class="row-facts"><div><span>匿名案件</span><strong>${escapeHtml(maskId(item.id))}</strong></div><div><span>SLA</span><strong class="${due.tone}">${escapeHtml(due.text)}</strong></div><div><span>订单关联</span><strong>${item.hasOrder ? "有关联订单" : "无关联订单"}</strong></div></div>
          <div class="row-actions">${claimAction}</div>
        </article>`;
      }).join("") : '<div class="empty-state">当前没有待认领工单。</div>';
      renderPagination(claimablePagination, results[1].value.pagination, (next) => loadSupport(state.pages.supportAssigned, next));
    } else if (canReadClaimable) {
      renderLoadError(claimableContainer, `待认领工单加载失败：${results[1].reason.message}`, () => loadSupport(state.pages.supportAssigned, state.pages.supportClaimable));
    }
    const failed = results.find((result) => result.status === "rejected");
    if (failed) showTrace(failed.reason);
  }

  function attendancePartySummary(label, summary) {
    if (!summary) return `${label}：暂无渠道事实`;
    const firstJoin = summary.firstJoinedAt ? formatTime(summary.firstJoinedAt) : "未记录进房";
    const lastLeave = summary.lastLeftAt ? formatTime(summary.lastLeftAt) : "未记录离房";
    return `${label}：${firstJoin} → ${lastLeave} · 进房 ${summary.joinCount || 0} · 重连 ${summary.reconnectCount || 0} · 音频 ${summary.audioStartedCount || 0}`;
  }

  async function loadAttendanceDisputes(page = state.pages.attendanceDisputes) {
    state.pages.attendanceDisputes = page;
    const container = document.querySelector("#attendanceDisputeList");
    const pagination = document.querySelector("#attendanceDisputePagination");
    if (!container || !pagination) return;
    setContainerState(container, "loading", "正在读取履约争议、签名出席事实与复核状态…");
    pagination.innerHTML = "";
    const status = document.querySelector("#attendanceDisputeStatusFilter")?.value || "";
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) query.set("status", status);
    try {
      const assignedRequest = request(`/admin/commercial/attendance-disputes?${query.toString()}`);
      const claimableRequest = state.user?.role === "support"
        ? request(`/admin/commercial/attendance-disputes/claimable?${query.toString()}`)
        : Promise.resolve({ items: [], pagination: null });
      const [assigned, claimable] = await Promise.all([assignedRequest, claimableRequest]);
      const recordsById = new Map();
      (claimable.items || []).forEach((item) => recordsById.set(String(item.id), { ...item, claimableSummary: true }));
      (assigned.items || []).forEach((item) => recordsById.set(String(item.id), item));
      const records = [...recordsById.values()];
      setRecords("attendanceDispute", records);
      if (!records.length) {
        setContainerState(container, "empty", "当前没有符合条件的履约争议。等待期内的案件仍由双方补充材料，不会提前裁决。");
      } else {
        container.innerHTML = records.map((item) => {
          const deadline = item.status === "evidenceCollection"
            ? item.evidenceDueAt || item.deadlines?.evidenceDueAt
            : item.status === "counterpartyResponse"
              ? item.counterpartyResponseDueAt || item.deadlines?.counterpartyResponseDueAt
              : item.status === "decided"
                ? item.deadlines?.appealDeadlineAt
                : item.appealResponseDueAt || item.deadlines?.appealResponseDueAt;
          const due = dueText(deadline);
          const tone = item.issue === "safetyBoundary" || due.tone === "bad"
            ? "urgent"
            : item.status === "final" ? "good" : "attention";
          if (item.claimableSummary) {
            const claimAppeal = item.status === "appealed";
            return `<article class="data-row ${tone}">
              <div class="row-title"><div>${statusPill(item.status)}</div><h3>${escapeHtml(statusLabel(item.issue))} · ${claimAppeal ? "待独立复核" : "待认领"}</h3><p>当事人身份、陈述与出席详情将在并发安全认领后开放。</p></div>
              <div class="row-facts"><div><span>匿名案件</span><strong>${escapeHtml(maskId(item.id))} · 有关联付费订单</strong></div><div><span>收集截止</span><strong class="${due.tone}">${escapeHtml(due.text)}</strong></div><div><span>裁决边界</span><strong>不录音 · 客户端证据不能单独定案</strong></div></div>
              <div class="row-actions">${actionButton(claimAppeal ? "认领独立复核" : "认领后查看", claimAppeal ? "claimAttendanceAppeal" : "claimAttendanceDispute", "attendanceDispute", item.id, "primary")}</div>
            </article>`;
          }
          const staff = item.staff || {};
          const summary = item.attendanceSummary || {};
          const providerStatus = summary.providerEvidenceAvailable
            ? `渠道事件可用 · 房间事件 ${summary.providerRoomEvents || 0}`
            : "暂无渠道出席事件，必须人工复核";
          const statements = (item.statements || []).map((statement) =>
            `<p><strong>${escapeHtml(statusLabel(statement.participantRole))}</strong> · ${escapeHtml(statusLabel(statement.kind))} · ${escapeHtml(formatTime(statement.createdAt))}<br>${escapeHtml(statement.statement)}</p>`
          ).join("") || "<p>双方尚未提交文字陈述。</p>";
          const actions = [detailButton("查看详情", "attendanceDispute", item.id)];
          if (!staff.assignedToUserId && item.status !== "final" && item.status !== "decided" && item.status !== "appealed") {
            actions.push(actionButton("认领案件", "claimAttendanceDispute", "attendanceDispute", item.id, "primary"));
          }
          if (item.status === "review" && staff.assignedToUserId === state.user?.id) {
            actions.push(actionButton("提交首轮裁决", "decideAttendanceDispute", "attendanceDispute", item.id, "primary"));
          }
          if (item.status === "appealed" && !staff.appealAssignedToUserId && staff.decidedByUserId !== state.user?.id) {
            actions.push(actionButton("认领申诉复核", "claimAttendanceAppeal", "attendanceDispute", item.id, "warn"));
          }
          if (item.status === "appealed" && staff.appealAssignedToUserId === state.user?.id) {
            actions.push(actionButton("提交终局复核", "finalizeAttendanceAppeal", "attendanceDispute", item.id, "danger"));
          }
          if (item.status === "decided" && staff.decidedByUserId === state.user?.id && item.deadlines?.appealDeadlineAt && new Date(item.deadlines.appealDeadlineAt).getTime() <= Date.now()) {
            actions.push(actionButton("结束未申诉案件", "finalizeAttendanceDecision", "attendanceDispute", item.id, "warn"));
          }
          const refundTruth = item.refund
            ? `${statusLabel(item.refund.status)} · ${money(item.refund.amountCents)} · ${item.refund.successConfirmedAt ? `渠道成功 ${formatTime(item.refund.successConfirmedAt)}` : "尚未确认渠道成功"}`
            : item.finalDecision?.outcome === "fullRefund" ? "终局退款待创建或重试" : "无退款交易";
          return `<article class="data-row ${tone}">
            <div class="row-title"><div>${statusPill(item.status)} ${item.decision ? statusPill(item.decision.outcome) : ""}</div><h3>${escapeHtml(statusLabel(item.issue))} · ${escapeHtml(item.order?.serviceTitle || "预约服务")}</h3><p>${escapeHtml(maskId(item.id))} · 订单 ${escapeHtml(maskId(item.order?.id))} · ${escapeHtml(item.openedByRole === "customer" ? "用户发起" : "陪伴者发起")}</p></div>
            <div class="row-facts"><div><span>渠道可信事实</span><strong>${escapeHtml(providerStatus)}</strong><small>${escapeHtml(attendancePartySummary("用户", summary.customer))}<br>${escapeHtml(attendancePartySummary("陪伴者", summary.companion))}</small></div><div><span>材料 / 截止</span><strong>${escapeHtml((item.statements || []).length)} 条 · <span class="${due.tone}">${escapeHtml(deadline ? due.text : "无当前截止时间")}</span></strong><small>客户端辅助事件 ${escapeHtml(summary.auxiliaryClientEvents || 0)} 条</small></div><div><span>终局 / 退款</span><strong>${escapeHtml(item.finalDecision ? statusLabel(item.finalDecision.outcome) : "尚未终局")}</strong><small>${escapeHtml(refundTruth)}</small></div></div>
            <details><summary>查看双方陈述与裁决理由</summary>${statements}${item.decision ? `<p><strong>首轮裁决</strong><br>${escapeHtml(item.decision.reason || "—")}</p>` : ""}${item.finalDecision ? `<p><strong>终局理由</strong><br>${escapeHtml(item.finalDecision.reason || "—")}</p>` : ""}</details>
            <div class="row-actions">${actions.join("")}</div>
          </article>`;
        }).join("");
      }
      const assignedPages = Number(assigned.pagination?.totalPages || 1);
      const claimablePages = Number(claimable.pagination?.totalPages || 1);
      const total = Number(assigned.pagination?.total || 0) + Number(claimable.pagination?.total || 0);
      renderPagination(pagination, {
        page,
        total,
        totalPages: Math.max(assignedPages, claimablePages)
      }, (next) => loadAttendanceDisputes(next));
    } catch (error) {
      setContainerState(container, "error", `履约争议加载失败：${error.message}`);
      showTrace(error);
    }
  }

  async function loadSupportWorkbench() {
    await Promise.all([loadSupport(), loadAttendanceDisputes(state.pages.attendanceDisputes)]);
  }

  async function loadRefunds(page = state.pages.refunds) {
    state.pages.refunds = page;
    const container = document.querySelector("#refundList");
    const pagination = document.querySelector("#refundPagination");
    setContainerState(container, "loading", "正在读取退款审核与异常队列…");
    pagination.innerHTML = "";
    const status = document.querySelector("#refundStatusFilter").value;
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) query.set("status", status);
    try {
      const data = await request(`/payments/refunds/review-queue?${query.toString()}`);
      setRecords("refund", data.items || []);
      if (!data.items?.length) {
        setContainerState(container, "empty", "当前没有需要人工介入的退款。");
      } else {
        container.innerHTML = data.items.map((item) => {
          const isCurrentOwner = item.assignedToUserId === state.user?.id;
          const reviewDue = dueText(item.sla?.reviewDueAt);
          const resolutionDue = dueText(item.sla?.resolutionDueAt);
          const actions = [
            !item.assignedToUserId ? actionButton("认领退款", "claimRefund", "refund", item.id, "primary") : "",
            item.status === "pendingReview" && isCurrentOwner ? actionButton("批准退款", "approveRefund", "refund", item.id, "primary") : "",
            item.status === "pendingReview" && isCurrentOwner && item.exceptionReasonCode !== "ATTENDANCE_DISPUTE_DECISION" ? actionButton("拒绝退款", "rejectRefund", "refund", item.id, "danger") : "",
            item.status === "failed" && isCurrentOwner ? actionButton("重试提交", "retryRefund", "refund", item.id, "warn") : "",
            ["failed", "pending", "processing"].includes(item.status) ? actionButton("查询渠道", "syncRefund", "refund", item.id) : ""
          ].join("");
          const owner = item.assignedTo
            ? (item.assignedTo.displayName || maskId(item.assignedTo.id))
            : "待认领";
          return `<article class="data-row ${item.status === "failed" || item.sla?.overdue ? "urgent" : "attention"}">
            <div class="row-title"><div>${statusPill(item.status)}</div><h3>${escapeHtml(money(item.amountCents))} · 退款 ${escapeHtml(maskId(item.id))}</h3><p>${escapeHtml(item.exceptionReasonCode === "ATTENDANCE_DISPUTE_DECISION" ? "履约争议终局退款：第二人核验执行，不可推翻案件结论" : (item.reason || "未提供退款原因"))}</p></div>
            <div class="row-facts"><div><span>订单 / 用户</span><strong>${escapeHtml(maskId(item.orderId))} / ${escapeHtml(maskId(item.userId))}</strong></div><div><span>当前负责人</span><strong>${escapeHtml(owner)}</strong><small>${escapeHtml(item.assignedAt ? `认领 ${formatTime(item.assignedAt)}` : "财务或管理员需先认领")}</small></div><div><span>审核 / 处理 SLA</span><strong class="${escapeHtml(item.sla?.overdue ? "bad" : "")}">${escapeHtml(item.sla?.reviewDueAt ? reviewDue.text : "无需人工审核")} · ${escapeHtml(resolutionDue.text)}</strong><small>${escapeHtml(item.sla?.overdueStage ? `已超时阶段：${item.sla.overdueStage}` : "当前未超时")}</small></div><div><span>渠道参考</span><strong>${escapeHtml(maskReference(item.outRefundNo))}</strong></div><div><span>失败 / 对账</span><strong title="${escapeHtml(item.failureReason || "")}">${escapeHtml(item.failureReason || `查询 ${item.providerQueryAttempts || 0} 次`)}</strong></div></div>
            <div class="row-actions">${actions}</div>
          </article>`;
        }).join("");
      }
      renderPagination(pagination, data.pagination, (next) => loadRefunds(next));
    } catch (error) {
      setContainerState(container, "error", `退款队列加载失败：${error.message}`);
      showTrace(error);
    }
    if (hasCapability("payment-reconciliation.manage")) {
      await loadPaymentReconciliation(
        state.pages.paymentReconciliationRuns,
        state.pages.paymentReconciliationIssues
      );
    } else {
      document.querySelector("#paymentReconciliationPanel")?.classList.add("hidden");
    }
  }

  function shanghaiYesterday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(Date.now() - 24 * 60 * 60_000));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  function reconciliationComparison(item) {
    if (item.kind === "providerStatementMissingWithLocalActivity") {
      return `本地活动 ${Number(item.expectedCents || 0)} 笔 · 微信无账单`;
    }
    const expected = item.expectedCents === null || item.expectedCents === undefined
      ? "无本地金额"
      : money(item.expectedCents);
    const actual = item.actualCents === null || item.actualCents === undefined
      ? "无渠道金额"
      : money(item.actualCents);
    return `${expected} / ${actual}`;
  }

  async function sha256Hex(textValue) {
    const bytes = new TextEncoder().encode(textValue);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function submitMerchantBillImport() {
    if (!state.mutationsEnabled) {
      showToast("当前为只读模式。请先显式开启受控操作。", true);
      return;
    }
    const date = document.querySelector("#merchantBillImportDate")?.value || "";
    const kind = document.querySelector("#merchantBillImportKind")?.value || "";
    const evidenceReference = document.querySelector("#merchantBillEvidenceReference")?.value.trim() || "";
    const fileInput = document.querySelector("#merchantBillImportFile");
    const file = fileInput?.files?.[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !["tradeAll", "fundBasic", "fundOperation", "fundFees"].includes(kind)
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}$/.test(evidenceReference)
      || !file) {
      showToast("请选择单日日期、账单类型、受控证据引用和官方 CSV。", true);
      return;
    }
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
      showToast("官方 CSV 必须介于 1 字节和 20 MiB 之间。", true);
      fileInput.value = "";
      return;
    }
    if (!window.confirm(`确认把 ${date} 的${statusLabel(kind)}提交第二人复核？31 日合并导出不会被接受。`)) return;
    const button = document.querySelector("#merchantBillImportButton");
    let content = "";
    try {
      button.disabled = true;
      button.textContent = "正在本地计算 SHA-256…";
      content = await file.text();
      const digest = await sha256Hex(content);
      button.textContent = "正在提交请求内原文…";
      await request("/admin/commercial/payment-reconciliation/merchant-imports/text", {
        method: "POST",
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "x-wechat-bill-date": date,
          "x-wechat-bill-kind": kind,
          "x-content-sha256": digest,
          "x-evidence-reference": evidenceReference
        },
        body: content
      });
      showToast("账单摘要已提交；原文已从上传控件清除，等待另一人复核。");
      await loadFinanceEvidenceQueues(1, state.pages.cashLedgerClassifications);
    } catch (error) {
      showTrace(error);
      showToast(error.message || "账单导入失败；原文未持久化。", true);
    } finally {
      content = "";
      fileInput.value = "";
      button.disabled = false;
      button.textContent = "计算 SHA 并提交复核";
    }
  }

  async function loadFinanceEvidenceQueues(
    importPage = state.pages.merchantBillImports,
    cashPage = state.pages.cashLedgerClassifications
  ) {
    state.pages.merchantBillImports = importPage;
    state.pages.cashLedgerClassifications = cashPage;
    const importContainer = document.querySelector("#merchantBillImportList");
    const importPagination = document.querySelector("#merchantBillImportPagination");
    const cashContainer = document.querySelector("#cashLedgerClassificationList");
    const cashPagination = document.querySelector("#cashLedgerClassificationPagination");
    if (!importContainer || !cashContainer) return;
    setContainerState(importContainer, "loading", "正在读取历史账单导入审批链…");
    setContainerState(cashContainer, "loading", "正在读取未分类现金台账…");
    const importStatus = document.querySelector("#merchantBillImportStatus")?.value || "";
    const importQuery = new URLSearchParams({ page: String(importPage), pageSize: "25" });
    if (importStatus) importQuery.set("status", importStatus);
    const cashQuery = new URLSearchParams({
      page: String(cashPage),
      pageSize: "25",
      classificationStatus: "unclassified"
    });
    const [importsResult, cashResult] = await Promise.allSettled([
      request(`/admin/commercial/payment-reconciliation/merchant-imports?${importQuery.toString()}`),
      request(`/admin/commercial/payment-reconciliation/cash-ledger?${cashQuery.toString()}`)
    ]);
    if (importsResult.status === "rejected") {
      renderLoadError(importContainer, `历史账单审批链加载失败：${importsResult.reason.message}`, () => loadFinanceEvidenceQueues(importPage, cashPage));
    } else {
      const items = importsResult.value.items || [];
      setRecords("merchantBillImport", items);
      importContainer.innerHTML = items.length ? items.map((item) => {
        const actions = item.status === "pending"
          ? `${actionButton("独立批准并对账", "approveMerchantBillImport", "merchantBillImport", item.id, "primary")}${actionButton("驳回", "rejectMerchantBillImport", "merchantBillImport", item.id, "warn")}`
          : "";
        return `<article class="compact-row ${item.status === "pending" ? "attention" : item.status === "approved" ? "good" : ""}"><div><strong>${escapeHtml(item.billDate)} · ${escapeHtml(statusLabel(item.kind))}</strong><small>来源 ${escapeHtml(item.source)} · 单日范围 ${escapeHtml(item.billDate)} 至 ${escapeHtml(item.billDate)} · ${escapeHtml(item.entryCount)} 行 · ${escapeHtml(item.sizeBytes)} bytes</small><small>SHA-256 ${escapeHtml(item.contentSha256)} · 归一化 SHA-256 ${escapeHtml(item.normalizedSha256)}</small><small>证据 ${escapeHtml(item.evidenceReference)} · 提交 ${escapeHtml(item.proposedByUserIdMasked || "—")} · 审批 ${escapeHtml(item.reviewedByUserIdMasked || "待第二人")} · 原文持久化：否</small></div><div>${statusPill(item.status)}${actions}</div></article>`;
      }).join("") : '<div class="empty-state">当前筛选没有历史账单导入提案。</div>';
      renderPagination(importPagination, importsResult.value.pagination, (next) => loadFinanceEvidenceQueues(next, cashPage));
    }
    if (cashResult.status === "rejected") {
      renderLoadError(cashContainer, `现金台账加载失败：${cashResult.reason.message}`, () => loadFinanceEvidenceQueues(importPage, cashPage));
    } else {
      const items = cashResult.value.items || [];
      setRecords("cashLedgerEntry", items);
      cashContainer.innerHTML = items.length ? items.map((item) => {
        const proposal = item.classification;
        const actions = proposal?.status === "pending"
          ? `${actionButton("独立批准分类", "approveCashLedgerClassification", "cashLedgerEntry", item.id, "primary")}${actionButton("驳回分类", "rejectCashLedgerClassification", "cashLedgerEntry", item.id, "warn")}`
          : actionButton("提交分类", "proposeCashLedgerClassification", "cashLedgerEntry", item.id, "primary");
        return `<article class="compact-row attention"><div><strong>${escapeHtml(item.businessName)} · ${escapeHtml(money(item.netCents))} · ${escapeHtml(item.direction)}</strong><small>渠道 ${escapeHtml(item.provider)} / ${escapeHtml(item.providerReferenceMasked || "—")} · 入账 ${escapeHtml(formatTime(item.bookedAt))}</small><small>来源 ${escapeHtml(item.sourceResourceType)} / ${escapeHtml(item.sourceResourceIdMasked || "—")} · 当前账户 ${escapeHtml(statusLabel(item.accountType))} · 预计账单日 ${escapeHtml(item.expectedStatementDate || "待分类")}</small><small>${proposal ? `提案 ${statusLabel(proposal.status)} · ${proposal.accountType} · ${proposal.expectedStatementDate} · SHA-256 ${proposal.evidenceDigestSha256}` : "尚无分类提案"}</small></div><div>${actions}</div></article>`;
      }).join("") : '<div class="empty-state">未分类现金台账已清零。</div>';
      renderPagination(cashPagination, cashResult.value.pagination, (next) => loadFinanceEvidenceQueues(importPage, next));
    }
  }

  async function loadPaymentReconciliation(
    runPage = state.pages.paymentReconciliationRuns,
    issuePage = state.pages.paymentReconciliationIssues
  ) {
    state.pages.paymentReconciliationRuns = runPage;
    state.pages.paymentReconciliationIssues = issuePage;
    const panel = document.querySelector("#paymentReconciliationPanel");
    const readinessElement = document.querySelector("#paymentReconciliationReadiness");
    const runContainer = document.querySelector("#paymentReconciliationRunList");
    const runPagination = document.querySelector("#paymentReconciliationRunPagination");
    const issueContainer = document.querySelector("#paymentReconciliationIssueList");
    const issuePagination = document.querySelector("#paymentReconciliationIssuePagination");
    if (!panel || !hasCapability("payment-reconciliation.manage")) return;
    panel.classList.remove("hidden");
    readinessElement.textContent = "正在读取 T+1 对账门禁…";
    setContainerState(runContainer, "loading", "正在读取四类账单运行记录…");
    setContainerState(issueContainer, "loading", "正在读取账实差异与处置状态…");
    runPagination.innerHTML = "";
    issuePagination.innerHTML = "";

    try {
      const readiness = await request("/admin/commercial/payment-reconciliation/readiness");
      const gate = readiness.gate || {};
      const ready = readiness.enabled && readiness.approved
        && readiness.providerMode === "real" && gate.blocked === false;
      readinessElement.textContent = ready
        ? `覆盖 ${gate.coverageStartDate} 至 ${gate.dueDate} · ${gate.completedRuns}/${gate.requiredRuns} 运行 · 无未结差异`
        : `No-Go · 覆盖 ${gate.coverageStartDate || readiness.startDate || "未配置"} 至 ${gate.dueDate || "未知"} · 缺失/未完成 ${Number(gate.missingOrIncompleteRuns || 0)} · 未结 ${Number(gate.unresolvedIssues || 0)} · 异常处置待复核 ${Number(gate.pendingApprovals || 0)} · 历史账单待复核 ${Number(gate.pendingBillImportApprovals || 0)} · 资金待分类 ${Number(gate.unclassifiedCashLedgerEntries || 0)} · 渠道时间缺失 ${Number(gate.unknownProviderPaymentTimes || 0) + Number(gate.unknownProviderRefundTimes || 0)} · provider=${readiness.providerMode || "unknown"}`;
    } catch (error) {
      readinessElement.textContent = `门禁读取失败：${error.message}；当前状态未知，不得视为已放行`;
      setContainerState(runContainer, "error", "对账门禁不可用，不能把缺少账单解释为已经核对。");
      setContainerState(issueContainer, "error", "对账门禁不可用，异常状态未知。");
      showTrace(error);
      return;
    }

    const runQuery = new URLSearchParams({ page: String(runPage), pageSize: "50" });
    const runStatus = document.querySelector("#paymentReconciliationRunStatusFilter")?.value || "";
    const billDate = document.querySelector("#paymentReconciliationRunDateFilter")?.value || "";
    if (runStatus) runQuery.set("status", runStatus);
    if (billDate) runQuery.set("billDate", billDate);
    const issueQuery = new URLSearchParams({ page: String(issuePage), pageSize: "50" });
    const issueStatus = document.querySelector("#paymentReconciliationIssueStatusFilter")?.value || "";
    const issueKind = document.querySelector("#paymentReconciliationIssueKindFilter")?.value || "";
    if (issueStatus) issueQuery.set("status", issueStatus);
    if (issueKind) issueQuery.set("kind", issueKind);

    const [runsResult, issuesResult] = await Promise.allSettled([
      request(`/admin/commercial/payment-reconciliation/runs?${runQuery.toString()}`),
      request(`/admin/commercial/payment-reconciliation/issues?${issueQuery.toString()}`)
    ]);

    if (runsResult.status === "rejected") {
      setContainerState(runContainer, "error", `账单运行记录加载失败：${runsResult.reason.message}。状态未知，不得标记已核对。`);
      showTrace(runsResult.reason);
    } else {
      const runs = runsResult.value.items || [];
      setRecords("paymentReconciliationRun", runs);
      if (!runs.length) {
        setContainerState(runContainer, "empty", "当前筛选没有对账运行记录；这不代表该日期已经完成核对。");
      } else {
        runContainer.innerHTML = runs.map((item) => {
          const hashFact = item.status === "reconciled"
            ? item.hashVerified
              ? "下载 hash 与导入摘要均已验证"
              : "缺少 hash 验证证据 · No-Go"
            : item.status === "noStatement"
              ? "微信返回无账单 · 必须继续核对本地活动"
              : "尚未形成可验真的下载产物";
          const actions = item.status === "failed" || item.status === "noStatement"
            ? actionButton(item.status === "failed" ? "重试失败运行" : "重新拉取无账单", "retryPaymentReconciliationRun", "paymentReconciliationRun", item.id, "warn")
            : "";
          const tone = item.status === "failed" || (item.status === "reconciled" && !item.hashVerified)
            ? "urgent"
            : item.status === "reconciled" && item.hashVerified && Number(item.issueCount || 0) === 0
              ? "good"
              : "attention";
          return `<article class="data-row ${tone}">
            <div class="row-title"><div>${statusPill(item.status)} ${statusPill(item.kind)}</div><h3>${escapeHtml(item.billDate)} · ${escapeHtml(statusLabel(item.kind))}</h3><p>${escapeHtml(maskId(item.id))}</p></div>
            <div class="row-facts"><div><span>条目 / 异常</span><strong>${escapeHtml(item.entryCount || 0)} / ${escapeHtml(item.issueCount || 0)}</strong></div><div><span>Hash 证据</span><strong>${escapeHtml(hashFact)}</strong></div><div><span>尝试 / 下次处理</span><strong>${escapeHtml(item.attemptCount || 0)} 次 · ${escapeHtml(formatTime(item.nextAttemptAt))}</strong></div><div><span>导入 / 核对时间</span><strong>${escapeHtml(formatTime(item.importedAt))} / ${escapeHtml(formatTime(item.reconciledAt))}</strong></div><div><span>失败代码</span><strong>${escapeHtml(item.lastErrorCode || "无")}</strong></div></div>
            <div class="row-actions">${actions}</div>
          </article>`;
        }).join("");
      }
      renderPagination(runPagination, runsResult.value.pagination, (next) =>
        loadPaymentReconciliation(next, state.pages.paymentReconciliationIssues));
    }

    if (issuesResult.status === "rejected") {
      setContainerState(issueContainer, "error", `对账异常加载失败：${issuesResult.reason.message}。状态未知，不得视为无异常。`);
      showTrace(issuesResult.reason);
    } else {
      const issues = issuesResult.value.items || [];
      setRecords("paymentReconciliationIssue", issues);
      if (!issues.length) {
        setContainerState(issueContainer, "empty", "当前筛选没有异常记录；仍须以上方四类运行及 hash 事实判断当天是否完成。");
      } else {
        issueContainer.innerHTML = issues.map((item) => {
          const actions = [
            item.status === "open" ? actionButton("认领异常", "claimPaymentReconciliationIssue", "paymentReconciliationIssue", item.id, "primary") : "",
            item.canSubmitResolution ? actionButton("提交解决提案", "resolvePaymentReconciliationIssue", "paymentReconciliationIssue", item.id, "primary") : "",
            item.canSubmitResolution ? actionButton("提交例外提案", "acceptPaymentReconciliationException", "paymentReconciliationIssue", item.id, "danger") : "",
            item.canApproveResolution ? actionButton("独立批准", "approvePaymentReconciliationResolution", "paymentReconciliationIssue", item.id, "primary") : "",
            item.canRejectResolution ? actionButton("驳回提案", "rejectPaymentReconciliationResolution", "paymentReconciliationIssue", item.id, "warn") : ""
          ].join("");
          const tone = ["open", "investigating"].includes(item.status) ? "urgent" : item.status === "resolved" ? "good" : "attention";
          return `<article class="data-row ${tone}">
            <div class="row-title"><div>${statusPill(item.status)} ${statusPill(item.severity)}</div><h3>${escapeHtml(statusLabel(item.kind))}</h3><p>${escapeHtml(item.billDate || "日期未知")} · ${escapeHtml(statusLabel(item.billKind))} · 运行 ${escapeHtml(maskId(item.runId))}</p></div>
            <div class="row-facts"><div><span>本地 / 渠道对比</span><strong>${escapeHtml(reconciliationComparison(item))}</strong></div><div><span>本地对象</span><strong>${escapeHtml(item.localResourceType || "无")} · ${escapeHtml(item.localResourceIdMasked || "—")}</strong></div><div><span>渠道参考</span><strong>${escapeHtml(item.providerReferenceMasked || "—")}</strong></div><div><span>详情代码</span><strong>${escapeHtml(item.detailCode || "—")}</strong></div><div><span>处置提案 / 证据</span><strong>${escapeHtml(item.resolutionProposal ? `${statusLabel(item.resolutionProposal.status)} · ${item.resolutionProposal.resolutionCode}` : item.resolutionCode || "待提交")}</strong><small>${escapeHtml(item.resolutionProposal ? `${item.resolutionProposal.evidenceReference} · SHA256 ${item.resolutionProposal.evidenceDigestSha256.slice(0, 12)}…` : item.resolutionNote || "需负责人提交不可变证据并由第二人复核")}</small></div></div>
            <div class="row-actions">${actions}</div>
          </article>`;
        }).join("");
      }
      renderPagination(issuePagination, issuesResult.value.pagination, (next) =>
        loadPaymentReconciliation(state.pages.paymentReconciliationRuns, next));
    }
    await loadFinanceEvidenceQueues(
      state.pages.merchantBillImports,
      state.pages.cashLedgerClassifications
    );
  }

  async function loadPaymentDisputes(page = state.pages.paymentDisputes) {
    state.pages.paymentDisputes = page;
    const container = document.querySelector("#paymentDisputeList");
    const pagination = document.querySelector("#paymentDisputePagination");
    setContainerState(container, "loading", "正在读取微信支付消费者投诉与 SLA…");
    pagination.innerHTML = "";
    const status = document.querySelector("#paymentDisputeStatusFilter").value;
    const sla = document.querySelector("#paymentDisputeSlaFilter").value;
    const query = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (status) query.set("status", status);
    if (sla) query.set("sla", sla);
    try {
      const data = await request(`/admin/commercial/payment-disputes?${query.toString()}`);
      const items = data.items || [];
      setRecords("paymentDispute", items);
      if (!items.length) {
        setContainerState(container, "empty", "当前筛选下没有支付投诉。");
      } else {
        container.innerHTML = items.map((item) => {
          const resolutionDue = dueText(item.resolutionDueAt);
          const firstResponseDue = item.firstRespondedAt
            ? { text: `已回复 ${formatTime(item.firstRespondedAt)}`, tone: "" }
            : dueText(item.firstResponseDueAt);
          const tone = item.status === "syncFailed" || item.sla?.resolutionOverdue || item.sla?.firstResponseOverdue
            ? "urgent"
            : item.status === "resolved"
              ? "good"
              : "attention";
          const isSupport = state.user?.role === "support";
          const isAdmin = state.user?.role === "admin";
          const isAssignedToMe = item.assignedSupportUserId === state.user?.id;
          const isSummary = item.detailAvailable === false;
          const isFinancial = item.dataScope === "financial";
          const canRespond = !isSummary && (isAdmin || (isSupport && isAssignedToMe));
          const canComplete = canRespond
            && item.status !== "resolved"
            && item.providerStatus === "PROCESSING"
            && item.firstRespondedAt
            && !item.incomingUserResponse
            && !item.inPlatformService
            && Number(item.unmatchedComplaintOrderCount || 0) === 0;
          const actions = [
            isSupport && !item.assignedSupportUserId
              ? actionButton("认领后查看", "claimPaymentDispute", "paymentDispute", item.id, "primary")
              : "",
            isAdmin ? actionButton("分配受理人", "assignPaymentDispute", "paymentDispute", item.id) : "",
            canRespond && item.status !== "resolved" && !item.inPlatformService
              ? actionButton(item.incomingUserResponse ? "回复最新消息" : "回复投诉", "replyPaymentDispute", "paymentDispute", item.id, "primary")
              : "",
            canComplete ? actionButton("提交完结", "completePaymentDispute", "paymentDispute", item.id, "danger") : "",
            hasCapability("payment-dispute.sync") || isAdmin
              ? actionButton("同步微信状态", "syncPaymentDispute", "paymentDispute", item.id)
              : ""
          ].join("");
          const evidenceLabels = {
            notifications: "通知",
            replies: "本地回复",
            attachments: "附件元数据",
            negotiationEvents: "协商历史",
            recoveries: "追偿",
            complaintOrders: "投诉订单"
          };
          const evidenceResources = {
            notifications: "notifications",
            replies: "replies",
            attachments: "attachments",
            negotiationEvents: "negotiation-events",
            recoveries: "recoveries",
            complaintOrders: "complaint-orders"
          };
          const evidenceActions = Object.entries(item.evidenceWindows || {})
            .filter(([, window]) => window?.hasMore)
            .map(([key, window]) => `<button class="button small quiet" type="button" data-payment-evidence-id="${escapeHtml(item.id)}" data-payment-evidence-resource="${escapeHtml(evidenceResources[key])}" data-payment-evidence-page="${escapeHtml(window.nextPage || 2)}" data-payment-evidence-size="${escapeHtml(window.limit || 10)}">继续读取${escapeHtml(evidenceLabels[key])}（${escapeHtml(window.loaded || 0)}/${escapeHtml(window.total || 0)}）</button>`)
            .join("");
          const flags = [
            item.incomingUserResponse ? "用户有新消息" : "",
            item.complaintFullRefunded ? "渠道标记已全额退款" : "",
            item.requiresImmediateService ? "需立即服务" : "",
            item.inPlatformService ? "微信平台服务中" : "",
            Number(item.unmatchedComplaintOrderCount || 0) > 0
              ? `仍有 ${Number(item.unmatchedComplaintOrderCount || 0)} 个投诉订单未关联本地支付，禁止完结`
              : ""
          ].filter(Boolean).join(" · ") || "无额外渠道标记";
          const negotiationHistory = isSummary
            ? `<div class="json-preview">${isFinancial ? "财务岗位不展示投诉正文、用户往来与证据元数据。" : "认领成功后才开放投诉正文、用户往来与必要证据元数据。"}</div>`
            : (item.negotiationEvents || []).length
              ? `<div class="json-preview">${(item.negotiationEvents || []).map((event) => {
                  const operator = event.operator === "user" ? "用户" : event.operator === "merchant" ? "商户" : event.operator === "wechat_platform" ? "微信平台" : "系统";
                  const details = event.operateDetails || statusLabel(event.operateType);
                  return `${formatTime(event.operatedAt)} · ${operator} · ${details}${event.mediaCount ? ` · ${event.mediaCount} 份证据` : ""}`;
                }).map(escapeHtml).join("<br>")}</div>`
              : '<div class="json-preview">协商历史尚未同步；请先查询微信权威记录。</div>';
          const localReplies = !isSummary && (item.replies || []).length
            ? `<div class="json-preview">本地提交：${(item.replies || []).map((reply) => `${formatTime(reply.createdAt)} · ${statusLabel(reply.status)} · ${reply.content}`).map(escapeHtml).join("<br>")}</div>`
            : "";
          const complaintCopy = isSummary
            ? isFinancial
              ? "财务岗位仅展示订单关联、退款诉求与资金阻断状态"
              : "未认领投诉（正文最小可见）"
            : item.complaintDetail || "渠道尚未返回投诉正文，请先同步权威详情。";
          return `<article class="data-row ${tone}">
            <div class="row-title"><div>${statusPill(item.status)} ${item.providerStatus ? statusPill(item.providerStatus.toLowerCase()) : ""}</div><h3>${escapeHtml(item.problemType || "微信支付消费者投诉")} · ${escapeHtml(maskId(item.complaintId || item.id))}</h3><p>${escapeHtml(complaintCopy)}</p>${negotiationHistory}${localReplies}</div>
            <div class="row-facts"><div><span>首次回复 SLA</span><strong class="${escapeHtml(firstResponseDue.tone)}">${escapeHtml(firstResponseDue.text)}</strong></div><div><span>完结 SLA</span><strong class="${escapeHtml(resolutionDue.tone)}">${escapeHtml(item.status === "resolved" ? `已完结 ${formatTime(item.resolvedAt)}` : resolutionDue.text)}</strong></div><div><span>订单 / 资金</span><strong>${escapeHtml(maskId(item.orderId))} · ${escapeHtml(statusLabel(item.fundingStatus))}${item.applyRefundAmountCents != null ? ` · ${escapeHtml(money(item.applyRefundAmountCents))}` : ""}</strong></div><div><span>受理 / 渠道标记</span><strong>${escapeHtml(item.assignedSupportUserId ? maskId(item.assignedSupportUserId) : "未分配")} · ${escapeHtml(flags)}</strong></div></div>
            <div class="row-actions">${actions}${evidenceActions}</div><div class="json-preview hidden" data-payment-evidence-target="${escapeHtml(item.id)}"></div>
          </article>`;
        }).join("");
      }
      renderPagination(pagination, {
        page: data.page || page,
        pageSize: data.pageSize || 30,
        total: data.total || 0,
        totalPages: Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 30)))
      }, (next) => loadPaymentDisputes(next));
    } catch (error) {
      setContainerState(container, "error", `支付投诉队列加载失败：${error.message}`);
      showTrace(error);
    }
  }

  async function loadPaymentDisputeEvidence(button) {
    const id = button.dataset.paymentEvidenceId;
    const resource = button.dataset.paymentEvidenceResource;
    const page = Number(button.dataset.paymentEvidencePage || 2);
    const pageSize = Math.max(1, Math.min(100, Number(button.dataset.paymentEvidenceSize || 10)));
    const target = document.querySelector(`[data-payment-evidence-target="${CSS.escape(id)}"]`);
    if (!target || !resource || !Number.isInteger(page)) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "正在读取下一页…";
    try {
      const data = await request(`/admin/commercial/payment-disputes/${encodeURIComponent(id)}/evidence/${encodeURIComponent(resource)}?page=${page}&pageSize=${pageSize}`);
      target.classList.remove("hidden");
      target.insertAdjacentHTML("beforeend", `<div data-evidence-page="${escapeHtml(resource)}:${escapeHtml(page)}"><strong>${escapeHtml(resource)} · 第 ${escapeHtml(page)} 页</strong><pre>${escapeHtml(safePreview(data.items || []))}</pre></div>`);
      const nextPage = data.pagination?.nextPage;
      if (nextPage) {
        button.dataset.paymentEvidencePage = String(nextPage);
        button.disabled = false;
        button.textContent = `继续读取 ${resource}（下一页 ${nextPage}）`;
      } else {
        button.remove();
      }
    } catch (error) {
      target.classList.remove("hidden");
      target.insertAdjacentHTML("beforeend", `<div class="error-state"><strong>${escapeHtml(resource)} 第 ${escapeHtml(page)} 页读取失败</strong><span>${escapeHtml(error.message || "请重试；已经读取的证据仍保留。")}</span></div>`);
      button.disabled = false;
      button.textContent = original;
      showTrace(error);
    }
  }

  async function loadSettlements(
    earningPage = state.pages.earnings,
    recoveryPage = state.pages.recoveries,
    invoicePage = state.pages.invoices
  ) {
    state.pages.earnings = earningPage;
    state.pages.recoveries = recoveryPage;
    state.pages.invoices = invoicePage;
    const earningContainer = document.querySelector("#earningList");
    const recoveryContainer = document.querySelector("#recoveryList");
    const invoiceContainer = document.querySelector("#invoiceList");
    const invoicePagination = document.querySelector("#invoicePagination");
    const earningPagination = document.querySelector("#earningPagination");
    const recoveryPagination = document.querySelector("#recoveryPagination");
    const canManageLedger = hasCapability("settlement.manage") || hasCapability("recovery.manage");
    const canManageInvoices = hasCapability("invoice.manage");
    earningContainer.closest(".panel")?.classList.toggle("hidden", !canManageLedger);
    recoveryContainer.closest(".panel")?.classList.toggle("hidden", !canManageLedger);
    invoiceContainer.closest(".panel")?.classList.toggle("hidden", !canManageInvoices);
    if (canManageLedger) {
      setContainerState(earningContainer, "loading", "正在读取收益台账…");
      setContainerState(recoveryContainer, "loading", "正在读取追偿队列…");
    }
    if (canManageInvoices) setContainerState(invoiceContainer, "loading", "正在读取发票申请…");
    invoicePagination.innerHTML = "";
    earningPagination.innerHTML = "";
    recoveryPagination.innerHTML = "";
    const earningStatus = document.querySelector("#earningStatusFilter").value;
    const recoveryStatus = document.querySelector("#recoveryStatusFilter").value;
    const invoiceStatus = document.querySelector("#invoiceStatusFilter").value;
    const results = await Promise.allSettled([
      canManageLedger
        ? request(`/admin/commercial/earnings?page=${earningPage}&pageSize=50${earningStatus ? `&status=${encodeURIComponent(earningStatus)}` : ""}`)
        : Promise.resolve(null),
      canManageLedger
        ? request(`/admin/commercial/recoveries?page=${recoveryPage}&pageSize=50${recoveryStatus ? `&status=${encodeURIComponent(recoveryStatus)}` : ""}`)
        : Promise.resolve(null),
      canManageInvoices
        ? request(`/admin/account-governance/invoice-requests?page=${invoicePage}&pageSize=50${invoiceStatus ? `&status=${encodeURIComponent(invoiceStatus)}` : ""}`)
        : Promise.resolve(null)
    ]);
    if (canManageLedger && results[0].status === "fulfilled") {
      const items = results[0].value.items || [];
      setRecords("earning", items);
      earningContainer.innerHTML = items.length ? items.map((item) => {
        const actions = [
          item.status === "available" ? actionButton("认领结算", "claimPayout", "earning", item.id, "primary") : "",
          item.status === "held" && item.holdReason === "payout_execution_claimed" ? actionButton("记录转账证据", "submitPayout", "earning", item.id, "primary") : "",
          item.status === "held" && item.holdReason === "payout_execution_claimed" ? actionButton("取消认领", "cancelPayout", "earning", item.id, "warn") : "",
          item.status === "held" && item.holdReason === "payout_verification_pending" ? actionButton("第二人复核", "verifyPayout", "earning", item.id, "primary") : ""
        ].join("");
        return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companionId))} · ${escapeHtml(money(item.payableCents))}</h3>${statusPill(item.status)}</div><p>订单 ${escapeHtml(maskId(item.orderId))} · 平台费 ${escapeHtml(money(item.platformFeeCents))} · 收款方 ${escapeHtml(item.settlementRecipientMaskedSnapshot || "未留存快照")}</p><div class="compact-meta"><span>可用 ${escapeHtml(formatTime(item.availableAt))}</span><span>冻结原因 ${escapeHtml(item.holdReason || "无")}</span><span>证据 ${escapeHtml(maskReference(item.payoutEvidenceDigest))}</span></div><div class="compact-actions">${actions}</div></article>`;
      }).join("") : '<div class="empty-state">没有符合条件的收益记录。</div>';
      renderPagination(earningPagination, results[0].value.pagination, (next) => loadSettlements(next, state.pages.recoveries, state.pages.invoices));
    } else if (canManageLedger) {
      renderLoadError(earningContainer, results[0].reason.message || "收益台账加载失败", () => loadSettlements(state.pages.earnings, state.pages.recoveries, state.pages.invoices));
    }
    if (canManageLedger && results[1].status === "fulfilled") {
      const items = results[1].value.items || [];
      setRecords("recovery", items);
      recoveryContainer.innerHTML = items.length ? items.map((item) => {
        const actions = [
          item.status === "due" ? actionButton("记录追偿证据", "submitRecovery", "recovery", item.id, "primary") : "",
          item.status === "pendingVerification" ? actionButton("第二人核验", "verifyRecovery", "recovery", item.id, "primary") : ""
        ].join("");
        return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companionId))} · ${escapeHtml(money(item.amountCents))}</h3>${statusPill(item.status)}</div><p>${escapeHtml(item.reason || "退款后结算追偿")} · 订单 ${escapeHtml(maskId(item.orderId))}</p><div class="compact-meta"><span>证据 ${escapeHtml(maskReference(item.evidenceReference))}</span><span>提交人 ${escapeHtml(maskId(item.evidenceSubmittedById))}</span></div><div class="compact-actions">${actions}</div></article>`;
      }).join("") : '<div class="empty-state">没有符合条件的追偿记录。</div>';
      renderPagination(recoveryPagination, results[1].value.pagination, (next) => loadSettlements(state.pages.earnings, next, state.pages.invoices));
    } else if (canManageLedger) {
      renderLoadError(recoveryContainer, results[1].reason.message || "追偿队列加载失败", () => loadSettlements(state.pages.earnings, state.pages.recoveries, state.pages.invoices));
    }
    if (canManageInvoices && results[2].status === "fulfilled") {
      const items = results[2].value.items || [];
      setRecords("invoice", items);
      renderInvoices(invoiceContainer, items);
      renderPagination(invoicePagination, results[2].value.pagination, (next) => loadSettlements(state.pages.earnings, state.pages.recoveries, next));
    } else if (canManageInvoices) {
      renderLoadError(invoiceContainer, results[2].reason.message || "发票申请加载失败", () => loadSettlements(state.pages.earnings, state.pages.recoveries, state.pages.invoices));
    }
    const failed = results.find((result) => result.status === "rejected");
    if (failed) showTrace(failed.reason);
  }

  function renderInvoices(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const terminal = ["rejected", "voided", "cancelled"].includes(item.status);
      const action = terminal ? "" : actionButton("更新申请状态", "transitionInvoice", "invoice", item.id, "primary");
      const issuedFact = item.status === "issued"
        ? `已于 ${formatTime(item.issuedAt)} 记录真实开具完成；证据 ${maskReference(item.issuanceEvidenceReference)}`
        : item.status === "voided"
          ? `已于 ${formatTime(item.voidedAt)} 记录外部红冲/作废完成；证据 ${maskReference(item.voidEvidenceReference)}`
        : item.statusReason || "尚未填写处理结论";
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.invoiceTitle)} · ${escapeHtml(money(item.amountCents, item.currency))}</h3>${statusPill(item.status)}</div><p>${escapeHtml(item.service?.title || "服务订单")} · ${escapeHtml(issuedFact)}</p><div class="compact-meta"><span>订单 ${escapeHtml(maskId(item.orderId))}</span><span>用户 ${escapeHtml(maskId(item.userId))}</span><span>支付 ${escapeHtml(maskId(item.paymentTransactionId))}</span><span>申请 ${escapeHtml(formatTime(item.createdAt))}</span></div><div class="compact-actions">${action}</div></article>`;
    }).join("") : '<div class="empty-state">当前筛选下没有发票申请。</div>';
  }

  async function loadCompanionAppeals(page = state.pages.companionAppeals) {
    state.pages.companionAppeals = page;
    const panel = document.querySelector("#companionAppealsPanel");
    const container = document.querySelector("#companionAppealList");
    const pagination = document.querySelector("#companionAppealPagination");
    const canManage = hasCapability("companion.lifecycle.supply.manage")
      || hasCapability("companion.lifecycle.manage");
    panel?.classList.toggle("hidden", !canManage);
    if (!canManage) {
      state.records.companionAppeal.clear();
      pagination.innerHTML = "";
      return;
    }
    setContainerState(container, "loading", "正在读取陪伴者申诉队列…");
    pagination.innerHTML = "";
    const status = document.querySelector("#companionAppealStatusFilter").value || "pending";
    try {
      const result = await request(`/admin/commercial/companion-lifecycle/appeals?page=${page}&pageSize=50&appealStatus=${encodeURIComponent(status)}`);
      const items = result.items || [];
      setRecords("companionAppeal", items);
      renderCompanionAppeals(container, items);
      renderPagination(pagination, result.pagination, (next) => loadCompanionAppeals(next));
    } catch (error) {
      state.records.companionAppeal.clear();
      setContainerState(container, "error", `陪伴者申诉队列加载失败：${error.message}`);
      showTrace(error);
    }
  }

  async function loadLifecycle(targetPageKey, targetPage) {
    if (targetPageKey && Number.isFinite(Number(targetPage))) {
      state.pages[targetPageKey] = Math.max(1, Number(targetPage));
    }
    state.voiceIntroReads.clear();
    const supplyCapability = "companion.lifecycle.supply.manage";
    const withdrawalCapability = "companion.withdrawal.manage";
    const legacyAdminCapability = "companion.lifecycle.manage";
    const configs = [
      ["training", "training", "#trainingList", "#trainingPagination", `/admin/commercial/companion-lifecycle/training?page=${state.pages.training}&pageSize=50`, renderTraining, supplyCapability],
      ["reviewDue", "reviewDue", "#reviewDueList", "#reviewDuePagination", `/admin/commercial/companion-lifecycle/review-due?page=${state.pages.reviewDue}&pageSize=50`, renderReviewDue, supplyCapability],
      ["accountAction", "accountActions", "#accountActionList", "#accountActionPagination", `/admin/commercial/companion-lifecycle/actions?active=true&page=${state.pages.accountActions}&pageSize=50`, renderAccountActions, supplyCapability],
      ["incident", "incidents", "#incidentList", "#incidentPagination", `/admin/commercial/companion-lifecycle/incidents?page=${state.pages.incidents}&pageSize=50`, renderIncidents, supplyCapability],
      ["withdrawal", "withdrawals", "#withdrawalList", "#withdrawalPagination", `/admin/commercial/companion-lifecycle/withdrawals?page=${state.pages.withdrawals}&pageSize=50`, renderWithdrawals, withdrawalCapability],
      ["voiceIntro", "voiceIntros", "#voiceIntroList", "#voiceIntroPagination", `/admin/commercial/companion-lifecycle/voice-intros?page=${state.pages.voiceIntros}&pageSize=50`, renderVoiceIntros, supplyCapability]
    ];
    const allowedConfigs = configs.filter(([, , selector, , , , capability]) => {
      const allowed = hasCapability(capability) || hasCapability(legacyAdminCapability);
      document.querySelector(selector)?.closest(".panel")?.classList.toggle("hidden", !allowed);
      return allowed;
    });
    allowedConfigs.forEach(([, , selector, paginationSelector]) => {
      setContainerState(document.querySelector(selector), "loading", "正在读取真实队列…");
      document.querySelector(paginationSelector).innerHTML = "";
    });
    const companionAppealsPromise = loadCompanionAppeals(state.pages.companionAppeals);
    const results = await Promise.allSettled(allowedConfigs.map(([, , , , endpoint]) => request(endpoint)));
    results.forEach((result, index) => {
      const [kind, pageKey, selector, paginationSelector, , render] = allowedConfigs[index];
      const container = document.querySelector(selector);
      if (result.status === "fulfilled") {
        const items = result.value.items || [];
        setRecords(kind, items);
        render(container, items);
        renderPagination(
          document.querySelector(paginationSelector),
          result.value.pagination,
          (next) => loadLifecycle(pageKey, next)
        );
      } else {
        renderLoadError(
          container,
          `接口不可用，已失败关闭：${result.reason.message}`,
          () => loadLifecycle(pageKey, state.pages[pageKey])
        );
      }
    });
    await companionAppealsPromise;
    const failed = results.find((result) => result.status === "rejected");
    if (failed) showTrace(failed.reason);
  }

  function recommendationMetricsQuery() {
    const params = new URLSearchParams();
    for (const [id, key] of [
      ["#recommendationMetricsFrom", "from"],
      ["#recommendationMetricsTo", "to"]
    ]) {
      const value = document.querySelector(id)?.value;
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) params.set(key, date.toISOString());
    }
    const query = params.toString();
    return `/admin/recommendations/metrics${query ? `?${query}` : ""}`;
  }

  function renderRecommendationMetrics(container, result) {
    const items = result.items || [];
    container.innerHTML = items.length ? items.map((item) => `
      <article class="compact-item">
        <div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companion?.id))} · ${escapeHtml(item.placement)}</h3>${statusPill("active")}</div>
        <p>曝光 ${escapeHtml(item.served || 0)} · 查看 ${escapeHtml(item.viewed || 0)} · 点击 ${escapeHtml(item.clicked || 0)} · 下单 ${escapeHtml(item.orderCreated || 0)} · 支付 ${escapeHtml(item.paid || 0)}</p>
        <div class="compact-meta"><span>查看率 ${escapeHtml(percent(item.viewRate))}</span><span>点击率 ${escapeHtml(percent(item.clickRate))}</span><span>下单率 ${escapeHtml(percent(item.orderRate))}</span><span>退款率 ${escapeHtml(percent(item.refundRate))}</span><span>归因实收 ${escapeHtml(money(item.grossPaidCents))}</span></div>
      </article>`).join("") : '<div class="empty-state">当前时间范围没有推荐曝光事实。</div>';
    container.insertAdjacentHTML("afterbegin", `<div class="section-callout"><strong>算法 ${escapeHtml(result.algorithmVersion || "未知")}</strong><span>${escapeHtml(formatTime(result.range?.from))} — ${escapeHtml(formatTime(result.range?.to))}${result.truncated ? " · 仅展示最近 5000 条样本，禁止当作全量" : " · 当前查询未截断"}</span></div>`);
  }

  function renderAvailabilityReminderReadiness(container, readiness) {
    const pipeline = readiness.pipeline || {};
    const terminalAttempts = pipeline.terminalAttempts || {};
    const rows = [
      ["准备 runner", pipeline.preparationRunnerEnabled ? "已开启" : "未开启"],
      ["投递 runner", pipeline.deliveryRunnerEnabled ? "已开启" : "未开启"],
      ["待准备候选", pipeline.pendingCandidates || 0],
      ["已到期待准备", pipeline.dueCandidates || 0],
      ["待预留交接", pipeline.pending || 0],
      ["已到期待预留", pipeline.dueReservations || 0],
      ["已预留待发送", pipeline.reservedAttempts || 0],
      ["正在发送", pipeline.activeAttempts || 0],
      ["已到期待投递", pipeline.dueAttempts || 0],
      ["准备失败", pipeline.failedPreparation || 0],
      ["预留失败", pipeline.failedReservation || 0],
      ["投递处理失败", pipeline.failedDelivery || 0],
      ["调用渠道前失败", pipeline.failedBeforeSend || 0],
      ["渠道明确拒绝", pipeline.rejected || 0],
      ["渠道结果不确定", pipeline.uncertain || 0],
      ["准备 claim 租约过期", pipeline.expiredPreparationLeases || 0],
      ["预留 claim 租约过期", pipeline.expiredReservationLeases || 0],
      ["投递 claim 租约过期", pipeline.expiredDeliveryClaimLeases || 0],
      ["发送租约过期", pipeline.expiredAttemptLeases || 0],
      ["终态待人工核对", terminalAttempts.unresolved || 0],
      ["终态已人工核对", terminalAttempts.resolved || 0],
      ["积压时效", pipeline.backlogSlaBreached ? `超出 ${pipeline.backlogSlaSeconds || 300} 秒` : "未超出代码阈值"]
    ];
    container.innerHTML = `<article class="compact-item ${readiness.status === "attentionRequired" ? "urgent" : ""}"><div class="compact-item-head"><h3>运行状态</h3>${statusPill(readiness.status || "unknown")}</div><p>检查于 ${escapeHtml(formatTime(pipeline.checkedAt || readiness.checkedAt))}；代码 readiness 不等于微信后台模板或主体审批。</p></article>`
      + rows.map(([label, value]) => `<div class="stack-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  async function loadGrowth() {
    const metricsContainer = document.querySelector("#recommendationMetricsList");
    const readinessContainer = document.querySelector("#availabilityReminderReadiness");
    setContainerState(metricsContainer, "loading", "正在读取推荐曝光与转化事实…");
    setContainerState(readinessContainer, "loading", "正在读取可约提醒正式 readiness…");
    const [metrics, readiness] = await Promise.allSettled([
      request(recommendationMetricsQuery()),
      request("/admin/commercial/availability-reminders/readiness")
    ]);
    if (metrics.status === "fulfilled") renderRecommendationMetrics(metricsContainer, metrics.value);
    else renderLoadError(metricsContainer, `推荐指标加载失败：${metrics.reason.message}`, loadGrowth);
    if (readiness.status === "fulfilled") renderAvailabilityReminderReadiness(readinessContainer, readiness.value);
    else renderLoadError(readinessContainer, `可约提醒 readiness 加载失败：${readiness.reason.message}`, loadGrowth);
    const failed = [metrics, readiness].find((result) => result.status === "rejected");
    if (failed) showTrace(failed.reason);
  }

  function submitRecommendationPolicy(event) {
    event.preventDefault();
    const companionId = document.querySelector("#recommendationPolicyCompanionId").value.trim();
    if (!companionId) {
      showToast("请填写准确的陪伴者 ID。", true);
      return;
    }
    const placement = document.querySelector("#recommendationPolicyPlacement").value;
    const status = document.querySelector("#recommendationPolicyStatus").value;
    const boostBps = Number(document.querySelector("#recommendationPolicyBoost").value || 0);
    const dailyCapValue = document.querySelector("#recommendationPolicyDailyCap").value;
    const startsAtValue = document.querySelector("#recommendationPolicyStartsAt").value;
    const endsAtValue = document.querySelector("#recommendationPolicyEndsAt").value;
    const body = {
      status,
      boostBps,
      dailyCap: dailyCapValue ? Number(dailyCapValue) : null,
      startsAt: startsAtValue ? new Date(startsAtValue).toISOString() : null,
      endsAt: endsAtValue ? new Date(endsAtValue).toISOString() : null
    };
    openAction({
      title: "变更推荐策略",
      description: "该变更会影响指定陪伴者在一个推荐位置的状态、权重、曝光上限与生效窗口；不会绕过公开、实名、成年、商业资格、可售商品或真实容量门禁。",
      resource: `recommendationPolicy:${companionId}:${placement}`,
      risk: "DISCOVERY GOVERNANCE",
      submitLabel: "确认更新策略",
      variant: "primary",
      reasonMinLength: 8,
      execute: async (_values, reason, operationId) => {
        const result = await patchJson(
          `/admin/recommendations/companions/${encodeURIComponent(companionId)}/policies/${encodeURIComponent(placement)}`,
          body,
          reason,
          operationId
        );
        document.querySelector("#recommendationPolicyResult").textContent = `服务端已记录策略 ${result.id || ""}；状态 ${result.status || status}，权重 ${result.boostBps ?? boostBps} bps。`;
      }
    });
  }

  function submitAvailabilityReminderRetry(event) {
    event.preventDefault();
    const stage = document.querySelector("#availabilityReminderRetryStage").value;
    const id = document.querySelector("#availabilityReminderRetryId").value.trim();
    if (!id) {
      showToast("请填写准确的失败记录 ID。", true);
      return;
    }
    openAction({
      title: "恢复可约提醒失败记录",
      description: "服务端会再次校验当前阶段和远端状态；渠道结果不确定的发送不会被允许自动重试。",
      resource: `availabilityReminder:${stage}:${id}`,
      risk: "ONE-TIME AUTHORIZATION",
      submitLabel: "确认请求安全重试",
      reasonMinLength: 8,
      execute: async (_values, reason, operationId) => {
        const result = await postJson(
          `/admin/commercial/availability-reminders/${encodeURIComponent(stage)}/${encodeURIComponent(id)}/retry`,
          undefined,
          reason,
          operationId
        );
        document.querySelector("#availabilityReminderRetryResult").textContent = `服务端已受理记录 ${id} 的恢复请求；当前状态 ${result.status || result.outcome || "待重新读取"}。`;
      }
    });
  }

  function submitAvailabilityReminderTerminalResolution(event) {
    event.preventDefault();
    const id = document.querySelector("#availabilityReminderTerminalId").value.trim();
    const resolutionCode = document.querySelector("#availabilityReminderResolutionCode").value;
    const evidenceRef = document.querySelector("#availabilityReminderTerminalEvidenceRef").value.trim();
    const note = document.querySelector("#availabilityReminderTerminalNote").value.trim();
    if (!id) {
      showToast("请填写准确的发送尝试 ID。", true);
      return;
    }
    if (resolutionCode === "uncertainProviderStateReconciled" && (!evidenceRef || note.length < 8)) {
      showToast("渠道结果不确定时，必须先填写微信侧证据引用和至少 8 个字符的核对说明。", true);
      return;
    }
    const body = {
      resolutionCode,
      ...(note ? { note } : {}),
      ...(evidenceRef ? { evidenceRef } : {})
    };
    openAction({
      title: "记录可约提醒人工终态",
      description: "该操作只会核销服务端保留的终态并写入审计，不会重发消息。结论代码与真实终态不一致、记录已被不同结论核销或资源不存在时都会失败关闭。",
      resource: `availabilityReminderTerminalAttempt:${id}`,
      risk: "NO AUTOMATIC RESEND",
      submitLabel: "确认记录人工终态",
      reasonMinLength: 8,
      execute: async (_values, reason, operationId) => {
        const result = await postJson(
          `/admin/commercial/availability-reminders/terminal-attempts/${encodeURIComponent(id)}/resolve`,
          body,
          reason,
          operationId
        );
        document.querySelector("#availabilityReminderTerminalResult").textContent = result.automaticResend === false
          ? `记录 ${id} 已核销；终态 ${result.terminalStatus || "待重新读取"}，自动重发：否。`
          : `记录 ${id} 返回了非预期结果；请停止操作并核对服务端审计。`;
      }
    });
  }

  function renderTraining(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const companionName = item.companion?.name || maskId(item.companion?.id);
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(companionName)} · ${escapeHtml(item.moduleCode || "培训模块")}</h3>${statusPill(item.status)}</div><p>版本 ${escapeHtml(item.moduleVersion || "—")} · 最佳成绩 ${escapeHtml(item.bestScore ?? "—")} · 尝试 ${escapeHtml(item.attemptCount ?? 0)} 次</p><div class="compact-meta"><span>最近作答 ${escapeHtml(formatTime(item.lastAttemptedAt))}</span><span>有效期 ${escapeHtml(formatTime(item.expiresAt))}</span></div></article>`;
    }).join("") : '<div class="empty-state">当前没有培训记录。</div>';
  }

  function renderReviewDue(container, items) {
    container.innerHTML = items.length ? items.map((item) => `<article class="compact-item urgent"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companion?.id))}</h3>${statusPill("attentionRequired")}</div><p>${item.reason === "reviewDateMissing" ? "商业资质缺少下次复审日期" : "商业资质已到定期复审节点"}</p><div class="compact-meta"><span>原核验 ${escapeHtml(formatTime(item.verifiedAt))}</span><span>复审截止 ${escapeHtml(formatTime(item.nextReviewDueAt))}</span><span>${item.companion?.isPublished ? "当前公开" : "当前下架"}</span></div></article>`).join("") : '<div class="empty-state">当前没有到期或缺少日期的商业资质。</div>';
  }

  function renderAccountActions(container, items) {
    container.innerHTML = items.length ? items.map((item) => `<article class="compact-item attention"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companionId))} · ${escapeHtml(statusLabels[item.kind] || item.kind)}</h3>${statusPill(item.active ? "active" : "closed")}</div><p>${escapeHtml(item.message || item.reasonCode || "未填写对外说明")}</p><div class="compact-meta"><span>原因码 ${escapeHtml(item.reasonCode || "—")}</span><span>开始 ${escapeHtml(formatTime(item.startsAt))}</span><span>结束 ${escapeHtml(formatTime(item.endsAt))}</span><span>申诉截止 ${escapeHtml(formatTime(item.appealDeadlineAt))}</span><span>${escapeHtml(item.appeals?.length || 0)} 次申诉</span></div></article>`).join("") : '<div class="empty-state">当前没有生效中的账号处置。</div>';
  }

  function renderIncidents(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const actions = ["resolved", "closed"].includes(item.status) ? "" : actionButton("更新事件", "resolveIncident", "incident", item.id, "primary");
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companionId))} · ${escapeHtml(item.category)}</h3>${statusPill(item.status)}</div><p>${escapeHtml(item.summary)}</p><div class="compact-meta"><span>订单 ${escapeHtml(maskId(item.orderId))}</span><span>${escapeHtml(formatTime(item.createdAt))}</span><span>${escapeHtml(item.evidenceReferences?.length || 0)} 份证据</span></div><div class="compact-actions">${actions}</div></article>`;
    }).join("") : '<div class="empty-state">当前没有陪伴者事件。</div>';
  }

  function renderWithdrawals(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const terminal = ["paid", "rejected", "cancelled"].includes(item.status);
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companionId))} · ${escapeHtml(money(item.amountCents))}</h3>${statusPill(item.status)}</div><p>收款方 ${escapeHtml(item.settlementRecipientMasked || "—")} · ${escapeHtml(item.earningIds?.length || 0)} 笔收益</p><div class="compact-meta"><span>申请 ${escapeHtml(formatTime(item.createdAt))}</span><span>付款参考 ${escapeHtml(item.payoutReferenceMasked || "—")}</span></div><div class="compact-actions">${terminal ? "" : actionButton("推进状态", "updateWithdrawal", "withdrawal", item.id, "primary")}</div></article>`;
    }).join("") : '<div class="empty-state">当前没有提现请求。</div>';
  }

  function renderCompanionAppeals(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const decision = item.status !== "pending"
        ? ""
        : item.independentReviewEligible
          ? actionButton("独立复核申诉", "resolveCompanionAppeal", "companionAppeal", item.id, "primary")
          : '<button class="button small quiet" type="button" disabled title="你创建了原账号处置，必须由另一名授权人员独立复核">不可复核自己的处置</button>';
      const independence = item.status === "pending" && !item.independentReviewEligible
        ? '<span class="error-state">你是原处置人，服务端已禁止同人复核</span>'
        : '<span>原处置与申诉复核职责分离</span>';
      return `<article class="compact-item ${item.overdue ? "attention" : ""}"><div class="compact-item-head"><h3>${escapeHtml(item.companion?.name || maskId(item.companionId))} · 申诉 ${escapeHtml(maskId(item.id))}</h3>${statusPill(item.overdue ? "overdue" : item.status)}</div><p>${escapeHtml(item.statement)}</p><div class="compact-meta"><span>${escapeHtml(item.evidenceReferences?.length || 0)} 份证据</span><span>提交 ${escapeHtml(formatTime(item.createdAt))}</span><span>处理时限 ${escapeHtml(formatTime(item.reviewDueAt))}</span>${independence}</div><div class="compact-actions">${decision}</div></article>`;
    }).join("") : '<div class="empty-state">当前没有待处理陪伴者申诉。</div>';
  }

  function isFreshVoiceIntroRead(read, assetReference) {
    const expiresAt = new Date(read?.expiresAt || "").getTime();
    return Boolean(
      read?.url
      && read.reviewedAssetReference === assetReference
      && Number.isFinite(expiresAt)
      && expiresAt > Date.now()
    );
  }

  function renderVoiceIntros(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const assetReference = item.assetReference || item.voiceIntroAssetRef;
      const companionId = item.companionId || item.id;
      const read = state.voiceIntroReads.get(String(companionId));
      const freshRead = isFreshVoiceIntroRead(read, assetReference);
      const preview = freshRead
        ? `<a class="button small quiet" href="${escapeHtml(read.url)}" target="_blank" rel="noopener noreferrer">打开短期试听 ↗</a><span class="masked-id">证据 ${escapeHtml(String(read.assetReferenceHash || "").slice(0, 12))}… · ${escapeHtml(formatTime(read.expiresAt))} 失效</span>`
        : read?.error
          ? `<span class="error-state">No-Go：${escapeHtml(read.error)}</span>`
          : '<span class="masked-id">批准前必须获取当前版本的短期试听地址</span>';
      const readButton = state.user?.role === "admin"
        ? `<button class="button small quiet" type="button" data-admin-action="readVoiceIntro" data-kind="voiceIntro" data-id="${escapeHtml(companionId)}">获取短期试听</button>`
        : '<span class="masked-id">仅管理员可试听与审批</span>';
      const approve = state.user?.role !== "admin"
        ? ""
        : freshRead
          ? actionButton("批准", "approveVoiceIntro", "voiceIntro", companionId, "primary")
          : '<button class="button small primary" type="button" disabled title="先获取并打开当前版本的短期试听地址">批准（No-Go）</button>';
      const reject = state.user?.role === "admin"
        ? actionButton("拒绝", "rejectVoiceIntro", "voiceIntro", companionId, "danger")
        : "";
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.companionName || item.name || maskId(companionId))}</h3>${statusPill(item.status || item.voiceIntroStatus)}</div><p>时长 ${escapeHtml(item.durationSeconds || item.voiceIntroDurationSeconds || "—")} 秒 · 资产 ${escapeHtml(maskReference(assetReference))}</p><div class="compact-meta"><span>提交 ${escapeHtml(formatTime(item.submittedAt))}</span><span>所有者 ${escapeHtml(maskId(item.ownerUserId))}</span></div><div class="compact-actions">${preview}${readButton}${approve}${reject}</div></article>`;
    }).join("") : '<div class="empty-state">当前没有待审语音介绍。</div>';
  }

  function renderAccountAppeals(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const action = item.action || {};
      const evidence = action.evidence || { status: "legacyUnavailable" };
      const assignedToMe = item.assignedToUserId === state.user?.id;
      const pending = item.status === "pending";
      const canClaim = pending && !item.assignedToUserId && item.independentReviewEligible;
      const canResolve = pending && assignedToMe && item.independentReviewEligible;
      const assignment = item.assignedToUserId
        ? (assignedToMe ? "已由我认领" : `已分派 ${maskId(item.assignedToUserId)}`)
        : "尚未认领";
      const independence = item.independentReviewEligible
        ? "当前人员符合独立复核要求"
        : "当前人员是原处置人，禁止处理";
      const actions = [
        canClaim ? actionButton("认领独立复核", "claimAccountAppeal", "accountAppeal", item.id, "primary") : "",
        canResolve ? actionButton("提交复核结论", "resolveAccountAppeal", "accountAppeal", item.id, "warn") : ""
      ].filter(Boolean).join("");
      const resolution = item.resolution
        ? `<p><strong>复核结论：</strong>${escapeHtml(item.resolution)}</p>`
        : "";
      const evidenceChain = evidence.status === "available"
        ? `<p><strong>受控证据链：</strong>${escapeHtml(evidence.sourceType)} · 来源 ${escapeHtml(evidence.sourceReference)} · 证据 ${escapeHtml(evidence.evidenceReference)}</p><div class="compact-meta"><span class="masked-id">SHA-256 ${escapeHtml(evidence.evidenceDigest)}</span><span>仅显示引用与摘要，不显示原始敏感证据</span></div>`
        : evidence.status === "anonymized"
          ? `<p class="masked-id"><strong>受控证据链：</strong>已按留存政策匿名化 · ${escapeHtml(formatTime(evidence.anonymizedAt))}</p>`
          : '<p class="error-state"><strong>受控证据链：</strong>历史处置未形成新证据快照，不得伪造补录。</p>';
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(action.kind === "ban" ? "账号封禁申诉" : "账号限制申诉")} · 用户 ${escapeHtml(maskId(item.userId))}</h3>${statusPill(item.status)}</div><p><strong>处置理由：</strong>${escapeHtml(action.message || "未返回用户可见理由")}</p>${evidenceChain}<p><strong>用户申诉：</strong>${escapeHtml(item.statement || "未返回申诉说明")}</p>${resolution}<div class="compact-meta"><span>原因码 ${escapeHtml(action.reasonCode || "—")}</span><span>规则 ${escapeHtml(item.policyVersion || action.policyVersion || "—")}</span><span>提交 ${escapeHtml(formatTime(item.createdAt))}</span><span class="${item.overdue ? "error-state" : ""}">复核目标 ${escapeHtml(formatTime(item.reviewDueAt))}${item.overdue ? " · 已超期" : ""}</span></div><div class="compact-meta"><span>${escapeHtml(assignment)}</span><span>${escapeHtml(independence)}</span><span>原处置人 ${escapeHtml(maskId(action.createdById))}</span></div>${actions ? `<div class="compact-actions">${actions}</div>` : ""}</article>`;
    }).join("") : '<div class="empty-state">当前筛选条件下没有账号申诉。</div>';
  }

  async function loadAccountAppeals(page = state.pages.accountAppeals) {
    state.pages.accountAppeals = page;
    const panel = document.querySelector("#accountAppealsPanel");
    const container = document.querySelector("#accountAppealList");
    const pagination = document.querySelector("#accountAppealPagination");
    const canManage = state.user?.role === "admin" && hasCapability("account.manage");
    panel?.classList.toggle("hidden", !canManage);
    if (!canManage) {
      state.records.accountAppeal.clear();
      return;
    }
    setContainerState(container, "loading", "正在读取普通用户账号申诉…");
    pagination.innerHTML = "";
    const status = document.querySelector("#accountAppealStatusFilter").value || "pending";
    try {
      const result = await request(`/admin/account-governance/account-appeals?page=${page}&pageSize=50&status=${encodeURIComponent(status)}`);
      const items = result.items || [];
      setRecords("accountAppeal", items);
      renderAccountAppeals(container, items);
      renderPagination(pagination, result.pagination, (next) => loadAccountAppeals(next));
    } catch (error) {
      state.records.accountAppeal.clear();
      setContainerState(container, "error", error.message || "账号申诉队列加载失败");
    }
  }

  function legalHoldReasonOptions(action, category) {
    const reasons = state.legalHoldPolicy?.ready ? state.legalHoldPolicy.reasons || [] : [];
    return reasons
      .filter((item) => item.actions?.includes(action) && item.categories?.includes(category))
      .map((item) => ({ value: item.code, label: item.code }));
  }

  function renderLegalHoldPolicy(container, policy) {
    if (!policy) {
      container.className = "section-callout danger-callout";
      container.innerHTML = "<strong>政策状态未知</strong><span>未读取到政策门禁，所有保全操作保持关闭。</span>";
      return;
    }
    container.className = `section-callout${policy.ready ? "" : " danger-callout"}`;
    if (!policy.ready) {
      container.innerHTML = `<strong>政策门禁阻断</strong><span>${escapeHtml(policy.blockedReasonCode || "LEGAL_HOLD_POLICY_BLOCKED")} · 外部法律政策、版本、批准引用或原因目录尚未完整配置，当前只读。</span>`;
      return;
    }
    const reasonSummary = (policy.reasons || [])
      .map((item) => `${item.code}（${item.actions.join("/")} · ${item.categories.length} 类）`)
      .join("；");
    container.innerHTML = `<strong>政策 ${escapeHtml(policy.policyVersion)} 已就绪</strong><span>${escapeHtml(reasonSummary || "未配置可用原因")}。批准引用不在工作台回显。</span>`;
  }

  function renderLegalHolds(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const partial = item.partialErasure || {};
      const placementReasons = legalHoldReasonOptions("placement", item.category);
      const releaseReasons = legalHoldReasonOptions("release", item.category);
      const pending = (item.pendingActions || []).map((action) => {
        const reviewButtons = action.canReview ? [
          actionButton("第二人批准", `approveLegalHoldAction:${action.id}`, "legalHold", item.id, "primary"),
          actionButton("第二人拒绝", `rejectLegalHoldAction:${action.id}`, "legalHold", item.id, "warn")
        ].join("") : `<span class="masked-note">${action.requestedById === state.user?.id ? "等待其他管理员复核" : "当前不可复核"}</span>`;
        return `<div class="stack-row"><span>${escapeHtml(action.action === "placement" ? "保全申请" : "释放申请")} · ${escapeHtml(action.reasonCode)} · 申请人 ${escapeHtml(maskId(action.requestedById))} · ${escapeHtml(formatTime(action.requestedAt))}</span><strong>${statusPill(action.status)}</strong></div><div class="compact-actions">${reviewButtons}</div>`;
      }).join("");
      const requestPlacement = item.capabilities?.canRequestPlacement && placementReasons.length
        ? actionButton("申请保全", "requestLegalHoldPlacement", "legalHold", item.id, "warn")
        : "";
      const requestRelease = item.capabilities?.canRequestRelease && releaseReasons.length && item.legalHold?.id
        ? actionButton("申请释放", "requestLegalHoldRelease", "legalHold", item.id, "warn")
        : "";
      const historyButton = `<button class="button small quiet" type="button" data-legal-hold-history="${escapeHtml(item.id)}">查看完整操作历史</button>`;
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(retentionCategoryLabels[item.category] || item.category)} · ${escapeHtml(maskId(item.id))}</h3>${statusPill(item.holdState)}${item.disposalBarrierActive ? statusPill("held") : ""}</div><p>主体 ${escapeHtml(maskId(item.subjectUserId))} · 注销 ${escapeHtml(maskId(item.deletionRequestId))} · 处置 ${escapeHtml(item.disposition)}</p><div class="compact-meta"><span>留存截止 ${escapeHtml(formatTime(item.retentionEndsAt))}</span><span>完成处置 ${escapeHtml(formatTime(item.expiryProcessedAt))}</span><span>阶段 ${escapeHtml(partial.phase || "未开始")} · 已处理 ${escapeHtml(partial.erasedRecordCount || 0)}</span><span>游标 ${escapeHtml(maskReference(partial.cursor) || "—")}</span></div>${pending ? `<div class="stack-list">${pending}</div>` : ""}<div class="compact-actions">${requestPlacement}${requestRelease}${historyButton}</div></article>`;
    }).join("") : '<div class="empty-state">当前筛选范围没有留存记录。</div>';
  }

  async function loadLegalHolds(page = state.pages.legalHolds) {
    state.pages.legalHolds = page;
    const panel = document.querySelector("#legalHoldPanel");
    const policyContainer = document.querySelector("#legalHoldPolicyState");
    const container = document.querySelector("#legalHoldList");
    const pagination = document.querySelector("#legalHoldPagination");
    const isAdmin = state.user?.role === "admin";
    panel?.classList.toggle("hidden", !isAdmin);
    if (!isAdmin) {
      state.records.legalHold.clear();
      state.legalHoldPolicy = null;
      return;
    }
    setContainerState(container, "loading", "正在读取法定留存与保全屏障…");
    pagination.innerHTML = "";
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    const holdState = document.querySelector("#legalHoldStateFilter").value;
    const expiryState = document.querySelector("#legalHoldExpiryStateFilter").value;
    const category = document.querySelector("#legalHoldCategoryFilter").value;
    if (holdState) query.set("holdState", holdState);
    if (expiryState) query.set("expiryState", expiryState);
    if (category) query.set("category", category);
    const [policyResult, recordsResult] = await Promise.allSettled([
      request("/admin/data-retention/legal-hold-policy"),
      request(`/admin/data-retention/records?${query.toString()}`)
    ]);
    if (policyResult.status === "fulfilled") {
      state.legalHoldPolicy = policyResult.value;
      renderLegalHoldPolicy(policyContainer, policyResult.value);
    } else {
      state.legalHoldPolicy = null;
      renderLegalHoldPolicy(policyContainer, null);
      showTrace(policyResult.reason);
    }
    if (recordsResult.status === "fulfilled") {
      const items = recordsResult.value.items || [];
      setRecords("legalHold", items);
      renderLegalHolds(container, items);
      renderPagination(pagination, recordsResult.value.pagination, (next) => loadLegalHolds(next));
    } else {
      state.records.legalHold.clear();
      setContainerState(container, "error", recordsResult.reason.message || "法务保全记录加载失败");
      showTrace(recordsResult.reason);
    }
  }

  function renderLegalHoldHistory(container, result) {
    const holds = new Map((result.holds || []).map((hold) => [hold.id, hold]));
    container.innerHTML = (result.items || []).length ? result.items.map((action) => {
      const hold = action.legalHoldId ? holds.get(action.legalHoldId) : (result.holds || []).find((item) => item.placementActionId === action.id);
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(action.action === "placement" ? "保全" : "释放")} · ${escapeHtml(maskId(action.id))}</h3>${statusPill(action.status)}</div><p>${escapeHtml(action.reasonCode)} · 政策 ${escapeHtml(action.policyVersion)}${action.policySnapshotCurrent ? "（当前）" : "（已变更）"}</p><div class="compact-meta"><span>申请人 ${escapeHtml(maskId(action.requestedById))}</span><span>${escapeHtml(formatTime(action.requestedAt))}</span><span>依据 ${escapeHtml(action.authorityReferenceMasked || "—")}</span><span>决定人 ${escapeHtml(maskId(action.decidedById))}</span><span>决定 ${escapeHtml(formatTime(action.decidedAt))}</span><span>决定引用 ${escapeHtml(action.decisionReferenceMasked || "—")}</span>${hold ? `<span>保全 ${escapeHtml(maskId(hold.id))} · ${escapeHtml(statusLabel(hold.state))}</span>` : ""}</div></article>`;
    }).join("") : '<div class="empty-state">该留存记录尚无保全操作历史。</div>';
  }

  async function loadLegalHoldHistory(retentionRecordId, page = 1) {
    const panel = document.querySelector("#legalHoldHistoryPanel");
    const title = document.querySelector("#legalHoldHistoryTitle");
    const container = document.querySelector("#legalHoldHistoryList");
    const pagination = document.querySelector("#legalHoldHistoryPagination");
    state.legalHoldHistory = { retentionRecordId, page };
    panel.classList.remove("hidden");
    title.textContent = `保全操作历史 · ${maskId(retentionRecordId)}`;
    setContainerState(container, "loading", "正在读取有界操作历史…");
    pagination.innerHTML = "";
    try {
      const result = await request(`/admin/data-retention/records/${encodeURIComponent(retentionRecordId)}/legal-holds?page=${page}&pageSize=50`);
      renderLegalHoldHistory(container, result);
      renderPagination(pagination, result.pagination, (next) => loadLegalHoldHistory(retentionRecordId, next));
    } catch (error) {
      setContainerState(container, "error", error.message || "保全操作历史加载失败");
      showTrace(error);
    }
  }

  function closeLegalHoldHistory() {
    state.legalHoldHistory = { retentionRecordId: "", page: 1 };
    document.querySelector("#legalHoldHistoryPanel")?.classList.add("hidden");
    document.querySelector("#legalHoldHistoryList").innerHTML = "";
    document.querySelector("#legalHoldHistoryPagination").innerHTML = "";
  }

  function openLegalHoldRequest(item, action) {
    const reasons = legalHoldReasonOptions(action, item.category);
    if (!state.legalHoldPolicy?.ready || reasons.length === 0) {
      showToast("当前政策没有为该分类开放此操作。", true);
      return;
    }
    const placement = action === "placement";
    openAction({
      title: placement ? "申请法定留存保全" : "申请释放法定留存保全",
      description: placement
        ? "提交后会立即阻断该留存记录的到期处置，并等待另一名管理员批准。外部依据只填写受控、非秘密引用。"
        : "提交释放不会立即解除阻断；另一名管理员批准后，已到期记录才会恢复有界处置。",
      resource: `retention:${item.id}/${action}`,
      risk: placement ? "LEGAL HOLD PLACEMENT" : "LEGAL HOLD RELEASE",
      reasonMinLength: 10,
      fields: [
        { name: "reasonCode", label: "受控原因代码", type: "select", options: reasons },
        { name: "authorityReference", label: "外部权威依据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*", help: "只填受控系统引用，不粘贴文件或案件正文。" }
      ],
      execute: (values, reason, operationId) => postJson(
        placement
          ? `/admin/data-retention/records/${encodeURIComponent(item.id)}/legal-hold-placement-requests`
          : `/admin/data-retention/legal-holds/${encodeURIComponent(item.legalHold.id)}/release-requests`,
        { reasonCode: values.reasonCode, authorityReference: values.authorityReference, clientRequestId: operationId },
        reason,
        operationId
      )
    });
  }

  function openLegalHoldReview(item, actionId, decision) {
    const pending = (item.pendingActions || []).find((action) => action.id === actionId);
    if (!pending?.canReview) {
      showToast("该申请不再可由当前管理员复核。", true);
      return;
    }
    const approve = decision === "approve";
    openAction({
      title: approve ? "第二人批准法务保全操作" : "第二人拒绝法务保全操作",
      description: `${pending.action === "placement" ? "保全" : "释放"}申请由 ${maskId(pending.requestedById)} 提交。服务端会再次校验申请人不同、政策快照仍有效以及保全状态未被其他副本改变。`,
      resource: `legal-hold-action:${pending.id}/${decision}`,
      risk: approve ? "INDEPENDENT LEGAL HOLD APPROVAL" : "INDEPENDENT LEGAL HOLD REJECTION",
      reasonMinLength: 10,
      fields: [
        { name: "decisionReference", label: "独立决定依据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" },
        ...(approve ? [] : [{
          name: "decisionReasonCode",
          label: "拒绝原因代码",
          type: "select",
          options: ["AUTHORITY_NOT_VERIFIED", "DUPLICATE_OR_SUPERSEDED", "POLICY_SCOPE_MISMATCH", "REQUEST_EVIDENCE_INVALID", "RETENTION_RECORD_MISMATCH"]
        }])
      ],
      execute: (values, reason, operationId) => postJson(
        `/admin/data-retention/legal-hold-actions/${encodeURIComponent(pending.id)}/${approve ? "approvals" : "rejections"}`,
        approve
          ? { decisionReference: values.decisionReference }
          : { decisionReference: values.decisionReference, decisionReasonCode: values.decisionReasonCode },
        reason,
        operationId
      )
    });
  }

  async function loadAccounts(
    page = state.pages.users,
    deletionPage = state.pages.deletions,
    dataRightsPage = state.pages.dataRights,
    dataRightsClaimablePage = state.pages.dataRightsClaimable
  ) {
    state.pages.users = page;
    state.pages.deletions = deletionPage;
    state.pages.dataRights = dataRightsPage;
    state.pages.dataRightsClaimable = dataRightsClaimablePage;
    const userContainer = document.querySelector("#userList");
    const deletionContainer = document.querySelector("#deletionList");
    const dataRightsContainer = document.querySelector("#dataRightsList");
    const dataRightsClaimablePanel = document.querySelector("#dataRightsClaimablePanel");
    const dataRightsClaimableContainer = document.querySelector("#dataRightsClaimableList");
    const userPagination = document.querySelector("#userPagination");
    const deletionPagination = document.querySelector("#deletionPagination");
    const dataRightsPagination = document.querySelector("#dataRightsPagination");
    const dataRightsClaimablePagination = document.querySelector("#dataRightsClaimablePagination");
    const canManageAccounts = hasCapability("account.manage");
    const canReadDeletions = hasCapability("account.manage");
    const canManageDataRights = hasCapability("data-rights.manage.all")
      || hasCapability("data-rights.assigned.manage");
    const canReadClaimableDataRights = hasCapability("data-rights.claimable-summary.read");
    if (canManageDataRights || canReadClaimableDataRights) {
      state.records.dataRight.clear();
    }
    userContainer.closest(".panel")?.classList.toggle("hidden", !canManageAccounts);
    deletionContainer.closest(".panel")?.classList.toggle("hidden", !canReadDeletions);
    dataRightsContainer.closest(".panel")?.classList.toggle("hidden", !canManageDataRights);
    dataRightsClaimablePanel?.classList.toggle("hidden", !canReadClaimableDataRights);
    if (canManageAccounts) setContainerState(userContainer, "loading", "正在读取脱敏账号列表…");
    if (canReadDeletions) setContainerState(deletionContainer, "loading", "正在读取注销结算队列…");
    if (canManageDataRights) setContainerState(dataRightsContainer, "loading", "正在读取数据权利请求…");
    if (canReadClaimableDataRights) {
      setContainerState(dataRightsClaimableContainer, "loading", "正在读取匿名待认领摘要…");
    }
    userPagination.innerHTML = "";
    deletionPagination.innerHTML = "";
    dataRightsPagination.innerHTML = "";
    dataRightsClaimablePagination.innerHTML = "";
    const role = document.querySelector("#userRoleFilter").value;
    const accountStatus = document.querySelector("#userStatusFilter").value;
    const keyword = document.querySelector("#userKeyword").value.trim();
    const deletionStatus = document.querySelector("#deletionStatusFilter").value;
    const dataRightsStatus = document.querySelector("#dataRightsStatusFilter").value;
    const dataRightsClaimableStatus = document.querySelector("#dataRightsClaimableStatusFilter").value;
    const userQuery = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (role) userQuery.set("role", role);
    if (accountStatus) userQuery.set("accountStatus", accountStatus);
    if (keyword) userQuery.set("keyword", keyword);
    const deletionQuery = new URLSearchParams({ page: String(deletionPage), pageSize: "50" });
    if (deletionStatus) deletionQuery.set("status", deletionStatus);
    const results = await Promise.allSettled([
      canManageAccounts
        ? request(`/admin/operations/users?${userQuery.toString()}`)
        : Promise.resolve(null),
      canReadDeletions
        ? request(`/admin/account-deletions?${deletionQuery.toString()}`)
        : Promise.resolve(null),
      canManageDataRights
        ? request(`/admin/account-governance/data-rights?page=${dataRightsPage}&pageSize=50${dataRightsStatus ? `&status=${encodeURIComponent(dataRightsStatus)}` : ""}`)
        : Promise.resolve(null),
      canReadClaimableDataRights
        ? request(`/admin/account-governance/data-rights/claimable?page=${dataRightsClaimablePage}&pageSize=50${dataRightsClaimableStatus ? `&status=${encodeURIComponent(dataRightsClaimableStatus)}` : ""}`)
        : Promise.resolve(null)
    ]);
    if (canManageAccounts && results[0].status === "fulfilled") {
      const items = results[0].value.items || [];
      setRecords("user", items);
      userContainer.innerHTML = items.length ? items.map((item) => {
        const nextStatus = item.accountStatus === "active" ? "restricted" : "active";
        return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.displayName || "未设置名称")} · ${escapeHtml(item.phoneMasked || "无手机号")}</h3>${statusPill(item.accountStatus)}</div><p>${escapeHtml(item.role)} · ${item.isVerified ? "实名已核验" : "实名未核验"} · 安全分 ${escapeHtml(item.safetyScore ?? "—")}</p><div class="compact-meta"><span class="masked-id">${escapeHtml(maskId(item.id))}</span><span>${escapeHtml(item.counts?.orders || 0)} 个订单</span><span>${escapeHtml(item.counts?.supportTickets || 0)} 个工单</span></div><div class="compact-actions">${actionButton(nextStatus === "active" ? "恢复账号" : "限制账号", "updateAccountStatus", "user", item.id, nextStatus === "active" ? "primary" : "warn")}${actionButton(item.isVerified ? "提交撤销实名复核" : "提交实名核验复核", "updateUserVerification", "user", item.id, item.isVerified ? "warn" : "primary")}</div></article>`;
      }).join("") : '<div class="empty-state">没有符合条件的账号。</div>';
      renderPagination(userPagination, results[0].value.pagination, (next) => loadAccounts(next, state.pages.deletions, state.pages.dataRights, state.pages.dataRightsClaimable));
    } else if (canManageAccounts) {
      setContainerState(userContainer, "error", results[0].reason.message || "账号列表加载失败");
    }
    if (canReadDeletions && results[1].status === "fulfilled") {
      const items = results[1].value.items || [];
      setRecords("deletion", items);
      renderDeletions(deletionContainer, items);
      renderPagination(
        deletionPagination,
        results[1].value.pagination,
        (next) => loadAccounts(state.pages.users, next, state.pages.dataRights, state.pages.dataRightsClaimable)
      );
    } else if (canReadDeletions) {
      setContainerState(deletionContainer, "error", results[1].reason.message || "注销队列加载失败");
    }
    if (canManageDataRights && results[2].status === "fulfilled") {
      const items = results[2].value.items || [];
      setRecords("dataRight", items);
      renderDataRights(dataRightsContainer, items);
      renderPagination(
        dataRightsPagination,
        results[2].value.pagination,
        (next) => loadAccounts(state.pages.users, state.pages.deletions, next, state.pages.dataRightsClaimable)
      );
    } else if (canManageDataRights) {
      setContainerState(dataRightsContainer, "error", results[2].reason.message || "数据权利请求加载失败");
    }
    if (canReadClaimableDataRights && results[3].status === "fulfilled") {
      const items = results[3].value.items || [];
      setRecords("dataRight", [
        ...state.records.dataRight.values(),
        ...items.map((item) => ({ ...item, claimableSummary: true }))
      ]);
      renderClaimableDataRights(dataRightsClaimableContainer, items);
      renderPagination(
        dataRightsClaimablePagination,
        results[3].value.pagination,
        (next) => loadAccounts(state.pages.users, state.pages.deletions, state.pages.dataRights, next)
      );
    } else if (canReadClaimableDataRights) {
      setContainerState(
        dataRightsClaimableContainer,
        "error",
        results[3].reason.message || "待认领数据权利摘要加载失败"
      );
    }
    const failed = results.find((result) => result.status === "rejected");
    if (failed) showTrace(failed.reason);
  }

  const customerAdultEligibilityMethodLabels = {
    externalProvider: "平台接入的外部核验服务",
    governmentNetworkIdentity: "国家网络身份认证",
    secureManualReview: "平台安全人工核验"
  };

  function renderCustomerAdultEligibility(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const subject = item.subject || {};
      const submittedByCurrentOperator = item.submittedById === state.user?.id;
      const actions = item.status === "pending" && !submittedByCurrentOperator
        ? [
            actionButton("核验为成年", "markCustomerAdult", "customerAdultEligibility", item.id, "primary"),
            actionButton("标记不满足资格", "markCustomerIneligible", "customerAdultEligibility", item.id, "danger")
          ].join("")
        : item.status === "pending"
          ? '<button class="button small danger" type="button" disabled title="提交者不能复核自己的记录">必须由另一名人员复核</button>'
          : "";
      const reviewed = item.reviewedBy
        ? `<span>复核人 ${escapeHtml(item.reviewedBy.displayName || maskId(item.reviewedBy.id))}</span>`
        : "";
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(subject.displayName || "未设置名称")} · ${escapeHtml(maskId(item.userId))}</h3>${statusPill(item.status)}</div><p><strong>核验方式：</strong>${escapeHtml(customerAdultEligibilityMethodLabels[item.verificationMethod] || item.verificationMethod || "—")}</p><div class="json-preview"><strong>受控证据引用：</strong>${escapeHtml(item.evidenceReference || "未返回")}<br><span class="masked-id">仅允许不透明业务引用；不得在本后台粘贴或保存原始证件资料</span></div><div class="compact-meta"><span>${escapeHtml(subject.role || "user")} · 账号 ${escapeHtml(subject.accountStatus || "—")}</span><span>提交 ${escapeHtml(formatTime(item.submittedAt))}</span>${reviewed}${item.verifiedAt ? `<span>复核 ${escapeHtml(formatTime(item.verifiedAt))}</span>` : ""}${item.validUntil ? `<span>有效至 ${escapeHtml(formatTime(item.validUntil))}</span>` : ""}</div>${item.reviewReason ? `<p><strong>复核说明：</strong>${escapeHtml(item.reviewReason)}</p>` : ""}<div class="compact-actions">${actions}</div></article>`;
    }).join("") : '<div class="empty-state">当前筛选条件下没有用户成年资格记录。</div>';
  }

  async function loadCustomerAdultEligibility(page = state.pages.customerAdultEligibility) {
    const panel = document.querySelector("#customerAdultEligibilityPanel");
    const container = document.querySelector("#customerAdultEligibilityList");
    const pagination = document.querySelector("#customerAdultEligibilityPagination");
    const allowed = hasCapability("customer.adult-eligibility.manage");
    panel?.classList.toggle("hidden", !allowed);
    state.records.customerAdultEligibility.clear();
    if (!allowed) return;
    state.pages.customerAdultEligibility = page;
    setContainerState(container, "loading", "正在读取用户成年资格独立复核队列…");
    pagination.innerHTML = "";
    const status = document.querySelector("#customerAdultEligibilityStatusFilter").value || "pending";
    try {
      const data = await request(`/admin/customer-adult-eligibility?status=${encodeURIComponent(status)}&page=${page}&pageSize=50`);
      const items = data.items || [];
      setRecords("customerAdultEligibility", items);
      renderCustomerAdultEligibility(container, items);
      renderPagination(pagination, data.pagination, (next) => loadCustomerAdultEligibility(next));
    } catch (error) {
      setContainerState(container, "error", error.message || "用户成年资格复核队列加载失败");
      showTrace(error);
    }
  }

  function renderDataRights(container, items) {
    const typeLabels = {
      access: "访问",
      export: "导出",
      correction: "更正",
      deletion: "删除"
    };
    container.innerHTML = items.length ? items.map((item) => {
      const actionable = ["submitted", "inReview"].includes(item.status);
      const isCurrentAssignee = item.handledById === state.user?.id;
      const canTakeOver = hasCapability("data-rights.manage.all")
        && actionable
        && !isCurrentAssignee;
      const actions = [
        canTakeOver
          ? actionButton(item.handledById ? "接管请求" : "认领请求", "claimDataRight", "dataRight", item.id, "warn")
          : "",
        actionable && isCurrentAssignee
          ? actionButton("更新请求状态", "transitionDataRight", "dataRight", item.id, "primary")
          : ""
      ].join("");
      const followUps = (item.followUps || []).map((followUp) =>
        `<div class="json-preview">平台要求：${escapeHtml(followUp.requestedInformation || "补充信息")}<br>用户补件 ${escapeHtml(formatTime(followUp.createdAt))} · ${escapeHtml(followUp.statement)}</div>`
      ).join("");
      return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(typeLabels[item.type] || item.type)}请求 · ${escapeHtml(maskId(item.id))}</h3>${statusPill(item.status)}</div><p>${escapeHtml(item.description)}</p><div class="compact-meta"><span>用户 ${escapeHtml(maskId(item.userId))}</span><span>受理人 ${escapeHtml(maskId(item.handledById))}</span><span>申请 ${escapeHtml(formatTime(item.createdAt))}</span><span>结论 ${escapeHtml(item.statusReason || "尚未填写")}</span><span>补件 ${escapeHtml(item.followUps?.length || 0)} 条</span><span>完成证据 ${escapeHtml(maskReference(item.resolutionEvidenceReference))}</span></div>${followUps}<div class="compact-actions">${actions}</div></article>`;
    }).join("") : '<div class="empty-state">当前筛选下没有数据权利请求。</div>';
  }

  function renderClaimableDataRights(container, items) {
    const typeLabels = {
      access: "访问",
      export: "导出",
      correction: "更正",
      deletion: "删除"
    };
    container.innerHTML = items.length ? items.map((item) => {
      const action = hasCapability("data-rights.claim.self")
        ? actionButton("认领后查看", "claimDataRight", "dataRight", item.id, "primary")
        : "";
      return `<article class="compact-item attention"><div class="compact-item-head"><h3>${escapeHtml(typeLabels[item.type] || item.type)}请求 · ${escapeHtml(maskId(item.id))}</h3>${statusPill(item.status)}</div><p>描述、用户标识与补件内容在认领成功前保持隐藏。</p><div class="compact-meta"><span>申请 ${escapeHtml(formatTime(item.createdAt))}</span><span>更新 ${escapeHtml(formatTime(item.updatedAt))}</span></div><div class="compact-actions">${action}</div></article>`;
    }).join("") : '<div class="empty-state">当前没有可认领的数据权利摘要。</div>';
  }

  function renderDeletions(container, items) {
    container.innerHTML = items.length ? items.map((item) => {
      const canInspectSettlement = ["finance", "admin"].includes(state.user?.role);
      const canStartDeletion = hasCapability("account.manage");
      const canCompleteDeletion = hasCapability("account.manage");
      const settlement = state.deletionSettlements.get(item.id);
      const blockingObligations = settlement?.blockingObligations;
      const retentionPolicy = settlement?.retentionPolicy;
      const execution = item.execution || { status: "idle", phase: "awaiting_second_review" };
      const completionReady = Boolean(
        settlement
        && blockingObligations?.clear === true
        && retentionPolicy?.approved === true
      );
      const settlementProgress = settlement?.pagination
        ? `已加载 ${settlement.orders?.length || 0} / ${settlement.pagination.total || 0} 个关联订单`
        : "";
      const settlementHasMore = Boolean(
        settlement?.pagination
        && settlement.pagination.page < settlement.pagination.totalPages
      );
      const settlementHtml = settlement && canInspectSettlement ? `<div class="json-preview">${escapeHtml(safePreview({
        completionGate: {
          activeObligations: blockingObligations,
          retentionPolicy: {
            version: retentionPolicy?.version,
            approved: retentionPolicy?.approved,
            approvalReference: maskReference(retentionPolicy?.approvalReference)
          }
        },
        orderProgress: settlementProgress,
        orders: settlement.orders?.map((order) => ({
          id: maskId(order.id),
          relationship: order.relationship === "companion" ? "陪伴者履约侧" : "用户付款侧",
          status: order.status,
          amount: money(order.amountCents),
          payment: order.payment ? { status: order.payment.status, reference: maskReference(order.payment.outTradeNo) } : null,
          refund: order.refund ? { status: order.refund.status, reference: maskReference(order.refund.outRefundNo) } : null
        }))
      }))}</div><div class="compact-actions">${(settlement.orders || []).map((order) => [
        order.relationship !== "companion" && order.payment && order.payment.status !== "success" ? actionButton("同步支付", `syncDeletionPayment:${order.id}`, "deletion", item.id) : "",
        order.relationship !== "companion" && order.refund && ["pending", "processing", "failed"].includes(order.refund.status) ? actionButton("同步退款", `syncDeletionRefund:${order.id}`, "deletion", item.id) : "",
        order.relationship !== "companion" && order.payment?.status === "success" && !order.refund ? actionButton("发起结算退款", `initiateDeletionRefund:${order.id}`, "deletion", item.id, "warn") : ""
      ].join("")).join("")}${settlementHasMore ? `<button class="button small quiet" type="button" data-deletion-settlement-more="${escapeHtml(item.id)}" ${settlement.ordersLoadingMore ? "disabled" : ""}>${settlement.ordersLoadingMore ? "正在加载…" : "加载更多关联订单"}</button>` : ""}</div>${settlement.ordersLoadMoreError ? `<div class="error-state"><p>${escapeHtml(settlement.ordersLoadMoreError)}</p><button class="button small quiet" type="button" data-deletion-settlement-more="${escapeHtml(item.id)}">重试加载更多</button></div>` : ""}` : "";
      const startButton = item.status === "pending" && canStartDeletion && completionReady
        ? actionButton("开始注销结算", "startDeletion", "deletion", item.id, "warn")
        : item.status === "pending" && canStartDeletion
          ? `<button class="button small warn" type="button" disabled title="须先检查并清零用户与陪伴者全部义务，且留存策略取得外部法律批准">开始注销结算（No-Go）</button>`
          : "";
      const inspectButton = canInspectSettlement
        ? `<button class="button small quiet" type="button" data-admin-action="inspectDeletion" data-kind="deletion" data-id="${escapeHtml(item.id)}">检查全部注销门禁</button>`
        : "";
      const completeButton = item.status === "processing" && execution.status === "idle" && canCompleteDeletion && completionReady
        ? actionButton("批准并开始分批擦除", "completeDeletion", "deletion", item.id, "danger")
        : item.status === "processing" && execution.status === "idle" && canCompleteDeletion
          ? `<button class="button small danger" type="button" disabled title="须先检查并清零全部义务，且留存策略取得外部法律批准">批准擦除（No-Go）</button>`
          : "";
      const retryButton = item.status === "processing" && execution.status === "failed" && canCompleteDeletion
        ? actionButton("受控重试当前阶段", "retryDeletion", "deletion", item.id, "warn")
        : "";
      const executionHtml = item.status === "processing" && execution.status !== "idle"
        ? `<div class="json-preview">${escapeHtml(safePreview({
            erasureExecution: {
              status: execution.status,
              phase: execution.phase,
              processedCount: execution.processedCount,
              attemptCount: execution.attemptCount,
              failureCount: execution.failureCount,
              nextAttemptAt: formatTime(execution.nextAttemptAt),
              lastErrorCode: execution.lastErrorCode,
              failedAt: formatTime(execution.failedAt)
            },
            completionTruth: "只有最终后置条件、留存台账和封禁同事务提交后才算完成"
          }))}</div>`
        : "";
      return `<article class="compact-item"><div class="compact-item-head"><h3>注销 ${escapeHtml(maskId(item.id))}</h3>${statusPill(item.status)}${statusPill(execution.status)}</div><p>用户 ${escapeHtml(maskId(item.userId))} · ${escapeHtml(item.note || "无处理备注")}</p><div class="compact-meta"><span>申请 ${escapeHtml(formatTime(item.createdAt))}</span><span>账号 ${escapeHtml(item.user?.accountStatus || "—")}</span><span>擦除阶段 ${escapeHtml(execution.phase || "—")}</span></div><div class="compact-actions">${startButton}${inspectButton}${completeButton}${retryButton}</div>${executionHtml}${settlementHtml}</article>`;
    }).join("") : '<div class="empty-state">当前没有待处理注销申请。</div>';
  }

  async function loadAudit(page = state.pages.audit) {
    state.pages.audit = page;
    const container = document.querySelector("#auditList");
    const pagination = document.querySelector("#auditPagination");
    setContainerState(container, "loading", "正在读取脱敏运营审计…");
    pagination.innerHTML = "";
    const action = document.querySelector("#auditActionFilter").value.trim();
    const resourceType = document.querySelector("#auditResourceFilter").value.trim();
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (action) query.set("action", action);
    if (resourceType) query.set("resourceType", resourceType);
    try {
      if (!state.context) state.context = await request("/admin/operations/context");
      renderPermissions();
      const data = await request(`/admin/operations/audit-logs?${query.toString()}`);
      container.innerHTML = data.items?.length ? data.items.map((item) => `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.action)}</h3><span class="masked-id">${escapeHtml(formatTime(item.createdAt))}</span></div><p>${escapeHtml(item.resourceType)} · ${escapeHtml(maskId(item.resourceId))} · actor ${escapeHtml(maskId(item.actorId))}</p>${item.metadata ? `<pre class="json-preview">${escapeHtml(safePreview(item.metadata))}</pre>` : ""}</article>`).join("") : '<div class="empty-state">没有符合条件的审计记录。</div>';
      renderPagination(pagination, data.pagination, (next) => loadAudit(next));
    } catch (error) {
      setContainerState(container, "error", `审计记录加载失败：${error.message}`);
      showTrace(error);
    }
  }

  const staffAssignmentLabels = {
    supportTickets: "客服工单",
    refunds: "退款异常",
    paymentDisputes: "支付投诉",
    attendanceReviews: "履约首审",
    attendanceAppeals: "履约申诉",
    userAccountAppeals: "账号申诉",
    dataRightsRequests: "数据权利",
    invoiceRequests: "发票申请",
    companionWithdrawals: "提现复核"
  };

  async function loadStaffCredentials(page = state.pages.staffCredentials) {
    const panel = document.querySelector("#staffOffboardingPanel");
    const container = document.querySelector("#staffCredentialList");
    const pagination = document.querySelector("#staffCredentialPagination");
    const allowed = hasCapability("staff.offboarding.manage");
    panel?.classList.toggle("hidden", !allowed);
    if (!allowed) return;
    state.pages.staffCredentials = page;
    const previousMarkup = container.innerHTML;
    const previousPagination = pagination.innerHTML;
    setContainerState(container, "loading", "正在读取商业后台员工与未结任务归属…");
    pagination.innerHTML = "";
    const status = document.querySelector("#staffCredentialStatusFilter").value;
    const role = document.querySelector("#staffCredentialRoleFilter").value;
    const keyword = document.querySelector("#staffCredentialKeywordFilter").value.trim();
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (status) query.set("status", status);
    if (role) query.set("role", role);
    if (keyword) query.set("keyword", keyword);
    try {
      const data = await request(`/admin/staff?${query.toString()}`);
      setRecords("staffCredential", data.items || []);
      container.innerHTML = data.items?.length ? data.items.map((item) => {
        const assignmentSummary = Object.entries(item.activeAssignments || {})
          .filter(([, count]) => Number(count) > 0)
          .map(([key, count]) => `${staffAssignmentLabels[key] || key} ${count}`)
          .join("、") || "无未结任务";
        const canSuspend = item.status === "active" && item.userId !== state.user?.id;
        const action = canSuspend
          ? actionButton("停权并交接", "suspendStaffCredential", "staffCredential", item.userId, "danger")
          : item.status === "active"
            ? '<button class="button small danger" type="button" disabled title="禁止停用当前登录账号">当前账号不可自停</button>'
            : "";
        const suspension = item.status === "suspended"
          ? `<p>停权原因：${escapeHtml(item.suspensionReason || "—")}</p><div class="compact-meta"><span>停权 ${escapeHtml(formatTime(item.suspendedAt))}</span><span>接任 ${escapeHtml(item.handoffTo?.displayName || maskId(item.handoffTo?.userId))}</span></div>`
          : "";
        return `<article class="compact-item"><div class="compact-item-head"><h3>${escapeHtml(item.displayName || item.username)} · ${escapeHtml(item.username)}</h3>${statusPill(item.status)}</div><p>${escapeHtml(item.role)} · 用户 ${escapeHtml(maskId(item.userId))} · 最近登录 ${escapeHtml(formatTime(item.lastLoginAt))}</p><div class="compact-meta"><span>未结任务 ${escapeHtml(String(item.activeAssignmentTotal || 0))}</span><span>${escapeHtml(assignmentSummary)}</span></div>${suspension}<div class="compact-actions">${action}</div></article>`;
      }).join("") : '<div class="empty-state">当前筛选下没有商业后台员工。</div>';
      renderPagination(pagination, data.pagination, (next) => loadStaffCredentials(next));
    } catch (error) {
      if (previousMarkup) {
        container.innerHTML = `<div class="section-callout danger-callout"><strong>员工目录刷新失败</strong><span>${escapeHtml(error.message)}；以下保留上次成功读取的数据，不代表当前实时状态。</span></div>${previousMarkup}`;
        pagination.innerHTML = previousPagination;
      } else {
        setContainerState(container, "error", `员工停权台账加载失败：${error.message}`);
      }
      showTrace(error);
    }
  }

  function renderPermissions() {
    const container = document.querySelector("#permissionDetails");
    if (!container || !state.context) return;
    const dataScopes = Object.entries(state.context.dataScopes || {})
      .map(([resource, scope]) => `${resource}:${scope}`)
      .join("、");
    const items = [
      ["运营身份", `${state.context.operator?.role || "—"} · ${maskId(state.context.operator?.id)}`],
      ["操作模式", state.mutationsEnabled ? "受控操作已开启" : "默认只读"],
      ["内容审核", "独立 ReviewStaff 身份域"],
      ["可见能力", (state.context.capabilities || []).join("、")],
      ["数据范围", dataScopes || "none"]
    ];
    container.innerHTML = items.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  async function readVoiceIntro(id) {
    const item = getRecord("voiceIntro", id);
    if (!item) {
      showToast("当前语音介绍已经变化，请刷新后重试。", true);
      return;
    }
    const companionId = item.companionId || item.id;
    const assetReference = item.assetReference || item.voiceIntroAssetRef;
    try {
      const data = await request(`/admin/commercial/companion-lifecycle/companions/${encodeURIComponent(companionId)}/voice-intro-read`);
      const url = safeNavigationUrl(data.url);
      if (!url || !data.expiresAt || !data.assetReferenceHash) {
        throw Object.assign(new Error("证据查看器返回了无效的短期地址"), {
          code: "VOICE_INTRO_EVIDENCE_URL_INVALID"
        });
      }
      state.voiceIntroReads.set(String(companionId), {
        ...data,
        url,
        reviewedAssetReference: assetReference
      });
      renderVoiceIntros(document.querySelector("#voiceIntroList"), [...state.records.voiceIntro.values()]);
      showToast("短期试听地址已签发；批准仍会绑定当前资产版本。");
    } catch (error) {
      state.voiceIntroReads.set(String(companionId), {
        error: `${error.code || "VOICE_INTRO_EVIDENCE_UNAVAILABLE"} · ${error.message}`,
        reviewedAssetReference: assetReference
      });
      renderVoiceIntros(document.querySelector("#voiceIntroList"), [...state.records.voiceIntro.values()]);
      showTrace(error);
      showToast("证据查看器不可用，批准已失败关闭。", true);
    }
  }

  async function inspectDeletion(id, page = 1) {
    const container = document.querySelector("#deletionList");
    const existing = state.deletionSettlements.get(id);
    if (page > 1 && (!existing || existing.ordersLoadingMore)) return;
    if (existing) {
      state.deletionSettlements.set(id, {
        ...existing,
        ordersLoadingMore: page > 1,
        ordersLoadMoreError: ""
      });
      renderDeletions(container, [...state.records.deletion.values()]);
    }
    try {
      const data = await request(`/admin/account-deletions/${encodeURIComponent(id)}/settlement?page=${page}&pageSize=50`);
      const priorOrders = page > 1 ? existing?.orders || [] : [];
      const mergedOrders = new Map(priorOrders.map((order) => [String(order.id), order]));
      (data.orders || []).forEach((order) => mergedOrders.set(String(order.id), order));
      state.deletionSettlements.set(id, {
        ...data,
        orders: [...mergedOrders.values()],
        ordersLoadingMore: false,
        ordersLoadMoreError: ""
      });
      renderDeletions(container, [...state.records.deletion.values()]);
    } catch (error) {
      if (page > 1 && existing) {
        state.deletionSettlements.set(id, {
          ...existing,
          ordersLoadingMore: false,
          ordersLoadMoreError: error.message || "更多关联订单暂时无法读取；已加载订单仍保留。"
        });
        renderDeletions(container, [...state.records.deletion.values()]);
      }
      showTrace(error);
      showToast(error.message, true);
    }
  }

  function postJson(path, body, reason, operationId) {
    return mutationRequest(path, "POST", body, reason, operationId);
  }

  function patchJson(path, body, reason, operationId) {
    return mutationRequest(path, "PATCH", body, reason, operationId);
  }

  function recordResource(kind, item) {
    return `${kind}:${item?.id || item?.companionId || "unknown"}`;
  }

  function openCreatePaymentReconciliationRuns() {
    const billDate = document.querySelector("#paymentReconciliationCreateDate")?.value || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
      showToast("请选择需要建立对账的账单日期。", true);
      return;
    }
    openAction({
      title: "建立四类微信日账单对账",
      description: `将为 ${billDate} 建立交易、基本账户、运营账户与手续费账户四类运行。建立运行不代表账单已下载或账实已经核对。`,
      resource: `wechat-bill-date:${billDate}`,
      risk: "FINANCIAL RECONCILIATION",
      execute: (_values, reason, operationId) => postJson(
        "/admin/commercial/payment-reconciliation/runs",
        { billDate },
        reason,
        operationId
      )
    });
  }

  function openReviewMerchantBillImport(item, decision) {
    const approve = decision === "approve";
    openAction({
      title: approve ? "独立批准历史账单并执行对账" : "驳回历史账单导入",
      description: approve
        ? `只会使用 ${item.billDate} 的归一化不可变事实；服务端会重算 SHA、锁住提案并拒绝任何并发追加。原文不会回显。`
        : "驳回保留提案、SHA 和审批轨迹；修正流程后可用同一官方文件重新提交。",
      resource: recordResource("merchant-bill-import", item),
      risk: "SECOND REVIEW · FINANCIAL EVIDENCE",
      reasonMinLength: 10,
      execute: (_values, reason, operationId) => postJson(
        `/admin/commercial/payment-reconciliation/merchant-imports/${encodeURIComponent(item.id)}/reviews`,
        { decision, note: reason },
        reason,
        operationId
      )
    });
  }

  function openCashLedgerClassification(item) {
    openAction({
      title: "提交现金台账账户与账单日分类",
      description: "提交只创建不可变提案，不会立即修改现金台账。账户和日期必须来自受控微信资金账单证据，另一名财务/管理员批准后才生效。",
      resource: recordResource("cash-ledger-entry", item),
      risk: "FINANCIAL CLASSIFICATION",
      reasonMinLength: 10,
      fields: [
        { name: "accountType", label: "微信账户", type: "select", options: [{ value: "BASIC", label: "基本账户" }, { value: "OPERATION", label: "运营账户" }, { value: "FEES", label: "手续费账户" }] },
        { name: "expectedStatementDate", label: "预计出现的单日资金账单", type: "date" },
        { name: "evidenceReference", label: "受控证据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" },
        { name: "evidenceDigestSha256", label: "证据包 SHA-256", minlength: 64, maxlength: 64, pattern: "[A-Fa-f0-9]{64}" }
      ],
      execute: (values, reason, operationId) => postJson(
        `/admin/commercial/payment-reconciliation/cash-ledger/${encodeURIComponent(item.id)}/classifications`,
        {
          accountType: values.accountType,
          expectedStatementDate: values.expectedStatementDate,
          evidenceReference: values.evidenceReference,
          evidenceDigestSha256: values.evidenceDigestSha256
        },
        reason,
        operationId
      )
    });
  }

  function openReviewCashLedgerClassification(item, decision) {
    const proposal = item.classification;
    if (!proposal?.id) {
      showToast("当前现金台账没有待复核分类提案。", true);
      return;
    }
    openAction({
      title: decision === "approve" ? "独立批准现金台账分类" : "驳回现金台账分类",
      description: decision === "approve"
        ? `批准后仅填入 ${proposal.accountType} / ${proposal.expectedStatementDate}；渠道、来源、方向和金额仍由数据库禁止覆盖。`
        : "驳回保留证据和审批轨迹，现金台账继续阻断商业放行。",
      resource: `cash-ledger-classification:${proposal.id}`,
      risk: "SECOND REVIEW · CASH LEDGER",
      reasonMinLength: 10,
      execute: (_values, reason, operationId) => postJson(
        `/admin/commercial/payment-reconciliation/cash-ledger/classifications/${encodeURIComponent(proposal.id)}/reviews`,
        { decision, note: reason },
        reason,
        operationId
      )
    });
  }

  function openResolvePaymentReconciliationIssue(item, outcome) {
    const acceptedException = outcome === "acceptedException";
    openAction({
      title: acceptedException ? "提交有证据的例外提案" : "提交异常解决提案",
      description: acceptedException
        ? "接受例外不会改写微信或本地账本。必须填写受控证据引用和可复核结论；没有证据时不得关闭异常。"
        : "仅在账实差异已经通过权威渠道或本地台账修复并复核后关闭；本操作不会人工改写支付或退款状态。",
      resource: recordResource("payment-reconciliation-issue", item),
      risk: acceptedException ? "EVIDENCED FINANCIAL EXCEPTION" : "FINANCIAL RECONCILIATION",
      reasonMinLength: 10,
      fields: [
        {
          name: "resolutionCode",
          label: "处置代码",
          minlength: 3,
          maxlength: 80,
          pattern: "[A-Z][A-Z0-9_]{2,79}",
          placeholder: acceptedException ? "APPROVED_PROVIDER_EXCEPTION" : "LEDGER_FACTS_RECONCILED"
        },
        {
          name: "note",
          label: acceptedException ? "结论与受控证据引用" : "修复与复核说明",
          type: "textarea",
          minlength: 10,
          maxlength: 1000,
          wide: true,
          help: "不得填写身份证、银行卡、手机号、密钥或原始账单；使用受控证据库引用。"
        },
        {
          name: "evidenceReference",
          label: "受控证据引用",
          minlength: 6,
          maxlength: 160,
          pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]{5,159}",
          placeholder: "finance:reconciliation/2026-07-31/case-001"
        },
        {
          name: "evidenceDigestSha256",
          label: "证据 SHA-256",
          minlength: 64,
          maxlength: 64,
          pattern: "[A-Fa-f0-9]{64}",
          placeholder: "64 位十六进制摘要"
        }
      ],
      execute: (values, reason, operationId) => postJson(
        `/admin/commercial/payment-reconciliation/issues/${encodeURIComponent(item.id)}/resolutions`,
        {
          outcome,
          resolutionCode: values.resolutionCode,
          note: values.note,
          evidenceReference: values.evidenceReference,
          evidenceDigestSha256: values.evidenceDigestSha256
        },
        reason,
        operationId
      )
    });
  }

  function openReviewPaymentReconciliationResolution(item, decision) {
    const proposal = item.resolutionProposal;
    if (!proposal || proposal.status !== "pending") {
      showToast("该异常没有待独立复核的提案。", true);
      return;
    }
    openAction({
      title: decision === "approve" ? "独立批准对账提案" : "驳回对账提案",
      description: decision === "approve"
        ? `核对受控证据引用 ${proposal.evidenceReference} 与 SHA-256 后批准。提案人不能自审；接受例外只允许管理员批准。`
        : "驳回后异常保持调查中，原提案证据不可修改，负责人可提交一份新的提案。",
      resource: recordResource("payment-reconciliation-issue", item),
      risk: decision === "approve" ? "INDEPENDENT FINANCIAL REVIEW" : "FINANCIAL REVIEW REJECTION",
      reasonMinLength: 10,
      execute: (_values, reason, operationId) => postJson(
        `/admin/commercial/payment-reconciliation/issues/${encodeURIComponent(item.id)}/resolution-reviews`,
        { decision, note: reason },
        reason,
        operationId
      )
    });
  }

  function handleAdminAction(action, kind, id) {
    if (action === "readVoiceIntro") {
      void readVoiceIntro(id);
      return;
    }
    if (action === "inspectDeletion") {
      void inspectDeletion(id);
      return;
    }
    if (action.startsWith("syncDeletionPayment:")) {
      const orderId = action.split(":")[1];
      openAction(simplePostAction("同步注销订单支付", "向支付渠道查询权威订单状态，不直接修改渠道事实。", `deletion:${id}/order:${orderId}`, `/admin/account-deletions/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/payment/sync`));
      return;
    }
    if (action.startsWith("syncDeletionRefund:")) {
      const orderId = action.split(":")[1];
      openAction(simplePostAction("同步注销订单退款", "查询退款权威状态；受理不等于成功。", `deletion:${id}/order:${orderId}`, `/admin/account-deletions/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/refund/sync`));
      return;
    }
    if (action.startsWith("initiateDeletionRefund:")) {
      const orderId = action.split(":")[1];
      openAction(simplePostAction("发起注销结算退款", "为完成账号注销处理仍需结算的已支付订单。", `deletion:${id}/order:${orderId}`, `/admin/account-deletions/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/refund/initiate`, "HIGH RISK"));
      return;
    }
    const item = getRecord(kind, id);
    if (!item) {
      showToast("当前页面数据已经变化，请刷新后重试。", true);
      return;
    }
    if (action.startsWith("approveLegalHoldAction:")) {
      openLegalHoldReview(item, action.slice("approveLegalHoldAction:".length), "approve");
      return;
    }
    if (action.startsWith("rejectLegalHoldAction:")) {
      openLegalHoldReview(item, action.slice("rejectLegalHoldAction:".length), "reject");
      return;
    }
    const handlers = {
      submitCommercialProfile: () => openSubmitCommercialProfile(item),
      verifyCommercialProfile: () => openAction(simplePostAction("核验商业档案", "该动作必须由不同于提交人的管理员执行，服务端会再次验证陪伴者实名与账号状态。", recordResource("companion", item), `/admin/commercial/companions/${encodeURIComponent(item.id)}/profile-verifications`, "SECOND REVIEW")),
      suspendCommercialProfile: () => openAction({
        title: "暂停商业资格",
        description: "暂停会同步下架陪伴者。恢复需要重新提交并完成核验。",
        resource: recordResource("companion", item),
        risk: "HIGH RISK",
        execute: (_values, reason, operationId) => postJson(`/admin/commercial/companions/${encodeURIComponent(item.id)}/profile-suspensions`, { reason }, reason, operationId)
      }),
      submitCompanionVerification: () => openCompanionVerification(item),
      approveIdentityVerification: () => openIdentityVerificationReview(item, "approve"),
      rejectIdentityVerification: () => openIdentityVerificationReview(item, "reject"),
      markCustomerAdult: () => openCustomerAdultEligibilityReview(item, "adult"),
      markCustomerIneligible: () => openCustomerAdultEligibilityReview(item, "ineligible"),
      publishCompanion: () => openAction(simplePostAction("发布陪伴者", "只有满足服务端实名和商业门禁的陪伴者才能公开。", recordResource("companion", item), `/admin/companions/${encodeURIComponent(item.id)}/publish`, "PUBLIC VISIBILITY")),
      unpublishCompanion: () => openAction(simplePostAction("下架陪伴者", "下架会停止新用户发现，但不会删除历史订单与审计记录。", recordResource("companion", item), `/admin/companions/${encodeURIComponent(item.id)}/unpublish`, "SUPPLY CHANGE")),
      companionAccountAction: () => openCompanionAccountAction(item),
      claimSupportSelf: () => openAction({
        title: "认领匿名客服工单",
        description: "服务端会使用 compare-and-set；只有成功认领后才返回正文、请求人与必要订单事实。",
        resource: recordResource("support", item),
        risk: "CASE OWNERSHIP",
        execute: (_values, reason, operationId) => postJson(`/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/claim`, undefined, reason, operationId)
      }),
      assignSupportSelf: () => openAction({
        title: "认领客服工单",
        description: "认领后该工单进入处理中，只有当前受理人可以提交解决结论。",
        resource: recordResource("support", item),
        risk: "CASE OWNERSHIP",
        execute: (_values, reason, operationId) => postJson(`/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/assign`, { assignedToUserId: state.user.id }, reason, operationId)
      }),
      assignSupportOther: () => openAssignSupport(item),
      resolveSupport: () => openResolveSupport(item),
      supportRefund: () => openAction({
        title: "从工单发起退款",
        description: "退款将进入渠道与复核状态机；此动作不会把受理误标为成功。",
        resource: recordResource("support", item),
        risk: "MONEY MOVEMENT",
        execute: (_values, reason, operationId) => postJson(`/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/refunds`, { reason }, reason, operationId)
      }),
      claimAttendanceDispute: () => openAction(simplePostAction(
        "认领履约争议",
        "服务端会以行锁确认案件仍可认领；成功后才返回双方陈述和渠道出席事实。",
        recordResource("attendance-dispute", item),
        `/admin/commercial/attendance-disputes/${encodeURIComponent(item.id)}/claims`,
        "CASE OWNERSHIP"
      )),
      decideAttendanceDispute: () => openAttendanceDecision(item, false),
      claimAttendanceAppeal: () => openAction(simplePostAction(
        "认领申诉复核",
        "申诉复核人必须不同于首轮裁决人；服务端会再次校验职责分离与唯一归属。",
        recordResource("attendance-dispute", item),
        `/admin/commercial/attendance-disputes/${encodeURIComponent(item.id)}/appeal-claims`,
        "INDEPENDENT REVIEW"
      )),
      finalizeAttendanceAppeal: () => openAttendanceDecision(item, true),
      finalizeAttendanceDecision: () => openAction({
        title: "结束未申诉案件",
        description: "仅首轮裁决人在申诉窗口结束后可终局。若结论为全额退款，只会创建受控退款交易，不会提前宣称渠道成功。",
        resource: recordResource("attendance-dispute", item),
        risk: "FINAL DECISION · MONEY MOVEMENT",
        execute: (_values, reason, operationId) => postJson(
          `/admin/commercial/attendance-disputes/${encodeURIComponent(item.id)}/finalizations`,
          {},
          reason,
          operationId
        )
      }),
      claimRefund: () => openAction(simplePostAction("认领退款", "认领后你成为当前负责人，审核、拒绝或失败重试只能由当前负责人执行。", recordResource("refund", item), `/payments/refunds/${encodeURIComponent(item.id)}/claim`, "CASE OWNERSHIP")),
      approveRefund: () => openRefundAction(item, "approve", "批准退款"),
      rejectRefund: () => openRefundAction(item, "reject", "拒绝退款"),
      retryRefund: () => openRefundAction(item, "retry", "重试退款"),
      syncRefund: () => openAction(simplePostAction("查询退款渠道", "仅同步渠道权威状态，不人工覆盖退款结果。", recordResource("refund", item), `/payments/refunds/${encodeURIComponent(item.id)}/sync`, "RECONCILIATION")),
      approveMerchantBillImport: () => openReviewMerchantBillImport(item, "approve"),
      rejectMerchantBillImport: () => openReviewMerchantBillImport(item, "reject"),
      proposeCashLedgerClassification: () => openCashLedgerClassification(item),
      approveCashLedgerClassification: () => openReviewCashLedgerClassification(item, "approve"),
      rejectCashLedgerClassification: () => openReviewCashLedgerClassification(item, "reject"),
      retryPaymentReconciliationRun: () => openAction(simplePostAction(
        "重试失败对账运行",
        "只把未导入不可变产物的失败运行重新排队；不会删除账单、异常或审计事实。",
        recordResource("payment-reconciliation-run", item),
        `/admin/commercial/payment-reconciliation/runs/${encodeURIComponent(item.id)}/retry`,
        "FINANCIAL RECONCILIATION"
      )),
      claimPaymentReconciliationIssue: () => openAction(simplePostAction(
        "认领对账异常",
        "服务端以行锁确认唯一归属；认领不会自动解决差异或修改账本。",
        recordResource("payment-reconciliation-issue", item),
        `/admin/commercial/payment-reconciliation/issues/${encodeURIComponent(item.id)}/claims`,
        "CASE OWNERSHIP"
      )),
      resolvePaymentReconciliationIssue: () => openResolvePaymentReconciliationIssue(item, "resolved"),
      acceptPaymentReconciliationException: () => openResolvePaymentReconciliationIssue(item, "acceptedException"),
      approvePaymentReconciliationResolution: () => openReviewPaymentReconciliationResolution(item, "approve"),
      rejectPaymentReconciliationResolution: () => openReviewPaymentReconciliationResolution(item, "reject"),
      claimPaymentDispute: () => openAction(simplePostAction("认领支付投诉", "认领采用并发安全的单一归属；成功后才开放投诉正文与商户回复能力。", recordResource("payment-dispute", item), `/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/claims`, "CASE OWNERSHIP")),
      assignPaymentDispute: () => openAssignPaymentDispute(item),
      replyPaymentDispute: () => openReplyPaymentDispute(item),
      completePaymentDispute: () => openCompletePaymentDispute(item),
      syncPaymentDispute: () => openAction(simplePostAction("同步微信投诉状态", "主动查询微信支付消费者投诉权威详情；本操作不会人工覆盖渠道结果。", recordResource("payment-dispute", item), `/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/sync`, "RECONCILIATION")),
      claimPayout: () => openAction(simplePostAction("认领结算执行", "认领本身不代表已转账。认领人随后必须提交金额、收款方和证据摘要。", recordResource("earning", item), `/admin/commercial/earnings/${encodeURIComponent(item.id)}/payout-claims`, "MONEY MOVEMENT")),
      submitPayout: () => openSubmitPayout(item),
      cancelPayout: () => openCancelPayout(item),
      verifyPayout: () => openAction(simplePostAction("第二人核验结算", "必须由不同于转账证据提交人的管理员执行，服务端会校验金额、收款方、证据和退款窗口。", recordResource("earning", item), `/admin/commercial/earnings/${encodeURIComponent(item.id)}/payout-verifications`, "SECOND REVIEW")),
      submitRecovery: () => openAction({
        title: "记录追偿证据",
        description: "只记录已经发生的外部追偿事实，不能把计划中的追偿写成完成。",
        resource: recordResource("recovery", item),
        risk: "LEDGER EVIDENCE",
        fields: [{ name: "evidenceReference", label: "追偿证据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" }],
        execute: (values, reason, operationId) => postJson(`/admin/commercial/recoveries/${encodeURIComponent(item.id)}/evidence`, { evidenceReference: values.evidenceReference }, reason, operationId)
      }),
      verifyRecovery: () => openAction(simplePostAction("第二人核验追偿", "核验人不能是证据提交人。成功后追偿台账进入已追回状态。", recordResource("recovery", item), `/admin/commercial/recoveries/${encodeURIComponent(item.id)}/verify`, "SECOND REVIEW")),
      resolveIncident: () => openResolveIncident(item),
      updateWithdrawal: () => openUpdateWithdrawal(item),
      resolveCompanionAppeal: () => openResolveCompanionAppeal(item),
      approveVoiceIntro: () => openVoiceIntro(item, "approved"),
      rejectVoiceIntro: () => openVoiceIntro(item, "rejected"),
      transitionDataRight: () => openDataRightTransition(item),
      claimDataRight: () => openAction({
        title: item.handledById ? "接管数据权利请求" : "认领匿名数据权利请求",
        description: item.handledById
          ? "服务端会锁定当前归属并记录原受理人与接管人；接管成功后你才可以改变请求状态。"
          : "服务端会在同一事务中校验当前归属；认领成功后才返回描述、用户标识与补件内容。",
        resource: recordResource("dataRight", item),
        risk: item.handledById ? "PRIVACY CASE TAKEOVER" : "PRIVACY CASE OWNERSHIP",
        execute: (_values, reason, operationId) => mutationRequest(
          `/admin/account-governance/data-rights/${encodeURIComponent(item.id)}/claim`,
          "PATCH",
          undefined,
          reason,
          operationId
        )
      }),
      transitionInvoice: () => openInvoiceTransition(item),
      claimAccountAppeal: () => openAction(simplePostAction(
        "认领普通用户账号申诉",
        "服务端会再次校验你不是原处置人员、案件仍为待复核且尚未被他人认领。认领本身不会改变账号状态。",
        recordResource("accountAppeal", item),
        `/admin/account-governance/account-appeals/${encodeURIComponent(item.id)}/claim`,
        "INDEPENDENT REVIEW OWNERSHIP"
      )),
      resolveAccountAppeal: () => openResolveAccountAppeal(item),
      updateAccountStatus: () => openUpdateAccountStatus(item),
      updateUserVerification: () => openUpdateVerification(item),
      suspendStaffCredential: () => openSuspendStaffCredential(item),
      startDeletion: () => openAction(simplePostAction("开始注销结算", "系统已确认用户侧与陪伴者侧全部义务清零；账号将进入受限处理态，且必须由另一名管理员完成。", recordResource("deletion", item), `/admin/account-deletions/${encodeURIComponent(item.id)}/start`, "IRREVERSIBLE WORKFLOW")),
      completeDeletion: () => openAction({
        title: "批准账号注销并开始分批擦除",
        description: "这是不可逆工作流的第二人批准。服务端会再次拒绝未结义务并校验外部法律批准，然后只把持久化擦除执行入队；账号继续保持受限，后台按表小批提交并支持崩溃恢复。只有最终后置条件、评分刷新、七类留存台账与封禁同事务提交后才显示完成。",
        resource: recordResource("deletion", item),
        risk: "IRREVERSIBLE",
        execute: (_values, reason, operationId) => postJson(`/admin/account-deletions/${encodeURIComponent(item.id)}/complete`, { note: reason }, reason, operationId)
      }),
      retryDeletion: () => openAction({
        title: "重试账号注销擦除阶段",
        description: "只从持久化失败阶段恢复；不会替换第二位批准人、法律批准引用、已处理计数或已提交批次。",
        resource: recordResource("deletion", item),
        risk: "CONTROLLED ERASURE RECOVERY",
        execute: (_values, reason, operationId) => postJson(`/admin/account-deletions/${encodeURIComponent(item.id)}/retry`, { reason }, reason, operationId)
      }),
      requestLegalHoldPlacement: () => openLegalHoldRequest(item, "placement"),
      requestLegalHoldRelease: () => openLegalHoldRequest(item, "release")
    };
    const handler = handlers[action];
    if (!handler) {
      showToast("该操作尚未接入受控处理器。", true);
      return;
    }
    handler();
  }

  function simplePostAction(title, description, resource, endpoint, risk = "CONTROLLED ACTION") {
    return {
      title,
      description,
      resource,
      risk,
      execute: (_values, reason, operationId) => postJson(endpoint, undefined, reason, operationId)
    };
  }

  function openSubmitCommercialProfile(item) {
    const profile = item.commercialProfile || {};
    openAction({
      title: profile.companionId ? "更新商业档案" : "提交商业档案",
      description: "提交会将档案置为待复核并自动下架。完整收款引用只发送到后端，不在列表中回显。",
      resource: recordResource("companion", item),
      risk: "SENSITIVE COMMERCIAL DATA",
      fields: [
        { name: "settlementRecipientRef", label: "完整收款方引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*", placeholder: "受控支付系统引用" },
        { name: "settlementRecipientMasked", label: "脱敏收款方显示", minlength: 3, maxlength: 80, value: profile.settlementRecipientMasked || "", placeholder: "例如 **** 8899" },
        { name: "taxProfileRef", label: "税务档案引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" },
        { name: "identityEvidenceRef", label: "实名证据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" },
        { name: "serviceAgreementVersion", label: "服务协议版本", minlength: 1, maxlength: 64, pattern: "[A-Za-z0-9][A-Za-z0-9._-]*", value: profile.serviceAgreementVersion || "" },
        { name: "serviceAgreementEvidenceRef", label: "协议签署证据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/companions/${encodeURIComponent(item.id)}/profile-submissions`, values, reason, operationId)
    });
  }

  function openCompanionAccountAction(item) {
    openAction({
      title: "创建陪伴者账号处置",
      description: "限制或暂停会立即下架。面向陪伴者的说明应描述行为和申诉入口，不包含内部风控细节。",
      resource: recordResource("companion", item),
      risk: "ACCOUNT ENFORCEMENT",
      fields: [
        { name: "kind", label: "处置类型", type: "select", options: ["warning", "serviceRestriction", "suspension"] },
        { name: "reasonCode", label: "标准原因码", minlength: 3, maxlength: 80, pattern: "[A-Za-z0-9][A-Za-z0-9._-]*", placeholder: "例如 late-arrival" },
        { name: "message", label: "面向陪伴者的说明", type: "textarea", minlength: 10, maxlength: 1000, wide: true },
        { name: "endsAt", label: "结束时间（可选）", type: "datetime-local", required: false }
      ],
      execute: (values, reason, operationId) => postJson("/admin/commercial/companion-lifecycle/actions", {
        companionId: item.id,
        kind: values.kind,
        reasonCode: values.reasonCode,
        message: values.message,
        ...(values.endsAt ? { endsAt: new Date(values.endsAt).toISOString() } : {})
      }, reason, operationId)
    });
  }

  async function openAssignSupport(item) {
    const keyword = window.prompt("输入客服或管理员姓名/编号关键字（至少 2 个字符）", "");
    if (keyword === null) return;
    const normalized = keyword.trim();
    if (normalized.length < 2) {
      showToast("请输入至少 2 个字符，以免只显示被截断的人员列表。", true);
      return;
    }
    let result;
    try {
      result = await request(`/admin/operations/support-assignees?keyword=${encodeURIComponent(normalized)}&page=1&pageSize=100`);
    } catch (error) {
      showToast(error.message || "受理人搜索失败，请重试。", true);
      showTrace(error);
      return;
    }
    if (Number(result.pagination?.totalPages || 1) > 1) {
      showToast("匹配人员超过 100 名，请补充更精确的姓名或编号后重试。", true);
      return;
    }
    const options = (result.items || []).map((operator) => ({
      value: operator.id,
      label: `${operator.displayName || "客服人员"} · ${operator.role || "staff"} · ${maskId(operator.id)}`
    }));
    if (!options.length) {
      showToast("没有匹配的活动客服或管理员，请调整关键字。", true);
      return;
    }
    openAction({
      title: "分配客服工单",
      description: "分配后只有当前受理人可提交解决结论。",
      resource: recordResource("support", item),
      risk: "CASE OWNERSHIP",
      fields: [{ name: "assignedToUserId", label: "受理人员", type: "select", options }],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/assign`, { assignedToUserId: values.assignedToUserId }, reason, operationId)
    });
  }

  function openResolveSupport(item) {
    openAction({
      title: "解决客服工单",
      description: "用户会收到工单结果通知。若选择“退款处理中”，必须先创建真实退款。",
      resource: recordResource("support", item),
      risk: "CUSTOMER OUTCOME",
      fields: [
        { name: "status", label: "结案状态", type: "select", options: ["resolved", "closed"] },
        { name: "resolutionCode", label: "结论代码", type: "select", options: [
          { value: "noRefund", label: "无需退款" },
          { value: "refundInProgress", label: "退款处理中" },
          { value: "safetyEscalated", label: "安全升级" },
          { value: "privacyRouted", label: "隐私流程" }
        ] },
        { name: "resolution", label: "用户可读结论", type: "textarea", minlength: 2, maxlength: 3000, wide: true }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/support/tickets/${encodeURIComponent(item.id)}/resolve`, values, reason, operationId)
    });
  }

  function openAttendanceDecision(item, isAppeal) {
    openAction({
      title: isAppeal ? "提交独立终局复核" : "提交首轮履约裁决",
      description: isAppeal
        ? "你必须与首轮裁决人不同。终局为全额退款时只会启动真实退款工作流，渠道未确认前仍显示处理中。"
        : "请依据渠道签名事件、双方陈述与公开等待规则裁决；客户端辅助事件不能单独作为结论。裁决后保留申诉窗口。",
      resource: recordResource("attendance-dispute", item),
      risk: isAppeal ? "INDEPENDENT FINAL REVIEW · MONEY MOVEMENT" : "CUSTOMER OUTCOME",
      reasonMinLength: 8,
      fields: [{
        name: "decision",
        label: isAppeal ? "终局结果" : "首轮结果",
        type: "select",
        options: [
          { value: "noRefund", label: "不退款" },
          { value: "fullRefund", label: "全额退款" }
        ]
      }],
      execute: (values, reason, operationId) => postJson(
        `/admin/commercial/attendance-disputes/${encodeURIComponent(item.id)}/${isAppeal ? "finalizations" : "decisions"}`,
        { decision: values.decision, reason },
        reason,
        operationId
      )
    });
  }

  function openRefundAction(item, action, title) {
    const risk = action === "reject" ? "CUSTOMER FUNDS" : action === "approve" ? "MONEY MOVEMENT" : "RETRY PAYMENT";
    openAction({
      title,
      description: action === "approve"
        ? "批准后仍需等待渠道受理与最终结果。"
        : action === "reject"
          ? "拒绝会结束本次退款申请，必须给出明确依据。"
          : "仅对失败退款重新提交，不会创建重复退款单。",
      resource: recordResource("refund", item),
      risk,
      execute: (_values, reason, operationId) => postJson(`/payments/refunds/${encodeURIComponent(item.id)}/${action}`, { note: reason }, reason, operationId)
    });
  }

  async function openAssignPaymentDispute(item) {
    const keyword = window.prompt("输入客服姓名/编号关键字（至少 2 个字符）", "");
    if (keyword === null) return;
    const normalized = keyword.trim();
    if (normalized.length < 2) {
      showToast("请输入至少 2 个字符，以免只显示被截断的人员列表。", true);
      return;
    }
    let result;
    try {
      result = await request(`/admin/operations/support-assignees?keyword=${encodeURIComponent(normalized)}&page=1&pageSize=100`);
    } catch (error) {
      showToast(error.message || "受理人搜索失败，请重试。", true);
      showTrace(error);
      return;
    }
    if (Number(result.pagination?.totalPages || 1) > 1) {
      showToast("匹配人员超过 100 名，请补充更精确的姓名或编号后重试。", true);
      return;
    }
    const options = (result.items || [])
      .filter((operator) => operator.role === "support")
      .map((operator) => ({
        value: operator.id,
        label: `${operator.displayName || "客服人员"} · ${maskId(operator.id)}`
      }));
    if (!options.length) {
      showToast("没有可分配的活动客服人员。", true);
      return;
    }
    openAction({
      title: "分配支付投诉",
      description: "分配后客服才能读取完整投诉内容并代表商户回复；服务端会重新校验受理人岗位和账号状态。",
      resource: recordResource("payment-dispute", item),
      risk: "CASE OWNERSHIP",
      fields: [{ name: "assignedToUserId", label: "受理人员", type: "select", options }],
      execute: (values, reason, operationId) => postJson(
        `/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/assignments`,
        { assignedToUserId: values.assignedToUserId },
        reason,
        operationId
      )
    });
  }

  function openReplyPaymentDispute(item) {
    openAction({
      title: "回复微信支付投诉",
      description: "回复将直接提交微信渠道，最多 200 字；图片字段只接受预先上传到微信得到的 media_id，不接受 URL 或本地文件。提交结果未知时必须先同步。",
      resource: recordResource("payment-dispute", item),
      risk: "CUSTOMER COMMUNICATION",
      fields: [
        { name: "content", label: "面向用户的回复", type: "textarea", minlength: 1, maxlength: 200, wide: true },
        { name: "responseImages", label: "微信图片 media_id（可选，逗号分隔，最多 4 个）", type: "textarea", required: false, maxlength: 1031, wide: true }
      ],
      execute: (values, reason, operationId) => {
        const responseImages = String(values.responseImages || "")
          .split(/[，,\n]/)
          .map((value) => value.trim())
          .filter(Boolean);
        if (responseImages.length > 4 || responseImages.some((value) => !/^[A-Za-z0-9._-]{1,256}$/.test(value))) {
          throw new Error("图片 media_id 最多 4 个，且只能包含字母、数字、点、下划线和连字符。");
        }
        return postJson(
          `/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/replies`,
          {
            clientRequestId: operationId,
            content: values.content,
            ...(responseImages.length ? { responseImages } : {})
          },
          reason,
          operationId
        );
      }
    });
  }

  function openCompletePaymentDispute(item) {
    openAction({
      title: "提交投诉完结",
      description: "只有微信状态为处理中、已回复所有用户消息且平台服务未介入时才能完结。完结会触发资金释放安全检查，不会绕过退款或其他投诉阻断。",
      resource: recordResource("payment-dispute", item),
      risk: "CUSTOMER OUTCOME · FUNDS RELEASE",
      execute: (_values, reason, operationId) => postJson(
        `/admin/commercial/payment-disputes/${encodeURIComponent(item.id)}/completions`,
        { clientRequestId: operationId },
        reason,
        operationId
      )
    });
  }

  function openSubmitPayout(item) {
    openAction({
      title: "记录线下转账证据",
      description: `台账应付 ${money(item.payableCents)}，目标收款方 ${item.settlementRecipientMaskedSnapshot || "未脱敏显示"}。请独立输入完整收款引用进行服务端比对。`,
      resource: recordResource("earning", item),
      risk: "MONEY MOVEMENT",
      fields: [
        { name: "paidReference", label: "外部转账参考号", minlength: 4, maxlength: 160 },
        { name: "paidAmountCents", label: "实付金额（分）", type: "number", min: 1, value: item.payableCents },
        { name: "paidRecipientRef", label: "完整收款方引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" },
        { name: "payoutEvidenceDigest", label: "证据 SHA-256", minlength: 64, maxlength: 64, pattern: "[a-fA-F0-9]{64}", wide: true }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/earnings/${encodeURIComponent(item.id)}/payout-submissions`, {
        paidReference: values.paidReference,
        paidAmountCents: Number(values.paidAmountCents),
        paidRecipientRef: values.paidRecipientRef,
        payoutEvidenceDigest: values.payoutEvidenceDigest
      }, reason, operationId)
    });
  }

  function openCancelPayout(item) {
    openAction({
      title: "取消结算认领",
      description: "必须由不同管理员确认从未发生转账，并提交独立证据引用和摘要。",
      resource: recordResource("earning", item),
      risk: "SECOND REVIEW",
      fields: [
        { name: "noTransferEvidenceReference", label: "未转账证据引用", minlength: 6, maxlength: 200, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" },
        { name: "evidenceDigest", label: "证据 SHA-256", minlength: 64, maxlength: 64, pattern: "[a-fA-F0-9]{64}", wide: true }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/earnings/${encodeURIComponent(item.id)}/payout-cancellations`, {
        reason,
        noTransferEvidenceReference: values.noTransferEvidenceReference,
        evidenceDigest: values.evidenceDigest
      }, reason, operationId)
    });
  }

  function openResolveIncident(item) {
    openAction({
      title: "更新陪伴者事件",
      description: "关闭或解决事件必须提供处理结论；事件证据仍保留在专用记录中。",
      resource: recordResource("incident", item),
      risk: "SAFETY CASE",
      fields: [
        { name: "status", label: "状态", type: "select", options: ["inReview", "resolved", "closed"] },
        { name: "resolution", label: "处理结论", type: "textarea", minlength: 5, maxlength: 1000, wide: true }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/companion-lifecycle/incidents/${encodeURIComponent(item.id)}/status`, values, reason, operationId)
    });
  }

  function withdrawalNextOptions(status) {
    return {
      requested: ["reviewing", "approved", "rejected"],
      reviewing: ["approved", "rejected"],
      approved: ["processing"],
      processing: ["paid"]
    }[status] || [];
  }

  function openUpdateWithdrawal(item) {
    const options = withdrawalNextOptions(item.status);
    if (!options.length) {
      showToast("该提现请求已经是终态或没有合法下一状态。", true);
      return;
    }
    openAction({
      title: "推进提现请求",
      description: "状态只能按服务端状态机前进；标记已支付时必须保留脱敏付款参考，拒绝时必须写明原因。",
      resource: recordResource("withdrawal", item),
      risk: "MONEY MOVEMENT",
      fields: [
        { name: "status", label: "下一状态", type: "select", options },
        { name: "payoutReferenceMasked", label: "脱敏付款参考（支付时）", required: false, minlength: 3, maxlength: 80 },
        { name: "rejectionReason", label: "拒绝原因（拒绝时）", type: "textarea", required: false, minlength: 5, maxlength: 500, wide: true }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/companion-lifecycle/withdrawals/${encodeURIComponent(item.id)}/status`, {
        status: values.status,
        ...(values.payoutReferenceMasked ? { payoutReferenceMasked: values.payoutReferenceMasked } : {}),
        ...(values.rejectionReason ? { rejectionReason: values.rejectionReason } : {})
      }, reason, operationId)
    });
  }

  function openResolveCompanionAppeal(item) {
    if (!item.independentReviewEligible) {
      showToast("你是原账号处置人，必须由另一名授权人员独立复核该申诉。", true);
      return;
    }
    openAction({
      title: "独立复核陪伴者申诉",
      description: "原处置人不能裁决本次申诉；推翻处置会撤销原账号动作，结论必须基于申诉证据并保留审计记录。",
      resource: recordResource("companionAppeal", item),
      risk: "SECOND REVIEW",
      fields: [
        { name: "status", label: "裁决", type: "select", options: ["upheld", "overturned", "dismissed"] },
        { name: "resolution", label: "裁决说明", type: "textarea", minlength: 10, maxlength: 1000, wide: true }
      ],
      execute: (values, reason, operationId) => postJson(`/admin/commercial/companion-lifecycle/appeals/${encodeURIComponent(item.id)}/resolution`, values, reason, operationId)
    });
  }

  function openVoiceIntro(item, status) {
    const companionId = item.companionId || item.id;
    const assetReference = item.assetReference || item.voiceIntroAssetRef;
    if (status === "approved" && !isFreshVoiceIntroRead(
      state.voiceIntroReads.get(String(companionId)),
      assetReference
    )) {
      showToast("No-Go：必须先获取当前资产版本的短期试听地址；查看器不可用时不能批准。", true);
      return;
    }
    openAction({
      title: status === "approved" ? "批准语音介绍" : "拒绝语音介绍",
      description: status === "approved"
        ? "批准绑定刚刚签发试听地址对应的资产版本；版本变化或查看器不可用都会失败关闭。"
        : "拒绝同样绑定当前列表中的资产版本，防止覆盖重新提交的内容。",
      resource: `companion:${companionId}/voice-intro`,
      risk: "PUBLIC CONTENT",
      execute: (_values, reason, operationId) => postJson(
        `/admin/commercial/companion-lifecycle/companions/${encodeURIComponent(companionId)}/voice-intro-review`,
        { status, reviewedAssetReference: assetReference },
        reason,
        operationId
      )
    });
  }

  function openDataRightTransition(item) {
    const transitions = {
      submitted: ["inReview", "needsInformation", "completed", "rejected"],
      inReview: ["needsInformation", "completed", "rejected"],
      needsInformation: []
    };
    const options = transitions[item.status] || [];
    if (!options.length) {
      showToast("该数据权利请求已经处于终态。", true);
      return;
    }
    openAction({
      title: "更新数据权利请求",
      description: "服务端会用当前列表状态作 expectedStatus 乐观锁；若其他人员已处理，本次更新将冲突并要求刷新。",
      resource: recordResource("dataRight", item),
      risk: "DATA RIGHTS",
      fields: [
        { name: "nextStatus", label: "目标状态", type: "select", options },
        { name: "resolutionEvidenceReference", label: "完成证据引用（仅完成时必填）", required: false, minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*", wide: true }
      ],
      execute: (values, reason, operationId) => {
        const resolutionEvidenceReference = values.resolutionEvidenceReference?.trim();
        if (values.nextStatus === "completed" && !resolutionEvidenceReference) {
          throw new Error("完成数据权利请求前必须填写受控完成证据引用。");
        }
        return mutationRequest(
          `/admin/account-governance/data-rights/${encodeURIComponent(item.id)}/status`,
          "PATCH",
          {
            expectedStatus: item.status,
            nextStatus: values.nextStatus,
            reason,
            ...(resolutionEvidenceReference ? { resolutionEvidenceReference } : {})
          },
          reason,
          operationId
        );
      }
    });
  }

  function openInvoiceTransition(item) {
    const transitions = {
      submitted: ["inReview", "rejected"],
      inReview: ["issued", "rejected"],
      issued: ["voided"]
    };
    const options = transitions[item.status] || [];
    if (!options.length) {
      showToast("该发票申请已经处于终态。", true);
      return;
    }
    openAction({
      title: "更新发票申请",
      description: item.status === "issued"
        ? "只有在授权开票系统已完成红冲/作废并取得外部证据后，才能记录“已作废”；本后台不会生成或伪造作废事实。"
        : "选择“已开具”只记录授权开票系统中的真实完成事实；本后台不会生成票据、附件或下载链接。服务端以 expectedStatus 防止并发覆盖。",
      resource: recordResource("invoice", item),
      risk: "INVOICE FACT",
      fields: [
        { name: "nextStatus", label: "目标状态", type: "select", options },
        { name: "evidenceReference", label: "外部开具/红冲证据引用（相应状态必填）", required: false, minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*", wide: true }
      ],
      execute: (values, reason, operationId) => {
        const evidenceReference = values.evidenceReference?.trim();
        if (["issued", "voided"].includes(values.nextStatus) && !evidenceReference) {
          throw new Error("记录已开具或已作废前必须填写授权系统中的外部证据引用。");
        }
        return mutationRequest(
          `/admin/account-governance/invoice-requests/${encodeURIComponent(item.id)}/status`,
          "PATCH",
          {
            expectedStatus: item.status,
            nextStatus: values.nextStatus,
            reason,
            ...(evidenceReference ? { evidenceReference } : {})
          },
          reason,
          operationId
        );
      }
    });
  }

  function openUpdateAccountStatus(item) {
    const defaultStatus = item.accountStatus === "active" ? "restricted" : "active";
    openAction({
      title: defaultStatus === "active" ? "恢复账号" : "变更账号状态",
      description: "限制或封禁会创建面向用户的正式处置、撤销现有刷新会话并开启 30 日申诉期。新处置必须填写受控来源与证据库引用；这里只能填写引用，不得粘贴聊天原文、证件、卡号或其他原始敏感证据。独立复核队列只显示不可变引用和 SHA-256 摘要。服务端还会在账号锁内检查进行中订单、退款、支付投诉、履约争议和客服工单；任一未结即拒绝并返回分项数量。安全事件先使用聊天限制、会话拉黑或客服/退款流程，义务结清后再处置账号。陪伴者和员工必须使用各自生命周期流程；已完成注销的账号不能恢复。",
      resource: recordResource("user", item),
      risk: "ACCOUNT ACCESS",
      fields: [
        { name: "status", label: "目标状态", type: "select", value: defaultStatus, options: ["active", "restricted", "banned"] },
        {
          name: "reasonCode",
          label: "受控原因码（恢复时忽略）",
          type: "select",
          options: ["policy_violation", "safety_risk", "fraud_risk", "off_platform_transaction", "other"]
        },
        {
          name: "sourceType",
          label: "证据来源类型（恢复时自动引用原处置）",
          type: "select",
          value: "moderationCase",
          options: ["moderationCase", "supportTicket", "paymentDispute", "attendanceDispute", "conversationSafety", "manualSafetyReview", "legalCompliance"]
        },
        {
          name: "sourceReference",
          label: "来源记录引用（新处置必填；恢复时可填原 action ID）",
          required: false,
          minlength: 6,
          maxlength: 160,
          pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*",
          wide: true,
          placeholder: "例如 case/moderation-100；不要填写原始证据"
        },
        {
          name: "evidenceReference",
          label: "受控证据库引用（新处置必填）",
          required: false,
          minlength: 6,
          maxlength: 160,
          pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*",
          wide: true,
          placeholder: "例如 evidence-vault/item-100；不要填写 URL、密钥或原文"
        }
      ],
      execute: (values, reason, operationId) => {
        const sourceReference = values.sourceReference?.trim();
        const evidenceReference = values.evidenceReference?.trim();
        if (values.status !== "active" && (!sourceReference || !evidenceReference)) {
          throw new Error("限制或封禁前必须填写来源记录引用和受控证据库引用。不得粘贴原始敏感证据。");
        }
        return patchJson(
          `/admin/users/${encodeURIComponent(item.id)}/account-status`,
          {
            status: values.status,
            reason,
            ...(values.status === "active"
              ? (sourceReference
                  ? { sourceType: "userAccountAction", sourceReference }
                  : {})
              : {
                  reasonCode: values.reasonCode,
                  sourceType: values.sourceType,
                  sourceReference,
                  evidenceReference
                })
          },
          reason,
          operationId
        );
      }
    });
  }

  async function loadAllEligibleStaffSuccessors(excludeUserId) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    do {
      const query = new URLSearchParams({
        excludeUserId,
        page: String(page),
        pageSize: "100"
      });
      const data = await request(`/admin/staff/eligible-successors?${query.toString()}`);
      items.push(...(data.items || []));
      totalPages = Math.max(0, Number(data.pagination?.totalPages || 0));
      page += 1;
    } while (page <= totalPages);
    return [...new Map(items.map((candidate) => [candidate.userId, candidate])).values()];
  }

  async function openSuspendStaffCredential(item) {
    let candidates;
    try {
      showToast("正在分页读取全部 active admin 交接候选…");
      candidates = await loadAllEligibleStaffSuccessors(item.userId);
    } catch (error) {
      showToast(`交接候选读取失败：${error.message}。未打开停权操作，避免遗漏后页。`, true);
      return;
    }
    const successors = candidates
      .map((successor) => ({
        value: successor.userId,
        label: `${successor.displayName || successor.username} · ${successor.username} · admin`
      }));
    const requiresHandoff = Number(item.activeAssignmentTotal || 0) > 0;
    if (requiresHandoff && successors.length === 0) {
      showToast("No-Go：存在未结任务，但没有可接任的 active admin。", true);
      return;
    }
    openAction({
      title: "停权商业后台员工",
      description: "服务端会再次禁止自停、禁止停掉最后一名 active admin，并在同一事务中转交未结商业任务、撤销全部刷新会话和写入独立审计。停权事实不可由 bootstrap 自动恢复；独立 ReviewStaff 身份域不会被触碰。",
      resource: `staff:${item.userId}`,
      risk: "WORKFORCE ACCESS · IMMEDIATE REVOCATION",
      submitLabel: "确认停权并完成交接",
      reasonMinLength: 10,
      fields: [{
        name: "replacementUserId",
        label: requiresHandoff ? "接任 active admin（必选）" : "接任 active admin（无未结任务时可不选）",
        type: "select",
        required: requiresHandoff,
        options: requiresHandoff
          ? successors
          : [{ value: "", label: "不转交（当前无未结任务）" }, ...successors],
        help: "如接任人与原处置人冲突，相关申诉会自动解除分配并回到可认领队列。"
      }],
      execute: (values, reason, operationId) => postJson(
        `/admin/staff/${encodeURIComponent(item.userId)}/suspensions`,
        {
          reason,
          ...(values.replacementUserId ? { replacementUserId: values.replacementUserId } : {}),
          operationId,
          confirmationCode: confirmationCode(item.userId)
        },
        reason,
        operationId
      )
    });
  }

  function openResolveAccountAppeal(item) {
    openAction({
      title: "提交普通用户账号申诉结论",
      description: "只有当前受理人可裁决。撤销处置会原子恢复符合条件的账号；维持或关闭不会恢复访问。结论会展示给用户，请写明事实与规则依据。",
      resource: recordResource("accountAppeal", item),
      risk: "INDEPENDENT REVIEW · ACCOUNT ACCESS",
      fields: [
        {
          name: "status",
          label: "复核结果",
          type: "select",
          value: "upheld",
          options: [
            { value: "upheld", label: "维持原处置" },
            { value: "overturned", label: "撤销原处置并恢复账号" },
            { value: "dismissed", label: "关闭申诉（不恢复账号）" }
          ]
        },
        {
          name: "resolution",
          label: "向用户展示的复核结论",
          type: "textarea",
          minlength: 10,
          maxlength: 1000,
          wide: true,
          placeholder: "说明核验过的事实、适用规则和最终结论；请勿填写内部密钥或无关敏感信息。"
        }
      ],
      execute: (values, reason, operationId) => postJson(
        `/admin/account-governance/account-appeals/${encodeURIComponent(item.id)}/resolve`,
        { status: values.status, resolution: values.resolution },
        reason,
        operationId
      )
    });
  }

  function openUpdateVerification(item) {
    const next = !item.isVerified;
    openAction({
      title: next ? "提交实名核验复核" : "提交撤销实名复核",
      description: next
        ? "本操作只创建待复核请求，不会立即改变实名状态；另一名授权人员批准后才生效。"
        : "本操作只提交撤销复核；批准后才撤销实名并按服务端规则下架相关公开资料。",
      resource: recordResource("user", item),
      risk: "IDENTITY STATUS",
      fields: [{ name: "evidenceReference", label: next ? "实名核验证据引用" : "撤销实名依据引用", minlength: 6, maxlength: 160, pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*" }],
      execute: (values, reason, operationId) => patchJson(`/admin/users/${encodeURIComponent(item.id)}/verification`, {
        isVerified: next,
        reason,
        evidenceReference: values.evidenceReference
      }, reason, operationId)
    });
  }

  function openCompanionVerification(item) {
    if (!item.ownerUserId) {
      showToast("该陪伴者缺少归属用户标识，无法提交实名复核。", true);
      return;
    }
    const next = !(item.owner?.isVerified === true);
    openAction({
      title: next ? "提交陪伴者实名核验复核" : "提交陪伴者撤销实名复核",
      description: next
        ? "本操作只创建待复核请求，不会立即改变实名状态；另一名授权人员批准后才生效。"
        : "本操作只提交撤销复核；另一名授权人员批准后才撤销实名，相关已公开陪伴者可能被服务端强制下架。",
      resource: `user:${item.ownerUserId} · companion:${item.id}`,
      risk: "IDENTITY STATUS",
      fields: [{
        name: "evidenceReference",
        label: next ? "实名核验证据引用" : "撤销实名依据引用",
        minlength: 6,
        maxlength: 160,
        pattern: "[A-Za-z0-9][A-Za-z0-9._:/-]*"
      }],
      execute: (values, reason, operationId) => patchJson(
        `/admin/users/${encodeURIComponent(item.ownerUserId)}/verification`,
        {
          isVerified: next,
          reason,
          evidenceReference: values.evidenceReference
        },
        reason,
        operationId
      )
    });
  }

  function openIdentityVerificationReview(item, decision) {
    const approve = decision === "approve";
    openAction({
      title: approve ? "批准并应用实名变更" : "拒绝实名变更请求",
      description: approve
        ? "必须由不同于提交人的授权人员执行。批准后服务端才会应用实名状态；撤销实名可能同时下架相关公开陪伴者。"
        : "拒绝只关闭本次待复核请求，不会改变用户当前实名状态。后续如需变更，必须重新提交证据。",
      resource: recordResource("identity-verification-request", item),
      risk: approve ? "SECOND REVIEW · IDENTITY STATUS" : "SECOND REVIEW",
      submitLabel: approve ? "确认批准并应用" : "确认拒绝",
      variant: approve ? "danger" : "secondary",
      execute: (_values, reason, operationId) => postJson(
        `/admin/identity-verification-requests/${encodeURIComponent(item.id)}/${decision}`,
        { reason },
        reason,
        operationId
      )
    });
  }

  function openCustomerAdultEligibilityReview(item, decision) {
    const adult = decision === "adult";
    openAction({
      title: adult ? "核验用户成年资格" : "标记不满足成年资格",
      description: adult
        ? "必须核对受控证据系统中的当前结果；有效期须覆盖允许预约的服务结束时间。此操作不会修改资料页生日或实名状态。"
        : "该结论会停止新的付费下单、支付、改期与实时语音，但不会隐藏已有订单、退款、客服或账号权利。",
      resource: recordResource("customer-adult-eligibility", item),
      risk: adult ? "SECOND REVIEW · PAID SERVICE ACCESS" : "SECOND REVIEW · SERVICE RESTRICTION",
      submitLabel: adult ? "确认核验为成年" : "确认标记不满足资格",
      variant: adult ? "danger" : "danger",
      fields: adult ? [{
        name: "validUntil",
        label: "核验有效期截止",
        type: "datetime-local",
        help: "必须晚于当前时间且不超过 366 天；服务结束时间超出有效期时仍会被服务端拒绝。"
      }] : [],
      execute: (values, reason, operationId) => postJson(
        `/admin/customer-adult-eligibility/${encodeURIComponent(item.id)}/${adult ? "adult" : "ineligible"}`,
        adult
          ? { validUntil: new Date(values.validUntil).toISOString(), reason }
          : { reason },
        reason,
        operationId
      )
    });
  }

  const loaders = {
    overview: loadOverview,
    companions: loadCompanions,
    orders: () => loadOrders(state.pages.orders),
    support: loadSupportWorkbench,
    refunds: () => loadRefunds(state.pages.refunds),
    complaints: () => loadPaymentDisputes(state.pages.paymentDisputes),
    settlements: loadSettlements,
    lifecycle: loadLifecycle,
    growth: loadGrowth,
    accounts: () => Promise.all([
      loadAccounts(state.pages.users),
      loadAccountAppeals(state.pages.accountAppeals),
      loadCustomerAdultEligibility(state.pages.customerAdultEligibility),
      loadLegalHolds(state.pages.legalHolds)
    ]),
    audit: () => Promise.all([
      loadStaffCredentials(state.pages.staffCredentials),
      loadAudit(state.pages.audit)
    ])
  };

  async function loadView(target, updateRoute = true, detail = null) {
    if (!adminViews.has(target)) {
      renderAdminRouteState(404, "运营模块不存在", "请从左侧导航重新进入。当前地址不会触发业务操作。");
      return;
    }
    if (!canAccessView(target)) {
      state.currentView = target;
      state.routeDetail = detail;
      if (updateRoute) writeAdminRoute();
      renderAdminRouteState(403, "当前角色无权访问", "该模块及其详情没有向当前商业运营身份开放，未发起业务数据请求。");
      return;
    }
    state.currentView = target;
    state.routeDetail = detail;
    const copy = viewCopy[target] || viewCopy.overview;
    elements.pageEyebrow.textContent = copy[0];
    elements.pageTitle.textContent = copy[1];
    elements.pageDescription.textContent = copy[2];
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== `${target}View`);
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewTarget === target);
    });
    if (updateRoute) writeAdminRoute();
    await loadCurrentView();
  }

  async function loadCurrentView(updateTimestamp = true) {
    if (state.loading) return;
    state.loading = true;
    elements.refreshButton.disabled = true;
    clearTrace();
    try {
      await loaders[state.currentView]();
      if (state.routeDetail) {
        await loadCanonicalDetail(state.routeDetail.kind, state.routeDetail.id);
      }
      if (updateTimestamp) elements.lastUpdated.textContent = `更新于 ${formatTime(new Date().toISOString())}`;
    } finally {
      state.loading = false;
      elements.refreshButton.disabled = false;
    }
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.logoutButton.addEventListener("click", logout);
    elements.controlledModeButton.addEventListener("click", toggleControlledMode);
    elements.refreshButton.addEventListener("click", () => loadCurrentView());
    elements.actionForm.addEventListener("submit", submitAction);
    elements.actionCancelButton.addEventListener("click", () => {
      elements.actionDialog.close();
      state.action = null;
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => loadView(button.dataset.viewTarget, true, null));
    });
    document.addEventListener("click", (event) => {
      const deletionMore = event.target.closest("[data-deletion-settlement-more]");
      if (deletionMore) {
        const settlement = state.deletionSettlements.get(deletionMore.dataset.deletionSettlementMore);
        const nextPage = Number(settlement?.pagination?.page || 0) + 1;
        void inspectDeletion(deletionMore.dataset.deletionSettlementMore, nextPage);
        return;
      }
      const detailButton = event.target.closest("[data-admin-detail]");
      if (detailButton) {
        const config = adminDetailKinds.get(detailButton.dataset.adminDetail);
        if (config) void loadView(config.view, true, {
          kind: detailButton.dataset.adminDetail,
          id: detailButton.dataset.id
        });
        return;
      }
      if (event.target.closest("[data-close-admin-detail]")) {
        state.routeDetail = null;
        writeAdminRoute();
        void loadCurrentView(false);
        return;
      }
      if (event.target.closest("[data-retry-admin-detail]") && state.routeDetail) {
        void loadCanonicalDetail(state.routeDetail.kind, state.routeDetail.id);
        return;
      }
      const evidenceButton = event.target.closest("[data-payment-evidence-resource]");
      if (evidenceButton) {
        void loadPaymentDisputeEvidence(evidenceButton);
        return;
      }
      const legalHoldHistoryButton = event.target.closest("[data-legal-hold-history]");
      if (legalHoldHistoryButton) {
        void loadLegalHoldHistory(legalHoldHistoryButton.dataset.legalHoldHistory, 1);
        return;
      }
      const button = event.target.closest("[data-admin-action]");
      if (!button || button.disabled) return;
      handleAdminAction(button.dataset.adminAction, button.dataset.kind, button.dataset.id);
    });
    document.querySelector("#companionStatusFilter").addEventListener("change", () => loadCompanions(1, state.pages.identityVerification));
    document.querySelector("#identityVerificationStatusFilter").addEventListener("change", () => loadCompanions(state.pages.companions, 1));
    document.querySelector("#supportStatusFilter").addEventListener("change", () => loadSupport(1, 1));
    document.querySelector("#attendanceDisputeStatusFilter").addEventListener("change", () => loadAttendanceDisputes(1));
    document.querySelector("#paymentDisputeStatusFilter").addEventListener("change", () => loadPaymentDisputes(1));
    document.querySelector("#paymentDisputeSlaFilter").addEventListener("change", () => loadPaymentDisputes(1));
    document.querySelector("#earningStatusFilter").addEventListener("change", () => loadSettlements(1, state.pages.recoveries, state.pages.invoices));
    document.querySelector("#recoveryStatusFilter").addEventListener("change", () => loadSettlements(state.pages.earnings, 1, state.pages.invoices));
    document.querySelector("#invoiceStatusFilter").addEventListener("change", () => loadSettlements(state.pages.earnings, state.pages.recoveries, 1));
    document.querySelector("#refundStatusFilter").addEventListener("change", () => loadRefunds(1));
    document.querySelector("#paymentReconciliationCreateDate").value = shanghaiYesterday();
    document.querySelector("#paymentReconciliationCreateButton").addEventListener("click", openCreatePaymentReconciliationRuns);
    document.querySelector("#merchantBillImportButton").addEventListener("click", () => void submitMerchantBillImport());
    document.querySelector("#merchantBillImportStatus").addEventListener("change", () => loadFinanceEvidenceQueues(1, state.pages.cashLedgerClassifications));
    document.querySelector("#paymentReconciliationRunStatusFilter").addEventListener("change", () => loadPaymentReconciliation(1, state.pages.paymentReconciliationIssues));
    document.querySelector("#paymentReconciliationRunDateFilter").addEventListener("change", () => loadPaymentReconciliation(1, state.pages.paymentReconciliationIssues));
    document.querySelector("#paymentReconciliationIssueStatusFilter").addEventListener("change", () => loadPaymentReconciliation(state.pages.paymentReconciliationRuns, 1));
    document.querySelector("#paymentReconciliationIssueKindFilter").addEventListener("change", () => loadPaymentReconciliation(state.pages.paymentReconciliationRuns, 1));
    document.querySelector("#companionAppealStatusFilter").addEventListener("change", () => loadCompanionAppeals(1));
    document.querySelector("#recommendationMetricsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      void loadGrowth();
    });
    document.querySelector("#recommendationMetricsRefresh").addEventListener("click", () => void loadGrowth());
    document.querySelector("#recommendationPolicyForm").addEventListener("submit", submitRecommendationPolicy);
    document.querySelector("#availabilityReminderReadinessRefresh").addEventListener("click", () => void loadGrowth());
    document.querySelector("#availabilityReminderRetryForm").addEventListener("submit", submitAvailabilityReminderRetry);
    document.querySelector("#availabilityReminderTerminalForm").addEventListener("submit", submitAvailabilityReminderTerminalResolution);
    document.querySelector("#deletionStatusFilter").addEventListener("change", () => loadAccounts(state.pages.users, 1, state.pages.dataRights, state.pages.dataRightsClaimable));
    document.querySelector("#legalHoldFilterForm").addEventListener("submit", (event) => {
      event.preventDefault();
      void loadLegalHolds(1);
    });
    document.querySelector("#legalHoldHistoryClose").addEventListener("click", closeLegalHoldHistory);
    document.querySelector("#dataRightsStatusFilter").addEventListener("change", () => loadAccounts(state.pages.users, state.pages.deletions, 1, state.pages.dataRightsClaimable));
    document.querySelector("#accountAppealStatusFilter").addEventListener("change", () => loadAccountAppeals(1));
    document.querySelector("#customerAdultEligibilityStatusFilter").addEventListener("change", () => loadCustomerAdultEligibility(1));
    document.querySelector("#staffCredentialStatusFilter").addEventListener("change", () => loadStaffCredentials(1));
    document.querySelector("#staffCredentialRoleFilter").addEventListener("change", () => loadStaffCredentials(1));
    document.querySelector("#staffCredentialFilterForm").addEventListener("submit", (event) => {
      event.preventDefault();
      loadStaffCredentials(1);
    });
    document.querySelector("#orderFilterForm").addEventListener("submit", (event) => {
      event.preventDefault();
      loadOrders(1);
    });
    document.querySelector("#userFilterForm").addEventListener("submit", (event) => {
      event.preventDefault();
      loadAccounts(1);
    });
    document.querySelector("#auditFilterForm").addEventListener("submit", (event) => {
      event.preventDefault();
      loadAudit(1);
    });
    window.setInterval(() => {
      updateSessionCountdown();
      const expiry = decodeTokenExpiry(state.accessToken);
      if (expiry && state.refreshToken && expiry - Date.now() <= 60_000) {
        void refreshSession();
      }
    }, 1_000);
    window.addEventListener("pagehide", () => {
      state.mutationsEnabled = false;
    });
    window.addEventListener("popstate", () => {
      if (state.accessToken && state.user) void restoreAdminRoute();
    });
  }

  async function boot() {
    sanitizeLocation();
    bindEvents();
    if (!state.accessToken || !state.refreshToken || !state.user || !allowedStaffRoles.has(state.user.role)) {
      clearSession();
      showLogin();
      return;
    }
    try {
      await request("/admin/status");
      state.context = await request("/admin/operations/context");
      showPortal();
      await restoreAdminRoute();
    } catch {
      clearSession();
      showLogin("运营会话已失效或没有工作台权限，请重新登录。");
    }
  }

  void boot();
})();
