import { api, ApiError, ensureSession } from "../../utils/api";
import {
  CompanionAvailabilityCandidate, Order, OrderExperienceFeedbackTag, OrderRescheduleRequest, OrderTimelineEvent, RecommendedCompanion
} from "../../utils/models";
import { ensurePrivacyAuthorization } from "../../utils/privacy";
import { flushRecommendationEvents, queueRecommendationEvent, trackRecommendationCardViews } from "../../utils/recommendations";
import { requestTransactionalSubscriptions } from "../../utils/subscription";

function serviceName(order: Order): string { return order.companionSnapshot?.name || order.companion?.name || "陪伴服务"; }

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待确认/待支付",
  paying: "待支付",
  paid: "已支付",
  inService: "服务中",
  completed: "已完成",
  cancelled: "已取消",
  refunded: "已退款"
};

const AVAILABILITY_STEP_MS = 30 * 60_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const SERVICE_EARLY_START_MS = 15 * 60_000;
const FULFILLMENT_REFRESH_INTERVAL_MS = 30_000;
const ORDER_FACT_SENSITIVE_CONTENT = /(?:\b\d{15}\b|\b\d{17}[\dXx]\b|(?:^|[^\d])1[3-9]\d{9}(?:$|[^\d])|身份证|护照|驾驶证|社保(?:卡|号)?|银行卡|银行账户|病历|诊断|健康(?:证明|码|状况)?|疾病|医疗|就诊|处方)/u;
const EXPERIENCE_FEEDBACK_RATING_OPTIONS = [
  { value: 1, label: "1", description: "很不符合预期" },
  { value: 2, label: "2", description: "有明显落差" },
  { value: 3, label: "3", description: "基本符合预期" },
  { value: 4, label: "4", description: "体验不错" },
  { value: 5, label: "5", description: "很符合预期" }
] as const;

type DisplayOrder = Order & {
  displayName: string;
  scheduledAtText: string;
  paymentDeadlineText: string;
  responseDeadlineText: string;
  completionEligibleAtText: string;
  canCompleteService: boolean;
  canRequestRefund: boolean;
  refundActionText: string;
  refundDeadlineText: string;
  refundStatusText: string;
  refundStatusExplanation: string;
  refundTone: "review" | "active" | "resolved" | "attention" | "neutral";
  refundAmountText: string;
  refundReasonText: string;
  refundReviewLabel: string;
  refundReviewText: string;
  refundFailureText: string;
  refundCanContactSupport: boolean;
  refundSupportActionText: string;
  hasFulfillmentGuidance: boolean;
  fulfillmentTitle: string;
  fulfillmentDetail: string;
  fulfillmentCountdownLabel: string;
  fulfillmentCountdownText: string;
  fulfillmentTone: "waiting" | "ready" | "active" | "complete" | "overdue";
  canOpenOrderConversation: boolean;
  orderConversationActionText: string;
  isRealtimeVoiceService: boolean;
  canOpenRealtimeVoice: boolean;
  canStartService: boolean;
  startServiceNotice: string;
  hasServiceGuidelines: boolean;
  serviceGuidelinesProgress: string;
  serviceGuidelinesSummary: string;
  customerServiceGuidelinesStatus: string;
  companionServiceGuidelinesStatus: string;
  canConfirmServiceGuidelines: boolean;
  serviceGuidelinesActionText: string;
  hasExperienceFeedback: boolean;
  experienceFeedbackStatusText: string;
  canSubmitExperienceFeedback: boolean;
  experienceFeedbackOpen: boolean;
  experienceFeedbackToggleText: string;
  experienceFeedbackRating: number;
  experienceFeedbackRatingOptions: ExperienceFeedbackRatingOption[];
  experienceFeedbackTags: OrderExperienceFeedbackTag[];
  experienceFeedbackTagOptions: ExperienceFeedbackTagOption[];
  experienceFeedbackNote: string;
  experienceFeedbackSubmitting: boolean;
  experienceFeedbackSubmitEnabled: boolean;
  canRebook: boolean;
  rebookDescription: string;
  rebookActionText: string;
  amountText: string;
  statusText: string;
  statusExplanation: string;
  timelineOpen: boolean;
  timelineState: "idle" | "loading" | "loaded" | "unavailable";
  timelineToggleText: string;
  timelineItems: DisplayTimelineItem[];
  timelineError: string;
  canInitiateReschedule: boolean;
  rescheduleOpen: boolean;
  rescheduleState: "idle" | "loading" | "structured" | "legacy" | "pending" | "empty" | "unavailable";
  rescheduleToggleText: string;
  rescheduleMessage: string;
  rescheduleDateGroups: RescheduleDateGroup[];
  selectedRescheduleCandidate: RescheduleSlot | null;
  selectedRescheduleCandidateId: string;
  rescheduleDate: string;
  rescheduleTime: string;
  rescheduleSubmitEnabled: boolean;
  rescheduleSubmitting: boolean;
  rescheduleSubmitText: string;
  pendingReschedule: OrderRescheduleRequest | null;
  pendingRescheduleText: string;
  pendingRescheduleOriginalText: string;
  pendingRescheduleRequestedText: string;
  pendingRescheduleDeadlineText: string;
  canRespondToReschedule: boolean;
  rescheduleResponseAction: "" | "accept" | "reject";
  rescheduleResponseError: string;
};

type OrderViewerRole = "customer" | "companion";

type DisplayTimelineItem = {
  id: string;
  title: string;
  description: string;
  occurredAt: string;
  occurredAtText: string;
  tone: "neutral" | "active" | "resolved" | "closed";
};

type RescheduleSlot = CompanionAvailabilityCandidate & {
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  endTimeLabel: string;
};

type RescheduleDateGroup = { key: string; label: string; items: RescheduleSlot[] };

type DisplayOrderSupportFact = {
  id: string;
  statement: string;
  createdAt: string;
  createdAtText: string;
};

type DisplaySupportTicket = {
  id: string;
  orderId: string | null;
  category: "orderIssue" | "refund" | "safety" | "privacy" | "general";
  status: string;
  subject: string;
  body: string;
  resolution: string | null;
  resolutionCode: string | null;
  dueAt: string | null;
  updatedAt: string;
  statusText: string;
  updatedAtText: string;
  orderFacts: DisplayOrderSupportFact[];
  canAddOrderFact: boolean;
};

type RefundPresentation = {
  statusText: string;
  statusExplanation: string;
  tone: DisplayOrder["refundTone"];
  canContactSupport: boolean;
};

type FulfillmentGuidance = {
  show: boolean;
  title: string;
  detail: string;
  countdownLabel: string;
  countdownText: string;
  tone: DisplayOrder["fulfillmentTone"];
  canOpenConversation: boolean;
  canStartService: boolean;
  startServiceNotice: string;
};

type ServiceGuidelinesGuidance = {
  show: boolean;
  progress: string;
  summary: string;
  customerStatus: string;
  companionStatus: string;
  canConfirm: boolean;
  actionText: string;
};

type ExperienceFeedbackRatingOption = {
  value: number;
  label: string;
  description: string;
  className: string;
};

type ExperienceFeedbackTagOption = {
  value: OrderExperienceFeedbackTag;
  label: string;
  className: string;
};

type ExperienceFeedbackDraft = Pick<DisplayOrder,
  "experienceFeedbackOpen" | "experienceFeedbackRating" | "experienceFeedbackTags" |
  "experienceFeedbackNote" | "experienceFeedbackSubmitting">;

const EXPERIENCE_FEEDBACK_TAG_OPTIONS: Array<Pick<ExperienceFeedbackTagOption, "value" | "label">> = [
  { value: "communicationClear", label: "沟通清晰" },
  { value: "boundaryRespected", label: "尊重边界" },
  { value: "onTime", label: "准时完成" },
  { value: "asExpected", label: "符合预期" },
  { value: "needsImprovement", label: "需要改进" }
];

function formatDateTime(value?: string | null): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "时间待确认";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function twoDigits(value: number): string { return String(value).padStart(2, "0"); }

function shanghaiDateParts(value: Date) {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  };
}

function isBookableRescheduleCandidate(
  candidate: unknown,
  durationMinutes: number
): candidate is CompanionAvailabilityCandidate {
  if (!candidate || typeof candidate !== "object") return false;
  const item = candidate as Partial<CompanionAvailabilityCandidate>;
  const startsAt = new Date(item.startsAt || "").getTime();
  const endsAt = new Date(item.endsAt || "").getTime();
  return typeof item.id === "string"
    && Boolean(item.id.trim())
    && typeof item.availabilityWindowId === "string"
    && Boolean(item.availabilityWindowId.trim())
    && typeof item.startsAt === "string"
    && typeof item.endsAt === "string"
    && Number.isFinite(startsAt)
    && Number.isFinite(endsAt)
    && startsAt % AVAILABILITY_STEP_MS === 0
    && endsAt - startsAt === durationMinutes * 60_000
    && typeof item.capacity === "number"
    && Number.isInteger(item.capacity)
    && item.capacity >= 1
    && typeof item.reservedCount === "number"
    && Number.isInteger(item.reservedCount)
    && item.reservedCount >= 0
    && typeof item.availableCapacity === "number"
    && Number.isInteger(item.availableCapacity)
    && item.availableCapacity > 0
    && item.availableCapacity <= item.capacity
    && item.reservedCount + item.availableCapacity === item.capacity;
}

function rescheduleSlot(candidate: CompanionAvailabilityCandidate): RescheduleSlot {
  const start = shanghaiDateParts(new Date(candidate.startsAt));
  const end = shanghaiDateParts(new Date(candidate.endsAt));
  return {
    ...candidate,
    dateKey: `${start.year}-${twoDigits(start.month)}-${twoDigits(start.day)}`,
    dateLabel: `${start.month}月${start.day}日 周${WEEKDAY_LABELS[start.weekday]}`,
    timeLabel: `${twoDigits(start.hour)}:${twoDigits(start.minute)}`,
    endTimeLabel: `${twoDigits(end.hour)}:${twoDigits(end.minute)}`
  };
}

function rescheduleDateGroups(candidates: RescheduleSlot[]): RescheduleDateGroup[] {
  const groups: RescheduleDateGroup[] = [];
  for (const candidate of candidates) {
    const last = groups[groups.length - 1];
    if (last?.key === candidate.dateKey) last.items.push(candidate);
    else groups.push({ key: candidate.dateKey, label: candidate.dateLabel, items: [candidate] });
  }
  return groups;
}

function rescheduleDateTimeDefaults(): { date: string; time: string } {
  const parts = shanghaiDateParts(new Date(Date.now() + 2 * 60 * 60_000));
  return {
    date: `${parts.year}-${twoDigits(parts.month)}-${twoDigits(parts.day)}`,
    time: `${twoDigits(parts.hour)}:${twoDigits(parts.minute)}`
  };
}

function parseShanghaiDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

function hasActiveRefund(order: Order): boolean {
  return Boolean(order.refund && ["pendingReview", "pending", "processing", "failed"].includes(order.refund.status));
}

function isRealtimeVoiceService(order: Order): boolean {
  return order.serviceOfferingSnapshot?.deliveryMode === "voice";
}

function timestamp(value?: string | null): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "现在";
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}天${hours}小时`;
  return hours ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

function fulfillmentGuidance(order: Order, viewerRole: OrderViewerRole, now = Date.now()): FulfillmentGuidance {
  const scheduledAt = timestamp(order.scheduledAt);
  const realTimeVoice = isRealtimeVoiceService(order);
  const chatEnabled = ["paid", "inService", "completed"].includes(order.status);
  const canOpenConversation = chatEnabled && (viewerRole === "customer"
    ? Boolean(order.conversationId)
    : Boolean(order.customer?.id));
  const base = {
    show: false,
    title: "",
    detail: "",
    countdownLabel: "",
    countdownText: "",
    tone: "waiting" as const,
    canOpenConversation,
    canStartService: false,
    startServiceNotice: ""
  };
  if (!scheduledAt) return base;

  const serviceStartedAt = timestamp(order.serviceStartedAt);
  const serviceEndAt = Math.max(scheduledAt, serviceStartedAt ?? scheduledAt) + order.durationMinutes * 60_000;
  if (order.status === "paid") {
    if (viewerRole === "companion") {
      const startWindowAt = scheduledAt - SERVICE_EARLY_START_MS;
      if (now < startWindowAt) {
        return {
          ...base,
          show: true,
          title: "服务尚未到开始窗口",
          detail: "请先在订单会话中确认本次约定；服务可在预约开始前 15 分钟内开始。",
          countdownLabel: "开始服务可用",
          countdownText: formatCountdown(startWindowAt - now),
          tone: "waiting",
          startServiceNotice: `开始服务将在 ${formatCountdown(startWindowAt - now)} 后开放`
        };
      }
      if (now < serviceEndAt) {
        return {
          ...base,
          show: true,
          title: "可以开始服务",
          detail: realTimeVoice
            ? "已进入开始窗口。开始后双方可从订单进入实时语音；请先确认本次服务方式和边界。"
            : "已进入开始窗口。开始前请在订单会话中确认本次服务方式和边界。",
          countdownLabel: "本次服务窗口结束",
          countdownText: formatCountdown(serviceEndAt - now),
          tone: "ready",
          canStartService: true
        };
      }
      return {
        ...base,
        show: true,
        title: "服务窗口已结束",
        detail: "本次服务未开始，不能在订单中补记开始。请联系平台客服处理后续安排。",
        tone: "overdue",
        startServiceNotice: "预约服务窗口已结束，请联系平台客服处理"
      };
    }
    if (now < scheduledAt) {
      return {
        ...base,
        show: true,
          title: "等待服务开始",
          detail: realTimeVoice
            ? "可先确认服务方式和边界；陪伴者开始服务后，双方可从订单进入实时语音。"
            : "可先进入订单会话确认本次服务方式和边界；开始状态以陪伴者在订单内操作为准。",
        countdownLabel: "距预约开始",
        countdownText: formatCountdown(scheduledAt - now),
        tone: "waiting"
      };
    }
    if (now < serviceEndAt) {
      return {
        ...base,
        show: true,
          title: "已到预约开始时间",
          detail: realTimeVoice
            ? "请等待陪伴者在订单中开始服务；开始后可进入实时语音。"
            : "请在订单会话中与陪伴者确认；服务开始后，订单会同步显示进行中状态。",
        countdownLabel: "本次服务窗口结束",
        countdownText: formatCountdown(serviceEndAt - now),
        tone: "ready"
      };
    }
    return {
      ...base,
      show: true,
      title: "预约服务窗口已结束",
      detail: "如未能按约开始，请从订单联系平台客服说明情况。",
      tone: "overdue"
    };
  }

  if (order.status === "inService") {
    if (now < serviceEndAt) {
      return {
        ...base,
        show: true,
        title: "服务进行中",
        detail: viewerRole === "companion"
          ? realTimeVoice
            ? "请通过订单内实时语音完成本次服务；服务时长结束后再标记完成。"
            : "请在平台内完成本次服务；服务时长结束后再标记完成。"
          : realTimeVoice
            ? "请通过订单内实时语音继续本次服务；如遇履约或安全问题，可从订单联系平台客服。"
            : "请在平台内继续沟通；如遇履约或安全问题，可从订单联系平台客服。",
        countdownLabel: viewerRole === "companion" ? "可标记完成" : "预计结束",
        countdownText: formatCountdown(serviceEndAt - now),
        tone: "active"
      };
    }
    return {
      ...base,
      show: true,
      title: viewerRole === "companion" ? "服务时长已结束" : "本次服务时长已到",
      detail: viewerRole === "companion"
        ? "现在可标记本次服务完成；服务端会再次核对订单状态。"
        : "等待陪伴者在订单内标记完成；如有问题可联系平台客服。",
      tone: "complete"
    };
  }

  if (order.status === "completed") {
    const refundDeadline = timestamp(order.refundRequestDeadlineAt);
    const inAfterSalesWindow = Boolean(refundDeadline && refundDeadline > now);
    return {
      ...base,
      show: true,
      title: "本次服务已完成",
      detail: viewerRole === "customer"
        ? "如已按约完成，可提交评价或确认完成；如有履约问题，可在售后期限内从订单提交申请。"
        : "订单已进入售后期，请保留平台内沟通记录并留意客户的后续反馈。",
      countdownLabel: inAfterSalesWindow ? "自助售后截止" : "",
      countdownText: inAfterSalesWindow && refundDeadline ? formatCountdown(refundDeadline - now) : "",
      tone: "complete"
    };
  }
  return base;
}

function fulfillmentDisplayPatch(order: Order, viewerRole: OrderViewerRole): Pick<DisplayOrder,
  "hasFulfillmentGuidance" | "fulfillmentTitle" | "fulfillmentDetail" | "fulfillmentCountdownLabel" |
  "fulfillmentCountdownText" | "fulfillmentTone" | "canOpenOrderConversation" |
  "orderConversationActionText" | "canStartService" | "startServiceNotice" |
  "isRealtimeVoiceService" | "canOpenRealtimeVoice"
> {
  const guidance = fulfillmentGuidance(order, viewerRole);
  const activeRefund = hasActiveRefund(order);
  const realTimeVoice = isRealtimeVoiceService(order);
  return {
    hasFulfillmentGuidance: guidance.show && !activeRefund,
    fulfillmentTitle: guidance.title,
    fulfillmentDetail: guidance.detail,
    fulfillmentCountdownLabel: guidance.countdownLabel,
    fulfillmentCountdownText: guidance.countdownText,
    fulfillmentTone: guidance.tone,
    canOpenOrderConversation: guidance.canOpenConversation,
    orderConversationActionText: viewerRole === "customer" ? "进入订单会话" : "进入与客户的订单会话",
    isRealtimeVoiceService: realTimeVoice,
    // Keep the visible entry aligned with the server's credential rule. The
    // server remains authoritative, but showing an entry after the paid window
    // has elapsed would create a guaranteed failed attempt for both parties.
    canOpenRealtimeVoice: realTimeVoice && order.status === "inService" && guidance.tone === "active" && !activeRefund,
    canStartService: guidance.canStartService && !activeRefund,
    startServiceNotice: activeRefund && order.status === "paid"
      ? "退款处理中，暂不能开始服务。"
      : guidance.startServiceNotice
  };
}

function serviceGuidelinesGuidance(order: Order, viewerRole: OrderViewerRole): ServiceGuidelinesGuidance {
  const customerConfirmedAt = order.customerServiceGuidelinesConfirmedAt;
  const companionConfirmedAt = order.companionServiceGuidelinesConfirmedAt;
  const customerConfirmed = Boolean(customerConfirmedAt);
  const companionConfirmed = Boolean(companionConfirmedAt);
  const ownConfirmed = viewerRole === "customer" ? customerConfirmed : companionConfirmed;
  const completeCount = Number(customerConfirmed) + Number(companionConfirmed);
  const show = order.status === "paid" && !order.serviceStartedAt && !hasActiveRefund(order);
  return {
    show,
    progress: `${completeCount}/2 已确认`,
    summary: "仅在平台内沟通；本服务不替代医疗、心理治疗或紧急救助。尊重双方边界，如有不适或安全风险可立即暂停并联系平台客服。",
    customerStatus: customerConfirmed
      ? `客户已于 ${formatDateTime(customerConfirmedAt)} 确认`
      : "客户待确认",
    companionStatus: companionConfirmed
      ? `陪伴者已于 ${formatDateTime(companionConfirmedAt)} 确认`
      : "陪伴者待确认",
    canConfirm: show && !ownConfirmed,
    actionText: viewerRole === "customer" ? "确认服务前约定" : "确认服务范围与边界"
  };
}

function experienceFeedbackRatingOptions(rating: number): ExperienceFeedbackRatingOption[] {
  return EXPERIENCE_FEEDBACK_RATING_OPTIONS.map((option) => ({
    ...option,
    className: option.value === rating ? "experience-feedback-rating-selected" : ""
  }));
}

function experienceFeedbackTagOptions(tags: OrderExperienceFeedbackTag[]): ExperienceFeedbackTagOption[] {
  return EXPERIENCE_FEEDBACK_TAG_OPTIONS.map((option) => ({
    ...option,
    className: tags.includes(option.value) ? "experience-feedback-tag-selected" : ""
  }));
}

function experienceFeedbackDisplayPatch(order: Order, viewerRole: OrderViewerRole): Pick<DisplayOrder,
  "hasExperienceFeedback" | "experienceFeedbackStatusText" | "canSubmitExperienceFeedback" |
  "experienceFeedbackOpen" | "experienceFeedbackToggleText" | "experienceFeedbackRating" |
  "experienceFeedbackRatingOptions" | "experienceFeedbackTags" | "experienceFeedbackTagOptions" |
  "experienceFeedbackNote" | "experienceFeedbackSubmitting" | "experienceFeedbackSubmitEnabled"
> {
  const feedback = viewerRole === "customer" ? order.experienceFeedback : null;
  const canSubmit = viewerRole === "customer" && order.status === "completed" && !feedback;
  const rating = 0;
  const tags: OrderExperienceFeedbackTag[] = [];
  return {
    hasExperienceFeedback: Boolean(feedback),
    experienceFeedbackStatusText: feedback ? `已记录 ${feedback.rating} / 5 的非公开体验反馈` : "",
    canSubmitExperienceFeedback: canSubmit,
    experienceFeedbackOpen: false,
    experienceFeedbackToggleText: "分享服务体验",
    experienceFeedbackRating: rating,
    experienceFeedbackRatingOptions: experienceFeedbackRatingOptions(rating),
    experienceFeedbackTags: tags,
    experienceFeedbackTagOptions: experienceFeedbackTagOptions(tags),
    experienceFeedbackNote: "",
    experienceFeedbackSubmitting: false,
    experienceFeedbackSubmitEnabled: false
  };
}

function experienceFeedbackDraftPatch(order: DisplayOrder, draft: Partial<ExperienceFeedbackDraft>): Partial<DisplayOrder> {
  const rating = draft.experienceFeedbackRating ?? order.experienceFeedbackRating;
  const tags = draft.experienceFeedbackTags ?? order.experienceFeedbackTags;
  const submitting = draft.experienceFeedbackSubmitting ?? order.experienceFeedbackSubmitting;
  const open = draft.experienceFeedbackOpen ?? order.experienceFeedbackOpen;
  const note = draft.experienceFeedbackNote ?? order.experienceFeedbackNote;
  return {
    experienceFeedbackOpen: open,
    experienceFeedbackToggleText: open ? "收起反馈" : "分享服务体验",
    experienceFeedbackRating: rating,
    experienceFeedbackRatingOptions: experienceFeedbackRatingOptions(rating),
    experienceFeedbackTags: tags,
    experienceFeedbackTagOptions: experienceFeedbackTagOptions(tags),
    experienceFeedbackNote: note,
    experienceFeedbackSubmitting: submitting,
    experienceFeedbackSubmitEnabled: order.canSubmitExperienceFeedback && rating >= 1 && rating <= 5 && !submitting
  };
}

function rebookingDisplayPatch(order: Order, viewerRole: OrderViewerRole): Pick<DisplayOrder,
  "canRebook" | "rebookDescription" | "rebookActionText"
> {
  const serviceOfferingId = typeof order.serviceOfferingId === "string" ? order.serviceOfferingId.trim() : "";
  const serviceTitle = order.serviceOfferingSnapshot?.title?.trim() || "这项服务";
  const canRebook = viewerRole === "customer" && order.status === "completed" && Boolean(serviceOfferingId);
  return {
    canRebook,
    rebookDescription: canRebook
      ? `将带入上次的「${serviceTitle}」，再从当前可约时段中重新选择；价格、服务范围和时长以本页为准。`
      : "",
    rebookActionText: "回到实时可约日历"
  };
}

function refundPresentation(refund: NonNullable<Order["refund"]>): RefundPresentation {
  switch (refund.status) {
    case "pendingReview":
      return {
        statusText: "售后审核中",
        statusExplanation: "服务已开始或完成，平台正在结合订单和你补充的情况审核。处理结果会显示在订单中，并通过已授权的订单提醒发送。",
        tone: "review",
        canContactSupport: true
      };
    case "pending":
      return {
        statusText: "退款已受理",
        statusExplanation: "申请已受理，正在发起原路退款。到账进度以微信支付记录为准。",
        tone: "active",
        canContactSupport: false
      };
    case "processing":
      return {
        statusText: "原路退款处理中",
        statusExplanation: "退款正在由微信支付处理，请勿重复提交。到账进度以微信支付记录为准。",
        tone: "active",
        canContactSupport: false
      };
    case "success":
      return {
        statusText: "退款已完成",
        statusExplanation: "款项已按原支付路径退回；具体到账时间以微信支付记录为准。",
        tone: "resolved",
        canContactSupport: false
      };
    case "failed":
      return {
        statusText: "退款处理未完成",
        statusExplanation: "退款暂未完成，平台会继续核对支付状态。请保留订单和支付记录，如需补充情况可联系平台客服。",
        tone: "attention",
        canContactSupport: true
      };
    case "rejected":
      return {
        statusText: "售后申请未通过",
        statusExplanation: "本次退款申请未通过审核。若有新的履约或安全情况需要补充，可联系平台客服。",
        tone: "attention",
        canContactSupport: true
      };
    default:
      return {
        statusText: "退款状态更新中",
        statusExplanation: "退款状态正在更新，请稍后下拉刷新订单查看最新结果。",
        tone: "neutral",
        canContactSupport: true
      };
  }
}

function canInitiateReschedule(order: Order): boolean {
  const unconfirmedPending = order.status === "pending" && !order.companionConfirmedAt;
  const scheduledAt = new Date(order.scheduledAt || "").getTime();
  return Number.isFinite(scheduledAt)
    && scheduledAt > Date.now() + 15 * 60_000
    && !hasActiveRefund(order)
    && (unconfirmedPending || order.status === "paid");
}

function isStructuredOrder(order: Order): boolean {
  return Boolean(order.availabilityWindowId || order.availabilitySnapshot?.availabilityWindowId || order.availabilitySnapshot?.startsAt);
}

function findPendingReschedule(events: OrderTimelineEvent[]): OrderRescheduleRequest | null {
  const pending = events
    .map((event) => event.rescheduleRequest)
    .filter((request): request is OrderRescheduleRequest => Boolean(request && request.status === "pending"));
  return pending.sort((left, right) => Date.parse(right.expiresAt) - Date.parse(left.expiresAt))[0] || null;
}

function pendingRescheduleText(request: OrderRescheduleRequest, viewerRole: OrderViewerRole): string {
  const requester = request.requestedByRole === viewerRole ? "你" : request.requestedByRole === "customer" ? "客户" : "陪伴者";
  const recipient = request.requestedByRole === viewerRole ? "对方" : "你";
  return `${requester}提议改为 ${formatDateTime(request.requestedScheduledAt)}，等待${recipient}在 ${formatDateTime(request.expiresAt)} 前回应。`;
}

function pendingReschedulePatch(request: OrderRescheduleRequest, viewerRole: OrderViewerRole): Partial<DisplayOrder> {
  return {
    canInitiateReschedule: false,
    pendingReschedule: request,
    pendingRescheduleText: pendingRescheduleText(request, viewerRole),
    pendingRescheduleOriginalText: formatDateTime(request.originalScheduledAt),
    pendingRescheduleRequestedText: formatDateTime(request.requestedScheduledAt),
    pendingRescheduleDeadlineText: formatDateTime(request.expiresAt),
    canRespondToReschedule: request.requestedByRole !== viewerRole,
    rescheduleResponseAction: "",
    rescheduleResponseError: ""
  };
}

function rescheduleFailureMessage(error: ApiError): string {
  switch (error.code) {
    case "RESCHEDULE_ORDER_INVALID_STATE": return "当前订单状态不支持改期。";
    case "ORDER_RESPONSE_WINDOW_EXPIRED": return "预约响应时限已结束，无法再提交改期。";
    case "ORDER_REFUND_IN_PROGRESS": return "退款处理中，暂不能发起改期。";
    case "RESCHEDULE_SCHEDULE_UNCHANGED": return "新时间与原预约相同，请选择其他时段。";
    case "RESCHEDULE_SCHEDULE_TOO_SOON": return "新时间需至少预留 15 分钟。";
    case "RESCHEDULE_SCHEDULE_TOO_FAR": return "新时间超出当前可预约范围。";
    case "RESCHEDULE_AVAILABILITY_REQUIRED": return "此预约需要选择一个新的可约时段。";
    case "RESCHEDULE_RESPONSE_WINDOW_TOO_SHORT": return "原预约时间过近，无法留出有效协商时限。";
    case "RESCHEDULE_REQUEST_PENDING": return "已有改期协商等待回应，请先查看订单进度。";
    case "AVAILABILITY_WINDOW_UNAVAILABLE": return "所选时段已失效，请重新读取可约时间。";
    case "AVAILABILITY_SLOT_INVALID": return "所选时段不再满足本次服务，请重新选择。";
    case "COMPANION_SLOT_UNAVAILABLE": return "所选时段刚刚被占用，请重新选择。";
    default: return error.message || "提交改期提议失败，请稍后重试。";
  }
}

function rescheduleResponseFailureMessage(error: ApiError): string {
  switch (error.code) {
    case "RESCHEDULE_REQUEST_EXPIRED": return "这份改期提议已超时，原预约保持不变。";
    case "RESCHEDULE_REQUEST_INVALID_STATE": return "这份改期提议已被处理，请刷新订单进度。";
    case "RESCHEDULE_REQUEST_SELF_RESPONSE_FORBIDDEN": return "发起提议的一方不能处理自己的改期请求。";
    case "RESCHEDULE_REQUEST_AVAILABILITY_MISSING": return "这份提议缺少可验证的预约时段，无法接受。";
    default: return rescheduleFailureMessage(error);
  }
}

function refundFailureMessage(error: ApiError): string {
  switch (error.code) {
    case "ORDER_INVALID_STATE": return "订单状态已变化，暂时不能自助申请退款，请刷新后重试。";
    case "REFUND_REQUEST_WINDOW_CLOSED": return "自助售后期限已结束；如需提交争议，请联系平台客服。";
    case "PAYMENT_NOT_FOUND": return "未找到成功支付记录，暂时无法申请退款，请联系平台客服。";
    case "ORDER_NOT_FOUND": return "订单不存在或你无权申请退款，请刷新订单。";
    default: return error.message || "退款申请暂未提交，请稍后重试。";
  }
}

function fulfillmentActionFailureMessage(error: ApiError, action: "start" | "complete"): string {
  switch (error.code) {
    case "ORDER_SERVICE_NOT_READY": return "尚未进入开始服务窗口，请等待预约前 15 分钟内再操作。";
    case "ORDER_SERVICE_WINDOW_EXPIRED": return "预约服务窗口已结束，请联系平台客服处理。";
    case "ORDER_SERVICE_NOT_COMPLETE": return "服务时长尚未结束，暂不能标记完成。";
    case "ORDER_REFUND_IN_PROGRESS": return "退款处理中，暂不能开始服务。";
    case "ORDER_INVALID_STATE": return action === "start"
      ? "订单状态已变化，暂不能开始服务，请刷新后重试。"
      : "订单状态已变化，暂不能标记完成，请刷新后重试。";
    default: return error.message || (action === "start" ? "无法开始服务" : "无法完成服务");
  }
}

function actorLabel(actorRole: string, viewerRole: OrderViewerRole): string {
  if (actorRole === viewerRole) return "你";
  if (actorRole === "customer") return "客户";
  if (actorRole === "companion") return "陪伴者";
  return "系统";
}

function rescheduleDescription(
  request: OrderRescheduleRequest | null,
  fallback: string,
  includeDeadline = false
): string {
  if (!request) return fallback;
  const original = formatDateTime(request.originalScheduledAt);
  const requested = formatDateTime(request.requestedScheduledAt);
  const deadline = includeDeadline && request.status === "pending"
    ? ` 请在 ${formatDateTime(request.expiresAt)} 前回应。`
    : "";
  return `原预约：${original}；提议调整为：${requested}。${deadline}`;
}

function displayTimelineEvent(event: OrderTimelineEvent, viewerRole: OrderViewerRole): DisplayTimelineItem {
  const request = event.rescheduleRequest;
  const actor = actorLabel(event.actorRole, viewerRole);
  switch (event.type) {
    case "orderCreated":
      return {
        id: event.id,
        title: "预约已创建",
        description: request ? rescheduleDescription(request, "订单已进入预约流程。") : "订单已进入预约流程。",
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "neutral"
      };
    case "rescheduleRequested":
      return {
        id: event.id,
        title: `${actor}提出改期`,
        description: rescheduleDescription(request, "已提交改期协商。", true),
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "active"
      };
    case "rescheduleAccepted":
      return {
        id: event.id,
        title: `${actor}确认改期`,
        description: request
          ? `预约已调整至：${formatDateTime(request.requestedScheduledAt)}。`
          : "双方已确认新的预约时间。",
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "resolved"
      };
    case "rescheduleRejected":
      return {
        id: event.id,
        title: `${actor}未接受改期`,
        description: request
          ? `原预约保持：${formatDateTime(request.originalScheduledAt)}。`
          : "原预约时间保持不变。",
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "closed"
      };
    case "rescheduleExpired":
      return {
        id: event.id,
        title: "改期请求已超时",
        description: request
          ? `原预约保持：${formatDateTime(request.originalScheduledAt)}。`
          : "双方未在时限内确认，原预约保持不变。",
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "closed"
      };
    case "rescheduleCancelled":
      return {
        id: event.id,
        title: "改期请求已自动关闭",
        description: request
          ? `订单状态已变化，原预约记录为：${formatDateTime(request.originalScheduledAt)}。`
          : "订单状态已变化，改期协商已自动关闭。",
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "closed"
      };
    default:
      return {
        id: event.id,
        title: "订单进度已更新",
        description: "订单状态已有更新，请以当前订单状态为准。",
        occurredAt: event.occurredAt,
        occurredAtText: formatDateTime(event.occurredAt),
        tone: "neutral"
      };
  }
}

function lifecycleTimelineItems(order: Order, viewerRole: OrderViewerRole): DisplayTimelineItem[] {
  const actor = viewerRole === "companion" ? "客户" : "陪伴者";
  const items: DisplayTimelineItem[] = [];
  if (order.paidAt) {
    items.push({
      id: `paid:${order.id}`, title: "支付已完成", description: "预约时段已保留，等待按约开始服务。",
      occurredAt: order.paidAt, occurredAtText: formatDateTime(order.paidAt), tone: "resolved"
    });
  }
  if (order.serviceStartedAt) {
    items.push({
      id: `service-started:${order.id}`, title: "服务已开始", description: `${actor}已在订单中开始本次服务。`,
      occurredAt: order.serviceStartedAt, occurredAtText: formatDateTime(order.serviceStartedAt), tone: "active"
    });
  }
  if (order.completedAt) {
    items.push({
      id: `service-completed:${order.id}`, title: "服务已完成", description: "本次服务已标记完成，售后期限以订单说明为准。",
      occurredAt: order.completedAt, occurredAtText: formatDateTime(order.completedAt), tone: "resolved"
    });
  }
  if (order.customerConfirmedAt) {
    items.push({
      id: `customer-confirmed:${order.id}`, title: "客户已确认完成", description: "客户已确认本次服务完成。",
      occurredAt: order.customerConfirmedAt, occurredAtText: formatDateTime(order.customerConfirmedAt), tone: "resolved"
    });
  }
  if (order.cancelledAt) {
    items.push({
      id: `cancelled:${order.id}`, title: "订单已取消", description: "本次预约已取消，不再进入履约流程。",
      occurredAt: order.cancelledAt, occurredAtText: formatDateTime(order.cancelledAt), tone: "closed"
    });
  }
  return items;
}

function mergeTimeline(order: Order, events: OrderTimelineEvent[], viewerRole: OrderViewerRole): DisplayTimelineItem[] {
  const items = events.map((event) => displayTimelineEvent(event, viewerRole));
  if (!items.some((item) => item.title === "预约已创建")) {
    items.push({
      id: `created:${order.id}`, title: "预约已创建", description: "订单已进入预约流程。",
      occurredAt: order.createdAt, occurredAtText: formatDateTime(order.createdAt), tone: "neutral"
    });
  }
  items.push(...lifecycleTimelineItems(order, viewerRole));
  return items.sort((left, right) => {
    const timeDifference = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

function describeOrderStatus(
  order: Order,
  viewerRole: OrderViewerRole,
  paymentDeadline: string | undefined,
  completionEligibleAt: Date | null
): string {
  if (order.refund) return refundPresentation(order.refund).statusExplanation;
  if (order.status === "pending") {
    if (order.companionConfirmedAt) return `陪伴者已确认，请在 ${formatDateTime(paymentDeadline)} 前完成支付；超时会释放预约时段。`;
    return viewerRole === "companion"
      ? `请在 ${formatDateTime(order.companionResponseDeadlineAt)} 前确认或拒绝这笔预约，超时将自动关闭。`
      : `等待陪伴者在 ${formatDateTime(order.companionResponseDeadlineAt)} 前响应，确认前不会扣款。`;
  }
  if (order.status === "paying") return `支付结果确认中，请勿重复付款；可稍后下拉刷新订单。`;
  if (order.status === "paid") return viewerRole === "companion"
    ? `客户已支付，临近预约时间后可在订单中开始服务。`
    : `预约已支付，将按 ${formatDateTime(order.scheduledAt)} 开始服务。`;
  if (order.status === "inService") return viewerRole === "companion"
    ? `服务进行中，${formatDateTime(completionEligibleAt?.toISOString())} 后可标记完成。`
    : `服务正在进行；如遇履约或安全问题，可从订单提交客服工单。`;
  if (order.status === "completed") return order.refundRequestDeadlineAt
    ? `服务已完成；自助售后截止：${formatDateTime(order.refundRequestDeadlineAt)}。`
    : `服务已完成；如有问题仍可从订单联系平台客服。`;
  if (order.status === "refunded") return "退款已完成，到账时间以微信支付记录为准。";
  if (order.status === "cancelled") return "订单已取消，原预约不再保留。";
  return "订单状态正在更新，请下拉刷新查看最新进度。";
}

function displayOrder(order: Order, viewerRole: OrderViewerRole): DisplayOrder {
  const scheduledAt = order.scheduledAt ? new Date(order.scheduledAt) : null;
  const scheduledPaymentCutoff = scheduledAt && !Number.isNaN(scheduledAt.getTime())
    ? new Date(scheduledAt.getTime() - 5 * 60_000).toISOString()
    : undefined;
  const reservationDeadline = order.paymentReservationExpiresAt;
  const paymentDeadline = [scheduledPaymentCutoff, reservationDeadline]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0]
    ?.toISOString();
  const serviceStartedAt = order.serviceStartedAt ? new Date(order.serviceStartedAt) : scheduledAt;
  const completionEligibleAt = serviceStartedAt && !Number.isNaN(serviceStartedAt.getTime()) && scheduledAt && !Number.isNaN(scheduledAt.getTime())
    ? new Date(Math.max(serviceStartedAt.getTime(), scheduledAt.getTime()) + order.durationMinutes * 60_000)
    : null;
  const refundDeadline = order.refundRequestDeadlineAt ? new Date(order.refundRequestDeadlineAt) : null;
  const canRequestRefund = !hasActiveRefund(order) && (["paid", "inService"].includes(order.status) || (
    order.status === "completed" && Boolean(refundDeadline && !Number.isNaN(refundDeadline.getTime()) && refundDeadline.getTime() > Date.now())
  ));
  const refundState = order.refund ? refundPresentation(order.refund) : null;
  const fulfillment = fulfillmentDisplayPatch(order, viewerRole);
  const serviceGuidelines = serviceGuidelinesGuidance(order, viewerRole);
  const experienceFeedback = experienceFeedbackDisplayPatch(order, viewerRole);
  const rebooking = rebookingDisplayPatch(order, viewerRole);
  const rescheduleDefaults = rescheduleDateTimeDefaults();
  return {
    ...order,
    displayName: serviceName(order),
    scheduledAtText: formatDateTime(order.scheduledAt),
    paymentDeadlineText: formatDateTime(paymentDeadline),
    responseDeadlineText: formatDateTime(order.companionResponseDeadlineAt ?? undefined),
    completionEligibleAtText: formatDateTime(completionEligibleAt?.toISOString()),
    canCompleteService: Boolean(completionEligibleAt && Date.now() >= completionEligibleAt.getTime()),
    canRequestRefund,
    refundActionText: order.status === "paid" ? "申请原路退款" : "提交售后申请",
    refundDeadlineText: formatDateTime(order.refundRequestDeadlineAt ?? undefined),
    refundStatusText: refundState?.statusText || "",
    refundStatusExplanation: refundState?.statusExplanation || "",
    refundTone: refundState?.tone || "neutral",
    refundAmountText: order.refund ? `¥${(order.refund.amountCents / 100).toFixed(2)}` : "",
    refundReasonText: order.refund?.reason?.trim() || "未填写具体原因",
    refundReviewLabel: order.refund?.status === "rejected" ? "审核说明" : "平台说明",
    refundReviewText: order.refund?.reviewNote?.trim() || "",
    refundFailureText: order.refund?.failureReason?.trim() || "",
    refundCanContactSupport: Boolean(refundState?.canContactSupport),
    refundSupportActionText: viewerRole === "customer" ? "补充情况 / 联系客服" : "联系平台客服",
    ...fulfillment,
    hasServiceGuidelines: serviceGuidelines.show,
    serviceGuidelinesProgress: serviceGuidelines.progress,
    serviceGuidelinesSummary: serviceGuidelines.summary,
    customerServiceGuidelinesStatus: serviceGuidelines.customerStatus,
    companionServiceGuidelinesStatus: serviceGuidelines.companionStatus,
    canConfirmServiceGuidelines: serviceGuidelines.canConfirm,
    serviceGuidelinesActionText: serviceGuidelines.actionText,
    ...experienceFeedback,
    ...rebooking,
    amountText: `¥${(order.amountCents / 100).toFixed(2)}`,
    statusText: ORDER_STATUS_LABELS[order.status] || "状态处理中",
    statusExplanation: describeOrderStatus(order, viewerRole, paymentDeadline, completionEligibleAt),
    timelineOpen: false,
    timelineState: "idle",
    timelineToggleText: "查看订单进度",
    timelineItems: [],
    timelineError: "",
    canInitiateReschedule: canInitiateReschedule(order),
    rescheduleOpen: false,
    rescheduleState: "idle",
    rescheduleToggleText: "申请改期",
    rescheduleMessage: "",
    rescheduleDateGroups: [],
    selectedRescheduleCandidate: null,
    selectedRescheduleCandidateId: "",
    rescheduleDate: rescheduleDefaults.date,
    rescheduleTime: rescheduleDefaults.time,
    rescheduleSubmitEnabled: false,
    rescheduleSubmitting: false,
    rescheduleSubmitText: "提交改期提议",
    pendingReschedule: null,
    pendingRescheduleText: "",
    pendingRescheduleOriginalText: "",
    pendingRescheduleRequestedText: "",
    pendingRescheduleDeadlineText: "",
    canRespondToReschedule: false,
    rescheduleResponseAction: "",
    rescheduleResponseError: ""
  };
}

const PAYMENT_SYNC_RETRY_DELAYS_MS = [0, 400, 900];
const CUSTOMER_ORDER_NOTIFICATION_KEYS = [
  "reservationExpired", "serviceStarted", "serviceCompleted", "supportUpdate",
  "rescheduleRequested", "rescheduleAccepted", "rescheduleRejected",
  "rescheduleExpired", "rescheduleCancelled"
];
const COMPANION_ORDER_NOTIFICATION_KEYS = [
  "newOrder", "orderCancelled", "supportUpdate",
  "rescheduleRequested", "rescheduleAccepted", "rescheduleRejected",
  "rescheduleExpired", "rescheduleCancelled"
];

async function confirmOrderNotificationSetup(viewerRole: OrderViewerRole): Promise<boolean> {
  const customer = viewerRole === "customer";
  const result = await new Promise<any>((resolve) => wx.showModal({
    title: customer ? "开启订单提醒" : "开启接单提醒",
    content: customer
      ? "将按微信每次最多 3 项的规则分批请求：服务状态、售后处理、改期处理、改期超时或自动关闭。未授权不影响订单内消息和操作。"
      : "将按微信每次最多 3 项的规则分批请求：新订单/取消/客服更新、改期处理、改期超时或自动关闭。未授权不影响接单和订单内消息。",
    confirmText: "开始授权",
    success: resolve,
    fail: () => resolve({ confirm: false })
  }));
  return Boolean(result?.confirm);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function confirmPaymentWithBackend(orderId: string): Promise<boolean> {
  for (const retryDelay of PAYMENT_SYNC_RETRY_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay);
    try {
      const result = await api.syncPayment(orderId);
      if (result.code === "SUCCESS" || ["paid", "inService", "completed", "refunded"].includes(result.data.orderStatus)) {
        return true;
      }
    } catch {
      // requestPayment success means WeChat accepted the payment. A transient
      // backend query failure must not be presented to the user as payment loss.
    }
  }
  return false;
}

Page({
  data: {
    orders: [] as DisplayOrder[], serviceOrders: [] as DisplayOrder[], supportTickets: [] as DisplaySupportTicket[], followupRecommendations: [] as RecommendedCompanion[],
    loading: true, error: "", payingId: "", confirmingGuidelinesId: "", submittingSupportFactId: ""
  },
  stopRecommendationTracking: null as (() => void) | null,
  fulfillmentTimer: null as ReturnType<typeof setInterval> | null,
  onShow() {
    this.startFulfillmentTimer();
    void this.load();
  },
  onHide() {
    this.stopTracking();
    this.stopFulfillmentTimer();
  },
  onUnload() {
    this.stopTracking();
    this.stopFulfillmentTimer();
  },
  onPullDownRefresh() { void this.load(true); },
  async load(stopRefresh = false) {
    this.stopTracking();
    this.setData({ loading: true, error: "" });
    try {
      await ensureSession();
      const [customer, service, support] = await Promise.all([
        api.orders(),
        api.serviceOrders().catch(() => ({ items: [] as Order[] })),
        api.supportTickets().catch(() => ({ items: [] }))
      ]);
      const latestCompleted = (customer.items || []).find((order) => order.status === "completed");
      const recommendations = latestCompleted
        ? await api.recommendedCompanions({
            placement: "orderFollowup",
            themeId: latestCompleted.themeId,
            pageSize: 4
          }).catch(() => ({ items: [] as RecommendedCompanion[] }))
        : { items: [] as RecommendedCompanion[] };
      this.setData({
        orders: (customer.items || []).map((order) => displayOrder(order, "customer")),
        serviceOrders: (service.items || []).map((order) => displayOrder(order, "companion")),
        supportTickets: (support.items || []).map((ticket) => ({
          ...ticket,
          orderFacts: (ticket.orderFacts || []).map((fact) => ({
            ...fact,
            createdAtText: formatDateTime(fact.createdAt)
          })),
          canAddOrderFact: Boolean(
            ticket.orderId
            && ["orderIssue", "refund"].includes(ticket.category)
            && ["open", "inProgress"].includes(ticket.status)
            && (ticket.orderFacts || []).length < 10
          ),
          statusText: ({ open: "待受理", inProgress: "处理中", resolved: "已处理", closed: "已关闭" } as Record<string, string>)[ticket.status] || ticket.status,
          updatedAtText: formatDateTime(ticket.updatedAt)
        })),
        followupRecommendations: recommendations.items || [],
        loading: false
      });
      setTimeout(() => this.startTracking(), 0);
    } catch (error) { this.setData({ loading: false, error: (error as Error).message || "加载订单失败" }); }
    finally { if (stopRefresh) wx.stopPullDownRefresh(); }
  },
  startTracking() {
    if (!this.data.followupRecommendations.length) return;
    this.stopRecommendationTracking = trackRecommendationCardViews(this, this.data.followupRecommendations, "order-followup-recommendation");
  },
  stopTracking() {
    this.stopRecommendationTracking?.();
    this.stopRecommendationTracking = null;
    void flushRecommendationEvents();
  },
  startFulfillmentTimer() {
    if (this.fulfillmentTimer) return;
    this.refreshFulfillmentGuidance();
    this.fulfillmentTimer = setInterval(() => this.refreshFulfillmentGuidance(), FULFILLMENT_REFRESH_INTERVAL_MS);
  },
  stopFulfillmentTimer() {
    if (!this.fulfillmentTimer) return;
    clearInterval(this.fulfillmentTimer);
    this.fulfillmentTimer = null;
  },
  refreshFulfillmentGuidance() {
    const refresh = (items: DisplayOrder[], viewerRole: OrderViewerRole) => items.map((item) => ({
      ...item,
      ...fulfillmentDisplayPatch(item, viewerRole)
    }));
    this.setData({
      orders: refresh(this.data.orders as DisplayOrder[], "customer"),
      serviceOrders: refresh(this.data.serviceOrders as DisplayOrder[], "companion")
    });
  },
  patchOrder(id: string, patch: Partial<DisplayOrder>) {
    const patchItems = (items: DisplayOrder[]) => items.map((item) => item.id === id ? { ...item, ...patch } : item);
    this.setData({
      orders: patchItems(this.data.orders as DisplayOrder[]),
      serviceOrders: patchItems(this.data.serviceOrders as DisplayOrder[])
    });
  },
  orderContext(id: string): { order: DisplayOrder; viewerRole: OrderViewerRole } | null {
    const customerOrder = (this.data.orders as DisplayOrder[]).find((item) => item.id === id);
    if (customerOrder) return { order: customerOrder, viewerRole: "customer" };
    const serviceOrder = (this.data.serviceOrders as DisplayOrder[]).find((item) => item.id === id);
    return serviceOrder ? { order: serviceOrder, viewerRole: "companion" } : null;
  },
  async toggleTimeline(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context) return;
    const { order, viewerRole } = context;
    if (order.timelineOpen) {
      this.patchOrder(id, { timelineOpen: false, timelineToggleText: "查看订单进度" });
      return;
    }
    if (order.timelineState === "loading") return;
    if (order.timelineState === "loaded") {
      this.patchOrder(id, { timelineOpen: true, timelineToggleText: "收起订单进度" });
      return;
    }
    this.patchOrder(id, {
      timelineOpen: true,
      timelineState: "loading",
      timelineToggleText: "收起订单进度",
      timelineError: ""
    });
    try {
      const timeline = await api.orderTimeline(id);
      const pending = findPendingReschedule(timeline.items || []);
      this.patchOrder(id, {
        timelineState: "loaded",
        timelineItems: mergeTimeline(order, timeline.items || [], viewerRole),
        ...(pending ? pendingReschedulePatch(pending, viewerRole) : {
          pendingReschedule: null,
          pendingRescheduleText: "",
          pendingRescheduleOriginalText: "",
          pendingRescheduleRequestedText: "",
          pendingRescheduleDeadlineText: "",
          canRespondToReschedule: false,
          rescheduleResponseAction: "",
          rescheduleResponseError: "",
          canInitiateReschedule: canInitiateReschedule(order)
        })
      });
    } catch {
      this.patchOrder(id, {
        timelineState: "unavailable",
        timelineError: "订单进度暂时无法加载，请稍后重试。"
      });
    }
  },
  async toggleReschedule(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context) return;
    if (context.order.rescheduleOpen) {
      this.patchOrder(id, { rescheduleOpen: false, rescheduleToggleText: "申请改期" });
      return;
    }
    await this.prepareReschedule(id);
  },
  async reloadReschedule(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    await this.prepareReschedule(id);
  },
  async prepareReschedule(id: string) {
    const context = this.orderContext(id);
    if (!context) return;
    const { order, viewerRole } = context;
    if (!order.canInitiateReschedule && !order.pendingReschedule) {
      wx.showToast({ title: "当前订单状态不支持改期", icon: "none" });
      return;
    }
    const defaults = rescheduleDateTimeDefaults();
    this.patchOrder(id, {
      rescheduleOpen: true,
      rescheduleState: "loading",
      rescheduleToggleText: "收起改期",
      rescheduleMessage: "正在核对改期协商与可约时段…",
      rescheduleDateGroups: [],
      selectedRescheduleCandidate: null,
      selectedRescheduleCandidateId: "",
      rescheduleDate: defaults.date,
      rescheduleTime: defaults.time,
      rescheduleSubmitEnabled: false,
      rescheduleSubmitting: false,
      pendingReschedule: null,
      pendingRescheduleText: ""
    });
    try {
      // Check the participant-safe timeline first. This avoids presenting a
      // second proposal form when the other person is already waiting on one.
      const timeline = await api.orderTimeline(id);
      const pending = findPendingReschedule(timeline.items || []);
      if (pending) {
        this.patchOrder(id, {
          rescheduleState: "pending",
          ...pendingReschedulePatch(pending, viewerRole),
          rescheduleMessage: "已有改期协商等待回应。"
        });
        return;
      }

      const availability = await api.companionAvailability(order.companionId, {
        ...(order.serviceOfferingId ? { serviceOfferingId: order.serviceOfferingId } : {}),
        durationMinutes: order.durationMinutes,
        days: 14
      });
      if (availability.source === "structured") {
        const rawCandidates = Array.isArray(availability.items) ? availability.items : [];
        const candidates = rawCandidates
          .filter((candidate) => isBookableRescheduleCandidate(candidate, order.durationMinutes))
          .map(rescheduleSlot)
          .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
        if (rawCandidates.length > 0 && candidates.length === 0) {
          this.patchOrder(id, {
            rescheduleState: "unavailable",
            rescheduleMessage: "可约时段数据异常，请稍后重新读取。"
          });
          return;
        }
        if (candidates.length === 0) {
          this.patchOrder(id, {
            rescheduleState: "empty",
            rescheduleMessage: "未来两周没有可用于改期的时段，请稍后再试。"
          });
          return;
        }
        this.patchOrder(id, {
          rescheduleState: "structured",
          rescheduleMessage: "请选择一个新的可约时段；提交后仍需对方确认，原预约暂时不变。",
          rescheduleDateGroups: rescheduleDateGroups(candidates)
        });
        return;
      }
      if (availability.source === "legacy" && !isStructuredOrder(order)) {
        const commonTimes = (availability.legacyAvailableTimes || []).filter((value) => value.trim());
        this.patchOrder(id, {
          rescheduleState: "legacy",
          rescheduleMessage: commonTimes.length
            ? `常见可约时段：${commonTimes.join("、")}。请填写新的北京时间，提交后等待对方确认。`
            : "请填写新的北京时间，提交后等待对方确认。"
        });
        return;
      }
      this.patchOrder(id, {
        rescheduleState: "unavailable",
        rescheduleMessage: "这笔预约需要选择新的结构化可约时段，当前暂时无法读取。"
      });
    } catch {
      this.patchOrder(id, {
        rescheduleState: "unavailable",
        rescheduleMessage: "改期协商或可约时段暂时无法读取，请稍后重试。"
      });
    }
  },
  selectRescheduleCandidate(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(String(event.currentTarget.dataset.orderId || ""));
    if (!context || context.order.rescheduleState !== "structured") return;
    const candidate = context.order.rescheduleDateGroups
      .flatMap((group) => group.items)
      .find((item) => item.id === id);
    if (!candidate || !isBookableRescheduleCandidate(candidate, context.order.durationMinutes)) return;
    const slot = candidate as RescheduleSlot;
    this.patchOrder(context.order.id, {
      selectedRescheduleCandidate: slot,
      selectedRescheduleCandidateId: slot.id,
      rescheduleDate: slot.dateKey,
      rescheduleTime: slot.timeLabel,
      rescheduleSubmitEnabled: true,
      rescheduleSubmitText: "提交改期提议"
    });
  },
  setRescheduleDate(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.order.rescheduleState !== "legacy") return;
    this.patchOrder(id, {
      rescheduleDate: event.detail.value,
      rescheduleSubmitEnabled: Boolean(event.detail.value && context.order.rescheduleTime)
    });
  },
  setRescheduleTime(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.order.rescheduleState !== "legacy") return;
    this.patchOrder(id, {
      rescheduleTime: event.detail.value,
      rescheduleSubmitEnabled: Boolean(context.order.rescheduleDate && event.detail.value)
    });
  },
  async submitReschedule(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context) return;
    const { order, viewerRole } = context;
    let requestedScheduledAt: Date;
    let availabilityWindowId: string | undefined;
    if (order.rescheduleState === "structured") {
      const candidate = order.selectedRescheduleCandidate;
      if (!candidate || !isBookableRescheduleCandidate(candidate, order.durationMinutes)) {
        wx.showToast({ title: "请选择新的可约时段", icon: "none" });
        return;
      }
      requestedScheduledAt = new Date(candidate.startsAt);
      availabilityWindowId = candidate.availabilityWindowId;
    } else if (order.rescheduleState === "legacy") {
      requestedScheduledAt = parseShanghaiDateTime(order.rescheduleDate, order.rescheduleTime);
    } else {
      wx.showToast({ title: order.rescheduleMessage || "暂时无法提交改期", icon: "none" });
      return;
    }
    if (!Number.isFinite(requestedScheduledAt.getTime()) || requestedScheduledAt.getTime() <= Date.now() + 15 * 60_000) {
      wx.showToast({ title: "新时间需至少预留 15 分钟", icon: "none" });
      return;
    }
    if (new Date(order.scheduledAt || "").getTime() === requestedScheduledAt.getTime()) {
      wx.showToast({ title: "新时间与原预约相同", icon: "none" });
      return;
    }
    this.patchOrder(id, { rescheduleSubmitting: true, rescheduleSubmitText: "正在提交…" });
    try {
      const request = await api.createOrderRescheduleRequest(id, {
        requestedScheduledAt: requestedScheduledAt.toISOString(),
        ...(availabilityWindowId ? { availabilityWindowId } : {})
      });
      this.patchOrder(id, {
        rescheduleState: "pending",
        rescheduleMessage: "改期提议已发送，原预约保持不变，等待对方确认。",
        rescheduleSubmitEnabled: false,
        rescheduleSubmitText: "改期提议已提交",
        ...pendingReschedulePatch(request, viewerRole),
        timelineOpen: false,
        timelineState: "idle",
        timelineToggleText: "查看订单进度",
        timelineItems: [],
        timelineError: ""
      });
      wx.showToast({ title: "改期提议已发送", icon: "success" });
    } catch (error) {
      const apiError = error as ApiError;
      const staleAvailabilityCodes = ["COMPANION_SLOT_UNAVAILABLE", "AVAILABILITY_WINDOW_UNAVAILABLE", "AVAILABILITY_SLOT_INVALID"];
      if (apiError.code === "RESCHEDULE_REQUEST_PENDING" || staleAvailabilityCodes.includes(apiError.code || "")) {
        wx.showToast({ title: rescheduleFailureMessage(apiError), icon: "none" });
        await this.prepareReschedule(id);
        return;
      }
      wx.showToast({ title: rescheduleFailureMessage(apiError), icon: "none" });
    } finally {
      this.patchOrder(id, { rescheduleSubmitting: false });
    }
  },
  async respondReschedule(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const action = event.currentTarget.dataset.action === "accept" ? "accept" : "reject";
    const context = this.orderContext(id);
    const request = context?.order.pendingReschedule;
    if (!context || !request || !context.order.canRespondToReschedule) return;
    const accepting = action === "accept";
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: accepting ? "确认接受改期" : "确认拒绝改期",
      content: accepting
        ? `确认后预约将调整为 ${context.order.pendingRescheduleRequestedText}。服务端会再次核对时段和订单状态。`
        : `拒绝后原预约 ${context.order.pendingRescheduleOriginalText} 保持不变。`,
      confirmText: accepting ? "接受改期" : "保持原预约",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.patchOrder(id, { rescheduleResponseAction: action, rescheduleResponseError: "" });
    try {
      if (accepting) {
        await api.acceptOrderRescheduleRequest(id, request.id);
        wx.showToast({ title: "已接受改期", icon: "success" });
      } else {
        await api.rejectOrderRescheduleRequest(id, request.id);
        wx.showToast({ title: "已保持原预约", icon: "success" });
      }
      // Reload both sources: accept changes Order.scheduledAt, while reject
      // preserves it but appends a participant-visible timeline outcome.
      await this.load();
      await this.toggleTimeline({ currentTarget: { dataset: { id } } });
    } catch (error) {
      const apiError = error as ApiError;
      const message = rescheduleResponseFailureMessage(apiError);
      const refreshCodes = [
        "RESCHEDULE_REQUEST_EXPIRED",
        "RESCHEDULE_REQUEST_INVALID_STATE",
        "COMPANION_SLOT_UNAVAILABLE",
        "AVAILABILITY_WINDOW_UNAVAILABLE",
        "AVAILABILITY_SLOT_INVALID",
        "ORDER_REFUND_IN_PROGRESS",
        "RESCHEDULE_ORDER_INVALID_STATE"
      ];
      this.patchOrder(id, { rescheduleResponseError: message });
      wx.showToast({ title: message, icon: "none" });
      if (refreshCodes.includes(apiError.code || "")) {
        await this.load();
        await this.toggleTimeline({ currentTarget: { dataset: { id } } });
      }
    } finally {
      this.patchOrder(id, { rescheduleResponseAction: "" });
    }
  },
  async pay(event: any) {
    const id = event.currentTarget.dataset.id;
    const order = (this.data.orders as DisplayOrder[]).find((item) => item.id === id);
    if (!order) {
      wx.showToast({ title: "订单不存在，请刷新后重试", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认订单并支付",
      content: [
        `服务对象：${order.displayName}`,
        `预约时间：${order.scheduledAtText}`,
        `服务时长：${order.durationMinutes} 分钟`,
        `支付金额：${order.amountText}`,
        `支付截止：${order.paymentDeadlineText}（确认保留或预约前 5 分钟截止，以更早者为准）`,
        "未开始服务可申请全额原路退款；服务中或完成后申请将进入人工审核。"
      ].join("\n"),
      confirmText: "确认支付",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    this.setData({ payingId: id });
    try {
      await ensurePrivacyAuthorization();
      await requestTransactionalSubscriptions(["paymentSuccess", "serviceStarted", "serviceCompleted"]);
      const prepay = await api.prepay(id);
      if (prepay.payment.mock) {
        await api.mockNotify(prepay.payment.outTradeNo);
        wx.showToast({ title: "测试支付已完成", icon: "success" });
      } else {
        const params = prepay.payment.wechatMiniProgramParams;
        if (!params) throw new Error("支付参数不完整");
        await new Promise<void>((resolve, reject) => wx.requestPayment({
          ...params,
          success: () => resolve(),
          fail: (reason: any) => reject(reason?.errMsg?.includes("cancel") ? new Error("已取消支付") : new Error("支付未完成"))
        }));
        const confirmed = await confirmPaymentWithBackend(id);
        wx.showToast(confirmed
          ? { title: "支付已确认", icon: "success" }
          : { title: "支付结果确认中，请稍后刷新订单", icon: "none", duration: 3000 });
      }
      await this.load();
    } catch (error) { wx.showToast({ title: (error as Error).message || "支付失败", icon: "none" }); }
    finally { this.setData({ payingId: "" }); }
  },
  async cancel(event: any) {
    try { await api.cancelOrder(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "取消失败", icon: "none" }); }
  },
  async refund(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "customer") {
      wx.showToast({ title: "订单信息已变化，请刷新后重试", icon: "none" });
      return;
    }
    const { order } = context;
    if (!order.canRequestRefund) {
      wx.showToast({ title: "当前订单暂不能重复申请退款", icon: "none" });
      return;
    }
    const requiresReview = ["inService", "completed"].includes(order.status);
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: requiresReview ? "提交售后申请" : "申请原路退款",
      editable: true,
      placeholderText: "请简要说明退款原因（2–200 字）",
      content: requiresReview
        ? "服务已开始或完成，本次申请会进入人工审核。请说明发生的情况和希望平台核对的内容；平台会在订单内更新结果。"
        : "服务尚未开始，符合规则的订单会按原支付路径退款。请说明退款原因，到账时间以微信支付记录为准。",
      confirmText: "提交申请",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    const reason = String(confirmation.content || "").trim();
    if (reason.length < 2) {
      wx.showToast({ title: "请至少写明两个字的退款原因", icon: "none" });
      return;
    }
    if (reason.length > 200) {
      wx.showToast({ title: "退款原因请控制在 200 字内", icon: "none" });
      return;
    }
    try {
      const result = await api.refund(id, reason);
      const title = result.refund.status === "success"
        ? "退款已完成"
        : result.refund.status === "pendingReview"
          ? "售后申请已提交"
          : "退款申请已受理";
      wx.showToast({ title, icon: "success" });
      await this.load();
    } catch (error) {
      const apiError = error as ApiError;
      wx.showToast({ title: refundFailureMessage(apiError), icon: "none" });
      if (["ORDER_INVALID_STATE", "REFUND_REQUEST_WINDOW_CLOSED"].includes(apiError.code || "")) await this.load();
    }
  },
  async confirmCompletion(event: any) {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认服务完成",
      content: "确认代表本次服务已按约完成，但不会缩短售后申请期限。已有退款或客服争议时不可确认。",
      confirmText: "确认完成",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    try {
      await api.confirmOrderCompletion(event.currentTarget.dataset.id);
      wx.showToast({ title: "已确认服务完成", icon: "success" });
      await this.load();
    } catch (error) { wx.showToast({ title: (error as Error).message || "确认失败", icon: "none" }); }
  },
  async confirmServiceGuidelines(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || !context.order.canConfirmServiceGuidelines) {
      wx.showToast({ title: "当前订单暂不能确认服务前约定", icon: "none" });
      return;
    }
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认服务前约定",
      content: "我已知晓：本次服务仅在平台内沟通，不替代医疗、心理治疗或紧急救助；我会尊重双方边界，遇到不适或安全风险立即暂停并联系平台客服。确认仅记录本次约定，不改变退款、服务开始或售后规则。",
      confirmText: "确认约定",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation?.confirm) return;
    this.setData({ confirmingGuidelinesId: id });
    try {
      await api.confirmOrderServiceGuidelines(id);
      wx.showToast({ title: "服务前约定已确认", icon: "success" });
      await this.load();
    } catch (error) {
      const apiError = error as ApiError;
      const message = apiError.code === "ORDER_SERVICE_GUIDELINES_INVALID_STATE"
        ? "仅限已支付且未开始的订单确认"
        : apiError.code === "ORDER_REFUND_IN_PROGRESS"
          ? "退款处理中，暂不能确认服务约定"
          : apiError.message || "确认服务前约定失败";
      wx.showToast({ title: message, icon: "none" });
      if (["ORDER_SERVICE_GUIDELINES_INVALID_STATE", "ORDER_REFUND_IN_PROGRESS"].includes(apiError.code || "")) {
        await this.load();
      }
    } finally {
      if (this.data.confirmingGuidelinesId === id) this.setData({ confirmingGuidelinesId: "" });
    }
  },
  updateExperienceFeedbackDraft(id: string, draft: Partial<ExperienceFeedbackDraft>) {
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "customer" || !context.order.canSubmitExperienceFeedback) return;
    this.patchOrder(id, experienceFeedbackDraftPatch(context.order, draft));
  },
  toggleExperienceFeedback(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "customer" || !context.order.canSubmitExperienceFeedback) return;
    this.updateExperienceFeedbackDraft(id, { experienceFeedbackOpen: !context.order.experienceFeedbackOpen });
  },
  setExperienceFeedbackRating(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const rating = Number(event.currentTarget.dataset.rating || 0);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
    this.updateExperienceFeedbackDraft(id, { experienceFeedbackRating: rating });
  },
  toggleExperienceFeedbackTag(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const tag = String(event.currentTarget.dataset.tag || "") as OrderExperienceFeedbackTag;
    if (!EXPERIENCE_FEEDBACK_TAG_OPTIONS.some((option) => option.value === tag)) return;
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "customer" || !context.order.canSubmitExperienceFeedback) return;
    const currentTags = context.order.experienceFeedbackTags;
    const nextTags = currentTags.includes(tag)
      ? currentTags.filter((item) => item !== tag)
      : currentTags.length >= 3
        ? null
        : [...currentTags, tag];
    if (!nextTags) {
      wx.showToast({ title: "最多选择 3 项体验标签", icon: "none" });
      return;
    }
    this.updateExperienceFeedbackDraft(id, { experienceFeedbackTags: nextTags });
  },
  setExperienceFeedbackNote(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    this.updateExperienceFeedbackDraft(id, { experienceFeedbackNote: String(event.detail.value || "").slice(0, 200) });
  },
  async submitExperienceFeedback(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "customer" || !context.order.canSubmitExperienceFeedback) {
      wx.showToast({ title: "当前订单暂不能提交体验反馈", icon: "none" });
      return;
    }
    const { order } = context;
    if (order.experienceFeedbackRating < 1 || order.experienceFeedbackRating > 5) {
      wx.showToast({ title: "请先选择 1–5 的体验刻度", icon: "none" });
      return;
    }
    const note = order.experienceFeedbackNote.trim();
    if (note.length > 200) {
      wx.showToast({ title: "反馈说明请控制在 200 字内", icon: "none" });
      return;
    }
    this.updateExperienceFeedbackDraft(id, { experienceFeedbackSubmitting: true });
    try {
      await api.submitOrderExperienceFeedback(id, {
        rating: order.experienceFeedbackRating,
        tags: order.experienceFeedbackTags,
        note: note || undefined
      });
      wx.showToast({ title: "体验反馈已记录", icon: "success" });
      await this.load();
    } catch (error) {
      const apiError = error as ApiError;
      const message = apiError.code === "ORDER_FEEDBACK_INVALID_STATE"
        ? "仅完成后的订单可提交体验反馈"
        : apiError.code === "ORDER_FEEDBACK_NOTE_REQUIRES_REVISION"
          ? "这段说明需要调整后再提交"
          : apiError.code === "CONTENT_MODERATION_UNAVAILABLE"
            ? "反馈说明审核暂不可用，请稍后重试"
            : apiError.message || "提交体验反馈失败";
      wx.showToast({ title: message, icon: "none" });
      if (["ORDER_FEEDBACK_INVALID_STATE", "ORDER_FEEDBACK_NOTE_REQUIRES_REVISION"].includes(apiError.code || "")) {
        await this.load();
      }
    } finally {
      const latest = this.orderContext(id);
      if (latest?.viewerRole === "customer" && latest.order.canSubmitExperienceFeedback) {
        this.updateExperienceFeedbackDraft(id, { experienceFeedbackSubmitting: false });
      }
    }
  },
  async startService(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    try {
      const started = await api.startService(id);
      await this.load();
      if (started.serviceOfferingSnapshot?.deliveryMode === "voice") this.navigateToVoiceRoom(id);
    }
    catch (error) {
      const apiError = error as ApiError;
      wx.showToast({ title: fulfillmentActionFailureMessage(apiError, "start"), icon: "none" });
      if (["ORDER_SERVICE_NOT_READY", "ORDER_SERVICE_WINDOW_EXPIRED", "ORDER_REFUND_IN_PROGRESS", "ORDER_INVALID_STATE"].includes(apiError.code || "")) {
        await this.load();
      }
    }
  },
  async confirmServiceOrder(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "companion") {
      wx.showToast({ title: "订单信息已变化，请刷新后重试", icon: "none" });
      return;
    }
    const realTimeVoice = isRealtimeVoiceService(context.order);
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "确认接单",
      content: realTimeVoice
        ? "确认后会为客户保留支付时段，客户支付后才生效。请在服务窗口内手动开始服务，双方才能进入订单内实时语音。"
        : "确认后会为客户保留支付时段，客户支付后才生效。请在服务窗口内手动开始本次服务。",
      confirmText: "确认接单",
      success: resolve,
      fail: () => resolve({ confirm: false })
    }));
    if (!confirmation?.confirm) return;
    try { await api.confirmServiceOrder(id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法确认预约", icon: "none" }); }
  },
  async rejectServiceOrder(event: any) {
    const confirmation = await new Promise<any>((resolve) => wx.showModal({
      title: "拒绝本次预约",
      content: "拒绝后订单会取消且客户不会被扣款。",
      success: resolve
    }));
    if (!confirmation.confirm) return;
    try { await api.rejectServiceOrder(event.currentTarget.dataset.id); await this.load(); }
    catch (error) { wx.showToast({ title: (error as Error).message || "无法拒绝预约", icon: "none" }); }
  },
  async completeService(event: any) {
    try { await api.completeService(event.currentTarget.dataset.id); await this.load(); }
    catch (error) {
      const apiError = error as ApiError;
      wx.showToast({ title: fulfillmentActionFailureMessage(apiError, "complete"), icon: "none" });
      if (["ORDER_SERVICE_NOT_COMPLETE", "ORDER_INVALID_STATE"].includes(apiError.code || "")) await this.load();
    }
  },
  async openOrderConversation(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || !context.order.canOpenOrderConversation) {
      wx.showToast({ title: "订单会话暂未开启，请刷新订单后重试", icon: "none" });
      return;
    }
    let conversationId = "";
    if (context.viewerRole === "customer") {
      conversationId = context.order.conversationId || "";
    } else {
      const customerId = context.order.customer?.id;
      if (!customerId) {
        wx.showToast({ title: "订单缺少客户会话信息，请联系平台客服", icon: "none" });
        return;
      }
      try {
        const result = await api.conversations();
        conversationId = result.conversations.find((conversation) => conversation.participant.id === customerId)?.id || "";
      } catch {
        wx.showToast({ title: "订单会话暂时无法读取，请稍后重试", icon: "none" });
        return;
      }
    }
    if (!conversationId) {
      wx.showToast({ title: "订单会话暂未开启，请刷新订单后重试", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(conversationId)}` });
  },
  openVoiceRoom(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || !context.order.canOpenRealtimeVoice) {
      wx.showToast({ title: "实时语音尚未到可进入时间，请刷新订单后重试", icon: "none" });
      return;
    }
    this.navigateToVoiceRoom(id);
  },
  navigateToVoiceRoom(orderId: string) {
    wx.navigateTo({ url: `/pages/voice/index?orderId=${encodeURIComponent(orderId)}` });
  },
  async openSupport(event: any) {
    const orderId = event.currentTarget.dataset.id;
    const directCategory = String(event.currentTarget.dataset.category || "");
    let category: "orderIssue" | "refund" | "safety" | "general";
    const directCategories = ["orderIssue", "refund", "safety", "general"] as const;
    if (directCategories.includes(directCategory as typeof directCategories[number])) {
      category = directCategory as typeof directCategories[number];
    } else {
      const choice = await new Promise<any>((resolve) => wx.showActionSheet({
        itemList: ["履约或时间问题", "退款问题", "安全或骚扰问题", "其他问题"],
        success: resolve,
        fail: () => resolve(null)
      }));
      if (!choice || typeof choice.tapIndex !== "number") return;
      category = (["orderIssue", "refund", "safety", "general"] as const)[choice.tapIndex] || "general";
    }
    const result = await new Promise<any>((resolve) => wx.showModal({
      title: category === "refund" ? "补充退款情况" : "联系平台客服",
      editable: true,
      placeholderText: category === "refund"
        ? "请补充订单、履约或支付相关情况，平台会在工单中跟进"
        : "请说明发生的情况，平台会在工单中跟进",
      confirmText: "提交工单",
      success: resolve
    }));
    if (!result.confirm) return;
    try {
      await requestTransactionalSubscriptions(["supportUpdate"]);
      await api.createSupportTicket({
        orderId,
        category,
        subject: category === "refund" ? "退款申请补充" : "订单客服请求",
        body: result.content?.trim() || "用户请求平台客服协助处理订单。"
      });
      wx.showToast({ title: "工单已提交", icon: "success" });
      await this.load();
    } catch (error) { wx.showToast({ title: (error as Error).message || "提交工单失败", icon: "none" }); }
  },
  async addOrderSupportFact(event: any) {
    const ticketId = String(event.currentTarget.dataset.id || "");
    const ticket = this.data.supportTickets.find((item) => item.id === ticketId);
    if (!ticket?.canAddOrderFact) {
      wx.showToast({ title: "当前工单不能补充订单事实", icon: "none" });
      return;
    }
    const result = await new Promise<any>((resolve) => wx.showModal({
      title: "补充订单事实（仅客服可见）",
      content: "只写你亲历的时间、履约或支付事实。不粘贴整段聊天，不提交证件、健康等高敏感材料；这不会自动决定退款、结算或订单状态。",
      editable: true,
      placeholderText: "例如：我在 7 月 20 日 20:00 进入平台会话，等待 15 分钟后仍未开始服务（5–1200 字）",
      confirmText: "仅提交客服",
      success: resolve
    }));
    if (!result.confirm) return;
    const statement = String(result.content || "").trim();
    if (statement.length < 5) {
      wx.showToast({ title: "请至少补充 5 个非空白字符", icon: "none" });
      return;
    }
    if (statement.length > 1200) {
      wx.showToast({ title: "订单事实不能超过 1200 字", icon: "none" });
      return;
    }
    if (ORDER_FACT_SENSITIVE_CONTENT.test(statement)) {
      wx.showToast({ title: "请不要提交证件、联系方式、健康或医疗材料", icon: "none" });
      return;
    }
    this.setData({ submittingSupportFactId: ticketId });
    try {
      await api.addOrderSupportFact(ticketId, statement);
      wx.showToast({ title: "已补充给平台客服", icon: "success" });
      await this.load().catch(() => undefined);
    } catch (error) {
      wx.showToast({ title: (error as Error).message || "补充订单事实失败", icon: "none" });
    } finally {
      if (this.data.submittingSupportFactId === ticketId) this.setData({ submittingSupportFactId: "" });
    }
  },
  async enableCustomerNotifications() {
    if (!await confirmOrderNotificationSetup("customer")) return;
    const result = await requestTransactionalSubscriptions(CUSTOMER_ORDER_NOTIFICATION_KEYS);
    wx.showToast({
      title: result.recorded > 0
        ? `已记录 ${result.recorded} 项订单提醒`
        : result.requested
          ? "未授予订单提醒授权"
          : "当前无法开启提醒",
      icon: "none"
    });
  },
  async enableCompanionNotifications() {
    if (!await confirmOrderNotificationSetup("companion")) return;
    const result = await requestTransactionalSubscriptions(COMPANION_ORDER_NOTIFICATION_KEYS);
    wx.showToast({
      title: result.recorded > 0
        ? `已记录 ${result.recorded} 项接单提醒`
        : result.requested
          ? "未授予提醒授权"
          : "当前无法开启提醒",
      icon: "none"
    });
  },
  review(event: any) {
    const orderId = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["5 星 · 非常满意", "4 星 · 满意", "3 星 · 一般", "2 星 · 不满意", "1 星 · 很不满意"],
      success: (ratingResult: any) => {
        const rating = 5 - Number(ratingResult.tapIndex);
        wx.showModal({
          title: `${rating} 星评价`, editable: true, placeholderText: "写下真实的服务感受", success: async (contentResult: any) => {
            if (!contentResult.confirm) return;
            try {
              await api.createReview({ orderId, rating, content: contentResult.content?.trim() || "本次服务体验良好" });
              wx.showToast({ title: "评价已提交", icon: "success" });
            } catch (error) { wx.showToast({ title: (error as Error).message || "评价失败", icon: "none" }); }
          }
        });
      }
    });
  },
  rebook(event: any) {
    const id = String(event.currentTarget.dataset.id || "");
    const context = this.orderContext(id);
    if (!context || context.viewerRole !== "customer" || !context.order.canRebook) {
      wx.showToast({ title: "当前订单暂不能再次预约", icon: "none" });
      return;
    }
    const serviceOfferingId = context.order.serviceOfferingId?.trim() || "";
    if (!serviceOfferingId) {
      wx.showToast({ title: "这项服务暂时无法带入，请从资料页重新选择", icon: "none" });
      return;
    }
    const params = [
      `id=${encodeURIComponent(context.order.companionId)}`,
      `serviceOfferingId=${encodeURIComponent(serviceOfferingId)}`,
      context.order.themeId ? `themeId=${encodeURIComponent(context.order.themeId)}` : "",
      "rebook=1"
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${params}` });
  },
  openRecommendedCompanion(event: any) {
    const { id, impressionId, themeId } = event.currentTarget.dataset;
    queueRecommendationEvent(impressionId, "click");
    void flushRecommendationEvents();
    const params = [
      `id=${encodeURIComponent(id)}`,
      `rid=${encodeURIComponent(impressionId)}`,
      themeId ? `themeId=${encodeURIComponent(themeId)}` : ""
    ].filter(Boolean).join("&");
    wx.navigateTo({ url: `/pages/companion/detail?${params}` });
  }
});
