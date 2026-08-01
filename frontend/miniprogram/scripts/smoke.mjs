import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const output = join(tmpdir(), "talkandtalk-miniprogram-smoke");
mkdirSync(output, { recursive: true });
assert.match(
  readFileSync(join(root, "pages/order/detail.wxml"), "utf8"),
  /微信支付投诉状态/,
  "order detail must expose the customer-safe WeChat payment dispute status"
);
assert.match(
  readFileSync(join(root, "pages/order/detail.wxml"), "utf8"),
  /确认接单[\s\S]*无法接单[\s\S]*开始服务[\s\S]*完成服务/,
  "role-aware order detail must carry the companion's full authoritative fulfillment actions"
);
assert.match(
  readFileSync(join(root, "pages/order/detail.wxml"), "utf8"),
  /履约争议[\s\S]*查看履约争议详情/,
  "role-aware order detail must keep an existing bilateral attendance case reachable"
);
assert.match(
  readFileSync(join(root, "pages/support/index.wxml"), "utf8"),
  /正式发起入口在微信的.*钱包.*账单/,
  "support center must preserve the official WeChat bill complaint-entry boundary"
);
const crisisTemplate = readFileSync(join(root, "pages/crisis/index.wxml"), "utf8");
assert.match(crisisTemplate, /一键拨号/);
assert.match(crisisTemplate, /普通客服工单不是紧急服务/);
assert.match(crisisTemplate, /核验日期/);
assert.doesNotMatch(
  readFileSync(join(root, "utils/crisis-gate.ts"), "utf8"),
  /intentInput|messageId\s*:/,
  "the shared crisis gate must never route raw user input or message identifiers"
);
const voiceTemplate = readFileSync(join(root, "pages/voice/index.wxml"), "utf8");
assert.match(
  voiceTemplate,
  /深圳市腾讯计算机系统有限公司提供的 TRTC[\s\S]*麦克风音频、IP、网络及设备系统基础信息/,
  "voice preflight must disclose the TRTC provider, purpose-bound data scope and explicit confirmation"
);
assert.match(
  readFileSync(join(root, "pages/consent/index.wxml"), "utf8"),
  /TRTC 仅在你进入实时语音并再次确认后初始化[\s\S]*默认不录音或启用 AI 转写/,
  "first-use consent must disclose delayed TRTC initialization and the no-recording boundary"
);
const adultEligibilityTemplate = readFileSync(join(root, "pages/account/adult-eligibility.wxml"), "utf8");
assert.match(adultEligibilityTemplate, /不接收证件照片/);
assert.match(adultEligibilityTemplate, /不要填写身份证号、手机号、姓名、住址或验证码/);
assert.match(adultEligibilityTemplate, /提交成功不等于核验通过/);
const loginUnavailableTemplate = readFileSync(join(root, "pages/account/deletion-status.wxml"), "utf8");
assert.match(loginUnavailableTemplate, /不会显示该标识关联的历史账号状态、处理日期或其他资料/);
assert.doesNotMatch(
  readFileSync(join(root, "pages/account/deletion-status.ts"), "utf8"),
  /\b(?:api|request|ensureSession|ensureLegalRecoverySession)\s*\(/,
  "the login-unavailable page must remain local-only and call no authenticated endpoint"
);

const compiler = join(repo, "backend/api/node_modules/.bin/tsc");
const compilation = spawnSync(compiler, ["-p", join(root, "tsconfig.json"), "--outDir", output], {
  cwd: repo,
  encoding: "utf8"
});
if (compilation.status !== 0) {
  process.stderr.write(compilation.stdout || "");
  process.stderr.write(compilation.stderr || "");
  process.exit(compilation.status || 1);
}

const storage = new Map();
const calls = [];
let registeredPage = null;
let importSequence = 0;
let createdOrderPayload = null;
let updatedProfilePayload = null;
let currentProfileGender = "female";
let paymentIsMock = true;
let failNextOrderCreate = false;
let failServiceOfferingsLoad = false;
let returnMalformedServiceOffering = false;
let failAvailabilityLoad = false;
let availabilityMode = "structured";
let returnEmptyAvailability = false;
let returnMalformedAvailability = false;
let loginIdentityUnavailable = false;
let nextOrderApiErrorCode = "";
let managedServiceOfferingLoadError = null;
let managedServiceOfferingSaveError = null;
let managedAvailabilityWindowLoadError = null;
let managedAvailabilityWindowSaveError = null;
let managedAvailabilityWindowUpdateError = null;
let companionEarningsLoadError = null;
let companionTodayServiceScheduleLoadError = null;
let failCompanionLifecycleOverview = false;
let failRecommendationExclusionsLoad = false;
let failRecommendationsLoad = false;
let failRecommendationTopicsLoad = false;
let failRecommendationPreferencesLoad = false;
let failFavoritesLoad = false;
let failRecentViewsLoad = false;
let failNotificationsLoad = false;
let failNotificationUnreadLoad = false;
let availabilityReminderChannelAvailable = true;
let timelineLoadError = null;
let customerOrdersLoadError = null;
let serviceOrdersLoadError = null;
let supportTicketsLoadError = null;
let orderReadError = null;
let ownOrderReviewLoadError = null;
let ownOrderReview = null;
let rescheduleSubmitError = null;
let submittedReschedulePayload = null;
let rescheduleResponseError = null;
let serviceRescheduleRequest = null;
const attemptedOrderRequestIds = [];
let privacyAuthorizationRequests = 0;
let modalConfirm = false;
let modalContent = "";
let messageNotificationsMuted = false;
let conversationBlockedByYou = false;
let conversationViewerCanManageFutureBookingBoundary = false;
let futureBookingsDeclinedByYou = false;
let conversationMessageWindowOpen = true;
let communityReportSubmissionCount = 0;
let communityWriteRateLimited = false;
let failModerationAppealsLoad = false;
let failModerationAppealableCasesLoad = false;
let failPaymentDisputesLoad = false;
let communityReportReceipts = [{
  id: "community-report-existing",
  submittedAt: "2030-01-01T08:00:00.000Z",
  status: "received"
}];
let nextSupportTicketNumber = 1;
let nextOrderSupportFactNumber = 1;
const supportTickets = [];
let nextReporterCaseNumber = 2;
let nextReporterFollowUpNumber = 1;
const reporterCases = [{
  id: "report-1",
  category: "voice_safety",
  riskLevel: "medium",
  priority: "standard",
  status: "open",
  outcome: "reviewing",
  outcomeSummary: "独立审核部门正在核对这次举报。",
  submittedSummary: "对方在通话中持续索要站外联系方式。",
  dueAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  resolvedAt: null,
  createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  followUps: []
}];
const moderationAppeals = [{
  id: "appeal-1",
  caseId: "moderation-case-1",
  status: "pending",
  reason: "这条内容没有包含站外联系方式，请重新核对。",
  appealDeadlineAt: new Date(Date.now() + 29 * 24 * 60 * 60_000).toISOString(),
  reviewDueAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
  overdue: false,
  policyVersion: "2026.1",
  resolution: null,
  reviewedAt: null,
  createdAt: new Date(Date.now() - 60 * 60_000).toISOString()
}];
const moderationAppealableCases = [{
  caseId: "moderation-case-eligible-1",
  kind: "contentAction",
  source: "chat",
  summary: "内容未送达或已被移除",
  contentPreview: "这条内容没有包含站外联系方式。",
  restrictionEndsAt: null,
  appealDeadlineAt: new Date(Date.now() + 29 * 24 * 60 * 60_000).toISOString(),
  policyVersion: "2026.1",
  createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString()
}];
const notifications = [{
  id: "notification-order-1",
  type: "orderConfirmed",
  title: "订单已确认",
  body: "陪伴者已确认预约，可查看订单并完成支付。",
  data: { orderId: "order-1" },
  readAt: null,
  createdAt: new Date().toISOString()
}];
let pullDownRefreshStops = 0;
const paymentInvocations = [];
const trtcEnterInvocations = [];
const trtcExitInvocations = [];
const trtcPusherStarts = [];
const microphoneVolumes = [];
const modalInvocations = [];
const toasts = [];
const navigations = [];
const subscriptionRequests = [];
const subscriptionGrants = [];
const phoneCalls = [];
let crisisIntervention = null;
let cloudRunCall = null;
let environmentVersion = "release";
let currentUserRole = "companion";
const recommendationEvents = [];
const excludedRecommendationCompanionIds = new Set();
const favoriteCompanionIds = new Set();
const favoriteReminderEnabledIds = new Set();
const favoriteReminderUpdatedAts = new Map();
let nextSubscriptionGrantNumber = 1;
let recentlyViewedCompanionIds = [];
let recommendationPreference = {
  personalizationEnabled: true,
  topicIds: ["t1"],
  city: null,
  maxPricePerHalfHour: 50,
  preferredTimeSlots: ["21:00"],
  behavioralTags: [{ id: "inferred:t1", topicId: "t1", name: "情绪倾听", weight: 3, source: "inferredOrder", updatedAt: null }]
};

const companion = {
  id: "companion-1", name: "小安", role: "情绪倾听者", initials: "小安", bio: "安全、耐心地倾听",
  rating: 4.9, reviewCount: 12, pricePerHalfHour: 39, isOnline: true, isVerified: true,
  availability: "online", tags: ["情绪倾听"], availableTimes: ["今晚"], topicIds: ["t1"],
  languages: ["中文"], specialties: ["情绪倾听"],
  livedExperience: "有异地生活和职场转型经历，公开分享仅用于帮助用户判断匹配度。",
  serviceBoundaries: ["不提供医疗诊断", "仅平台内沟通"],
  completedOrders: 86,
  responseTime: "通常 5 分钟内回复",
  voiceIntro: {
    available: true,
    status: "approved",
    durationSeconds: 20,
    playbackStatus: "secureShortLivedUrlRequired",
    playbackUrl: null
  },
  publicTrust: {
    training: {
      status: "current", currentModules: 3, requiredModules: 3,
      validUntil: new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString()
    },
    platformReview: {
      status: "current",
      verifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
      nextReviewDueAt: new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString()
    }
  },
  catalog: {
    sellable: true,
    startingPriceCents: 3900,
    startingDurationMinutes: 30,
    currency: "CNY",
    deliveryModes: ["text", "voice"],
    nextAvailableAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  }
};
const serviceOfferings = [
  {
    id: "service-text-30", code: "text-30", title: "安静文字陪伴", description: "在平台内慢慢说，按自己的节奏梳理想法。",
    deliveryMode: "text", durationMinutes: 30, priceCents: 3900, currency: "CNY", topicIds: ["t1"]
  },
  {
    id: "service-voice-60", code: "voice-60", title: "60 分钟语音陪伴", description: "留出更完整的一段倾听时间。",
    deliveryMode: "voice", durationMinutes: 60, priceCents: 6900, currency: "CNY", topicIds: ["t1"]
  }
];
let nextManagedServiceOfferingNumber = 1;
let managedServiceOfferings = [
  {
    ...serviceOfferings[0], id: "owned-service-text", code: "owned-text-30", isActive: true, sortOrder: 0,
    createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z"
  },
  {
    ...serviceOfferings[1], id: "owned-service-voice", code: "owned-voice-60", isActive: false, sortOrder: 0,
    createdAt: "2030-01-02T00:00:00.000Z", updatedAt: "2030-01-02T00:00:00.000Z"
  }
];
const managedAvailabilityWindows = [
  {
    id: "owned-window-active", startsAt: "2030-06-10T01:00:00.000Z", endsAt: "2030-06-10T03:00:00.000Z",
    capacity: 2, isActive: true, createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z"
  },
  {
    id: "owned-window-retired", startsAt: "2030-06-11T01:00:00.000Z", endsAt: "2030-06-11T02:00:00.000Z",
    capacity: 1, isActive: false, createdAt: "2030-01-02T00:00:00.000Z", updatedAt: "2030-01-02T00:00:00.000Z"
  },
  {
    id: "owned-window-expired", startsAt: "2020-06-10T01:00:00.000Z", endsAt: "2020-06-10T02:00:00.000Z",
    capacity: 3, isActive: true, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z"
  }
];
let nextManagedAvailabilityWindowNumber = 1;
const availabilityBaseStart = new Date(
  Math.ceil((Date.now() + 2 * 60 * 60_000) / (30 * 60_000)) * (30 * 60_000)
);

function availabilityFor(serviceOfferingId) {
  const offering = serviceOfferings.find((item) => item.id === serviceOfferingId) || serviceOfferings[0];
  const startsAt = new Date(availabilityBaseStart.getTime() + (offering.id === "service-voice-60" ? 30 * 60_000 : 0));
  const endsAt = new Date(startsAt.getTime() + offering.durationMinutes * 60_000);
  const candidate = {
    id: `window-${offering.id}:${startsAt.toISOString()}`,
    availabilityWindowId: `window-${offering.id}`,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    capacity: 1,
    reservedCount: 0,
    availableCapacity: 1
  };
  return {
    source: "structured",
    timezone: "Asia/Shanghai",
    serviceOfferingId: offering.id,
    durationMinutes: offering.durationMinutes,
    legacyAvailableTimes: [],
    items: returnMalformedAvailability ? [{ ...candidate, availableCapacity: 0 }] : returnEmptyAvailability ? [] : [candidate]
  };
}
const recommendedCompanion = {
  ...companion,
  impressionId: "00000000-0000-4000-8000-000000000001",
  position: 1,
  score: 0.91,
  reasonCodes: ["theme", "quality"],
  reasonText: "适合情绪倾听"
};
const order = {
  id: "order-1", companionId: companion.id, themeId: "t1", durationMinutes: 30, amountCents: 3900,
  status: "pending", scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  refundPolicyVersionSnapshot: "2026.08-v1",
  refundRequestWindowHoursSnapshot: 72,
  serviceOfferingId: "service-text-30",
  serviceOfferingSnapshot: {
    id: "service-text-30", code: "text-30", title: "安静文字陪伴", deliveryMode: "text",
    durationMinutes: 30, priceCents: 3900, currency: "CNY"
  },
  serviceIntent: { code: "listen", label: "只想被倾听", policyVersion: "2026.1" },
  companionSnapshot: { name: companion.name, role: companion.role, initials: companion.initials },
  conversationId: companion.id,
  customer: { id: "customer-1", name: "小雨", initials: "小雨" },
  customerServiceGuidelinesConfirmedAt: null,
  companionServiceGuidelinesConfirmedAt: null,
  experienceFeedback: null,
  createdAt: new Date().toISOString()
};
const paymentDisputes = [{
  id: "00000000-0000-4000-8000-000000000301",
  channel: "wechat",
  type: "consumer_complaint",
  orderId: order.id,
  ownedOrderIds: [order.id, "owned-order-2"],
  ownedOrders: [{ orderId: order.id }, { orderId: "owned-order-2" }],
  status: "processing",
  providerStatus: "PROCESSING",
  complaintOccurredAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  firstResponseDueAt: new Date(Date.now() + 22 * 60 * 60_000).toISOString(),
  resolutionDueAt: new Date(Date.now() + 47 * 60 * 60_000).toISOString(),
  firstRespondedAt: null,
  resolvedAt: null,
  updatedAt: new Date(Date.now() - 15 * 60_000).toISOString()
}];
let accountSessions = [
  {
    id: "session-current",
    sessionLabel: "当前微信小程序",
    clientPlatform: "WeChat Mini Program",
    lastUsedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    current: true
  },
  {
    id: "session-other",
    sessionLabel: "另一台 iPhone",
    clientPlatform: "WeChat Mini Program",
    lastUsedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 23 * 24 * 60 * 60_000).toISOString(),
    current: false
  }
];
let nextDataRightsRequestNumber = 2;
const dataRightsRequests = [{
  id: "data-right-1",
  type: "export",
  status: "completed",
  description: "导出我在平台内的订单与账户资料。",
  statusReason: "已完成身份与请求范围核对。",
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  resolvedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  followUps: []
}];
let accountDeletionRequest = null;
let accountDeletionSubjectWasCompanion = false;
let customerAdultEligibility = {
  currentAdult: false,
  status: "notSubmitted",
  recordedStatus: null,
  verificationMethod: null,
  evidenceReferenceMasked: null,
  submittedAt: null,
  verifiedAt: null,
  validUntil: null,
  reviewReason: null,
  canSubmit: true,
  recovery: {
    submissionPath: "/api/v1/me/adult-eligibility/submissions",
    existingOrdersPath: "/api/v1/orders",
    accountRightsRemainAvailable: true,
    unpaidOrderCancellationRemainsAvailable: true,
    paidUnfulfilledRefundRequestsRemainAvailable: true
  }
};
const accountDeletionPolicy = {
  version: "2026.1",
  businessDays: 15,
  timezone: "Asia/Shanghai",
  calendarRule: "从申请后的下一自然日开始计算，仅跳过周六和周日。",
  holidayNotice: "当前期限计算不排除法定节假日，也不按调休工作日调整。"
};
let nextInvoiceRequestNumber = 2;
const invoiceRequests = [{
  id: "invoice-1",
  orderId: order.id,
  status: "issued",
  invoiceTitle: "示例个人抬头",
  amountCents: order.amountCents,
  currency: "CNY",
  paymentPaidAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
  service: {
    title: order.serviceOfferingSnapshot.title,
    deliveryMode: order.serviceOfferingSnapshot.deliveryMode,
    durationMinutes: order.durationMinutes,
    companionName: order.companionSnapshot.name
  },
  statusReason: null,
  createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  issuedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  voidedAt: null,
  cancelledAt: null
}];
const serviceOrder = {
  ...order,
  id: "service-order-1",
  scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  companionConfirmedAt: null,
  companionResponseDeadlineAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  viewerRole: "companion",
  fulfillmentBlockedByRefund: false
};
const attendanceDispute = {
  id: "attendance-dispute-1",
  order: {
    id: serviceOrder.id,
    status: "paid",
    scheduledAt: serviceOrder.scheduledAt,
    durationMinutes: serviceOrder.durationMinutes,
    serviceTitle: serviceOrder.serviceOfferingSnapshot.title
  },
  issue: "customerAbsent",
  status: "counterpartyResponse",
  openedByRole: "customer",
  viewerRole: "companion",
  policyVersion: "fulfillment-test-v1",
  timezone: "Asia/Shanghai",
  deadlines: {
    evidenceDueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    counterpartyResponseDueAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    appealDeadlineAt: null,
    appealResponseDueAt: null
  },
  statements: [],
  attendanceSummary: {
    providerEvidenceAvailable: true,
    providerRoomEvents: 1,
    auxiliaryClientEvents: 0,
    decisionConstraint: "clientEvidenceCannotDecideCaseAlone",
    customer: {
      trustedProviderEvents: 0, firstJoinedAt: null, lastLeftAt: null,
      joinCount: 0, leaveCount: 0, reconnectCount: 0,
      audioStartedCount: 0, audioStoppedCount: 0, auxiliaryClientEvents: 0
    },
    companion: {
      trustedProviderEvents: 1, firstJoinedAt: new Date().toISOString(), lastLeftAt: null,
      joinCount: 1, leaveCount: 0, reconnectCount: 0,
      audioStartedCount: 0, audioStoppedCount: 0, auxiliaryClientEvents: 0
    }
  },
  decision: null,
  appeal: null,
  finalDecision: null,
  refund: null,
  recording: "notRecordedByDefault"
};
serviceOrder.attendanceDispute = {
  id: attendanceDispute.id,
  issue: attendanceDispute.issue,
  status: attendanceDispute.status,
  updatedAt: new Date().toISOString()
};
function attendanceDisputeEligibilityFor(target) {
  const opensAt = new Date(Date.parse(target.scheduledAt) + 10 * 60_000);
  const createDeadlineAt = new Date(Date.parse(target.scheduledAt) + target.durationMinutes * 60_000 + 7 * 24 * 60 * 60_000);
  const base = { opensAt: opensAt.toISOString(), createDeadlineAt: createDeadlineAt.toISOString() };
  if (target.attendanceDispute) {
    return { ...base, eligible: false, reasonCode: "existingCase", reason: "本订单已有履约争议，请查看现有案件。" };
  }
  if (!["paid", "inService", "completed", "refunded"].includes(target.status)) {
    return { ...base, eligible: false, reasonCode: "orderStateInvalid", reason: "只有已支付的服务预约可以提交履约争议。" };
  }
  if (Date.now() < opensAt.getTime()) {
    return { ...base, eligible: false, reasonCode: "waitingPeriod", reason: "公开等待期尚未结束，请先尝试联系对方。" };
  }
  if (Date.now() > createDeadlineAt.getTime()) {
    return { ...base, eligible: false, reasonCode: "windowClosed", reason: "履约争议提交期限已结束；如仍需协助，请提交客服工单。" };
  }
  return { ...base, eligible: true, reasonCode: null, reason: null };
}
const customerOrderTimeline = {
  orderId: order.id,
  items: [
    { id: "order-created", type: "orderCreated", actorRole: "customer", occurredAt: order.createdAt, rescheduleRequest: null },
    {
      id: "reschedule-requested", type: "rescheduleRequested", actorRole: "customer",
      occurredAt: new Date(Date.now() + 60_000).toISOString(),
      rescheduleRequest: {
        id: "reschedule-1", requestedByRole: "customer", originalScheduledAt: order.scheduledAt,
        requestedScheduledAt: new Date(Date.parse(order.scheduledAt) + 24 * 60 * 60 * 1000).toISOString(),
        requestedAvailabilitySnapshot: null, status: "pending",
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(), respondedAt: null
      }
    }
  ]
};
const serviceOrderTimeline = {
  orderId: serviceOrder.id,
  items: [
    { id: "service-order-created", type: "orderCreated", actorRole: "customer", occurredAt: serviceOrder.createdAt, rescheduleRequest: null },
    {
      id: "service-reschedule-rejected", type: "rescheduleRejected", actorRole: "customer",
      occurredAt: new Date(Date.now() + 90_000).toISOString(),
      rescheduleRequest: {
        id: "reschedule-service-1", requestedByRole: "companion", originalScheduledAt: serviceOrder.scheduledAt,
        requestedScheduledAt: new Date(Date.parse(serviceOrder.scheduledAt) + 24 * 60 * 60 * 1000).toISOString(),
        requestedAvailabilitySnapshot: null, status: "rejected",
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(), respondedAt: new Date(Date.now() + 90_000).toISOString()
      }
    }
  ]
};
const companionEarnings = [
  {
    id: "earning-available-1", orderId: order.id, grossCents: 6900, platformFeeCents: 1100,
    payableCents: 5800, status: "available",
    availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    holdReason: null, paidAt: null, settlementRecipientMasked: "微信支付（尾号 1234）"
  },
  {
    id: "earning-held-1", orderId: serviceOrder.id, grossCents: 4900, platformFeeCents: 1000,
    payableCents: 3900, status: "held",
    availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    holdReason: "unresolved_support_ticket", paidAt: null, settlementRecipientMasked: "微信支付（尾号 1234）"
  }
];
const lifecycleQuality = {
  generatedAt: new Date().toISOString(),
  orderSampleSize: 10,
  orderSampleLimit: 500,
  orderPopulationSize: 10,
  orderSampleTruncated: false,
  acceptedWithinDeadline: { value: 90, numerator: 9, denominator: 10 },
  startedWithinTenMinutes: { value: 80, numerator: 8, denominator: 10 },
  completion: { value: 90, numerator: 9, denominator: 10 },
  refund: { value: 10, numerator: 1, denominator: 10 },
  rating: { value: 4.8, sampleSize: 8 },
  openSupportTickets: 1,
  activeAccountActions: 1,
  limitations: ["样本量仍有限"]
};
const lifecycleTraining = {
  complete: true,
  requiredModuleCodes: ["service-boundaries"],
  modules: [{
    code: "service-boundaries",
    version: "2026.07",
    title: "服务边界与安全",
    kind: "required",
    summary: "核对平台内沟通、紧急风险和隐私边界。",
    passScore: 80,
    validityDays: 365,
    questions: [{
      id: "boundary-q1",
      prompt: "遇到现实危险时应如何处理？",
      options: [
        { value: "A", label: "优先联系当地紧急服务并停止互动" },
        { value: "B", label: "继续普通陪伴" },
        { value: "C", label: "转到站外" },
        { value: "D", label: "承诺医疗建议" }
      ]
    }],
    record: {
      id: "training-record-1", status: "passed", attemptCount: 1, bestScore: 100,
      passedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 364 * 24 * 60 * 60_000).toISOString()
    }
  }]
};
const lifecycleActions = [{
  id: "companion-action-1",
  kind: "warning",
  reasonCode: "response_quality_review",
  message: "平台正在复核一次服务响应记录。",
  startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  endsAt: null,
  appealDeadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  appealWindowOpen: true,
  revokedAt: null,
  active: true,
  createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  appeals: []
}];
let lifecycleIncidents = [{
  id: "companion-incident-1",
  orderId: serviceOrder.id,
  category: "technicalIssue",
  summary: "实时语音连接中断，已退出并保留订单内记录。",
  evidenceReferences: ["evidence://incident-1"],
  status: "open",
  resolution: null,
  resolvedAt: null,
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 30 * 60_000).toISOString()
}];
let lifecycleWithdrawals = [];
let recurringAvailabilityRules = [{
  id: "recurring-rule-1", weekday: 1, startsAtMinute: 540, endsAtMinute: 660,
  capacity: 1, timezone: "Asia/Shanghai", isActive: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}];
let availabilityBlackouts = [];
let recurringAvailabilityDrafts = [{
  id: "recurring-draft-1", recurringAvailabilityRuleId: "recurring-rule-1",
  startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 50 * 60 * 60_000).toISOString(),
  capacity: 1, timezone: "Asia/Shanghai", isActive: false
}];
const companionLifecycleOverview = {
  companion: {
    id: companion.id,
    name: companion.name,
    role: companion.role,
    bio: companion.bio,
    languages: ["普通话"],
    specialties: ["情绪倾听"],
    cityDistrict: "上海市徐汇区",
    livedExperience: "接受过平台服务边界培训。",
    serviceBoundaries: ["不提供医疗诊断", "仅平台内沟通"],
    isPublished: true,
    voiceIntro: { assetReference: "asset://voice-intro-1", durationSeconds: 20, status: "approved" }
  },
  commercialProfile: {
    status: "verified",
    settlementRecipientMasked: "微信支付（尾号 1234）",
    serviceAgreementVersion: "2026.07",
    submittedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
    verifiedAt: new Date(Date.now() - 6 * 24 * 60 * 60_000).toISOString(),
    suspendedAt: null,
    suspendedReason: null,
    nextReviewDueAt: new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString(),
    adultEligibility: {
      verdict: "adult",
      verifiedAt: new Date(Date.now() - 6 * 24 * 60 * 60_000).toISOString(),
      validUntil: new Date(Date.now() + 180 * 24 * 60 * 60_000).toISOString(),
      evidenceAvailable: true
    },
    evidence: { settlementRecipient: true, taxProfile: true, identity: true, serviceAgreement: true }
  },
  training: lifecycleTraining,
  quality: lifecycleQuality,
  actions: { items: lifecycleActions },
  incidents: { items: lifecycleIncidents },
  withdrawals: { items: lifecycleWithdrawals }
};
const chatMessageStartedAt = Date.now() - 2 * 60 * 60 * 1000;
const chatMessages = Array.from({ length: 55 }, (_, index) => ({
  id: `message-${String(index + 1).padStart(3, "0")}`,
  conversationId: companion.id,
  senderId: index % 2 ? companion.id : "user-1",
  senderName: index % 2 ? companion.name : "微信用户",
  content: index === 54 ? "订单已支付，平台内沟通已开启。" : `历史消息 ${index + 1}`,
  type: index === 54 ? "system" : "text",
  timestamp: new Date(chatMessageStartedAt + index * 60_000).toISOString()
}));
const message = chatMessages.at(-1);
let sentMessageCount = 0;

function messagePage(cursor) {
  const sorted = [...chatMessages].sort((left, right) => {
    const timeDifference = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return timeDifference || left.id.localeCompare(right.id);
  });
  let available = sorted;
  if (cursor) {
    const cursorIndex = sorted.findIndex((item) => item.id === cursor);
    assert.notEqual(cursorIndex, -1, "message cursor must refer to an existing message");
    available = sorted.slice(0, cursorIndex);
  }
  const page = available.slice(Math.max(0, available.length - 50));
  return {
    messages: page,
    pagination: {
      nextCursor: available.length > 50 ? page[0]?.id ?? null : null,
      hasMore: available.length > 50
    }
  };
}

function paginatedItems(items, query, defaultPageSize = 20) {
  const page = Math.max(1, Number(query.get("page") || 1));
  const pageSize = Math.max(1, Math.min(100, Number(query.get("pageSize") || defaultPageSize)));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / pageSize)
    }
  };
}

function responseFor(path, method, data, query = new URLSearchParams()) {
  calls.push({ path, method, data, query: Object.fromEntries(query.entries()) });
  if (path === "/auth/wechat/mini-program") {
    if (loginIdentityUnavailable) {
      return {
        __smokeError: {
          statusCode: 409,
          code: "LOGIN_IDENTITY_UNAVAILABLE",
          message: "server detail must not be displayed"
        }
      };
    }
    return { accessToken: "access", refreshToken: "refresh", expiresIn: 900, user: { id: "user-1", role: currentUserRole, profile: { displayName: "微信用户" } } };
  }
  if (path === "/users/me/legal-consents" && method === "POST") {
    assert.equal(data.version, "2.2-2026-08-01");
    assert.equal(data.privacyAccepted, true);
    assert.equal(data.termsAccepted, true);
    assert.equal(data.adultConfirmed, true);
    assert.equal(data.source, "wechatMiniProgram");
    return { receipt: { id: "consent-1", version: data.version } };
  }
  if (path === "/users/me/legal-consents" && method === "GET") {
    return { valid: true, receipt: { id: "consent-1", version: "2.2-2026-08-01" } };
  }
  if (path === "/crisis/resources" && method === "GET") {
    return {
      policyVersion: "cn-emergency-resources-2026-08-01",
      requestedRegion: query.get("region") || "CN",
      coverageRegion: "CN",
      coverageStatus: "emergencyBaselineOnly",
      approved: false,
      coverageStatement: "当前仅提供110、120全国基础紧急号码，不代表完整地区资源覆盖；完整资源目录尚未获得发布审批。",
      disclaimers: {
        platformCannotDispatch: true,
        platformCannotDispatchText: "Talk&Talk 不会代替你报警、呼叫救护车或实施现场救援。",
        ordinarySupportNotEmergencyText: "普通客服工单不是紧急服务，不能保证即时响应。"
      },
      resources: [
        {
          code: "110", name: "公安报警电话", kind: "policeEmergency", phone: "110", region: "CN",
          availability: "紧急情况请立即拨打，以所在地接通情况为准",
          officialSourceOrganization: "北京市通信管理局", officialSourceTitle: "我国常用公益服务号码说明",
          officialSourceUrl: "https://bjca.miit.gov.cn/official-110", lastVerifiedOn: "2026-08-01"
        },
        {
          code: "120", name: "医疗急救电话", kind: "medicalEmergency", phone: "120", region: "CN",
          availability: "需要紧急医疗救助时请立即拨打，以所在地接通情况为准",
          officialSourceOrganization: "国家卫生健康委员会", officialSourceTitle: "院前医疗急救管理办法",
          officialSourceUrl: "https://www.nhc.gov.cn/official-120", lastVerifiedOn: "2026-08-01"
        }
      ]
    };
  }
  if (path === "/crisis/interventions/active" && method === "GET") {
    return { intervention: crisisIntervention?.status === "resourcesPending" ? { ...crisisIntervention } : null };
  }
  if (path === "/crisis/interventions" && method === "POST") {
    crisisIntervention ||= {
      id: "crisis-1",
      source: data.source,
      riskCode: data.riskCode,
      region: data.region,
      resourcePolicyVersion: "cn-emergency-resources-2026-08-01",
      status: "resourcesPending",
      resourcesViewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { ...crisisIntervention };
  }
  if (path === "/crisis/interventions/crisis-1" && method === "GET") return { ...crisisIntervention };
  if (path === "/crisis/interventions/crisis-1/resource-view-completions" && method === "POST") {
    crisisIntervention = {
      ...crisisIntervention,
      status: "resourcesViewed",
      resourcesViewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { ...crisisIntervention };
  }
  if (path === "/recommendations/topics" && method === "GET") {
    if (failRecommendationTopicsLoad) throw new Error("simulated recommendation topic outage");
    return { algorithmVersion: "companion-ranking-v1", items: [
      { id: "t1", name: "情绪倾听" }, { id: "t2", name: "职场减压" }, { id: "t3", name: "睡前语音" }
    ] };
  }
  if (path === "/recommendations/me/preferences" && method === "GET") {
    if (failRecommendationPreferencesLoad) throw new Error("simulated recommendation preference outage");
    return recommendationPreference;
  }
  if (path === "/recommendations/me/preferences" && method === "PATCH") {
    recommendationPreference = { ...recommendationPreference, ...data };
    return recommendationPreference;
  }
  if (path.startsWith("/recommendations/me/tags/") && method === "DELETE") {
    const id = decodeURIComponent(path.split("/").at(-1));
    recommendationPreference = {
      ...recommendationPreference,
      behavioralTags: recommendationPreference.behavioralTags.filter((tag) => tag.id !== id)
    };
    return { deleted: true, topicId: id.replace("inferred:", "") };
  }
  if (path === "/recommendations/me/companion-exclusions" && method === "GET") {
    if (failRecommendationExclusionsLoad) throw new Error("simulated recommendation exclusion settings outage");
    return paginatedItems(excludedRecommendationCompanionIds.has(companion.id) ? [{
        companionId: companion.id,
        excludedAt: "2030-01-02T03:04:05.000Z",
        companion: {
          id: companion.id,
          name: companion.name,
          role: companion.role,
          initials: companion.initials,
          currentlyPublic: true
        }
      }] : [], query, 20);
  }
  if (path === `/recommendations/me/companion-exclusions/${companion.id}` && method === "PUT") {
    excludedRecommendationCompanionIds.add(companion.id);
    return {
      excluded: true,
      item: {
        companionId: companion.id,
        excludedAt: "2030-01-02T03:04:05.000Z",
        companion: {
          id: companion.id,
          name: companion.name,
          role: companion.role,
          initials: companion.initials,
          currentlyPublic: true
        }
      }
    };
  }
  if (path === `/recommendations/me/companion-exclusions/${companion.id}` && method === "DELETE") {
    const removed = excludedRecommendationCompanionIds.delete(companion.id);
    return { excluded: false, removed, companionId: companion.id };
  }
  if (path === "/recommendations/companions" && method === "GET") {
    if (failRecommendationsLoad) throw new Error("simulated recommendation feed outage");
    const items = excludedRecommendationCompanionIds.has(companion.id) ? [] : [recommendedCompanion];
    return {
      algorithmVersion: "companion-ranking-v1", personalized: true, items,
      pagination: { pageSize: 20, total: items.length, nextCursor: null }
    };
  }
  if (path === "/recommendations/events" && method === "POST") {
    assert.ok(Array.isArray(data.events), "recommendation events must be batched");
    recommendationEvents.push(...data.events);
    return { updated: data.events.length };
  }
  if (path === "/companions" && method === "GET") {
    const keyword = (query.get("keyword") || "").toLocaleLowerCase();
    const language = query.get("language");
    const specialty = query.get("specialty");
    const topicId = query.get("topicId");
    const deliveryMode = query.get("deliveryMode");
    const maxServicePriceCents = Number(query.get("maxServicePriceCents") || 0);
    const availableWithinDays = Number(query.get("availableWithinDays") || 0);
    const sortBy = query.get("sortBy") || "";
    assert.ok(!sortBy || ["online", "rating", "reviewCount", "priceAsc", "soonestAvailable"].includes(sortBy), "public sort must use a declared sort value");
    const hasMatchingActiveService = serviceOfferings.some((offering) =>
      offering.isActive !== false
      && (!topicId || offering.topicIds.includes(topicId))
      && (!deliveryMode || offering.deliveryMode === deliveryMode)
      && (!maxServicePriceCents || offering.priceCents <= maxServicePriceCents)
    );
    const needsStructuredCapacity = Boolean(availableWithinDays) || sortBy === "soonestAvailable";
    const hasMatchingStructuredCapacity = !needsStructuredCapacity || (!returnEmptyAvailability && (!availableWithinDays || availableWithinDays <= 3));
    const publicSearchValues = [
      companion.name,
      companion.role,
      ...companion.tags,
      ...serviceOfferings.filter((offering) => offering.isActive !== false).map((offering) => offering.title)
    ];
    const hasKeywordMatch = !keyword || publicSearchValues.some((value) => value.toLocaleLowerCase().includes(keyword));
    const hasPublicProfileMatch = (!language || companion.languages.includes(language))
      && (!specialty || companion.specialties.includes(specialty));
    const hasResult = hasMatchingActiveService && hasMatchingStructuredCapacity && hasKeywordMatch && hasPublicProfileMatch;
    return { items: hasResult ? [companion] : [], pagination: { total: hasResult ? 1 : 0 } };
  }
  if (path === "/favorites/companions" && method === "GET") {
    if (failFavoritesLoad) throw new Error("simulated favorite list outage");
    return paginatedItems(favoriteCompanionIds.has(companion.id) ? [{
        ...companion,
        availabilityReminderEnabled: favoriteReminderEnabledIds.has(companion.id),
        availabilityReminderUpdatedAt: favoriteReminderUpdatedAts.get(companion.id) || null,
        availabilityReminderMinimumIntervalHours: 24
      }] : [], query, 20);
  }
  if (path === `/favorites/companions/${companion.id}/status` && method === "GET") {
    if (failFavoritesLoad) throw new Error("simulated favorite settings outage");
    return {
      companionId: companion.id,
      favorited: favoriteCompanionIds.has(companion.id),
      availabilityReminderEnabled: false,
      availabilityReminderUpdatedAt: null,
      availabilityReminderMinimumIntervalHours: 24
    };
  }
  if (path === `/favorites/companions/${companion.id}` && method === "PUT") {
    favoriteCompanionIds.add(companion.id);
    return { favorited: true, companion: { ...companion } };
  }
  if (path === `/favorites/companions/${companion.id}/availability-reminder` && method === "PUT") {
    assert.equal(typeof data.enabled, "boolean", "favorite reminder must be an explicit boolean preference");
    if (!favoriteCompanionIds.has(companion.id)) {
      return { __smokeError: { statusCode: 404, code: "FAVORITE_REMINDER_NOT_FOUND", message: "not found" } };
    }
    if (data.enabled) {
      assert.equal(typeof data.subscriptionGrantId, "string", "enabling a favorite reminder must bind a one-time grant");
      favoriteReminderEnabledIds.add(companion.id);
    } else {
      assert.equal(data.subscriptionGrantId, undefined, "disabling a favorite reminder must not request or reuse a grant");
      favoriteReminderEnabledIds.delete(companion.id);
    }
    const updatedAt = new Date().toISOString();
    favoriteReminderUpdatedAts.set(companion.id, updatedAt);
    return { companionId: companion.id, enabled: favoriteReminderEnabledIds.has(companion.id), updatedAt, minimumIntervalHours: 24 };
  }
  if (path === `/favorites/companions/${companion.id}` && method === "DELETE") {
    const removed = favoriteCompanionIds.delete(companion.id);
    favoriteReminderEnabledIds.delete(companion.id);
    favoriteReminderUpdatedAts.delete(companion.id);
    return { favorited: false, removed };
  }
  if (path === "/recently-viewed/companions" && method === "GET") {
    if (failRecentViewsLoad) throw new Error("simulated recent-view outage");
    return { items: recentlyViewedCompanionIds.includes(companion.id) ? [companion] : [] };
  }
  if (path === `/recently-viewed/companions/${companion.id}` && method === "PUT") {
    recentlyViewedCompanionIds = [companion.id, ...recentlyViewedCompanionIds.filter((id) => id !== companion.id)].slice(0, 20);
    return { recorded: true };
  }
  if (path === "/recently-viewed/companions" && method === "DELETE") {
    const cleared = recentlyViewedCompanionIds.length;
    recentlyViewedCompanionIds = [];
    return { cleared };
  }
  if (path === `/companions/${companion.id}/service-offerings` && method === "GET") {
    if (failServiceOfferingsLoad) throw new Error("simulated service catalog outage");
    if (returnMalformedServiceOffering) {
      return paginatedItems([{ ...serviceOfferings[0], durationMinutes: 45 }], query);
    }
    return paginatedItems(serviceOfferings, query);
  }
  if (path === `/companions/${companion.id}/availability` && method === "GET") {
    if (failAvailabilityLoad) throw new Error("simulated availability outage");
    const serviceOfferingId = query.get("serviceOfferingId") || serviceOfferings[0].id;
    const offering = serviceOfferings.find((item) => item.id === serviceOfferingId) || serviceOfferings[0];
    if (availabilityMode === "legacy") {
      return {
        source: "legacy",
        timezone: "Asia/Shanghai",
        serviceOfferingId: offering.id,
        durationMinutes: offering.durationMinutes,
        legacyAvailableTimes: ["今晚 20:00 后", "周末下午"],
        items: []
      };
    }
    return availabilityFor(serviceOfferingId);
  }
  if (path === "/companions/me/service-offerings" && method === "GET") {
    if (managedServiceOfferingLoadError) return { __smokeError: managedServiceOfferingLoadError };
    const page = paginatedItems(
      [...managedServiceOfferings].sort((left, right) =>
        left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
          || left.id.localeCompare(right.id)
      ),
      query
    );
    return {
      ...page,
      summary: {
        total: managedServiceOfferings.length,
        active: managedServiceOfferings.filter((item) => item.isActive).length
      }
    };
  }
  if (path === "/companions/me/service-offerings" && method === "POST") {
    if (managedServiceOfferingSaveError) return { __smokeError: managedServiceOfferingSaveError };
    assert.equal(typeof data.title, "string", "owner service catalog must submit a title");
    assert.ok(["text", "voice"].includes(data.deliveryMode), "owner service catalog must submit a delivery mode");
    assert.ok(Number.isInteger(data.durationMinutes) && data.durationMinutes % 30 === 0, "service duration must use 30-minute increments");
    assert.ok(Number.isInteger(data.priceCents) && data.priceCents >= 100, "service price must be sent as cents");
    const timestamp = new Date().toISOString();
    const created = {
      id: `owned-service-${nextManagedServiceOfferingNumber++}`,
      code: `owned-service-${nextManagedServiceOfferingNumber}`,
      title: data.title,
      description: data.description ?? null,
      deliveryMode: data.deliveryMode,
      durationMinutes: data.durationMinutes,
      priceCents: data.priceCents,
      currency: "CNY",
      topicIds: data.topicIds || [],
      isActive: data.isActive === true,
      sortOrder: data.sortOrder || 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    managedServiceOfferings.push(created);
    return created;
  }
  if (path.startsWith("/companions/me/service-offerings/") && method === "PATCH") {
    if (managedServiceOfferingSaveError) return { __smokeError: managedServiceOfferingSaveError };
    const id = decodeURIComponent(path.split("/").at(-1));
    const index = managedServiceOfferings.findIndex((item) => item.id === id);
    if (index < 0) return { __smokeError: { statusCode: 404, code: "SERVICE_OFFERING_NOT_FOUND", message: "not found" } };
    managedServiceOfferings[index] = { ...managedServiceOfferings[index], ...data, updatedAt: new Date().toISOString() };
    return managedServiceOfferings[index];
  }
  if (path === "/companions/me/availability-windows" && method === "GET") {
    if (managedAvailabilityWindowLoadError) return { __smokeError: managedAvailabilityWindowLoadError };
    const page = paginatedItems(managedAvailabilityWindows.map((item) => ({ ...item })), query);
    const futureActive = managedAvailabilityWindows
      .filter((item) => item.isActive && Date.parse(item.endsAt) > Date.now())
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    return {
      ...page,
      summary: {
        futureActiveCount: futureActive.length,
        nextFutureActiveStartsAt: futureActive[0]?.startsAt ?? null
      }
    };
  }
  if (path === "/companions/me/availability-windows" && method === "POST") {
    if (managedAvailabilityWindowSaveError) return { __smokeError: managedAvailabilityWindowSaveError };
    assert.match(data.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/, "owner availability must submit an explicit Shanghai timezone");
    assert.match(data.endsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/, "owner availability end must submit an explicit Shanghai timezone");
    assert.ok(Date.parse(data.endsAt) > Date.parse(data.startsAt), "availability end must be after start");
    assert.ok(Number.isInteger(data.capacity) && data.capacity >= 1 && data.capacity <= 10, "availability capacity must be bounded");
    const timestamp = new Date().toISOString();
    const created = {
      id: `owned-window-new-${nextManagedAvailabilityWindowNumber++}`,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      capacity: data.capacity,
      isActive: data.isActive === true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    managedAvailabilityWindows.push(created);
    return created;
  }
  if (path.startsWith("/companions/me/availability-windows/") && method === "PATCH") {
    if (managedAvailabilityWindowUpdateError) return { __smokeError: managedAvailabilityWindowUpdateError };
    const id = decodeURIComponent(path.split("/").at(-1));
    const index = managedAvailabilityWindows.findIndex((item) => item.id === id);
    if (index < 0) return { __smokeError: { statusCode: 404, code: "AVAILABILITY_WINDOW_NOT_FOUND", message: "not found" } };
    managedAvailabilityWindows[index] = { ...managedAvailabilityWindows[index], ...data, updatedAt: new Date().toISOString() };
    return managedAvailabilityWindows[index];
  }
  if (path === "/companions/me/application" && method === "POST") {
    assert.ok(String(data.role || "").trim(), "self-onboarding must submit a role");
    assert.ok(String(data.bio || "").trim(), "self-onboarding must submit a bio");
    return { id: companion.id, status: "pendingReview" };
  }
  if (path === "/companions/me/profile" && method === "PATCH") {
    assert.ok(String(data.role || "").trim(), "companion profile updates must retain a role");
    assert.ok(Array.isArray(data.serviceBoundaries), "companion profile updates must use structured boundaries");
    Object.assign(companionLifecycleOverview.companion, {
      role: data.role,
      bio: data.bio,
      languages: data.languages,
      specialties: data.specialties,
      cityDistrict: data.cityDistrict,
      livedExperience: data.livedExperience,
      serviceBoundaries: data.serviceBoundaries
    });
    return { ...companionLifecycleOverview.companion };
  }
  if (path === "/companions/me/availability-schedule/rules" && method === "GET") {
    return paginatedItems(recurringAvailabilityRules.map((item) => ({ ...item })), query);
  }
  if (path === "/companions/me/availability-schedule/rules" && method === "POST") {
    const timestamp = new Date().toISOString();
    const item = {
      id: `recurring-rule-${recurringAvailabilityRules.length + 1}`,
      weekday: data.weekday,
      startsAtMinute: data.startsAtMinute,
      endsAtMinute: data.endsAtMinute,
      capacity: data.capacity,
      timezone: "Asia/Shanghai",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    recurringAvailabilityRules.push(item);
    return { ...item };
  }
  const recurringRuleDeactivateMatch = path.match(/^\/companions\/me\/availability-schedule\/rules\/([^/]+)\/deactivate$/);
  if (recurringRuleDeactivateMatch && method === "PATCH") {
    const item = recurringAvailabilityRules.find((candidate) => candidate.id === decodeURIComponent(recurringRuleDeactivateMatch[1]));
    if (!item) return { __smokeError: { statusCode: 404, code: "RECURRING_AVAILABILITY_RULE_NOT_FOUND", message: "not found" } };
    item.isActive = false;
    item.updatedAt = new Date().toISOString();
    return { ...item };
  }
  if (path === "/companions/me/availability-schedule/blackouts" && method === "GET") {
    return paginatedItems(availabilityBlackouts.map((item) => ({ ...item })), query);
  }
  if (path === "/companions/me/availability-schedule/blackouts" && method === "POST") {
    const timestamp = new Date().toISOString();
    const item = {
      id: `blackout-${availabilityBlackouts.length + 1}`,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      timezone: "Asia/Shanghai",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    availabilityBlackouts.push(item);
    return { ...item };
  }
  const blackoutDeactivateMatch = path.match(/^\/companions\/me\/availability-schedule\/blackouts\/([^/]+)\/deactivate$/);
  if (blackoutDeactivateMatch && method === "PATCH") {
    const item = availabilityBlackouts.find((candidate) => candidate.id === decodeURIComponent(blackoutDeactivateMatch[1]));
    if (!item) return { __smokeError: { statusCode: 404, code: "AVAILABILITY_BLACKOUT_NOT_FOUND", message: "not found" } };
    item.isActive = false;
    item.updatedAt = new Date().toISOString();
    return { ...item };
  }
  if (path === "/companions/me/availability-schedule/drafts/materialize" && method === "POST") {
    return {
      evaluatedRules: recurringAvailabilityRules.filter((item) => item.isActive).length,
      consideredOccurrences: 1,
      created: 0,
      alreadyMaterialized: recurringAvailabilityDrafts.length,
      skippedByBlackout: 0,
      skippedByExistingWindow: 0,
      skippedByOrder: 0,
      skippedOutsideHorizon: 0
    };
  }
  if (path === "/companions/me/availability-schedule/drafts" && method === "GET") {
    return {
      horizonEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
      ...paginatedItems(recurringAvailabilityDrafts.map((item) => ({ ...item })), query)
    };
  }
  const recurringDraftActivateMatch = path.match(/^\/companions\/me\/availability-schedule\/drafts\/([^/]+)\/activate$/);
  if (recurringDraftActivateMatch && method === "PATCH") {
    const item = recurringAvailabilityDrafts.find((candidate) => candidate.id === decodeURIComponent(recurringDraftActivateMatch[1]));
    if (!item) return { __smokeError: { statusCode: 404, code: "RECURRING_AVAILABILITY_DRAFT_NOT_FOUND", message: "not found" } };
    item.isActive = true;
    return { activated: true, id: item.id };
  }
  if (path === "/companions/me/profile" && method === "GET") return companion;
  if (path === `/companions/${companion.id}`) return companion;
  if (path === `/reviews/companion/${companion.id}`) {
    return paginatedItems([], query);
  }
  if (path === `/reviews/orders/${order.id}/me` && method === "GET") {
    if (ownOrderReviewLoadError) return { __smokeError: ownOrderReviewLoadError };
    return { review: ownOrderReview };
  }
  if (path === "/community/posts" && method === "GET") return paginatedItems([
    {
      id: "post-1", authorId: "user-2", authorName: "小雨", authorInitials: "小雨", kind: "femaleRequest",
      topic: "睡前放松", content: "想找人聊聊", likeCount: 0, isLiked: false, moderationStatus: "approved", createdAt: new Date().toISOString()
    },
    {
      id: "post-2", authorId: "user-3", authorName: "小晨", authorInitials: "小晨", kind: "femaleRequest",
      topic: "周末放松", content: "想找人安静说说话", likeCount: 0, isLiked: false, moderationStatus: "approved", createdAt: new Date().toISOString()
    }
  ], query);
  if (path === "/community/reports/mine" && method === "GET") {
    return paginatedItems(communityReportReceipts.map((item) => ({ ...item })), query);
  }
  if (/^\/community\/posts\/post-[12]\/report$/.test(path) && method === "POST") {
    assert.equal(typeof data.reason, "string", "community report must submit only a short reason");
    assert.ok(data.reason.trim().length >= 2 && data.reason.trim().length <= 500, "community report reason must stay bounded");
    if (communityWriteRateLimited) {
      return { __smokeError: { statusCode: 429, code: "COMMUNITY_WRITE_RATE_LIMITED", message: "internal quota detail" } };
    }
    communityReportSubmissionCount += 1;
    const submittedAt = new Date().toISOString();
    if (communityReportSubmissionCount === 1) {
      communityReportReceipts = [{
        id: "community-report-1",
        submittedAt,
        status: "received"
      }, ...communityReportReceipts];
    }
    return {
      report: {
        id: "community-report-1",
        submittedAt,
        duplicate: communityReportSubmissionCount > 1
      }
    };
  }
  if (path === "/orders" && method === "POST") {
    attemptedOrderRequestIds.push(data.clientRequestId);
    createdOrderPayload = data;
    assert.ok(Date.parse(data.scheduledAt) > Date.now(), "created order must include a future scheduledAt");
    assert.match(data.clientRequestId, /^[A-Za-z0-9_-]{16,64}$/, "created order must carry a stable idempotency key");
    if (nextOrderApiErrorCode) {
      const code = nextOrderApiErrorCode;
      nextOrderApiErrorCode = "";
      return { __smokeError: { statusCode: 409, code, message: "所选时段已更新" } };
    }
    if (failNextOrderCreate) {
      failNextOrderCreate = false;
      throw new Error("simulated ambiguous order timeout");
    }
    return { ...order, scheduledAt: data.scheduledAt };
  }
  if (path === "/orders" && method === "GET") {
    if (customerOrdersLoadError) return { __smokeError: customerOrdersLoadError };
    return paginatedItems([order], query, 20);
  }
  if (path === `/orders/${order.id}` && method === "GET") {
    if (orderReadError) return { __smokeError: orderReadError };
    return {
      ...order,
      viewerRole: "customer",
      fulfillmentBlockedByRefund: false,
      attendanceDisputeEligibility: attendanceDisputeEligibilityFor(order)
    };
  }
  if (path === `/orders/${serviceOrder.id}` && method === "GET") {
    if (orderReadError) return { __smokeError: orderReadError };
    return {
      ...serviceOrder,
      viewerRole: "companion",
      fulfillmentBlockedByRefund: false,
      attendanceDisputeEligibility: attendanceDisputeEligibilityFor(serviceOrder),
      refund: null,
      experienceFeedback: null
    };
  }
  if (path === "/orders/service/today") {
    if (companionTodayServiceScheduleLoadError) return { __smokeError: companionTodayServiceScheduleLoadError };
    const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return {
      date: beijingNow.toISOString().slice(0, 10),
      timezone: "Asia/Shanghai",
      pendingConfirmationCount: 1,
      items: [{
        id: serviceOrder.id,
        scheduledAt: serviceOrder.scheduledAt,
        durationMinutes: serviceOrder.durationMinutes,
        status: serviceOrder.status,
        serviceTitle: serviceOrder.serviceOfferingSnapshot.title
      }]
    };
  }
  if (path === "/orders/service") {
    if (serviceOrdersLoadError) return { __smokeError: serviceOrdersLoadError };
    return paginatedItems([serviceOrder], query, 20);
  }
  if (path === `/orders/service/${serviceOrder.id}/confirm` && method === "POST") {
    assert.equal(serviceOrder.status, "pending", "only a pending request may be manually accepted");
    assert.equal(serviceOrder.companionConfirmedAt, null, "manual acceptance must be one-time");
    serviceOrder.companionConfirmedAt = new Date().toISOString();
    serviceOrder.paymentReservationExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    return { ...serviceOrder };
  }
  if (path === `/orders/service/${serviceOrder.id}/start` && method === "POST") {
    assert.equal(serviceOrder.status, "paid", "the companion cannot start an unpaid service");
    assert.ok(serviceOrder.companionConfirmedAt, "the companion must have manually accepted before start");
    serviceOrder.status = "inService";
    serviceOrder.serviceStartedAt = new Date().toISOString();
    return { ...serviceOrder };
  }
  if (path === `/orders/service/${serviceOrder.id}/reject` && method === "POST") {
    assert.equal(serviceOrder.status, "pending", "only a pending request may be rejected");
    assert.equal(serviceOrder.companionConfirmedAt, null, "an accepted request may not be rejected");
    serviceOrder.status = "cancelled";
    serviceOrder.cancelledAt = new Date().toISOString();
    return { ...serviceOrder };
  }
  if (path === `/orders/service/${serviceOrder.id}/complete` && method === "POST") {
    assert.equal(serviceOrder.status, "inService", "only an in-service order may be completed");
    serviceOrder.status = "completed";
    serviceOrder.completedAt = new Date().toISOString();
    return { ...serviceOrder };
  }
  if (path === `/orders/${serviceOrder.id}/voice-room/access` && method === "POST") {
    assert.equal(serviceOrder.status, "inService", "voice credentials require a manually started service");
    assert.equal(serviceOrder.serviceOfferingSnapshot.deliveryMode, "voice", "voice credentials require a voice SKU");
    assert.ok(serviceOrder.companionConfirmedAt, "voice credentials require manual companion acceptance");
    return {
      provider: "trtc",
      sdkAppId: 1400000001,
      roomId: "tt_voice_smoke_service_order_1",
      userId: "tt_smokeopaqueuserid123456",
      userSig: "smoke-user-sig-not-for-storage",
      privateMapKey: "smoke-private-map-key-not-for-storage",
      participantRole: "companion",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      serviceEndsAt: new Date(Date.now() + 25 * 60_000).toISOString(),
      participant: { name: "客户", initials: "客户" }
    };
  }
  if (path === `/orders/${order.id}/service-guidelines-confirmations` && method === "POST") {
    order.customerServiceGuidelinesConfirmedAt = new Date().toISOString();
    return { ...order };
  }
  if (path === `/orders/${serviceOrder.id}/service-guidelines-confirmations` && method === "POST") {
    serviceOrder.companionServiceGuidelinesConfirmedAt = new Date().toISOString();
    return { ...serviceOrder };
  }
  if (path === `/orders/${order.id}/experience-feedback` && method === "POST") {
    assert.ok(Number.isInteger(data.rating) && data.rating >= 1 && data.rating <= 5,
      "experience feedback must use a bounded 1–5 rating");
    assert.ok(Array.isArray(data.tags) && data.tags.length <= 3,
      "experience feedback must contain at most three structured tags");
    assert.ok(data.tags.every((tag) => ["communicationClear", "boundaryRespected", "onTime", "asExpected", "needsImprovement"].includes(tag)),
      "experience feedback must only use supported private tags");
    assert.ok(data.note === undefined || (typeof data.note === "string" && data.note.length <= 200),
      "experience feedback note must remain optional and bounded");
    order.experienceFeedback = {
      id: "experience-feedback-1",
      rating: data.rating,
      tags: [...data.tags].sort(),
      note: data.note || null,
      createdAt: new Date().toISOString()
    };
    return { ...order };
  }
  if (path === `/orders/${order.id}/refund` && method === "POST") {
    assert.equal(typeof data.reason, "string", "refund requests must include the customer-provided reason");
    assert.ok(data.reason.trim().length >= 2 && data.reason.trim().length <= 200, "refund reasons must stay within the user-facing limit");
    order.refund = {
      id: "refund-1", outRefundNo: "R100", amountCents: order.amountCents, status: "pendingReview",
      reason: data.reason.trim(), reviewNote: null, failureReason: null
    };
    return { refund: { ...order.refund }, order: { ...order }, created: true };
  }
  if (path === `/orders/${order.id}/reschedule-requests` && method === "POST") {
    if (rescheduleSubmitError) return { __smokeError: rescheduleSubmitError };
    assert.ok(Date.parse(data.requestedScheduledAt) > Date.now() + 15 * 60 * 1000, "reschedule must submit a sufficiently future candidate");
    assert.equal(typeof data.availabilityWindowId, "string", "structured reschedule must retain its availability window");
    submittedReschedulePayload = data;
    return {
      id: "reschedule-created", requestedByRole: "customer", originalScheduledAt: order.scheduledAt,
      requestedScheduledAt: data.requestedScheduledAt,
      requestedAvailabilitySnapshot: { availabilityWindowId: data.availabilityWindowId, startsAt: null, endsAt: null, capacity: 1 },
      status: "pending", expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), respondedAt: null
    };
  }
  if (path === `/orders/${serviceOrder.id}/reschedule-requests/${serviceRescheduleRequest?.id}/accept` && method === "POST") {
    if (rescheduleResponseError) return { __smokeError: rescheduleResponseError };
    assert.equal(serviceRescheduleRequest.status, "pending", "only a live proposal may be accepted");
    serviceRescheduleRequest.status = "accepted";
    serviceRescheduleRequest.respondedAt = new Date().toISOString();
    serviceOrder.scheduledAt = serviceRescheduleRequest.requestedScheduledAt;
    serviceOrderTimeline.items.push({
      id: `accepted-${serviceRescheduleRequest.id}`, type: "rescheduleAccepted", actorRole: "companion",
      occurredAt: serviceRescheduleRequest.respondedAt, rescheduleRequest: serviceRescheduleRequest
    });
    return { rescheduleRequest: serviceRescheduleRequest, order: { ...serviceOrder } };
  }
  if (path === `/orders/${serviceOrder.id}/reschedule-requests/${serviceRescheduleRequest?.id}/reject` && method === "POST") {
    if (rescheduleResponseError) return { __smokeError: rescheduleResponseError };
    assert.equal(serviceRescheduleRequest.status, "pending", "only a live proposal may be rejected");
    serviceRescheduleRequest.status = "rejected";
    serviceRescheduleRequest.respondedAt = new Date().toISOString();
    serviceOrderTimeline.items.push({
      id: `rejected-${serviceRescheduleRequest.id}`, type: "rescheduleRejected", actorRole: "companion",
      occurredAt: serviceRescheduleRequest.respondedAt, rescheduleRequest: serviceRescheduleRequest
    });
    return serviceRescheduleRequest;
  }
  if (path === `/orders/${order.id}/timeline` && method === "GET") {
    if (timelineLoadError) return { __smokeError: timelineLoadError };
    return { orderId: customerOrderTimeline.orderId, ...paginatedItems(customerOrderTimeline.items, query, 20) };
  }
  if (path === `/orders/${serviceOrder.id}/timeline` && method === "GET") {
    if (timelineLoadError) return { __smokeError: timelineLoadError };
    return { orderId: serviceOrderTimeline.orderId, ...paginatedItems(serviceOrderTimeline.items, query, 20) };
  }
  if (path === "/attendance-disputes/policy" && method === "GET") {
    return {
      version: "fulfillment-test-v1",
      timezone: "Asia/Shanghai",
      waitMinutes: 10,
      caseWindowDays: 7,
      evidenceCollectionHours: 24,
      counterpartyResponseHours: 24,
      appealHours: 48,
      insufficientEvidence: "reviewed by staff",
      recording: "not recorded",
      settlement: "held during dispute",
      refund: "provider-confirmed only"
    };
  }
  if (path === "/attendance-disputes/mine" && method === "GET") {
    return paginatedItems([{ ...attendanceDispute }], query);
  }
  if (path === `/orders/${order.id}/attendance-disputes/me` && method === "GET") {
    return { item: null };
  }
  if (path === `/orders/${serviceOrder.id}/attendance-disputes/me` && method === "GET") {
    return { item: { ...attendanceDispute } };
  }
  if (path === `/attendance-disputes/${attendanceDispute.id}` && method === "GET") {
    return { ...attendanceDispute };
  }
  if (path === `/attendance-disputes/${attendanceDispute.id}/statements` && method === "POST") {
    attendanceDispute.statements.push({
      id: `attendance-statement-${attendanceDispute.statements.length + 1}`,
      participantRole: "companion",
      kind: attendanceDispute.status === "appealed" ? "appealResponse" : "counterpartyResponse",
      statement: data.statement,
      createdAt: new Date().toISOString()
    });
    if (attendanceDispute.status === "counterpartyResponse") attendanceDispute.status = "review";
    serviceOrder.attendanceDispute.status = attendanceDispute.status;
    return { ...attendanceDispute };
  }
  if (path === `/attendance-disputes/${attendanceDispute.id}/appeals` && method === "POST") {
    assert.equal(attendanceDispute.status, "decided", "appeal requires a current initial decision");
    attendanceDispute.status = "appealed";
    attendanceDispute.appeal = {
      appealedByRole: "companion",
      appealedAt: new Date().toISOString(),
      independentlyAssigned: false
    };
    attendanceDispute.deadlines.appealResponseDueAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    attendanceDispute.statements.push({
      id: `attendance-statement-${attendanceDispute.statements.length + 1}`,
      participantRole: "companion",
      kind: "appeal",
      statement: data.statement,
      createdAt: new Date().toISOString()
    });
    serviceOrder.attendanceDispute.status = attendanceDispute.status;
    return { ...attendanceDispute };
  }
  if (path === "/commercial/companion/overview" && method === "GET") {
    if (failCompanionLifecycleOverview) {
      return { __smokeError: { statusCode: 503, code: "COMPANION_LIFECYCLE_UNAVAILABLE", message: "overview unavailable" } };
    }
    return {
      ...companionLifecycleOverview,
      companion: { ...companionLifecycleOverview.companion, voiceIntro: { ...companionLifecycleOverview.companion.voiceIntro } },
      commercialProfile: {
        ...companionLifecycleOverview.commercialProfile,
        adultEligibility: { ...companionLifecycleOverview.commercialProfile.adultEligibility },
        evidence: { ...companionLifecycleOverview.commercialProfile.evidence }
      },
      training: { ...lifecycleTraining, modules: lifecycleTraining.modules.map((item) => ({ ...item })) },
      quality: { ...lifecycleQuality },
      actions: { items: lifecycleActions.map((item) => ({ ...item, appeals: item.appeals.map((appeal) => ({ ...appeal })) })) },
      incidents: { items: lifecycleIncidents.map((item) => ({ ...item })) },
      withdrawals: { items: lifecycleWithdrawals.map((item) => ({ ...item })) },
      operationalSummary: {
        activeRestrictionCount: lifecycleActions.filter((item) => item.active && ["serviceRestriction", "suspension"].includes(item.type)).length,
        openIncidentCount: lifecycleIncidents.filter((item) => ["open", "inReview"].includes(item.status)).length
      }
    };
  }
  if (path === "/commercial/companion/profile/submissions" && method === "POST") {
    assert.ok(data.settlementRecipientRef && data.taxProfileRef && data.identityEvidenceRef, "commercial submission must use opaque external references");
    companionLifecycleOverview.commercialProfile.status = "pendingReview";
    companionLifecycleOverview.commercialProfile.settlementRecipientMasked = data.settlementRecipientMasked;
    companionLifecycleOverview.commercialProfile.serviceAgreementVersion = data.serviceAgreementVersion;
    companionLifecycleOverview.commercialProfile.submittedAt = new Date().toISOString();
    return { ...companionLifecycleOverview.commercialProfile };
  }
  if (path === "/commercial/companion/training" && method === "GET") {
    return { ...lifecycleTraining, modules: lifecycleTraining.modules.map((item) => ({ ...item })) };
  }
  if (path === "/commercial/companion/training/attempts" && method === "POST") {
    assert.equal(data.moduleCode, lifecycleTraining.modules[0].code);
    assert.equal(data.moduleVersion, lifecycleTraining.modules[0].version);
    assert.equal(data.answers.length, lifecycleTraining.modules[0].questions.length);
    return { moduleCode: data.moduleCode, moduleVersion: data.moduleVersion, score: 100, passScore: 80, passed: true };
  }
  if (path === "/commercial/companion/quality" && method === "GET") return { ...lifecycleQuality };
  if (path === "/commercial/companion/actions" && method === "GET") {
    const active = query.get("active");
    const actionId = query.get("actionId");
    const items = lifecycleActions
      .filter((item) => active === null || item.active === (active === "true"))
      .filter((item) => !actionId || item.id === actionId)
      .map((item) => ({ ...item, appeals: item.appeals.map((appeal) => ({ ...appeal })) }));
    return paginatedItems(items, query);
  }
  const companionAppealMatch = path.match(/^\/commercial\/companion\/actions\/([^/]+)\/appeals$/);
  if (companionAppealMatch && method === "POST") {
    const action = lifecycleActions.find((item) => item.id === decodeURIComponent(companionAppealMatch[1]));
    if (!action) return { __smokeError: { statusCode: 404, code: "COMPANION_ACTION_NOT_FOUND", message: "not found" } };
    const appeal = {
      id: `companion-appeal-${action.appeals.length + 1}`,
      status: "pending",
      statement: data.statement,
      evidenceReferences: data.evidenceReferences || [],
      reviewDueAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
      overdue: false,
      resolution: null,
      createdAt: new Date().toISOString()
    };
    action.appeals.push(appeal);
    return { ...appeal };
  }
  if (path === "/commercial/companion/incidents" && method === "GET") {
    const status = query.get("incidentStatus");
    return paginatedItems(
      lifecycleIncidents.filter((item) => !status || item.status === status).map((item) => ({ ...item })),
      query
    );
  }
  if (path === "/commercial/companion/incidents" && method === "POST") {
    const timestamp = new Date().toISOString();
    const incident = {
      id: `companion-incident-${lifecycleIncidents.length + 1}`,
      orderId: data.orderId || null,
      category: data.category,
      summary: data.summary,
      evidenceReferences: data.evidenceReferences || [],
      status: "open",
      resolution: null,
      resolvedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    lifecycleIncidents.unshift(incident);
    return { ...incident };
  }
  if (path === "/commercial/companion/withdrawals" && method === "GET") {
    const status = query.get("withdrawalStatus");
    return paginatedItems(
      lifecycleWithdrawals
        .filter((item) => !status || item.status === status)
        .map((item) => ({ ...item, earningIds: [...item.earningIds] })),
      query
    );
  }
  if (path === "/commercial/companion/withdrawals" && method === "POST") {
    const selected = companionEarnings.filter((earning) => data.earningIds.includes(earning.id) && earning.status === "available");
    assert.equal(selected.length, data.earningIds.length, "withdrawals may include only currently available owned earnings");
    const timestamp = new Date().toISOString();
    const request = {
      id: `withdrawal-${lifecycleWithdrawals.length + 1}`,
      earningIds: [...data.earningIds],
      amountCents: selected.reduce((total, earning) => total + earning.payableCents, 0),
      settlementRecipientMasked: companionLifecycleOverview.commercialProfile.settlementRecipientMasked,
      status: "requested",
      payoutReferenceMasked: null,
      rejectionReason: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    lifecycleWithdrawals.unshift(request);
    return { ...request };
  }
  const withdrawalCancelMatch = path.match(/^\/commercial\/companion\/withdrawals\/([^/]+)\/cancel$/);
  if (withdrawalCancelMatch && method === "POST") {
    const request = lifecycleWithdrawals.find((item) => item.id === decodeURIComponent(withdrawalCancelMatch[1]));
    if (!request) return { __smokeError: { statusCode: 404, code: "WITHDRAWAL_REQUEST_NOT_FOUND", message: "not found" } };
    request.status = "cancelled";
    request.updatedAt = new Date().toISOString();
    return { ...request };
  }
  if (path === "/commercial/earnings/me") {
    if (companionEarningsLoadError) return { __smokeError: companionEarningsLoadError };
    const status = query.get("status");
    const page = paginatedItems(
      companionEarnings.filter((item) => !status || item.status === status),
      query
    );
    const totals = Object.fromEntries(["pending", "available", "held", "paid", "void"].map((earningStatus) => {
      const matching = companionEarnings.filter((item) => item.status === earningStatus);
      return [earningStatus, {
        count: matching.length,
        payableCents: matching.reduce((sum, item) => sum + item.payableCents, 0)
      }];
    }));
    return {
      ...page,
      summary: {
        totalCount: companionEarnings.length,
        availableCents: totals.available.payableCents,
        pendingOrHeldCents: totals.pending.payableCents + totals.held.payableCents,
        paidCents: totals.paid.payableCents,
        byStatus: totals
      }
    };
  }
  if (path === `/orders/${order.id}/prepay`) return {
    order: { ...order, status: "paying" },
    payment: {
      outTradeNo: "T100", mock: paymentIsMock, channel: "miniProgram",
      wechatMiniProgramParams: { timeStamp: "1", nonceStr: "nonce", package: "prepay_id=mock", signType: "RSA", paySign: "sign" }
    }
  };
  if (path === `/orders/${order.id}/payment/sync` && method === "POST") return {
    code: "SUCCESS", message: "支付已确认",
    data: { alreadyProcessed: false, orderId: order.id, orderStatus: "paid" }
  };
  if (path === "/payments/wechat/mock-notify") return { code: "SUCCESS" };
  if (path === "/support/tickets/me" && method === "GET") {
    if (supportTicketsLoadError) return { __smokeError: supportTicketsLoadError };
    const status = query.get("status");
    return paginatedItems(supportTickets.filter((item) => !status || item.status === status), query);
  }
  const supportByOrderMatch = path.match(/^\/support\/orders\/([^/]+)\/tickets$/);
  if (supportByOrderMatch && method === "GET") {
    const orderId = decodeURIComponent(supportByOrderMatch[1]);
    return paginatedItems(supportTickets.filter((item) => item.orderId === orderId), query);
  }
  const supportDetailMatch = path.match(/^\/support\/tickets\/([^/]+)$/);
  if (supportDetailMatch && method === "GET") {
    const ticket = supportTickets.find((item) => item.id === decodeURIComponent(supportDetailMatch[1]));
    return ticket || { __smokeError: { statusCode: 404, code: "SUPPORT_TICKET_NOT_FOUND", message: "not found" } };
  }
  if (path === "/support/tickets" && method === "GET") return { items: supportTickets };
  if (path === "/support/tickets" && method === "POST") {
    const timestamp = new Date().toISOString();
    assert.ok(
      ["orderIssue", "refund", "safety", "privacy", "general"].includes(data.category),
      "support tickets must use the shared category contract"
    );
    if (data.category === "refund" && data.subject === "退款申请补充") {
      assert.equal(data.subject, "退款申请补充", "refund follow-up needs a distinct support subject");
    } else if (data.category === "orderIssue" && data.subject === "订单客服请求") {
      assert.equal(data.subject, "订单客服请求", "experience feedback assistance must use the existing order support queue");
    }
    const ticket = {
      id: `support-${nextSupportTicketNumber++}`,
      orderId: data.orderId || null,
      category: data.category,
      status: "open",
      subject: data.subject,
      body: data.body,
      resolution: null,
      resolutionCode: null,
      dueAt: null,
      updatedAt: timestamp,
      orderFacts: []
    };
    supportTickets.unshift(ticket);
    return { id: ticket.id, status: ticket.status };
  }
  const orderFactMatch = path.match(/^\/support\/tickets\/([^/]+)\/order-facts$/);
  if (orderFactMatch && method === "POST") {
    const ticket = supportTickets.find((item) => item.id === decodeURIComponent(orderFactMatch[1]));
    if (!ticket) return { __smokeError: { statusCode: 404, code: "SUPPORT_TICKET_NOT_FOUND", message: "not found" } };
    assert.ok(["orderIssue", "refund"].includes(ticket.category), "only order/refund support may accept a fact");
    assert.ok(["open", "inProgress"].includes(ticket.status), "closed support tickets must stay immutable");
    assert.equal(typeof data.statement, "string", "order support facts must be text-only");
    assert.ok(data.statement.trim().length >= 5 && data.statement.length <= 1200, "order support facts must be bounded");
    const fact = {
      id: `support-fact-${nextOrderSupportFactNumber++}`,
      statement: data.statement,
      createdAt: new Date().toISOString()
    };
    ticket.orderFacts.push(fact);
    ticket.updatedAt = fact.createdAt;
    return fact;
  }
  if (path === "/payments/disputes/me" && method === "GET") {
    if (failPaymentDisputesLoad) {
      return { __smokeError: { statusCode: 503, code: "PAYMENT_DISPUTE_STATUS_UNAVAILABLE", message: "unavailable" } };
    }
    const status = query.get("status");
    return paginatedItems(
      paymentDisputes.filter((item) => !status || item.status === status).map((item) => ({ ...item })),
      query
    );
  }
  if (path === `/payments/disputes/by-order/${order.id}` && method === "GET") {
    if (failPaymentDisputesLoad) {
      return { __smokeError: { statusCode: 503, code: "PAYMENT_DISPUTE_STATUS_UNAVAILABLE", message: "unavailable" } };
    }
    return { item: paymentDisputes.find((item) => item.orderId === order.id) || null };
  }
  if (path === "/moderation/reports/me" && method === "GET") {
    return paginatedItems(
      reporterCases.map(({ followUps, ...item }) => ({ ...item, followUpCount: followUps.length })),
      query
    );
  }
  if (path === "/moderation/appeals/me" && method === "GET") {
    if (failModerationAppealsLoad) {
      return { __smokeError: { statusCode: 503, code: "APPEAL_STATUS_UNAVAILABLE", message: "unavailable" } };
    }
    const status = query.get("status");
    const caseId = query.get("caseId");
    const appealId = query.get("appealId");
    return paginatedItems(
      moderationAppeals
        .filter((item) => !status || item.status === status)
        .filter((item) => !caseId || item.caseId === caseId)
        .filter((item) => !appealId || item.id === appealId)
        .map((item) => ({ ...item })),
      query
    );
  }
  if (path === "/moderation/appeals/eligible" && method === "GET") {
    if (failModerationAppealableCasesLoad) {
      return { __smokeError: { statusCode: 503, code: "APPEAL_ELIGIBILITY_UNAVAILABLE", message: "unavailable" } };
    }
    const caseId = query.get("caseId");
    const restrictionId = query.get("restrictionId");
    return paginatedItems(
      moderationAppealableCases
        .filter((item) => !caseId || item.caseId === caseId)
        .filter((item) => !restrictionId || item.restrictionId === restrictionId)
        .map((item) => ({ ...item })),
      query
    );
  }
  if (path === "/moderation/appeals" && method === "POST") {
    const createdAt = new Date().toISOString();
    const appeal = {
      id: `appeal-${moderationAppeals.length + 1}`,
      caseId: String(data.caseId),
      status: "pending",
      reason: String(data.reason),
      appealDeadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      reviewDueAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
      overdue: false,
      policyVersion: "2026.1",
      resolution: null,
      reviewedAt: null,
      createdAt
    };
    moderationAppeals.unshift(appeal);
    const eligibleIndex = moderationAppealableCases.findIndex((item) => item.caseId === appeal.caseId);
    if (eligibleIndex >= 0) moderationAppealableCases.splice(eligibleIndex, 1);
    return { appeal };
  }
  const reporterFollowUpMatch = path.match(/^\/moderation\/reports\/([^/]+)\/follow-ups$/);
  if (reporterFollowUpMatch && method === "POST") {
    const report = reporterCases.find((item) => item.id === decodeURIComponent(reporterFollowUpMatch[1]));
    if (!report) return { __smokeError: { statusCode: 404, code: "REPORT_NOT_FOUND", message: "not found" } };
    assert.ok(data.statement.trim().length >= 5 && data.statement.length <= 500, "report follow-ups must be bounded");
    const followUp = {
      id: `report-follow-up-${nextReporterFollowUpNumber++}`,
      statement: data.statement.trim(),
      createdAt: new Date().toISOString()
    };
    report.followUps.push(followUp);
    return followUp;
  }
  const reporterCaseMatch = path.match(/^\/moderation\/reports\/([^/]+)$/);
  if (reporterCaseMatch && method === "GET") {
    const report = reporterCases.find((item) => item.id === decodeURIComponent(reporterCaseMatch[1]));
    if (!report) return { __smokeError: { statusCode: 404, code: "REPORT_NOT_FOUND", message: "not found" } };
    return { ...report, followUps: [...report.followUps] };
  }
  if (path === "/moderation/reports" && method === "POST") {
    assert.ok(String(data.reason || "").trim().length >= 5, "a safety report needs a meaningful reason");
    const createdAt = new Date().toISOString();
    const report = {
      id: `report-${nextReporterCaseNumber++}`,
      category: String(data.reasonCode || "safety_center"),
      riskLevel: "medium",
      priority: "standard",
      status: "open",
      outcome: "received",
      outcomeSummary: "安全举报已收到，等待独立审核。",
      submittedSummary: String(data.reason || "").trim().slice(0, 500),
      dueAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      resolvedAt: null,
      createdAt,
      followUps: []
    };
    reporterCases.unshift(report);
    return { report: { id: report.id, status: report.status, source: "reporter" } };
  }
  if (path === "/conversations") {
    const conversations = [
      {
      id: companion.id, participant: { ...companion }, lastMessage: conversationBlockedByYou ? null : message,
      unreadCount: conversationBlockedByYou ? 0 : 1,
      messageNotificationsMuted,
      conversationBlockedByYou,
      viewerCanManageFutureBookingBoundary: conversationViewerCanManageFutureBookingBoundary,
      futureBookingsDeclinedByYou: conversationViewerCanManageFutureBookingBoundary
        ? futureBookingsDeclinedByYou
        : false,
      futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly",
      existingOrdersUnaffected: true,
      conversationUnaffected: true,
      messageHistoryAvailable: !conversationBlockedByYou,
      messageInteractionAvailable: !conversationBlockedByYou && conversationMessageWindowOpen,
      updatedAt: new Date().toISOString()
    },
    {
      id: "conversation-internal-order-1", messageNotificationsMuted: false,
      conversationBlockedByYou: false, messageHistoryAvailable: true, messageInteractionAvailable: true,
      participant: { id: "customer-1", name: "小雨", role: "客户", initials: "小雨", isOnline: true, isVerified: true },
      lastMessage: null, unreadCount: 0, updatedAt: new Date().toISOString()
      }
    ];
    const filtered = query.get("blockedByYou") === "true"
      ? conversations.filter((item) => item.conversationBlockedByYou)
      : conversations;
    const page = paginatedItems(filtered, query, 20);
    return { conversations: page.items, pagination: page.pagination };
  }
  if (path === `/conversations/${companion.id}/status` && method === "GET") {
    return {
      mediaEnabled: false,
      messageNotificationsMuted,
      conversationBlockedByYou,
      viewerCanManageFutureBookingBoundary: conversationViewerCanManageFutureBookingBoundary,
      futureBookingsDeclinedByYou: conversationViewerCanManageFutureBookingBoundary
        ? futureBookingsDeclinedByYou
        : false,
      futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly",
      existingOrdersUnaffected: true,
      conversationUnaffected: true,
      messageHistoryAvailable: !conversationBlockedByYou,
      messageInteractionAvailable: !conversationBlockedByYou && conversationMessageWindowOpen,
      chatRestriction: null
    };
  }
  if (path === `/conversations/${companion.id}/notification-preference` && method === "PUT") {
    messageNotificationsMuted = data.muted === true;
    return { messageNotificationsMuted };
  }
  if (path === `/conversations/${companion.id}/block` && method === "PUT") {
    conversationBlockedByYou = data.blocked === true;
    return {
      conversationBlockedByYou,
      messageHistoryAvailable: !conversationBlockedByYou,
      messageInteractionAvailable: !conversationBlockedByYou && conversationMessageWindowOpen
    };
  }
  if (path === `/conversations/${companion.id}/future-booking-boundary` && method === "PUT") {
    if (!conversationViewerCanManageFutureBookingBoundary) {
      return { __smokeError: { statusCode: 403, code: "FUTURE_BOOKING_BOUNDARY_COMPANION_ONLY", message: "companion only" } };
    }
    const next = data.declined === true;
    const changed = next !== futureBookingsDeclinedByYou;
    futureBookingsDeclinedByYou = next;
    return {
      viewerCanManageFutureBookingBoundary: true,
      futureBookingsDeclinedByYou,
      futureBookingBoundaryScope: "newOrdersAndRecommendationsOnly",
      existingOrdersUnaffected: true,
      conversationUnaffected: true,
      changed
    };
  }
  if (path === `/conversations/${companion.id}/messages` && method === "GET") {
    if (conversationBlockedByYou) return { messages: [], pagination: { nextCursor: null, hasMore: false } };
    return messagePage(query.get("cursor"));
  }
  if (path === `/conversations/${companion.id}/messages` && method === "POST") {
    if (conversationBlockedByYou || !conversationMessageWindowOpen) {
      return { __smokeError: { statusCode: 403, code: "CONVERSATION_INTERACTION_UNAVAILABLE", message: "conversation unavailable" } };
    }
    const sentMessage = {
      ...message,
      id: `message-sent-${++sentMessageCount}`,
      senderId: "user-1",
      senderName: "微信用户",
      content: data.content,
      type: "text",
      timestamp: new Date().toISOString()
    };
    chatMessages.push(sentMessage);
    return { moderation: { decision: "allow", riskLevel: "low" }, message: sentMessage, safetyMessage: null };
  }
  if (path === "/me/sessions" && method === "GET") {
    const page = Math.max(1, Number(query.get("page") || 1));
    const pageSize = Math.max(1, Number(query.get("pageSize") || 20));
    const start = (page - 1) * pageSize;
    return {
      items: accountSessions.slice(start, start + pageSize).map((item) => ({ ...item })),
      pagination: {
        page,
        pageSize,
        total: accountSessions.length,
        totalPages: Math.ceil(accountSessions.length / pageSize)
      }
    };
  }
  if (path === "/me/sessions" && method === "DELETE") {
    const before = accountSessions.length;
    accountSessions = accountSessions.filter((item) => item.current);
    return { success: true, revokedCount: before - accountSessions.length };
  }
  const sessionDeleteMatch = path.match(/^\/me\/sessions\/([^/]+)$/);
  if (sessionDeleteMatch && method === "DELETE") {
    const id = decodeURIComponent(sessionDeleteMatch[1]);
    const session = accountSessions.find((item) => item.id === id);
    if (!session) return { __smokeError: { statusCode: 404, code: "SESSION_NOT_FOUND", message: "not found" } };
    if (session.current) return { __smokeError: { statusCode: 409, code: "CURRENT_SESSION_REVOKE_FORBIDDEN", message: "当前会话不能从设备列表下线" } };
    accountSessions = accountSessions.filter((item) => item.id !== id);
    return { success: true, id };
  }
  if (path === "/me/account-actions" && method === "GET") {
    return { accountStatus: "active", ...paginatedItems([], query, 50) };
  }
  if (path === "/me/data-rights" && method === "GET") {
    const status = query.get("status");
    return paginatedItems(
      dataRightsRequests
        .filter((item) => !status || item.status === status)
        .map((item) => ({ ...item, followUps: (item.followUps || []).map((followUp) => ({ ...followUp })) })),
      query,
      50
    );
  }
  if (path === "/me/data-rights" && method === "POST") {
    assert.ok(["access", "export", "correction", "deletion"].includes(data.type), "data rights type must use the frozen contract");
    assert.ok(String(data.description || "").trim().length >= 5, "data rights description must explain the requested scope");
    const timestamp = new Date().toISOString();
    const item = {
      id: `data-right-${nextDataRightsRequestNumber++}`,
      type: data.type,
      status: "submitted",
      description: data.description.trim(),
      statusReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      followUps: []
    };
    dataRightsRequests.unshift(item);
    return { ...item };
  }
  const dataRightsFollowUpMatch = path.match(/^\/me\/data-rights\/([^/]+)\/follow-ups$/);
  if (dataRightsFollowUpMatch && method === "POST") {
    const item = dataRightsRequests.find((candidate) => candidate.id === decodeURIComponent(dataRightsFollowUpMatch[1]));
    if (!item) return { __smokeError: { statusCode: 404, code: "DATA_RIGHTS_REQUEST_NOT_FOUND", message: "not found" } };
    if (item.status !== "needsInformation") {
      return { __smokeError: { statusCode: 409, code: "DATA_RIGHTS_FOLLOW_UP_NOT_ALLOWED", message: "not awaiting information" } };
    }
    assert.ok(String(data.statement || "").trim().length >= 5 && data.statement.length <= 500, "data-rights follow-ups must be bounded");
    const timestamp = new Date().toISOString();
    const followUp = {
      id: `data-right-follow-up-${item.followUps.length + 1}`,
      requestedInformation: item.statusReason,
      statement: data.statement.trim(),
      createdAt: timestamp
    };
    item.followUps.push(followUp);
    item.status = "inReview";
    item.statusReason = "已收到补充信息，继续处理中。";
    item.updatedAt = timestamp;
    return { request: { ...item, followUps: item.followUps.map((entry) => ({ ...entry })) }, followUp: { ...followUp } };
  }
  if (path === "/me/invoice-requests/eligible-orders" && method === "GET") {
    const refundBlocksInvoice = Boolean(
      order.refund
      && ["pendingReview", "pending", "processing", "failed", "success"].includes(order.refund.status)
    );
    return paginatedItems([{
      id: order.id,
      status: ["paid", "inService", "completed"].includes(order.status) ? order.status : "completed",
      scheduledAt: order.scheduledAt,
      amountCents: order.amountCents,
      currency: order.currency,
      serviceTitle: order.serviceOfferingSnapshot?.title || order.theme?.name || "陪伴服务",
      companionName: companion.name,
      eligible: !refundBlocksInvoice,
      ineligibleReason: refundBlocksInvoice ? "refundInProgressOrCompleted" : null
    }], query, 20);
  }
  if (path === "/me/invoice-requests" && method === "GET") {
    const status = query.get("status");
    return paginatedItems(
      invoiceRequests
        .filter((item) => !status || item.status === status)
        .map((item) => ({ ...item, service: { ...item.service } })),
      query,
      50
    );
  }
  if (path === "/me/invoice-requests" && method === "POST") {
    assert.equal(data.orderId, order.id, "invoice requests must bind an owned paid order");
    assert.ok(String(data.invoiceTitle || "").trim().length >= 2, "invoice requests need an explicit title");
    const timestamp = new Date().toISOString();
    const item = {
      id: `invoice-${nextInvoiceRequestNumber++}`,
      orderId: data.orderId,
      status: "submitted",
      invoiceTitle: data.invoiceTitle.trim(),
      amountCents: order.amountCents,
      currency: "CNY",
      paymentPaidAt: order.paidAt || timestamp,
      service: {
        title: order.serviceOfferingSnapshot.title,
        deliveryMode: order.serviceOfferingSnapshot.deliveryMode,
        durationMinutes: order.durationMinutes,
        companionName: order.companionSnapshot.name
      },
      statusReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      issuedAt: null,
      voidedAt: null,
      cancelledAt: null
    };
    invoiceRequests.unshift(item);
    return { ...item };
  }
  const invoiceCancelMatch = path.match(/^\/me\/invoice-requests\/([^/]+)\/cancel$/);
  if (invoiceCancelMatch && method === "POST") {
    const item = invoiceRequests.find((candidate) => candidate.id === decodeURIComponent(invoiceCancelMatch[1]));
    if (!item) return { __smokeError: { statusCode: 404, code: "INVOICE_REQUEST_NOT_FOUND", message: "not found" } };
    if (item.status !== "submitted") {
      return { __smokeError: { statusCode: 409, code: "INVOICE_REQUEST_NOT_CANCELLABLE", message: "not cancellable" } };
    }
    const timestamp = new Date().toISOString();
    item.status = "cancelled";
    item.statusReason = "用户在审核前主动撤回。";
    item.cancelledAt = timestamp;
    item.updatedAt = timestamp;
    return { ...item, service: { ...item.service } };
  }
  if (path === "/me" && method === "PATCH") {
    updatedProfilePayload = data;
    assert.ok(data.gender === null || ["female", "male"].includes(data.gender),
      "profile update must use a real shared gender value or clear it with null");
    currentProfileGender = data.gender;
    return { id: "user-1", role: currentUserRole, profile: { displayName: data.displayName, gender: data.gender } };
  }
  if (path === "/me/adult-eligibility" && method === "GET") {
    return structuredClone(customerAdultEligibility);
  }
  if (path === "/me/adult-eligibility/submissions" && method === "POST") {
    assert.ok(["externalProvider", "governmentNetworkIdentity", "secureManualReview"].includes(data.verificationMethod));
    assert.equal(data.evidenceProcessingConfirmed, true);
    assert.match(data.evidenceReference, /^(?!.*\d{10,})[A-Za-z][A-Za-z0-9._-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{4,127}$/);
    assert.doesNotMatch(data.evidenceReference, /身份证|姓名|手机号|证件/u);
    customerAdultEligibility = {
      ...customerAdultEligibility,
      status: "pending",
      recordedStatus: "pending",
      verificationMethod: data.verificationMethod,
      evidenceReferenceMasked: `provider:••••${String(data.evidenceReference).slice(-4)}`,
      submittedAt: new Date().toISOString(),
      canSubmit: false
    };
    return structuredClone(customerAdultEligibility);
  }
  if (path === "/me/deletion-request" && method === "GET") {
    return { request: accountDeletionRequest ? { ...accountDeletionRequest } : null, policy: accountDeletionPolicy };
  }
  if (path === "/me/deletion-request" && method === "POST") {
    if (accountDeletionRequest?.status === "pending") {
      return { ...accountDeletionRequest, message: "注销申请已提交", policy: accountDeletionPolicy };
    }
    const timestamp = new Date().toISOString();
    accountDeletionSubjectWasCompanion = currentUserRole === "companion";
    accountDeletionRequest = {
      id: "deletion-1",
      status: "pending",
      processingStartedAt: null,
      completedAt: null,
      cancelledAt: null,
      canCancel: true,
      companionReactivationRequired: false,
      dueAt: new Date(Date.now() + 21 * 24 * 60 * 60_000).toISOString(),
      policyVersion: "2026.1",
      overdue: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return { ...accountDeletionRequest, message: "注销申请已提交", policy: accountDeletionPolicy };
  }
  if (path === "/me/deletion-request/cancel" && method === "POST") {
    if (!accountDeletionRequest) {
      return { __smokeError: { statusCode: 404, code: "DELETION_REQUEST_NOT_FOUND", message: "not found" } };
    }
    if (accountDeletionRequest.status !== "pending" && accountDeletionRequest.status !== "cancelled") {
      return { __smokeError: { statusCode: 409, code: "DELETION_REQUEST_NOT_CANCELLABLE", message: "not cancellable" } };
    }
    const idempotent = accountDeletionRequest.status === "cancelled";
    const timestamp = accountDeletionRequest.cancelledAt || new Date().toISOString();
    accountDeletionRequest = {
      ...accountDeletionRequest,
      status: "cancelled",
      cancelledAt: timestamp,
      canCancel: false,
      companionReactivationRequired: accountDeletionSubjectWasCompanion,
      overdue: false,
      updatedAt: timestamp
    };
    return {
      ...accountDeletionRequest,
      message: accountDeletionSubjectWasCompanion
        ? "注销申请已取消。陪伴者供给不会自动恢复，请重新提交商业资料并完成资格复核后再上架。"
        : "注销申请已取消。其他独立账号限制或处罚保持不变。",
      policy: accountDeletionPolicy,
      cancellation: {
        idempotent,
        accountStatusPreserved: "active",
        independentAccountActionsPreserved: true,
        sessionsRestored: false,
        companionSupply: {
          automaticRestore: false,
          reactivationRequired: accountDeletionSubjectWasCompanion,
          state: accountDeletionSubjectWasCompanion ? "manualReviewRequired" : "notApplicable",
          requirements: accountDeletionSubjectWasCompanion ? ["activeAccount", "currentAdultEligibility"] : []
        }
      }
    };
  }
  if (path === "/users/me/legal-consents/current" && method === "DELETE") return { withdrawn: true, withdrawnAt: new Date().toISOString() };
  if (path === "/me") return { id: "user-1", role: currentUserRole, profile: { displayName: "微信用户", gender: currentProfileGender } };
  if (path === "/auth/logout" && method === "POST") return { success: true };
  if (path === "/notifications/subscription-templates" && method === "GET") {
    const keys = (query.get("keys") || "").split(",").filter(Boolean);
    return { enabled: true, templates: keys.map((key) => ({ key, templateId: `template-${key}` })) };
  }
  if (path === "/notifications/channels/availability-reminder" && method === "GET") {
    return availabilityReminderChannelAvailable
      ? {
          key: "availabilityReminder",
          available: true,
          reasonCode: null,
          message: "可约提醒通道已启用。",
          templateConfigured: true,
          preparationRunnerEnabled: true,
          deliveryRunnerEnabled: true
        }
      : {
          key: "availabilityReminder",
          available: false,
          reasonCode: "deliveryRunnerDisabled",
          message: "可约提醒通道尚未启用，收藏和手动查看不受影响。",
          templateConfigured: true,
          preparationRunnerEnabled: true,
          deliveryRunnerEnabled: false
        };
  }
  if (path === "/notifications/subscription-grants" && method === "POST") {
    subscriptionGrants.push(data.templateKey);
    const sequence = String(nextSubscriptionGrantNumber++).padStart(12, "0");
    return {
      recorded: data.granted === true,
      ...(data.granted === true ? {
        grantId: `00000000-0000-4000-8000-${sequence}`,
        grantedAt: new Date().toISOString()
      } : {})
    };
  }
  if (path === "/notifications/unread-count" && method === "GET") {
    if (failNotificationUnreadLoad) throw new Error("simulated unread-count outage");
    return { count: notifications.filter((item) => !item.readAt).length };
  }
  if (path === "/notifications/read-all" && method === "POST") {
    let updated = 0;
    for (const item of notifications) {
      if (!item.readAt) {
        item.readAt = new Date().toISOString();
        updated += 1;
      }
    }
    return { updated };
  }
  const notificationReadMatch = path.match(/^\/notifications\/([^/]+)\/read$/);
  if (notificationReadMatch && method === "POST") {
    const item = notifications.find((candidate) => candidate.id === decodeURIComponent(notificationReadMatch[1]));
    if (!item) return { __smokeError: { statusCode: 404, code: "NOTIFICATION_NOT_FOUND", message: "not found" } };
    item.readAt ||= new Date().toISOString();
    return { ...item };
  }
  if (path === "/notifications" && method === "GET") {
    if (failNotificationsLoad) throw new Error("simulated notification-list outage");
    const unreadOnly = query.get("unreadOnly") === "true";
    return paginatedItems(
      notifications.filter((item) => !unreadOnly || !item.readAt).map((item) => ({ ...item })),
      query
    );
  }
  if (path === "/health") return { status: "ok", service: "talk-and-talk-api" };
  throw new Error(`Unhandled smoke route: ${method} ${path}`);
}

globalThis.Page = (options) => { registeredPage = options; };
globalThis.App = () => undefined;
const smokeApp = { globalData: { discoveryIntent: null } };
globalThis.getApp = () => smokeApp;
globalThis.__TALK_AND_TALK_TRTC_SDK__ = class SmokeTrtc {
  constructor(page) {
    this.page = page;
    this.EVENT = {
      LOCAL_JOIN: "LOCAL_JOIN",
      KICKED_OUT: "KICKED_OUT",
      ERROR: "ERROR",
      REMOTE_AUDIO_ADD: "REMOTE_AUDIO_ADD",
      REMOTE_AUDIO_REMOVE: "REMOTE_AUDIO_REMOVE",
      REMOTE_VIDEO_ADD: "REMOTE_VIDEO_ADD"
    };
    this.handlers = new Map();
    this.pusher = { url: "", mode: "RTC", autopush: true, enableCamera: false, enableMic: false };
    this.playerList = [];
  }
  on(eventCode, handler) { this.handlers.set(eventCode, handler); }
  off(eventCode) { this.handlers.delete(eventCode); }
  createPusher(attributes) {
    this.pusher = { ...this.pusher, ...attributes };
    return this.pusher;
  }
  enterRoom(options) {
    trtcEnterInvocations.push(options);
    this.pusher = {
      ...this.pusher,
      url: "trtc://smoke.local/pusher",
      mode: "RTC",
      autopush: true,
      enableCamera: options.enableCamera,
      enableMic: options.enableMic
    };
    return this.pusher;
  }
  getPusherInstance() {
    return {
      start: () => {
        trtcPusherStarts.push(true);
        this.handlers.get(this.EVENT.LOCAL_JOIN)?.({ data: {} });
      }
    };
  }
  setPusherAttributes(attributes) {
    this.pusher = { ...this.pusher, ...attributes };
    microphoneVolumes.push(attributes.enableMic === false ? 0 : 100);
    return this.pusher;
  }
  getPlayerList() { return this.playerList; }
  setPlayerAttributes(id, attributes) {
    this.playerList = this.playerList.map((player) => player.id === id ? { ...player, ...attributes } : player);
    return this.playerList;
  }
  exitRoom() {
    trtcExitInvocations.push(true);
    this.pusher = { url: "", mode: "RTC", autopush: true, enableCamera: false, enableMic: false };
    this.playerList = [];
    return { pusher: this.pusher, playerList: this.playerList };
  }
  pusherEventHandler() {}
  pusherNetStatusHandler() {}
  pusherErrorHandler() {}
  playerEventHandler() {}
  playerFullscreenChange() {}
  playerNetStatus() {}
  playerAudioVolumeNotify() {}
  pusherAudioVolumeNotify() {}
};
globalThis.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: environmentVersion } }),
  cloud: {
    init: () => undefined,
    callContainer: ({ path, method = "GET", data = {}, header, config, success, fail }) => {
      cloudRunCall = { path, method, data, header, config };
      try {
        const requestUrl = new URL(path, "https://smoke.local");
        const apiPath = requestUrl.pathname.replace(/^\/api\/v1/, "");
        const payload = responseFor(apiPath, method, data, requestUrl.searchParams);
        if (payload?.__smokeError) {
          queueMicrotask(() => success({
            statusCode: payload.__smokeError.statusCode,
            data: { error: { code: payload.__smokeError.code, message: payload.__smokeError.message } }
          }));
          return;
        }
        queueMicrotask(() => success({ statusCode: 200, data: { data: payload, meta: {} } }));
      } catch (error) { queueMicrotask(() => fail(error)); }
    }
  },
  login: ({ success }) => queueMicrotask(() => success({ code: "smoke-code" })),
  request: ({ url, method = "GET", data = {}, success, fail }) => {
    try {
      const requestUrl = new URL(url);
      const path = requestUrl.pathname.replace(/^\/api\/v1/, "");
      const payload = responseFor(path, method, data, requestUrl.searchParams);
      if (payload?.__smokeError) {
        queueMicrotask(() => success({
          statusCode: payload.__smokeError.statusCode,
          data: { error: { code: payload.__smokeError.code, message: payload.__smokeError.message } }
        }));
        return;
      }
      queueMicrotask(() => success({ statusCode: 200, data: { data: payload, meta: {} } }));
    } catch (error) { queueMicrotask(() => fail(error)); }
  },
  getPrivacySetting: ({ success }) => queueMicrotask(() => success({ needAuthorization: true })),
  requirePrivacyAuthorize: ({ success }) => { privacyAuthorizationRequests += 1; queueMicrotask(success); },
  getNetworkType: ({ success }) => queueMicrotask(() => success({ networkType: "wifi" })),
  getSetting: ({ success }) => queueMicrotask(() => success({ authSetting: { "scope.record": true } })),
  authorize: ({ success }) => queueMicrotask(() => success({})),
  openSetting: ({ success }) => queueMicrotask(() => success({ authSetting: { "scope.record": true } })),
  requestPayment: (options) => { paymentInvocations.push(options); queueMicrotask(options.success); },
  makePhoneCall: ({ phoneNumber, success }) => { phoneCalls.push(phoneNumber); queueMicrotask(() => success?.()); },
  setClipboardData: ({ success }) => queueMicrotask(() => success?.()),
  createLivePusherContext: () => ({ setMICVolume: (volume) => microphoneVolumes.push(volume) }),
  requestSubscribeMessage: ({ tmplIds, success }) => {
    subscriptionRequests.push([...tmplIds]);
    queueMicrotask(() => success(Object.fromEntries(tmplIds.map((templateId) => [templateId, "accept"]))));
  },
  showToast: (options) => { toasts.push(options); },
  stopPullDownRefresh: () => { pullDownRefreshStops += 1; },
  navigateTo: (options) => { navigations.push(options.url); },
  redirectTo: (options) => { navigations.push(options.url); },
  navigateBack: ({ delta = 1 } = {}) => { navigations.push(`__back:${delta}`); },
  switchTab: (options) => { navigations.push(options.url); },
  reLaunch: (options) => { navigations.push(options.url); queueMicrotask(() => options.complete?.()); },
  setNavigationBarTitle: () => undefined,
  openPrivacyContract: ({ success }) => queueMicrotask(() => success?.()),
  showModal: (options) => { modalInvocations.push(options); queueMicrotask(() => options.success?.({ confirm: modalConfirm, content: modalContent })); },
  showActionSheet: () => undefined
};

async function loadPage(name) {
  registeredPage = null;
  await import(`${pathToFileURL(join(output, `pages/${name}.js`)).href}?smoke=${++importSequence}-${name}`);
  assert.ok(registeredPage, `${name} page must register itself`);
  const page = {
    ...registeredPage,
    data: structuredClone(registeredPage.data),
    setData(patch, callback) { Object.assign(this.data, patch); callback?.(); }
  };
  return page;
}

const blockedDiscover = await loadPage("discover/index");
await blockedDiscover.load();
assert.equal(calls.length, 0, "deep links must not bypass the first-use consent gate");
assert.ok(navigations.includes("/pages/consent/index"));

const consent = await loadPage("consent/index");
assert.equal(calls.length, 0, "first-use gate must not start login or API requests before consent");
consent.setAgreement({ detail: { value: ["accepted"] } });
consent.setAdultConfirmation({ detail: { value: ["adult"] } });
await consent.accept();
const consentRecord = storage.get("talkandtalk.legalConsent");
assert.equal(consentRecord.version, "2.2-2026-08-01");
assert.equal(consentRecord.privacyAccepted, true);
assert.equal(consentRecord.termsAccepted, true);
assert.equal(consentRecord.source, "wechatMiniProgram");
assert.ok(Date.parse(consentRecord.acceptedAt));
assert.equal(privacyAuthorizationRequests, 1);
assert.ok(navigations.includes("/pages/home/index"));

const home = await loadPage("home/index");
await home.load();
assert.equal(home.data.recommendations.length, 1, "the commercial home should expose current recommendations");
assert.equal(home.data.recommendationsState, "available");
failRecommendationsLoad = true;
await home.loadRecommendations();
assert.equal(home.data.recommendationsState, "error", "a home recommendation outage must not look like a real empty feed");
assert.equal(home.data.recommendations.length, 0);
assert.match(home.data.recommendationsError, /不代表没有可约服务/);
failRecommendationsLoad = false;
await home.retryRecommendations();
assert.equal(home.data.recommendationsState, "available", "home recommendations must recover through a scoped retry");
const callsBeforeIntent = calls.length;
home.setIntent({ detail: { value: "我现在有立即危险，想找人帮忙" } });
assert.equal(home.data.riskDetected, true, "high-risk language must interrupt ordinary matching");
const navigationsBeforeRiskAcknowledgement = navigations.length;
await home.continueDiscovery();
assert.equal(navigations.length, navigationsBeforeRiskAcknowledgement + 1, "risk triage must route to emergency resources before discovery");
assert.match(navigations.at(-1), /^\/pages\/crisis\/index\?/);
const crisis = await loadPage("crisis/index");
crisis.source = "homeIntent";
crisis.riskCode = "immediateDangerSignal";
await crisis.load("CN");
assert.deepEqual(crisis.data.resources.map((item) => item.code), ["110", "120"]);
assert.match(crisis.data.coverageStatement, /不代表完整地区资源覆盖/);
crisis.callResource({ currentTarget: { dataset: { phone: "110" } } });
assert.equal(phoneCalls.at(-1), "110", "emergency resources must support one-tap calling");
const crisisCreate = calls.find((call) => call.path === "/crisis/interventions" && call.method === "POST");
assert.deepEqual(crisisCreate.data, { source: "homeIntent", riskCode: "immediateDangerSignal", region: "CN" });
assert.doesNotMatch(JSON.stringify(crisisCreate.data), /我现在有立即危险|messageId|content/i, "crisis facts must not upload raw sensitive text");
await crisis.completeResourceView();
assert.equal(crisisIntervention.status, "resourcesViewed");
assert.equal(storage.has("talkandtalk.pendingCrisisIntervention"), false);
home.acknowledgeNonEmergency();
await home.continueDiscovery();
assert.equal(navigations.at(-1), "/pages/discover/index");
assert.deepEqual(
  smokeApp.globalData.discoveryIntent,
  { availableWithinDays: 3, sortBy: "soonestAvailable" },
  "the need intake may pass only bounded catalog intent after a risk acknowledgement"
);
assert.ok(calls.slice(callsBeforeIntent).every((call) => !JSON.stringify(call.data || {}).includes("我现在有立即危险")),
  "typing need or risk text must stay local and never upload raw text");
await home.browseAll();
assert.equal(smokeApp.globalData.discoveryIntent, null);

const legal = await loadPage("legal/index");
legal.onLoad({ type: "terms" });
assert.equal(legal.data.src, "https://api.talkandtalk.app/legal/terms.html");
legal.onLoad({ type: "privacy" });
assert.equal(legal.data.src, "https://api.talkandtalk.app/legal/privacy.html");

const discover = blockedDiscover;
await discover.load();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(discover.data.companions.length, 1);
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId);
assert.equal(discover.data.companions[0].catalogPriceText, "¥39 起", "discovery must display the current sellable catalog price");
assert.match(discover.data.companions[0].catalogDetailText, /起价商品 30 分钟 · 可选方式：文字 \/ 语音/);
assert.match(discover.data.companions[0].nextAvailableText, /北京时间/);
assert.equal(discover.data.topicFilters.length, 3, "discovery should expose only the platform's small public topic taxonomy");
const discoveryRecommendationCallsBeforeTopicRetry = calls.filter((call) => call.path === "/recommendations/companions").length;
failRecommendationTopicsLoad = true;
await discover.retryTopics();
assert.equal(discover.data.topicsState, "error", "a discovery topic outage must not look like an empty taxonomy");
assert.match(discover.data.topicsError, /其他筛选和结果不受影响/);
assert.equal(discover.data.companions.length, 1, "a scoped topic retry must preserve the current result set");
assert.equal(calls.filter((call) => call.path === "/recommendations/companions").length,
  discoveryRecommendationCallsBeforeTopicRetry,
  "retrying the topic taxonomy must not reload or replace discovery results");
failRecommendationTopicsLoad = false;
await discover.retryTopics();
assert.equal(discover.data.topicsState, "available");
assert.equal(discover.data.topicFilters.length, 3);
failRecommendationsLoad = true;
const catalogCallsBeforeRecommendationOutage = calls.filter((call) => call.path === "/companions").length;
await discover.load();
assert.equal(discover.data.companions.length, 0);
assert.match(discover.data.error, /仍可使用上方搜索手动查找/);
assert.equal(calls.filter((call) => call.path === "/companions").length, catalogCallsBeforeRecommendationOutage,
  "a recommendation outage must not bypass private exclusions through an automatic public-catalog fallback");
failRecommendationsLoad = false;
await discover.load();
const catalogCallsBeforeTyping = calls.filter((call) => call.path === "/companions").length;
discover.setSearchInput({ detail: { value: "小安" } });
assert.equal(calls.filter((call) => call.path === "/companions").length, catalogCallsBeforeTyping,
  "typing a keyword must not upload it before the customer explicitly submits search");
await discover.submitSearch();
assert.equal(discover.data.isFiltering, true);
assert.equal(discover.data.activeFilterSummary, "搜索：小安");
assert.equal(discover.data.companions[0].impressionId, undefined, "a public keyword search must not use personalized ranking");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.keyword === "小安"));
discover.setSearchInput({ detail: { value: "不存在的服务" } });
await discover.submitSearch();
assert.equal(discover.data.companions.length, 0, "a no-match keyword must not fall back to recommendation results");
await discover.clearFilters();
assert.equal(discover.data.selectedKeyword, "");
assert.equal(discover.data.searchInput, "");
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId);
await discover.selectLanguage({ currentTarget: { dataset: { value: "中文" } } });
assert.equal(discover.data.activeFilterSummary, "中文");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.language === "中文"));
await discover.selectSpecialty({ currentTarget: { dataset: { value: "情绪倾听" } } });
assert.equal(discover.data.activeFilterSummary, "中文 · 情绪倾听");
assert.ok(calls.some((call) => call.path === "/companions"
  && call.query.language === "中文"
  && call.query.specialty === "情绪倾听"));
await discover.clearFilters();
assert.equal(discover.data.selectedLanguage, "");
assert.equal(discover.data.selectedSpecialty, "");
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId,
  "clearing explicit public trust facets must restore recommendations");
await discover.selectPublicSort({ currentTarget: { dataset: { value: "rating" } } });
assert.equal(discover.data.isFiltering, true);
assert.equal(discover.data.activeFilterSummary, "评分优先");
assert.equal(discover.data.companions[0].impressionId, undefined, "an explicit public sort must bypass personalized ranking");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.sortBy === "rating"));
await discover.selectPublicSort({ currentTarget: { dataset: { value: "rating" } } });
assert.equal(discover.data.selectedSortBy, "", "tapping the active sort should restore the default mode");
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId);
await discover.selectPublicSort({ currentTarget: { dataset: { value: "soonestAvailable" } } });
assert.equal(discover.data.isFiltering, true);
assert.equal(discover.data.activeFilterSummary, "最早可约");
assert.equal(discover.data.companions[0].impressionId, undefined, "availability-priority sorting must use the public catalog rather than recommendations");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.sortBy === "soonestAvailable"));
await discover.selectAvailabilityWithinDays({ currentTarget: { dataset: { value: "3" } } });
assert.equal(discover.data.activeFilterSummary, "最早可约 · 3天内可约");
assert.ok(calls.some((call) => call.path === "/companions"
  && call.query.sortBy === "soonestAvailable"
  && call.query.availableWithinDays === "3"));
returnEmptyAvailability = true;
await discover.load();
assert.equal(discover.data.companions.length, 0, "availability-priority sorting must not show a profile after its structured capacity is gone");
returnEmptyAvailability = false;
await discover.clearFilters();
assert.equal(discover.data.isFiltering, false);
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId);
await discover.selectTopic({ currentTarget: { dataset: { id: "t1" } } });
assert.equal(discover.data.isFiltering, true);
assert.equal(discover.data.activeFilterSummary, "情绪倾听");
assert.equal(discover.data.companions[0].id, companion.id);
assert.equal(discover.data.companions[0].impressionId, undefined, "explicit filters must use the public catalog rather than personalized ranking");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.topicId === "t1" && !call.query.deliveryMode));
await discover.selectDeliveryMode({ currentTarget: { dataset: { value: "voice" } } });
assert.equal(discover.data.activeFilterSummary, "情绪倾听 · 语音服务");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.topicId === "t1" && call.query.deliveryMode === "voice"));
await discover.selectPriceLimit({ currentTarget: { dataset: { value: "5000" } } });
assert.equal(discover.data.activeFilterSummary, "情绪倾听 · 语音服务 · ¥50 内");
assert.equal(discover.data.companions.length, 0, "combined budget and delivery filters must match one current active service, not two different services");
assert.ok(calls.some((call) => call.path === "/companions"
  && call.query.topicId === "t1"
  && call.query.deliveryMode === "voice"
  && call.query.maxServicePriceCents === "5000"));
await discover.selectDeliveryMode({ currentTarget: { dataset: { value: "voice" } } });
assert.equal(discover.data.activeFilterSummary, "情绪倾听 · ¥50 内");
assert.equal(discover.data.companions[0].id, companion.id, "the active text service under the selected total-price ceiling should remain discoverable");
await discover.selectTopic({ currentTarget: { dataset: { id: "t2" } } });
assert.equal(discover.data.companions.length, 0, "an explicit public-service filter should explain an empty result instead of falling back to a recommendation");
await discover.clearFilters();
assert.equal(discover.data.isFiltering, false);
assert.equal(discover.data.selectedTopicId, "");
assert.equal(discover.data.selectedDeliveryMode, "");
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId, "clearing filters must return to the unchanged recommendation flow");
await discover.selectAvailabilityWithinDays({ currentTarget: { dataset: { value: "3" } } });
assert.equal(discover.data.activeFilterSummary, "3天内可约");
assert.equal(discover.data.companions[0].id, companion.id);
assert.equal(discover.data.companions[0].impressionId, undefined, "capacity filtering must use the live public catalog rather than a recommendation result");
assert.ok(calls.some((call) => call.path === "/companions" && call.query.availableWithinDays === "3"));
returnEmptyAvailability = true;
await discover.load();
assert.equal(discover.data.companions.length, 0, "a capacity filter must not return a profile once its current structured candidates are full");
returnEmptyAvailability = false;
await discover.clearFilters();
assert.equal(discover.data.isFiltering, false);
assert.equal(discover.data.companions[0].impressionId, recommendedCompanion.impressionId);
assert.ok(calls.some((call) => call.path === "/users/me/legal-consents" && call.method === "POST"));

const runtimeApi = await import(pathToFileURL(join(output, "utils/api.js")).href);
const sha256 = await import(pathToFileURL(join(output, "utils/sha256.js")).href);
assert.equal(
  sha256.sha256Hex(new TextEncoder().encode("abc").buffer),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "media reservations must use a standard SHA-256 digest"
);
const restoredAccessToken = storage.get("talkandtalk.accessToken");
const restoredRefreshToken = storage.get("talkandtalk.refreshToken");
const restoredUser = storage.get("talkandtalk.user");
runtimeApi.clearSession();
storage.set("talkandtalk.accessToken", restoredAccessToken);
storage.set("talkandtalk.refreshToken", restoredRefreshToken);
storage.set("talkandtalk.user", restoredUser);
await runtimeApi.ensureSession();
assert.ok(calls.some((call) => call.path === "/users/me/legal-consents" && call.method === "GET"));

runtimeApi.clearSession();
loginIdentityUnavailable = true;
await assert.rejects(runtimeApi.ensureSession(), /该登录标识暂不可使用，请联系客服/);
assert.equal(navigations.at(-1), "/pages/account/deletion-status");
assert.deepEqual(storage.get("talkandtalk.loginIdentityUnavailable"), {
  code: "LOGIN_IDENTITY_UNAVAILABLE",
  message: "该登录标识暂不可使用，请联系客服"
});
assert.equal(storage.has("talkandtalk.accessToken"), false);
assert.equal(storage.has("talkandtalk.refreshToken"), false);
const unavailablePageCallsBefore = calls.length;
const unavailablePage = await loadPage("account/deletion-status");
unavailablePage.onShow();
assert.equal(unavailablePage.data.message, "该登录标识暂不可使用，请联系客服");
assert.equal(calls.length, unavailablePageCallsBefore, "the local notice page must not call the backend");
loginIdentityUnavailable = false;
storage.set("talkandtalk.accessToken", restoredAccessToken);
storage.set("talkandtalk.refreshToken", restoredRefreshToken);
storage.set("talkandtalk.user", restoredUser);

const messages = await loadPage("messages/index");
await messages.load();
assert.equal(messages.data.conversations[0].name, companion.name);
assert.equal(messages.data.conversations[0].messageNotificationsMuted, false);

const chat = await loadPage("chat/index");
chat.conversationId = companion.id;
await chat.load();
assert.equal(chat.data.hasConversation, true, "a valid chat should expose user-selected safety actions");
const chatSafetyCallsBeforeNavigation = calls.length;
chat.openSafetyCenter();
assert.equal(navigations.at(-1), "/pages/safety/index");
chat.leaveConversation();
assert.equal(navigations.at(-1), "/pages/messages/index");
assert.equal(calls.length, chatSafetyCallsBeforeNavigation, "chat safety navigation must not upload content, submit reports, or create records");
chat.openMessageEmergencyHelp();
assert.match(navigations.at(-1), /source=chatSafetyRule/,
  "a safety message must expose its own emergency-resource route");
assert.equal(calls.length, chatSafetyCallsBeforeNavigation,
  "message-level emergency routing must not upload message ids or content before the resource page opens");
assert.deepEqual(
  { ...storage.get("talkandtalk.pendingCrisisIntervention"), createdAt: undefined, id: undefined },
  { source: "chatSafetyRule", riskCode: "chatSafetyRule", region: "CN", createdAt: undefined, id: undefined }
);
storage.delete("talkandtalk.pendingCrisisIntervention");
modalConfirm = true;
const muteCallsBefore = calls.length;
await chat.toggleMessageNotifications();
assert.equal(chat.data.messageNotificationsMuted, true, "a participant can mute only their own reminder preference");
assert.ok(calls.slice(muteCallsBefore).some((call) =>
  call.path === `/conversations/${companion.id}/notification-preference` && call.method === "PUT" && call.data.muted === true
), "muting must call the persisted server preference rather than a local-only switch");
await messages.load();
assert.equal(messages.data.conversations[0].messageNotificationsMuted, true, "the message list must show the viewer's muted state");
const subscriptionRequestsBeforeUnmute = subscriptionRequests.length;
const subscriptionGrantsBeforeUnmute = subscriptionGrants.length;
await chat.toggleMessageNotifications();
assert.equal(chat.data.messageNotificationsMuted, false, "the participant can restore their own reminder preference");
assert.ok(calls.some((call) =>
  call.path === `/conversations/${companion.id}/notification-preference` && call.method === "PUT" && call.data.muted === false
), "restoring must use the same participant-scoped preference route");
assert.deepEqual(subscriptionRequests.slice(subscriptionRequestsBeforeUnmute), [["template-messageReceived"]],
  "restoring reminders must request only the explicit message template");
assert.deepEqual(subscriptionGrants.slice(subscriptionGrantsBeforeUnmute), ["messageReceived"]);
modalConfirm = false;
assert.equal(chat.data.messages.length, 50, "initial chat load must show the newest page");
assert.equal(chat.data.messages[0].id, "message-006");
assert.equal(chat.data.messages.at(-1).id, "message-055");
assert.equal(chat.data.hasMore, true, "initial chat page must expose older history");
await chat.onReachBottom();
assert.equal(chat.data.messages.length, 55, "reaching the bottom must prepend older history");
assert.equal(chat.data.messages[0].id, "message-001");
assert.equal(chat.data.hasMore, false, "history cursor must stop after the oldest page");
assert.equal(new Set(chat.data.messages.map((item) => item.id)).size, chat.data.messages.length, "history paging must not duplicate messages");
chat.data.draft = "你好，想聊聊今天的压力";
await chat.send();
assert.equal(chat.data.messages.length, 56);
assert.equal(chat.data.messages.at(-1).content, "你好，想聊聊今天的压力");
chat.onShow();
assert.ok(chat.syncTimer, "visible chat must start a periodic sync timer");
await chat.latestSyncInFlight;
chat.onHide();
assert.equal(chat.syncTimer, null, "hiding chat must clear the periodic sync timer");

const remoteMessages = Array.from({ length: 55 }, (_, index) => ({
  ...message,
  id: `message-remote-${String(index + 1).padStart(3, "0")}`,
  senderId: companion.id,
  senderName: companion.name,
  content: `新消息 ${index + 1}`,
  type: "text",
  timestamp: new Date(Date.now() + (index + 1) * 1_000).toISOString()
}));
chatMessages.push(...remoteMessages);
await chat.onPullDownRefresh();
assert.equal(pullDownRefreshStops, 1, "pull-to-refresh must always stop its loading indicator");
assert.equal(chat.data.messages.length, 111, "refresh must bridge every page of messages that arrived since the prior sync");
assert.equal(chat.data.messages.at(-1).id, "message-remote-055");
assert.equal(new Set(chat.data.messages.map((item) => item.id)).size, chat.data.messages.length, "refresh must preserve a duplicate-free timeline");
assert.ok(calls.some((call) => call.path === `/conversations/${companion.id}/messages` && call.query.cursor),
  "chat refresh must request a cursor page when the newest page has no overlap");
conversationMessageWindowOpen = false;
await chat.refreshConversationStatus();
assert.equal(chat.data.messageHistoryAvailable, true, "completed-order history must remain readable");
assert.equal(chat.data.messageInteractionAvailable, false, "a closed order window must disable the composer");
assert.ok(chat.data.messages.length > 0, "closing the order window must not erase local history");
const readOnlyMessagePosts = calls.filter((call) => call.path === `/conversations/${companion.id}/messages` && call.method === "POST").length;
chat.setDraft({ detail: { value: "只读历史不应继续发送" } });
await chat.send();
assert.equal(calls.filter((call) => call.path === `/conversations/${companion.id}/messages` && call.method === "POST").length, readOnlyMessagePosts,
  "a completed-order chat must not attempt a new message request");
await messages.load();
assert.match(messages.data.conversations[0].preview, /仅供查看/, "the conversation list must explain the read-only state");
conversationMessageWindowOpen = true;
await chat.refreshConversationStatus();
modalConfirm = true;
conversationViewerCanManageFutureBookingBoundary = true;
await chat.refreshConversationStatus();
const futureBoundaryCallsBefore = calls.length;
await chat.toggleFutureBookingBoundary();
assert.equal(chat.data.futureBookingsDeclinedByYou, true, "a companion can privately stop only this customer's future marketplace activity");
assert.ok(calls.slice(futureBoundaryCallsBefore).some((call) =>
  call.path === `/conversations/${companion.id}/future-booking-boundary`
    && call.method === "PUT"
    && call.data.declined === true
), "the future-only relationship choice must be persisted server-side");
assert.match(modalInvocations.at(-1).content, /客户不会收到原因或被处罚/);
assert.match(modalInvocations.at(-1).content, /现有订单、聊天、退款、评价、举报与客服处理均不受影响/);
await chat.toggleFutureBookingBoundary();
assert.equal(chat.data.futureBookingsDeclinedByYou, false, "a companion can restore future marketplace activity without changing existing records");
conversationViewerCanManageFutureBookingBoundary = false;
await chat.refreshConversationStatus();
assert.equal(chat.data.viewerCanManageFutureBookingBoundary, false, "a customer must not receive the companion-only management control");
assert.equal(chat.data.futureBookingsDeclinedByYou, false, "a customer status response must not reveal the companion's private choice");

const blockCallsBefore = calls.length;
await chat.toggleConversationBlock();
assert.equal(chat.data.conversationBlockedByYou, true, "a participant can create their own conversation boundary");
assert.equal(chat.data.messageInteractionAvailable, false, "blocking must stop ordinary message interaction for the current view");
assert.equal(chat.data.messages.length, 0, "blocking must clear the local visible message timeline without deleting server records");
assert.ok(calls.slice(blockCallsBefore).some((call) =>
  call.path === `/conversations/${companion.id}/block` && call.method === "PUT" && call.data.blocked === true
), "blocking must use the participant-scoped server boundary rather than local hiding");
assert.match(modalInvocations.at(-1).content, /不会取消订单、退款、结算、举报或客服处理/);
const blockedMessagePosts = calls.filter((call) => call.path === `/conversations/${companion.id}/messages` && call.method === "POST").length;
chat.setDraft({ detail: { value: "拉黑后不应发送" } });
await chat.send();
assert.equal(calls.filter((call) => call.path === `/conversations/${companion.id}/messages` && call.method === "POST").length, blockedMessagePosts,
  "a blocked chat view must not attempt a new message request");
await messages.load();
assert.equal(messages.data.conversations[0].conversationBlockedByYou, true, "the message list should retain only a private management state");
assert.match(messages.data.conversations[0].preview, /拉黑/);
modalConfirm = false;
chat.onUnload();

currentUserRole = "user";
const detail = await loadPage("companion/detail");
detail.companionId = companion.id;
await detail.load();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(detail.data.serviceCatalogStatus, "available");
assert.equal(detail.data.selectedServiceOfferingId, "service-text-30");
assert.equal(detail.data.trustFacts.length, 3, "public profiles must explain verification, service boundaries, and transaction protection before booking");
assert.deepEqual(detail.data.publicProfile.languages, ["中文"]);
assert.deepEqual(detail.data.publicProfile.specialties, ["情绪倾听"]);
assert.match(detail.data.publicProfile.livedExperience, /职场转型/);
assert.deepEqual(detail.data.publicProfile.serviceBoundaries, ["不提供医疗诊断", "仅平台内沟通"]);
assert.equal(detail.data.publicProfile.completedOrdersText, "86 单已完成");
assert.equal(detail.data.publicProfile.responseTimeText, "通常 5 分钟内回复");
assert.equal(detail.data.publicProfile.trainingCurrent, true);
assert.match(detail.data.publicProfile.trainingDetailText, /3\/3 项要求当前有效/);
assert.equal(detail.data.publicProfile.reviewCurrent, true);
assert.match(detail.data.publicProfile.reviewDetailText, /下次复审/);
assert.equal(detail.data.publicProfile.voiceIntroPlayable, false, "an approved voice intro without a safe playback URL must stay hidden");
assert.match(detail.data.publicProfile.voiceIntroMetaText, /已审核 · 20 秒/);
assert.equal(detail.data.publicProfile.voiceIntroPlaybackText, "");
companion.voiceIntro.playbackUrl = "https://media.talkandtalk.test/voice/short-lived-token";
await detail.load();
assert.equal(detail.data.publicProfile.voiceIntroPlayable, true, "an approved voice intro with a controlled HTTPS URL may be shown");
assert.match(detail.data.publicProfile.voiceIntroPlaybackText, /点击播放/);
companion.voiceIntro.playbackUrl = null;
assert.match(detail.data.trustFacts[0].description, /公开展示条件/);
assert.match(detail.data.trustFacts[0].description, /不表示医疗/);
assert.match(detail.data.trustFacts[1].description, /只在平台内进行/);
assert.match(detail.data.trustFacts[2].description, /创建订单时的当前选择/);
assert.match(detail.data.trustFacts[2].description, /订单内联系平台客服/);
assert.equal(detail.data.canManageFavorites, true, "only a customer profile should receive the private bookmark control");
assert.equal(detail.data.favoriteState, "available");
assert.deepEqual(recentlyViewedCompanionIds, [companion.id], "opening a public detail page should update only the customer's private recall list");
assert.ok(calls.some((call) => call.path === `/recently-viewed/companions/${companion.id}` && call.method === "PUT"));
assert.equal(detail.data.isFavorite, false);
failFavoritesLoad = true;
await detail.load();
assert.equal(detail.data.favoriteState, "error", "unknown bookmark state must not be rendered as not saved");
const favoriteMutationsBeforeUnknownState = calls.filter((call) =>
  call.path === `/favorites/companions/${companion.id}` && call.method !== "GET"
).length;
await detail.toggleFavorite();
assert.equal(calls.filter((call) =>
  call.path === `/favorites/companions/${companion.id}` && call.method !== "GET"
).length, favoriteMutationsBeforeUnknownState, "unknown bookmark state must fail closed before mutation");
failFavoritesLoad = false;
await detail.retryFavoriteState();
assert.equal(detail.data.favoriteState, "available");
assert.equal(detail.data.isFavorite, false);
await detail.toggleFavorite();
assert.equal(detail.data.isFavorite, true);
assert.ok(favoriteCompanionIds.has(companion.id));
assert.ok(calls.some((call) => call.path === `/favorites/companions/${companion.id}` && call.method === "PUT"));
await detail.toggleFavorite();
assert.equal(detail.data.isFavorite, false);
assert.equal(favoriteCompanionIds.has(companion.id), false);
assert.ok(calls.some((call) => call.path === `/favorites/companions/${companion.id}` && call.method === "DELETE"));
await detail.toggleFavorite();
assert.equal(detail.data.isFavorite, true, "a customer can save a public companion again after removing the private bookmark");
assert.equal(detail.data.isRecommendationExcluded, false);
const unrelatedRelationshipMutationCount = () => calls.filter((call) =>
  call.method !== "GET" && (
    call.path === `/conversations/${companion.id}/block`
    || call.path.startsWith("/reports")
    || call.path.startsWith("/orders")
    || call.path.startsWith("/favorites/companions")
  )
).length;
const unrelatedMutationsBeforeRecommendationExclusion = unrelatedRelationshipMutationCount();
modalConfirm = true;
await detail.excludeFromRecommendations();
modalConfirm = false;
assert.equal(detail.data.isRecommendationExcluded, true);
assert.ok(excludedRecommendationCompanionIds.has(companion.id));
assert.ok(calls.some((call) =>
  call.path === `/recommendations/me/companion-exclusions/${companion.id}` && call.method === "PUT"
));
assert.match(modalInvocations.at(-1).content, /不会拉黑会话、提交举报、取消订单、改变书签或隐藏公开资料/);
assert.equal(unrelatedRelationshipMutationCount(), unrelatedMutationsBeforeRecommendationExclusion,
  "a recommendation exclusion must not mutate blocks, reports, orders, or bookmarks");
await discover.load();
assert.equal(discover.data.isFiltering, false);
assert.equal(discover.data.companions.length, 0,
  "an excluded companion must disappear from default recommendations even when personalization stays enabled");
discover.setSearchInput({ detail: { value: companion.name } });
await discover.submitSearch();
assert.equal(discover.data.companions[0].id, companion.id,
  "a recommendation exclusion must leave explicit public catalog search available");
assert.equal(discover.data.companions[0].impressionId, undefined);
await discover.clearFilters();
assert.equal(discover.data.companions.length, 0, "clearing search must return to the exclusion-aware recommendation flow");
await detail.restoreToRecommendations();
assert.equal(detail.data.isRecommendationExcluded, false);
assert.equal(excludedRecommendationCompanionIds.has(companion.id), false);
await discover.load();
assert.equal(discover.data.companions[0].id, companion.id, "restoring must make the companion eligible for later recommendations");
modalConfirm = true;
await detail.excludeFromRecommendations();
modalConfirm = false;
assert.equal(detail.data.isRecommendationExcluded, true, "the recommendation-only preference can be set again idempotently");
await discover.load();
assert.equal(discover.data.companions.length, 0);
assert.equal(detail.data.availabilityStatus, "structured");
assert.equal(detail.data.canBook, false, "a structured booking must require an explicit slot choice");
detail.selectServiceIntent({ currentTarget: { dataset: { code: "organize" } } });
assert.equal(detail.data.selectedServiceIntent, "organize");
assert.equal(detail.data.selectedServiceIntentLabel, "想梳理思路");
detail.selectServiceOffering({ currentTarget: { dataset: { id: "service-voice-60" } } });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(detail.data.selectedServiceOfferingId, "service-voice-60");
assert.equal(detail.data.availabilityStatus, "structured");
assert.equal(detail.data.selectedAvailabilityCandidate, null);
const voiceSlot = detail.data.availabilityCandidates[0];
assert.equal(voiceSlot.availabilityWindowId, "window-service-voice-60");
detail.selectAvailabilityCandidate({ currentTarget: { dataset: { id: voiceSlot.id } } });
assert.equal(detail.data.selectedAvailabilityCandidateId, voiceSlot.id);
assert.equal(detail.data.canBook, true);
assert.match(detail.data.bookingButtonText, /¥69/);
failNextOrderCreate = true;
await detail.book();
assert.equal(detail.data.bookingConfirmationVisible, true, "booking must show a review step before creating an order");
detail.toggleBookingBoundary();
detail.toggleBookingAccuracy();
await detail.confirmBooking();
// The smoke output is CommonJS-cached by Node, so instantiate a fresh page
// object explicitly to model a Mini Program page/process restart.
const detailAfterRestart = {
  ...detail,
  data: {
    ...structuredClone(detail.data),
    orderClientRequestId: "",
    bookingConfirmationVisible: false,
    bookingBoundaryConfirmed: false,
    bookingAccuracyConfirmed: false,
    bookingPreview: null
  },
  setData(patch) { Object.assign(this.data, patch); }
};
detailAfterRestart.companionId = companion.id;
detailAfterRestart.themeId = detail.themeId;
detailAfterRestart.setData({ bookingDate: detail.data.bookingDate, bookingTime: detail.data.bookingTime });
await detailAfterRestart.book();
detailAfterRestart.toggleBookingBoundary();
detailAfterRestart.toggleBookingAccuracy();
await detailAfterRestart.confirmBooking();
assert.equal(attemptedOrderRequestIds.length, 2);
assert.equal(
  attemptedOrderRequestIds[0],
  attemptedOrderRequestIds[1],
  "an ambiguous create followed by a page restart must reuse the persisted idempotency key"
);
assert.equal(
  [...storage.keys()].some((key) => key.startsWith("talkandtalk.pendingOrder.")),
  false,
  "an acknowledged order create must clear its persisted pending key"
);
assert.equal(createdOrderPayload.themeId, "t1");
assert.equal(createdOrderPayload.serviceOfferingId, "service-voice-60");
assert.equal(createdOrderPayload.durationMinutes, 60);
assert.equal(createdOrderPayload.availabilityWindowId, "window-service-voice-60");
assert.equal(createdOrderPayload.serviceIntent, "organize");

failServiceOfferingsLoad = true;
const orderCreatesBeforeCatalogFailure = calls.filter((call) => call.path === "/orders" && call.method === "POST").length;
const legacyDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
legacyDetail.companionId = companion.id;
legacyDetail.themeId = "";
await legacyDetail.load();
assert.equal(legacyDetail.data.serviceCatalogStatus, "empty");
assert.equal(legacyDetail.data.selectedServiceOffering, null);
assert.equal(legacyDetail.data.canBook, false);
assert.match(legacyDetail.data.serviceCatalogMessage, /服务目录暂时不可用/);
await legacyDetail.book();
assert.equal(
  calls.filter((call) => call.path === "/orders" && call.method === "POST").length,
  orderCreatesBeforeCatalogFailure,
  "a catalog outage must fail closed instead of creating an editable-profile-price order"
);
failServiceOfferingsLoad = false;

availabilityMode = "legacy";
const orderCreatesBeforeLegacyAvailability = calls.filter((call) => call.path === "/orders" && call.method === "POST").length;
const serverLegacyDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
serverLegacyDetail.companionId = companion.id;
serverLegacyDetail.themeId = "";
await serverLegacyDetail.load();
serverLegacyDetail.selectServiceIntent({ currentTarget: { dataset: { code: "listen" } } });
assert.equal(serverLegacyDetail.data.serviceCatalogStatus, "available");
assert.equal(serverLegacyDetail.data.availabilityStatus, "empty");
assert.equal(serverLegacyDetail.data.canBook, false);
assert.match(serverLegacyDetail.data.availabilityMessage, /真实时段/);
await serverLegacyDetail.book();
assert.equal(
  calls.filter((call) => call.path === "/orders" && call.method === "POST").length,
  orderCreatesBeforeLegacyAvailability,
  "commercial booking must not proceed without a structured availability window"
);
availabilityMode = "structured";

const staleAvailabilityDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
staleAvailabilityDetail.companionId = companion.id;
staleAvailabilityDetail.themeId = "";
await staleAvailabilityDetail.load();
staleAvailabilityDetail.selectServiceIntent({ currentTarget: { dataset: { code: "organize" } } });
const staleSlot = staleAvailabilityDetail.data.availabilityCandidates[0];
staleAvailabilityDetail.selectAvailabilityCandidate({ currentTarget: { dataset: { id: staleSlot.id } } });
nextOrderApiErrorCode = "COMPANION_SLOT_UNAVAILABLE";
await staleAvailabilityDetail.book();
staleAvailabilityDetail.toggleBookingBoundary();
staleAvailabilityDetail.toggleBookingAccuracy();
await staleAvailabilityDetail.confirmBooking();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(staleAvailabilityDetail.data.availabilityStatus, "structured");
assert.equal(staleAvailabilityDetail.data.selectedAvailabilityCandidate, null);
assert.equal(staleAvailabilityDetail.data.canBook, false, "a full slot must be cleared before retrying");

returnEmptyAvailability = true;
const emptyAvailabilityDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
emptyAvailabilityDetail.companionId = companion.id;
emptyAvailabilityDetail.themeId = "";
await emptyAvailabilityDetail.load();
emptyAvailabilityDetail.selectServiceIntent({ currentTarget: { dataset: { code: "listen" } } });
assert.equal(emptyAvailabilityDetail.data.availabilityStatus, "empty");
assert.equal(emptyAvailabilityDetail.data.canBook, false);
const ordersBeforeEmptyAvailabilityBooking = attemptedOrderRequestIds.length;
await emptyAvailabilityDetail.book();
assert.equal(attemptedOrderRequestIds.length, ordersBeforeEmptyAvailabilityBooking, "an empty structured calendar must not create an order");
returnEmptyAvailability = false;

returnMalformedAvailability = true;
const invalidAvailabilityDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
invalidAvailabilityDetail.companionId = companion.id;
invalidAvailabilityDetail.themeId = "";
await invalidAvailabilityDetail.load();
assert.equal(invalidAvailabilityDetail.data.availabilityStatus, "unavailable");
assert.equal(invalidAvailabilityDetail.data.canBook, false);
returnMalformedAvailability = false;

failAvailabilityLoad = true;
const failedAvailabilityDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
failedAvailabilityDetail.companionId = companion.id;
failedAvailabilityDetail.themeId = "";
await failedAvailabilityDetail.load();
assert.equal(failedAvailabilityDetail.data.availabilityStatus, "unavailable");
assert.equal(failedAvailabilityDetail.data.canBook, false);
failAvailabilityLoad = false;

returnMalformedServiceOffering = true;
const invalidCatalogDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
invalidCatalogDetail.companionId = companion.id;
invalidCatalogDetail.themeId = "";
await invalidCatalogDetail.load();
assert.equal(invalidCatalogDetail.data.serviceCatalogStatus, "empty");
assert.equal(invalidCatalogDetail.data.canBook, false);
const ordersBeforeInvalidCatalogBooking = attemptedOrderRequestIds.length;
await invalidCatalogDetail.book();
assert.equal(attemptedOrderRequestIds.length, ordersBeforeInvalidCatalogBooking, "invalid catalog data must not reach order creation");
returnMalformedServiceOffering = false;

const community = await loadPage("community/index");
await community.load();
assert.equal(community.data.posts.length, 2);
assert.equal(community.data.recommendations.length, 0,
  "the same private exclusion must apply across recommendation placements without hiding public community content");
assert.equal(community.data.recommendationsState, "empty", "a successful exclusion-aware feed may be genuinely empty");
failRecommendationsLoad = true;
await community.loadRecommendations();
assert.equal(community.data.recommendationsState, "error", "a related-feed outage must not look like a genuine empty result");
assert.equal(community.data.posts.length, 2, "related-feed failure must not hide the community feed");
failRecommendationsLoad = false;
await community.retryRecommendations();
assert.equal(community.data.recommendationsState, "empty");
assert.equal(community.data.reportReceipts.length, 1, "community only recalls the caller's receipt list");
assert.equal(community.data.reportReceipts[0].status, "received");
assert.equal(Object.hasOwn(community.data.reportReceipts[0], "postId"), false, "receipt recall must not expose a reported post");
assert.equal(Object.hasOwn(community.data.reportReceipts[0], "authorId"), false, "receipt recall must not expose an author");
modalConfirm = true;
modalContent = "疑似引导私下联系";
const communityReportCallsBefore = calls.length;
community.reportPost({ currentTarget: { dataset: { id: "post-1" } } });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(calls.slice(communityReportCallsBefore).some((call) =>
  call.path === "/community/posts/post-1/report"
  && call.method === "POST"
  && call.data.reason === "疑似引导私下联系"
), "community report must post only the current card id and reporter reason");
assert.match(modalInvocations.at(-1).placeholderText, /不要粘贴联系方式/);
assert.equal(community.data.reportReceipts.length, 2, "a new report appends only its private receipt to the local recall list");
assert.equal(Object.hasOwn(community.data.reportReceipts[0], "postId"), false);
community.reportPost({ currentTarget: { dataset: { id: "post-1" } } });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(communityReportSubmissionCount, 2, "a repeat uses the private idempotent receipt path");
communityWriteRateLimited = true;
modalContent = "另一条不同帖子的举报原因";
const reportReceiptsBeforeRateLimit = community.data.reportReceipts.length;
community.reportPost({ currentTarget: { dataset: { id: "post-2" } } });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(community.data.reportReceipts.length, reportReceiptsBeforeRateLimit, "a throttled write must not manufacture a local receipt");
assert.equal(toasts.at(-1).title, "操作较频繁，请稍后再试", "the UI must not expose quota or server detail");
communityWriteRateLimited = false;
modalConfirm = false;
modalContent = "";

const orders = await loadPage("orders/index");
await orders.load();
assert.equal(orders.data.ordersState, "available", "the customer order queue must distinguish loaded data from empty/error");
assert.equal(orders.data.serviceOrdersState, "available", "the companion queue must expose its own loaded state");
assert.equal(orders.data.supportTicketsState, "empty", "an actual empty support queue must be explicit");
assert.match(orders.data.orders[0].scheduledAtText, /\d{4}年\d{2}月\d{2}日/, "orders must display a localized appointment time");
customerOrdersLoadError = { statusCode: 503, code: "ORDERS_UNAVAILABLE", message: "orders unavailable" };
await orders.load();
assert.equal(orders.data.ordersState, "error", "a customer-order outage must never look like an empty order history");
assert.equal(orders.data.orders.length, 0);
assert.equal(orders.data.serviceOrdersState, "available", "customer-order failure must not hide the independent companion queue");
assert.match(orders.data.ordersError, /不代表没有订单/);
customerOrdersLoadError = null;
await orders.retryCustomerOrders();
assert.equal(orders.data.ordersState, "available", "the customer order queue must recover through its scoped retry");
serviceOrdersLoadError = { statusCode: 503, code: "SERVICE_ORDERS_UNAVAILABLE", message: "service orders unavailable" };
await orders.load();
assert.equal(orders.data.serviceOrdersState, "error", "a companion-queue outage must not be rendered as no work");
assert.equal(orders.data.ordersState, "available", "companion-queue failure must not hide customer orders");
assert.match(orders.data.serviceOrdersError, /不代表当前没有/);
serviceOrdersLoadError = null;
await orders.retryServiceOrders();
assert.equal(orders.data.serviceOrdersState, "available", "the companion queue must recover through its scoped retry");
assert.equal(orders.data.serviceOrders[0].attendanceDispute.id, attendanceDispute.id,
  "the companion order queue must retain the stable linked attendance case summary");
orders.openAttendanceDispute({
  currentTarget: { dataset: { id: serviceOrder.id, disputeId: attendanceDispute.id } }
});
assert.equal(navigations.at(-1), `/pages/order/dispute?id=${attendanceDispute.id}`,
  "the companion order surface must keep an existing dispute directly reachable");
supportTicketsLoadError = { statusCode: 503, code: "SUPPORT_CASES_UNAVAILABLE", message: "support unavailable" };
await orders.load();
assert.equal(orders.data.supportTicketsState, "error", "a support-case outage must not be rendered as no case");
assert.equal(orders.data.ordersState, "available", "support-case failure must not hide customer orders");
assert.match(orders.data.supportTicketsError, /不代表案件不存在/);
supportTicketsLoadError = null;
await orders.retrySupportTickets();
assert.equal(orders.data.supportTicketsState, "empty", "a successful scoped retry may establish the real empty state");
assert.equal(calls.filter((call) => call.path.endsWith("/timeline")).length, 0, "order list must not fan out timeline requests before a user asks to view one");
await orders.toggleTimeline({ currentTarget: { dataset: { id: order.id } } });
assert.equal(orders.data.orders[0].timelineState, "loaded");
assert.match(orders.data.orders[0].timelineItems[1].title, /你提出改期/);
assert.match(orders.data.orders[0].timelineItems[1].description, /请在/);
assert.ok(calls.some((call) => call.path === `/orders/${order.id}/timeline` && call.method === "GET"));
await orders.toggleTimeline({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.equal(orders.data.serviceOrders[0].timelineState, "loaded");
assert.match(orders.data.serviceOrders[0].timelineItems.at(-1).title, /客户未接受改期/);
assert.ok(calls.some((call) => call.path === `/orders/${serviceOrder.id}/timeline` && call.method === "GET"));
timelineLoadError = { statusCode: 503, code: "TIMELINE_UNAVAILABLE", message: "timeline unavailable" };
await orders.load();
await orders.toggleTimeline({ currentTarget: { dataset: { id: order.id } } });
assert.equal(orders.data.orders[0].timelineState, "unavailable");
assert.match(orders.data.orders[0].timelineError, /暂时无法加载/);
timelineLoadError = null;
await orders.load();
customerOrderTimeline.items[1].rescheduleRequest.status = "accepted";
assert.equal(orders.data.serviceOrders[0].canInitiateReschedule, true, "an unconfirmed companion-side order should expose the same proposal entry");
await orders.toggleReschedule({ currentTarget: { dataset: { id: order.id } } });
assert.equal(orders.data.orders[0].rescheduleState, "structured");
assert.equal(orders.data.orders[0].rescheduleSubmitEnabled, false, "a structured proposal must require an explicit live slot choice");
const firstRescheduleCandidate = orders.data.orders[0].rescheduleDateGroups[0].items[0];
orders.selectRescheduleCandidate({ currentTarget: { dataset: { id: firstRescheduleCandidate.id, orderId: order.id } } });
assert.equal(orders.data.orders[0].selectedRescheduleCandidateId, firstRescheduleCandidate.id);
assert.equal(orders.data.orders[0].rescheduleSubmitEnabled, true);
rescheduleSubmitError = { statusCode: 409, code: "COMPANION_SLOT_UNAVAILABLE", message: "slot unavailable" };
await orders.submitReschedule({ currentTarget: { dataset: { id: order.id } } });
assert.equal(orders.data.orders[0].rescheduleState, "structured", "a stale candidate must reload the live schedule instead of leaving a false success state");
rescheduleSubmitError = null;
const reloadedRescheduleCandidate = orders.data.orders[0].rescheduleDateGroups[0].items[0];
orders.selectRescheduleCandidate({ currentTarget: { dataset: { id: reloadedRescheduleCandidate.id, orderId: order.id } } });
await orders.submitReschedule({ currentTarget: { dataset: { id: order.id } } });
assert.equal(orders.data.orders[0].rescheduleState, "pending");
assert.match(orders.data.orders[0].pendingRescheduleText, /等待对方/);
assert.equal(submittedReschedulePayload.availabilityWindowId, reloadedRescheduleCandidate.availabilityWindowId);
assert.ok(calls.some((call) => call.path === `/orders/${order.id}/reschedule-requests` && call.method === "POST"));
modalConfirm = true;
serviceRescheduleRequest = {
  id: "service-reschedule-accept", requestedByRole: "customer", originalScheduledAt: serviceOrder.scheduledAt,
  requestedScheduledAt: new Date(Date.parse(serviceOrder.scheduledAt) + 24 * 60 * 60 * 1000).toISOString(),
  requestedAvailabilitySnapshot: { availabilityWindowId: "window-service-accept", startsAt: null, endsAt: null, capacity: 1 },
  status: "pending", expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), respondedAt: null
};
serviceOrderTimeline.items = [
  { id: "service-order-created", type: "orderCreated", actorRole: "customer", occurredAt: serviceOrder.createdAt, rescheduleRequest: null },
  { id: serviceRescheduleRequest.id, type: "rescheduleRequested", actorRole: "customer", occurredAt: new Date().toISOString(), rescheduleRequest: serviceRescheduleRequest }
];
await orders.load();
await orders.toggleTimeline({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.equal(orders.data.serviceOrders[0].canRespondToReschedule, true, "only the participant who did not propose the change may handle it");
assert.match(orders.data.serviceOrders[0].pendingRescheduleRequestedText, /年/);
rescheduleResponseError = { statusCode: 409, code: "RESCHEDULE_REQUEST_AVAILABILITY_MISSING", message: "missing availability" };
await orders.respondReschedule({ currentTarget: { dataset: { id: serviceOrder.id, action: "accept" } } });
assert.match(orders.data.serviceOrders[0].rescheduleResponseError, /缺少可验证的预约时段/);
rescheduleResponseError = null;
await orders.respondReschedule({ currentTarget: { dataset: { id: serviceOrder.id, action: "accept" } } });
assert.equal(orders.data.serviceOrders[0].canRespondToReschedule, false);
assert.equal(serviceOrder.scheduledAt, serviceRescheduleRequest.requestedScheduledAt, "accepting must refresh the order with the server-selected schedule");
assert.ok(calls.some((call) => call.path.endsWith(`/reschedule-requests/${serviceRescheduleRequest.id}/accept`) && call.method === "POST"));
const scheduleBeforeReject = serviceOrder.scheduledAt;
serviceRescheduleRequest = {
  id: "service-reschedule-reject", requestedByRole: "customer", originalScheduledAt: scheduleBeforeReject,
  requestedScheduledAt: new Date(Date.parse(scheduleBeforeReject) + 24 * 60 * 60 * 1000).toISOString(),
  requestedAvailabilitySnapshot: { availabilityWindowId: "window-service-reject", startsAt: null, endsAt: null, capacity: 1 },
  status: "pending", expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), respondedAt: null
};
serviceOrderTimeline.items = [
  { id: "service-order-created-after-accept", type: "orderCreated", actorRole: "customer", occurredAt: serviceOrder.createdAt, rescheduleRequest: null },
  { id: serviceRescheduleRequest.id, type: "rescheduleRequested", actorRole: "customer", occurredAt: new Date().toISOString(), rescheduleRequest: serviceRescheduleRequest }
];
await orders.load();
await orders.toggleTimeline({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.equal(orders.data.serviceOrders[0].canRespondToReschedule, true);
await orders.respondReschedule({ currentTarget: { dataset: { id: serviceOrder.id, action: "reject" } } });
assert.equal(orders.data.serviceOrders[0].canRespondToReschedule, false);
assert.equal(serviceOrder.scheduledAt, scheduleBeforeReject, "rejecting must preserve the existing appointment");
assert.ok(calls.some((call) => call.path.endsWith(`/reschedule-requests/${serviceRescheduleRequest.id}/reject`) && call.method === "POST"));
const subscriptionRequestsBeforeCustomer = subscriptionRequests.length;
const subscriptionGrantsBeforeCustomer = subscriptionGrants.length;
await orders.enableCustomerNotifications();
const customerSubscriptionRequests = subscriptionRequests.slice(subscriptionRequestsBeforeCustomer);
const customerSubscriptionGrants = subscriptionGrants.slice(subscriptionGrantsBeforeCustomer);
assert.equal(customerSubscriptionRequests.length, 3, "nine customer reminder templates must be requested in three platform-safe batches");
assert.ok(customerSubscriptionRequests.every((templates) => templates.length >= 1 && templates.length <= 3));
assert.deepEqual(customerSubscriptionRequests.flat(), [
  "template-reservationExpired", "template-serviceStarted", "template-serviceCompleted",
  "template-supportUpdate",
  "template-rescheduleRequested", "template-rescheduleAccepted", "template-rescheduleRejected",
  "template-rescheduleExpired", "template-rescheduleCancelled"
]);
assert.deepEqual(customerSubscriptionGrants, [
  "reservationExpired", "serviceStarted", "serviceCompleted",
  "supportUpdate",
  "rescheduleRequested", "rescheduleAccepted", "rescheduleRejected",
  "rescheduleExpired", "rescheduleCancelled"
]);
assert.match(modalInvocations.at(-1).content, /售后处理/);
const subscriptionRequestsBeforeCompanion = subscriptionRequests.length;
const subscriptionGrantsBeforeCompanion = subscriptionGrants.length;
await orders.enableCompanionNotifications();
const companionSubscriptionRequests = subscriptionRequests.slice(subscriptionRequestsBeforeCompanion);
const companionSubscriptionGrants = subscriptionGrants.slice(subscriptionGrantsBeforeCompanion);
assert.equal(companionSubscriptionRequests.length, 3, "eight companion reminder templates must be requested in three platform-safe batches");
assert.ok(companionSubscriptionRequests.every((templates) => templates.length >= 1 && templates.length <= 3));
assert.deepEqual(companionSubscriptionGrants, [
  "newOrder", "orderCancelled", "supportUpdate",
  "rescheduleRequested", "rescheduleAccepted", "rescheduleRejected",
  "rescheduleExpired", "rescheduleCancelled"
]);
assert.match(modalInvocations.at(-1).content, /新订单/);
await orders.pay({ currentTarget: { dataset: { id: order.id } } });
assert.match(modalInvocations.at(-1).content, /服务对象/);
assert.match(modalInvocations.at(-1).content, /预约前 5 分钟/);
assert.match(modalInvocations.at(-1).content, /全额原路退款/);
assert.ok(calls.some((call) => call.path === "/payments/wechat/mock-notify"));
paymentIsMock = false;
await orders.pay({ currentTarget: { dataset: { id: order.id } } });
assert.equal(paymentInvocations.length, 1, "real payment branch must invoke wx.requestPayment exactly once");
assert.equal(paymentInvocations[0].package, "prepay_id=mock");
assert.equal(paymentInvocations[0].signType, "RSA");
assert.ok(calls.some((call) => call.path === `/orders/${order.id}/payment/sync` && call.method === "POST"),
  "real payment branch must reconcile the payment with the backend");

const serviceScheduleBeforeFulfillment = serviceOrder.scheduledAt;
order.status = "paid";
order.serviceStartedAt = null;
order.refund = null;
order.scheduledAt = new Date(Date.now() + 30 * 60_000).toISOString();
serviceOrder.status = "paid";
serviceOrder.serviceStartedAt = null;
serviceOrder.scheduledAt = new Date(Date.now() + 10 * 60_000).toISOString();
await orders.load();
assert.equal(orders.data.orders[0].fulfillmentTitle, "等待服务开始");
assert.match(orders.data.orders[0].fulfillmentCountdownText, /分钟/);
assert.equal(orders.data.orders[0].canOpenOrderConversation, true, "a paid customer order with an activated conversation should expose the order chat entry");
assert.equal(orders.data.orders[0].hasServiceGuidelines, true, "a paid order before service starts should show the shared service-boundary acknowledgement");
assert.equal(orders.data.orders[0].serviceGuidelinesProgress, "0/2 已确认");
assert.match(orders.data.orders[0].serviceGuidelinesSummary, /平台内沟通/);
await orders.confirmServiceGuidelines({ currentTarget: { dataset: { id: order.id } } });
assert.ok(order.customerServiceGuidelinesConfirmedAt, "customer acknowledgement must be persisted through the order endpoint");
assert.ok(calls.some((call) => call.path === `/orders/${order.id}/service-guidelines-confirmations` && call.method === "POST"));
assert.equal(orders.data.orders[0].serviceGuidelinesProgress, "1/2 已确认");
assert.match(orders.data.orders[0].customerServiceGuidelinesStatus, /已于/);
assert.equal(orders.data.orders[0].canConfirmServiceGuidelines, false, "a participant should not see a duplicate acknowledgement action");
assert.match(modalInvocations.at(-1).content, /不替代医疗/);
await orders.openOrderConversation({ currentTarget: { dataset: { id: order.id } } });
assert.equal(navigations.at(-1), `/pages/chat/index?id=${companion.id}`, "customers must route through the paid order's public conversation id");
assert.equal(orders.data.serviceOrders[0].fulfillmentTitle, "可以开始服务");
assert.equal(orders.data.serviceOrders[0].canStartService, true, "companions should see start only inside the 15-minute service window");
assert.equal(orders.data.serviceOrders[0].hasServiceGuidelines, true);
assert.equal(orders.data.serviceOrders[0].serviceGuidelinesActionText, "确认服务范围与边界");
await orders.confirmServiceGuidelines({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.ok(serviceOrder.companionServiceGuidelinesConfirmedAt, "companion acknowledgement must be persisted independently");
assert.ok(calls.some((call) => call.path === `/orders/${serviceOrder.id}/service-guidelines-confirmations` && call.method === "POST"));
assert.equal(orders.data.serviceOrders[0].serviceGuidelinesProgress, "1/2 已确认");
assert.match(orders.data.serviceOrders[0].companionServiceGuidelinesStatus, /已于/);
await orders.openOrderConversation({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.equal(navigations.at(-1), "/pages/chat/index?id=conversation-internal-order-1", "companions must resolve their participant-safe conversation id before navigating");

const serviceOfferingBeforeVoiceSmoke = { ...serviceOrder.serviceOfferingSnapshot };
const serviceDurationBeforeVoiceSmoke = serviceOrder.durationMinutes;
serviceOrder.status = "pending";
serviceOrder.serviceStartedAt = null;
serviceOrder.companionConfirmedAt = null;
serviceOrder.paymentReservationExpiresAt = null;
serviceOrder.scheduledAt = new Date(Date.now() + 10 * 60_000).toISOString();
serviceOrder.durationMinutes = 60;
serviceOrder.serviceOfferingSnapshot = {
  ...serviceOrder.serviceOfferingSnapshot,
  id: "service-voice-60",
  code: "voice-60",
  title: "60 分钟语音陪伴",
  deliveryMode: "voice",
  durationMinutes: 60,
  priceCents: 6900
};
modalConfirm = true;
await orders.load();
await orders.confirmServiceOrder({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.ok(serviceOrder.companionConfirmedAt, "the companion must manually accept a voice order before payment");
assert.ok(serviceOrder.paymentReservationExpiresAt, "manual acceptance must create a bounded payment hold");
assert.match(modalInvocations.at(-1).content, /双方才能进入订单内实时语音/);
assert.ok(calls.some((call) => call.path === `/orders/service/${serviceOrder.id}/confirm` && call.method === "POST"));
serviceOrder.status = "paid";
await orders.load();
await orders.startService({ currentTarget: { dataset: { id: serviceOrder.id } } });
assert.equal(serviceOrder.status, "inService", "the companion must explicitly start the paid voice service");
assert.equal(navigations.at(-1), `/pages/voice/index?orderId=${serviceOrder.id}`, "starting a voice service should enter the order-scoped RTC page");
const voice = await loadPage("voice/index");
const trtcEntersBeforePreflight = trtcEnterInvocations.length;
const trtcStartsBeforePreflight = trtcPusherStarts.length;
voice.onLoad({ orderId: serviceOrder.id });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(voice.data.roomState, "preflight");
assert.equal(voice.data.preflightVisible, true, "opening voice must show a preflight before requesting room credentials");
assert.match(voice.data.networkTypeText, /Wi-Fi/);
assert.equal(trtcEnterInvocations.length, trtcEntersBeforePreflight, "preflight must not enter an RTC room");
assert.equal(trtcPusherStarts.length, trtcStartsBeforePreflight, "preflight must not enable the microphone");
voice.onHide();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(
  trtcEnterInvocations.length,
  trtcEntersBeforePreflight,
  "backgrounding before explicit preflight confirmation must never enter a room"
);
assert.equal(
  trtcPusherStarts.length,
  trtcStartsBeforePreflight,
  "backgrounding before explicit preflight confirmation must never enable the microphone"
);
assert.equal(voice.data.roomState, "preflight");
voice.toggleEnvironmentConfirmation();
voice.toggleBoundaryConfirmation();
await voice.connect();
assert.equal(
  trtcEnterInvocations.length,
  trtcEntersBeforePreflight,
  "calling connect directly must not bypass the TRTC disclosure confirmation"
);
voice.toggleTrtcDisclosureConfirmation();
await voice.confirmPreflight();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(voice.data.roomState, "connected");
assert.equal(voice.data.preflightVisible, false);
assert.match(voice.data.serviceRemainingText, /^\d{2}:\d{2}$/, "connected voice must display a service countdown");
assert.equal(trtcEnterInvocations.length, 1, "the page must pass only the server-issued order credential to TRTC");
assert.equal(trtcEnterInvocations[0].strRoomID, "tt_voice_smoke_service_order_1");
assert.equal(trtcEnterInvocations[0].recvMode, 2, "the real-time voice room must be audio receive mode");
assert.equal(trtcEnterInvocations[0].enableCamera, false, "the RTC pusher must remain audio-only");
assert.equal(trtcEnterInvocations[0].enableMic, true, "the RTC pusher must start with microphone enabled");
assert.equal(trtcPusherStarts.length, 1, "the native pusher must start after the TRTC attributes bind to the page");
assert.equal(Object.hasOwn(voice.data, "userSig"), false, "raw UserSig must never be retained as a page field");
assert.equal(Object.hasOwn(voice.data, "privateMapKey"), false, "raw PrivateMapKey must never be retained as a page field");
const remoteAudioPlayer = {
  id: "remote-audio-1",
  streamID: "remote-audio-1",
  userID: "remote-companion",
  muteAudio: false
};
voice.trtc.playerList = [remoteAudioPlayer];
voice.trtc.handlers.get("REMOTE_AUDIO_ADD")?.({ data: { player: remoteAudioPlayer } });
assert.equal(voice.data.remoteAudioConnected, true, "a provider remote-audio add event must be the authoritative joined signal");
assert.match(voice.data.statusText, /正在通话中/);
voice.playerStateChange({ detail: { code: 2004 } });
assert.match(voice.data.statusText, /正在通话中/, "generic player state callbacks must not invent a participant state");
voice.trtc.playerList = [];
voice.trtc.handlers.get("REMOTE_AUDIO_REMOVE")?.({ data: { player: remoteAudioPlayer } });
assert.equal(voice.data.remoteAudioConnected, false, "remote-audio removal must clear the participant-connected state");
assert.equal(voice.data.playerList.length, 0, "remote-audio removal must clear the departed stream from native players");
assert.match(voice.data.statusText, /等待其重新加入/);
voice.playerStateChange({ detail: { code: 2105 } });
assert.match(voice.data.statusText, /等待其重新加入/, "a generic callback must not falsely announce that a departed participant rejoined");
voice.toggleMute();
assert.equal(voice.data.pusher.enableMic, false, "muting must disable microphone publishing through TRTC");
assert.equal(microphoneVolumes.at(-1), 0, "muting must immediately set native microphone volume to zero");
await voice.leaveVoice();
assert.equal(trtcExitInvocations.length, 1, "leaving must terminate the RTC room");
assert.equal(navigations.at(-1), "__back:1");
await voice.connect();
await new Promise((resolve) => setTimeout(resolve, 10));
voice.trtc.handlers.get("KICKED_OUT")?.({ data: { reason: "room-disband" } });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(voice.data.roomState, "ended", "a server-side room dismissal must end the local RTC page");
assert.equal(voice.data.pusher.url, "", "a provider kick-out must clear native pusher attributes");
assert.equal(trtcExitInvocations.length, 1, "KICKED_OUT must not race SDK cleanup with a second exitRoom call");
await voice.connect();
await new Promise((resolve) => setTimeout(resolve, 10));
voice.onHide();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(voice.data.roomState, "ended", "backgrounding must tear down the native RTC transport");
assert.equal(voice.data.canRetry, true, "returning from background must require an explicit, fresh reconnect");
await voice.retry();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(voice.data.roomState, "connected", "an explicit retry after backgrounding must issue a fresh RTC connection");
modalConfirm = true;
modalContent = "通话中对方持续要求私下转账，我需要平台核对。";
await voice.leaveAndReport();
assert.equal(voice.data.roomState, "ended", "the smoke test must release the retried RTC transport and its service timer");
assert.ok(calls.some((call) =>
  call.path === "/moderation/reports"
  && call.method === "POST"
  && call.data.reasonCode === "voice_safety"
), "voice safety exit must create a reporter-visible moderation case");
assert.match(navigations.at(-1), /^\/pages\/support\/detail\?kind=safety&id=report-/);
serviceOrder.scheduledAt = new Date(Date.now() - 61 * 60_000).toISOString();
serviceOrder.serviceStartedAt = serviceOrder.scheduledAt;
await orders.load();
assert.equal(
  orders.data.serviceOrders[0].canOpenRealtimeVoice,
  false,
  "an expired in-service voice order must hide the entry that the server would reject"
);
serviceOrder.status = "pending";
serviceOrder.serviceStartedAt = null;
serviceOrder.companionConfirmedAt = null;
serviceOrder.paymentReservationExpiresAt = null;
serviceOrder.scheduledAt = serviceScheduleBeforeFulfillment;
serviceOrder.durationMinutes = serviceDurationBeforeVoiceSmoke;
serviceOrder.serviceOfferingSnapshot = serviceOfferingBeforeVoiceSmoke;

order.status = "inService";
order.serviceStartedAt = new Date().toISOString();
order.refund = null;
modalContent = "临时情况变化，想请平台核对本次服务的履约情况。";
await orders.load();
assert.equal(orders.data.orders[0].canRequestRefund, true, "a service-in-progress order should expose the after-sales application entry");
assert.equal(orders.data.orders[0].fulfillmentTitle, "服务进行中");
assert.match(orders.data.orders[0].fulfillmentCountdownText, /分钟/);
await orders.refund({ currentTarget: { dataset: { id: order.id } } });
const refundRequest = calls.filter((call) => call.path === `/orders/${order.id}/refund` && call.method === "POST").at(-1);
assert.equal(refundRequest.data.reason, modalContent, "the API must receive the reason entered by the customer, not a generic placeholder");
assert.match(modalInvocations.at(-1).content, /人工审核/, "service-in-progress refund copy must explain the review path before submission");
assert.equal(modalInvocations.at(-1).editable, true, "refund application must collect the customer's explanation");
assert.equal(orders.data.orders[0].refundStatusText, "售后审核中");
assert.match(orders.data.orders[0].refundStatusExplanation, /显示在订单中/);
assert.equal(orders.data.orders[0].canRequestRefund, false, "a live refund application must hide duplicate self-service submission");

order.refund = {
  ...order.refund,
  status: "failed",
  reviewNote: "平台已提交退款请求，正在继续核对支付状态。",
  failureReason: "微信支付暂未返回明确处理结果，请保留订单和支付记录。"
};
await orders.load();
assert.equal(orders.data.orders[0].refundStatusText, "退款处理未完成");
assert.match(orders.data.orders[0].refundFailureText, /微信支付暂未返回/);
assert.match(orders.data.orders[0].refundReviewText, /平台已提交/);
assert.equal(orders.data.orders[0].refundCanContactSupport, true, "failed refunds should direct the customer to a refund-specific support path");
modalContent = "补充：我已核对支付账单，仍未收到退款结果。";
await orders.openSupport({ currentTarget: { dataset: { id: order.id, category: "refund" } } });
assert.match(modalInvocations.at(-1).title, /补充退款情况/);
assert.ok(calls.some((call) => call.path === "/support/tickets" && call.method === "POST" && call.data.category === "refund"));

order.status = "completed";
order.serviceStartedAt = new Date(Date.now() - 35 * 60_000).toISOString();
order.completedAt = new Date().toISOString();
order.refund = null;
order.experienceFeedback = null;
serviceOrder.experienceFeedback = null;
await orders.load();
assert.equal(orders.data.followupRecommendations.length, 0,
  "a recommendation exclusion must also suppress post-order recommendation placements without changing the order itself");
assert.equal(orders.data.orders[0].canSubmitExperienceFeedback, true,
  "only the customer should receive a private experience-feedback entry after completion");
assert.equal(orders.data.orders[0].hasExperienceFeedback, false);
assert.equal(orders.data.serviceOrders[0].canSubmitExperienceFeedback, false,
  "companion cards must never expose the customer's private feedback workflow");
assert.equal(orders.data.serviceOrders[0].hasExperienceFeedback, false,
  "companion cards must not receive the customer's individual feedback record");
assert.equal(orders.data.serviceOrders[0].canRebook, false,
  "only the customer, never the companion view, may start a new booking from a completed order");
const reviewCreateCallsBeforeOrdersEntry = calls.filter((call) => call.path === "/reviews" && call.method === "POST").length;
orders.review({ currentTarget: { dataset: { id: order.id } } });
assert.equal(navigations.at(-1), `/pages/order/aftercare?orderId=${order.id}`,
  "the order list must route public reviews through the fail-closed aftercare status check");
assert.equal(calls.filter((call) => call.path === "/reviews" && call.method === "POST").length,
  reviewCreateCallsBeforeOrdersEntry, "the order card must not submit a review before checking existing state");
await orders.toggleExperienceFeedback({ currentTarget: { dataset: { id: order.id } } });
assert.equal(orders.data.orders[0].experienceFeedbackOpen, true);
orders.setExperienceFeedbackRating({ currentTarget: { dataset: { id: order.id, rating: 4 } } });
orders.toggleExperienceFeedbackTag({ currentTarget: { dataset: { id: order.id, tag: "communicationClear" } } });
orders.toggleExperienceFeedbackTag({ currentTarget: { dataset: { id: order.id, tag: "onTime" } } });
orders.setExperienceFeedbackNote({ currentTarget: { dataset: { id: order.id } }, detail: { value: "沟通节奏清晰，开始时间也符合预期。" } });
assert.equal(orders.data.orders[0].experienceFeedbackSubmitEnabled, true);
await orders.submitExperienceFeedback({ currentTarget: { dataset: { id: order.id } } });
const feedbackRequest = calls.filter((call) => call.path === `/orders/${order.id}/experience-feedback` && call.method === "POST").at(-1);
assert.deepEqual(feedbackRequest.data, {
  rating: 4,
  tags: ["communicationClear", "onTime"],
  note: "沟通节奏清晰，开始时间也符合预期。"
});
assert.equal(order.experienceFeedback.rating, 4);
assert.equal(orders.data.orders[0].canSubmitExperienceFeedback, false,
  "a submitted feedback record must not invite duplicate submission");
assert.equal(orders.data.orders[0].hasExperienceFeedback, true);
assert.match(orders.data.orders[0].experienceFeedbackStatusText, /已记录/);
orders.rebook({ currentTarget: { dataset: { id: order.id } } });
const rebookUrl = navigations.at(-1);
const rebookLocation = new URL(rebookUrl, "https://talkandtalk.local");
assert.equal(rebookLocation.pathname, "/pages/companion/detail");
assert.equal(rebookLocation.searchParams.get("id"), companion.id);
assert.equal(rebookLocation.searchParams.get("serviceOfferingId"), "service-text-30");
assert.equal(rebookLocation.searchParams.get("themeId"), "t1");
assert.equal(rebookLocation.searchParams.get("rebook"), "1");

const rebookDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "", rebookingNotice: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
await rebookDetail.onLoad({
  id: rebookLocation.searchParams.get("id"),
  themeId: rebookLocation.searchParams.get("themeId"),
  serviceOfferingId: rebookLocation.searchParams.get("serviceOfferingId"),
  rebook: rebookLocation.searchParams.get("rebook")
});
assert.equal(rebookDetail.data.serviceCatalogStatus, "available");
assert.equal(rebookDetail.data.selectedServiceOfferingId, "service-text-30",
  "rebooking must only preselect the same currently active service, never an old price or order payload");
assert.match(rebookDetail.data.rebookingNotice, /重新选择当前可约时段/);
assert.equal(rebookDetail.data.canBook, false, "rebooking must require a newly selected live availability candidate");
const rebookCandidate = rebookDetail.data.availabilityCandidates[0];
assert.notEqual(rebookCandidate.startsAt, order.scheduledAt, "rebooking must never reuse the original order time");
rebookDetail.selectServiceIntent({ currentTarget: { dataset: { code: "listen" } } });
rebookDetail.selectAvailabilityCandidate({ currentTarget: { dataset: { id: rebookCandidate.id } } });
await rebookDetail.book();
rebookDetail.toggleBookingBoundary();
rebookDetail.toggleBookingAccuracy();
await rebookDetail.confirmBooking();
const rebookOrderRequest = calls.filter((call) => call.path === "/orders" && call.method === "POST").at(-1);
assert.equal(rebookOrderRequest.data.serviceOfferingId, "service-text-30");
assert.equal(rebookOrderRequest.data.availabilityWindowId, rebookCandidate.availabilityWindowId);
assert.equal(rebookOrderRequest.data.scheduledAt, rebookCandidate.startsAt);

failServiceOfferingsLoad = true;
const unavailableRebookDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "", rebookingNotice: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
await unavailableRebookDetail.onLoad({
  id: companion.id,
  themeId: "t1",
  serviceOfferingId: "service-text-30",
  rebook: "1"
});
assert.equal(unavailableRebookDetail.data.serviceCatalogStatus, "empty",
  "a rebooking flow must not fall back to legacy/free-form booking when the live service catalog cannot be verified");
assert.equal(unavailableRebookDetail.data.canBook, false);
assert.match(unavailableRebookDetail.data.rebookingNotice, /不会复用旧订单/);
failServiceOfferingsLoad = false;
const replacementOrderState = {
  status: order.status,
  cancelledAt: order.cancelledAt,
  completedAt: order.completedAt
};
order.status = "cancelled";
order.cancelledAt = new Date().toISOString();
order.completedAt = null;
await orders.load();
assert.equal(orders.data.orders[0].canFindReplacement, true,
  "a cancelled customer booking must offer a safe replacement-search recovery path");
assert.equal(orders.data.serviceOrders[0].canFindReplacement, false,
  "replacement search must remain customer-owned and hidden from the companion view");
orders.findReplacement({ currentTarget: { dataset: { id: order.id } } });
assert.equal(navigations.at(-1), "/pages/discover/index");
assert.deepEqual(smokeApp.globalData.discoveryIntent, {
  topicId: "t1",
  deliveryMode: "text",
  availableWithinDays: 3,
  sortBy: "soonestAvailable",
  recovery: {
    sourceOrderId: order.id,
    durationMinutes: 30,
    serviceTitle: "安静文字陪伴",
    scheduledAt: order.scheduledAt
  }
}, "replacement search may carry only bounded catalog intent, never the old payment or reservation payload");
const recoveryDiscover = {
  ...discover,
  data: structuredClone(discover.data),
  setData(patch) { Object.assign(this.data, patch); }
};
await recoveryDiscover.onShow();
assert.match(recoveryDiscover.data.recoveryNotice, /旧订单和支付不会转移/);
assert.equal(recoveryDiscover.data.selectedTopicId, "t1");
assert.equal(recoveryDiscover.data.selectedDeliveryMode, "text");
assert.equal(recoveryDiscover.data.selectedSortBy, "soonestAvailable");
assert.equal(smokeApp.globalData.discoveryIntent, null,
  "a replacement intent must be consumed once instead of leaking into later discovery visits");
recoveryDiscover.dismissRecoveryNotice();
assert.equal(recoveryDiscover.data.recoveryNotice, "");
Object.assign(order, replacementOrderState);
await orders.load();
modalContent = "服务结束后我还需要平台协助核对本次体验。";
await orders.openSupport({ currentTarget: { dataset: { id: order.id, category: "orderIssue" } } });
assert.match(modalInvocations.at(-1).title, /联系平台客服/);
assert.ok(calls.some((call) => call.path === "/support/tickets" && call.method === "POST"
  && call.data.category === "orderIssue" && call.data.subject === "订单客服请求"),
"feedback assistance must deliberately reuse the existing order-support workflow");
const orderSupportTicket = orders.data.supportTickets.find((ticket) => ticket.category === "orderIssue" && ticket.orderId === order.id);
assert.ok(orderSupportTicket?.canAddOrderFact, "an open order issue should expose only its requester's bounded fact follow-up");
const subscriptionsBeforeOrderFact = subscriptionRequests.length;
modalContent = "我在约定时间进入平台会话，等待十五分钟后仍未开始服务。";
await orders.addOrderSupportFact({ currentTarget: { dataset: { id: orderSupportTicket.id } } });
const orderFactRequest = calls.filter((call) => call.path === `/support/tickets/${orderSupportTicket.id}/order-facts` && call.method === "POST").at(-1);
assert.deepEqual(orderFactRequest.data, { statement: modalContent });
assert.match(modalInvocations.at(-1).content, /不粘贴整段聊天/);
assert.match(modalInvocations.at(-1).content, /不会自动决定退款、结算或订单状态/);
assert.equal(subscriptionRequests.length, subscriptionsBeforeOrderFact, "adding a fact must not request a notification grant");
const refreshedOrderSupportTicket = orders.data.supportTickets.find((ticket) => ticket.id === orderSupportTicket.id);
assert.equal(refreshedOrderSupportTicket.orderFacts.length, 1, "only the requester's returned private fact list should render");
assert.equal(refreshedOrderSupportTicket.orderFacts[0].statement, modalContent);

const serviceManager = await loadPage("companion/services/index");
await serviceManager.load();
assert.equal(serviceManager.data.accessState, "ready");
assert.equal(serviceManager.data.offerings.length, 2);
assert.equal(serviceManager.data.topicsState, "available");
failRecommendationTopicsLoad = true;
await serviceManager.retryTopics();
assert.equal(serviceManager.data.topicsState, "error", "a topic outage must not be rendered as a real empty taxonomy");
assert.match(serviceManager.data.topicsError, /不代表平台没有主题/);
failRecommendationTopicsLoad = false;
await serviceManager.retryTopics();
assert.equal(serviceManager.data.topicsState, "available");
serviceManager.openCreate();
serviceManager.setFormTitle({ detail: { value: "60 分钟深度倾听" } });
serviceManager.setFormDescription({ detail: { value: "在平台内用语音留出一段完整的表达时间。" } });
serviceManager.setFormDeliveryMode({ currentTarget: { dataset: { mode: "voice" } } });
serviceManager.setFormDuration({ detail: { value: "1" } });
serviceManager.setFormPrice({ detail: { value: "69.90" } });
serviceManager.toggleFormTopic({ currentTarget: { dataset: { id: "t2" } } });
await serviceManager.saveEditor();
const createdManagedOffering = managedServiceOfferings.find((item) => item.title === "60 分钟深度倾听");
assert.ok(createdManagedOffering, "a companion should be able to create a service draft");
assert.equal(createdManagedOffering.priceCents, 6990);
assert.equal(createdManagedOffering.isActive, false, "new service should stay a draft until explicitly published");
assert.ok(calls.some((call) => call.path === "/companions/me/service-offerings" && call.method === "POST"));

serviceManager.editOffering({ currentTarget: { dataset: { id: createdManagedOffering.id } } });
serviceManager.setFormTitle({ detail: { value: "60 分钟语音倾听" } });
managedServiceOfferingSaveError = {
  statusCode: 422,
  code: "SERVICE_OFFERING_CONTENT_REQUIRES_REVISION",
  message: "Public service offering content cannot be published; revise it and try again"
};
await serviceManager.saveEditor();
assert.match(serviceManager.data.formError, /公开内容审核/, "moderation feedback should remain in the editor");
managedServiceOfferingSaveError = null;
await serviceManager.saveEditor();
assert.equal(managedServiceOfferings.find((item) => item.id === createdManagedOffering.id).title, "60 分钟语音倾听");

await serviceManager.toggleOfferingActive({ currentTarget: { dataset: { id: createdManagedOffering.id } } });
assert.equal(managedServiceOfferings.find((item) => item.id === createdManagedOffering.id).isActive, true);
await serviceManager.moveOffering({ currentTarget: { dataset: { id: createdManagedOffering.id, direction: "-1" } } });
assert.equal(serviceManager.data.offerings[1].id, createdManagedOffering.id, "owner ordering should be reflected after reload");

managedServiceOfferingLoadError = {
  statusCode: 403,
  code: "COMPANION_OWNER_NOT_ELIGIBLE",
  message: "An active identity-verified companion profile and owner are required"
};
await serviceManager.load();
assert.equal(serviceManager.data.accessState, "ineligible");
assert.match(serviceManager.data.loadError, /实名认证/);
managedServiceOfferingLoadError = null;

serviceManager.openAvailabilityWindows();
assert.ok(navigations.includes("/pages/companion/availability/index"));
const availabilityManager = await loadPage("companion/availability/index");
await availabilityManager.load();
assert.equal(availabilityManager.data.accessState, "ready");
assert.equal(availabilityManager.data.activeWindows.length, 1);
assert.equal(availabilityManager.data.expiredWindows.length, 1);
assert.equal(availabilityManager.data.retiredWindows.length, 1);
assert.match(availabilityManager.data.activeWindows[0].rangeText, /09:00/, "availability must render in Asia/Shanghai");
assert.match(availabilityManager.data.activeWindows[0].capacityText, /2 位/);
availabilityManager.openCreateWindow();
availabilityManager.setFormCapacity({ detail: { value: "11" } });
const availabilityCreateCallsBeforeInvalidCapacity = calls.filter((call) => call.path === "/companions/me/availability-windows" && call.method === "POST").length;
await availabilityManager.saveWindow();
assert.match(availabilityManager.data.formError, /1 至 10/);
assert.equal(calls.filter((call) => call.path === "/companions/me/availability-windows" && call.method === "POST").length, availabilityCreateCallsBeforeInvalidCapacity);
availabilityManager.setFormCapacity({ detail: { value: "2" } });
managedAvailabilityWindowSaveError = {
  statusCode: 409,
  code: "AVAILABILITY_WINDOW_OVERLAP",
  message: "This availability window overlaps another active window"
};
await availabilityManager.saveWindow();
assert.match(availabilityManager.data.formError, /重叠/);
managedAvailabilityWindowSaveError = null;
await availabilityManager.saveWindow();
assert.equal(availabilityManager.data.activeWindows.length, 2, "a newly opened availability window should appear after reload");
assert.ok(calls.some((call) => call.path === "/companions/me/availability-windows" && call.method === "POST"));
const editableWindow = managedAvailabilityWindows.find((item) => item.id.startsWith("owned-window-new-"));
assert.ok(editableWindow, "created availability should be editable while it has no active order");
availabilityManager.openEditWindow({ currentTarget: { dataset: { id: editableWindow.id } } });
assert.equal(availabilityManager.data.editingWindowId, editableWindow.id);
availabilityManager.setFormCapacity({ detail: { value: "3" } });
availabilityManager.setFormEndTime({ detail: { value: String((availabilityManager.data.formStartTimeIndex + 4) % 48) } });
managedAvailabilityWindowUpdateError = {
  statusCode: 409,
  code: "AVAILABILITY_WINDOW_HAS_ACTIVE_ORDERS",
  message: "This availability window has an active order and cannot be changed or retired"
};
await availabilityManager.saveWindow();
assert.match(availabilityManager.data.formError, /待履约订单/);
assert.equal(managedAvailabilityWindows.find((item) => item.id === editableWindow.id).capacity, 2, "an active order must prevent editing");
managedAvailabilityWindowUpdateError = null;
await availabilityManager.saveWindow();
const availabilityEditCall = calls.filter((call) => call.path === `/companions/me/availability-windows/${editableWindow.id}` && call.method === "PATCH").at(-1);
assert.equal(availabilityEditCall.data.capacity, 3);
assert.equal(Object.hasOwn(availabilityEditCall.data, "isActive"), false, "editing time/capacity must not silently change publish state");
assert.equal(managedAvailabilityWindows.find((item) => item.id === editableWindow.id).capacity, 3);
assert.match(availabilityManager.data.activeWindows.find((item) => item.id === editableWindow.id).capacityText, /3 位/);
modalConfirm = true;
managedAvailabilityWindowUpdateError = {
  statusCode: 409,
  code: "AVAILABILITY_WINDOW_HAS_ACTIVE_ORDERS",
  message: "This availability window has an active order and cannot be changed or retired"
};
await availabilityManager.retireWindow({ currentTarget: { dataset: { id: "owned-window-active" } } });
assert.match(availabilityManager.data.actionError, /待履约订单/);
assert.equal(managedAvailabilityWindows.find((item) => item.id === "owned-window-active").isActive, true, "an active order must prevent retirement");
managedAvailabilityWindowUpdateError = null;
await availabilityManager.retireWindow({ currentTarget: { dataset: { id: "owned-window-active" } } });
assert.equal(managedAvailabilityWindows.find((item) => item.id === "owned-window-active").isActive, false);
assert.ok(availabilityManager.data.retiredWindows.some((item) => item.id === "owned-window-active"), "a retired window should move into the inactive group after reload");
managedAvailabilityWindowLoadError = {
  statusCode: 403,
  code: "COMPANION_OWNER_NOT_ELIGIBLE",
  message: "An active identity-verified companion profile and owner are required"
};
await availabilityManager.load();
assert.equal(availabilityManager.data.accessState, "ineligible");
assert.match(availabilityManager.data.loadError, /实名认证/);
managedAvailabilityWindowLoadError = null;

const workbench = await loadPage("companion/workbench/index");
const callsBeforeWorkbench = calls.length;
await workbench.load();
assert.equal(workbench.data.accessState, "ready");
assert.equal(workbench.data.activeOfferingCount, 2, "workbench should count only customer-visible services");
assert.equal(workbench.data.totalOfferingCount, 3);
assert.equal(workbench.data.futureWindowCount, 1, "retired windows must not be offered as upcoming capacity");
assert.equal(workbench.data.pendingConfirmationCount, 1, "unconfirmed service orders must be surfaced first");
assert.equal(workbench.data.todayServiceOrders.length, 1, "workbench should receive the narrow today-only service feed");
assert.equal(workbench.data.todayServiceOrders[0].id, serviceOrder.id);
assert.equal(workbench.data.todayServiceOrders[0].serviceTitle, "安静文字陪伴");
assert.match(workbench.data.todayServiceOrders[0].scheduledAtText, /^\d{2}:\d{2}$/);
assert.match(workbench.data.todayServiceOrders[0].statusDescription, /确认或拒绝/);
assert.ok(calls.slice(callsBeforeWorkbench).some((call) => call.path === "/orders/service/today"));
assert.equal(calls.slice(callsBeforeWorkbench).filter((call) => call.path === "/orders/service").length, 0,
  "workbench must not pull full service orders just to plan today");
assert.equal(workbench.data.availableEarningsText, "¥58.00");
assert.equal(workbench.data.availableEarningCount, 1, "only available ledger entries belong in the settlement total");
workbench.openServiceOfferings();
workbench.openAvailabilityWindows();
workbench.openOrders();
assert.ok(navigations.includes("/pages/companion/services/index"));
assert.ok(navigations.includes("/pages/companion/availability/index"));
assert.ok(navigations.includes("/pages/orders/index"));
companionEarningsLoadError = {
  statusCode: 503,
  code: "COMMERCIAL_LEDGER_UNAVAILABLE",
  message: "Commercial ledger is temporarily unavailable"
};
await workbench.load();
assert.equal(workbench.data.accessState, "ready", "an earnings outage must not hide booking work");
assert.equal(workbench.data.earningsUnavailable, true);
companionEarningsLoadError = null;
companionTodayServiceScheduleLoadError = {
  statusCode: 503,
  code: "ORDER_WORKBENCH_UNAVAILABLE",
  message: "today workbench temporarily unavailable"
};
await workbench.load();
assert.equal(workbench.data.accessState, "ready", "a day-feed outage must not hide catalog or availability management");
assert.equal(workbench.data.todayServiceOrdersUnavailable, true);
companionTodayServiceScheduleLoadError = null;
managedServiceOfferingLoadError = {
  statusCode: 403,
  code: "COMPANION_OWNER_NOT_ELIGIBLE",
  message: "An active identity-verified companion profile and owner are required"
};
await workbench.load();
assert.equal(workbench.data.accessState, "ineligible", "workbench direct access must use the server permission boundary");
managedServiceOfferingLoadError = null;

const profile = await loadPage("profile/index");
currentUserRole = "user";
await profile.load();
assert.equal(profile.data.user.id, "user-1");
assert.equal(profile.data.user.role, "user");
assert.equal(profile.data.hasCompanionProfile, false, "a customer profile should not probe the companion workbench");
assert.equal(profile.data.favoriteCompanions.length, 1, "a customer should see the private bookmark they just saved");
assert.equal(profile.data.favoriteCompanions[0].id, companion.id);
assert.equal(profile.data.favoriteCompanions[0].availabilityReminderEnabled, false, "a newly saved bookmark must not arm a reminder by default");
assert.equal(profile.data.favoriteCompanions[0].availabilityReminderMinimumIntervalHours, 24);
assert.equal(profile.data.favoriteCompanionsState, "available");
assert.equal(profile.data.recentViewsState, "available");
assert.notEqual(profile.data.notificationState, "error");
assert.equal(profile.data.unreadNotificationState, "available");
assert.equal(profile.data.recommendationSettingsState, "available");
assert.equal(profile.data.availabilityReminderChannelState, "available");
assert.equal(profile.data.availabilityReminderChannel.available, true);
failFavoritesLoad = true;
failRecentViewsLoad = true;
failNotificationsLoad = true;
failNotificationUnreadLoad = true;
failRecommendationPreferencesLoad = true;
failRecommendationTopicsLoad = true;
await profile.load();
assert.equal(profile.data.favoriteCompanionsState, "error", "a private bookmark outage must not render the empty-bookmark message");
assert.equal(profile.data.recentViewsState, "error", "a recent-view outage must not render the empty-history message");
assert.equal(profile.data.notificationState, "error", "notification outages must not render zero unread or no notifications");
assert.equal(profile.data.unreadNotificationState, "error", "an unread-count outage must remain independent and explicit");
assert.equal(profile.data.recommendationSettingsState, "error", "unknown recommendation settings must close the editor instead of clearing values");
assert.match(profile.data.favoriteCompanionsError, /不代表还没有/);
assert.match(profile.data.notificationError, /不代表没有新通知/);
failFavoritesLoad = false;
failRecentViewsLoad = false;
failNotificationsLoad = false;
failNotificationUnreadLoad = false;
failRecommendationPreferencesLoad = false;
failRecommendationTopicsLoad = false;
await profile.load();
assert.equal(profile.data.favoriteCompanionsState, "available", "profile private lists must recover on retry");
assert.equal(profile.data.recentViewsState, "available");
assert.notEqual(profile.data.notificationState, "error");
assert.equal(profile.data.unreadNotificationState, "available");
assert.equal(profile.data.recommendationSettingsState, "available");
assert.equal(profile.data.availabilityReminderChannelState, "available");
assert.equal(profile.data.excludedRecommendationCompanions.length, 1,
  "the customer must be able to inspect their private recommendation exclusions");
assert.equal(profile.data.excludedRecommendationCompanions[0].companion.currentlyPublic, true);
profile.openExcludedRecommendationCompanion({ currentTarget: { dataset: { id: companion.id } } });
assert.equal(navigations.at(-1), `/pages/companion/detail?id=${encodeURIComponent(companion.id)}`,
  "an excluded but public profile must remain manually viewable");
modalConfirm = true;
await profile.restoreExcludedRecommendationCompanion({ currentTarget: { dataset: { id: companion.id } } });
modalConfirm = false;
assert.equal(profile.data.excludedRecommendationCompanions.length, 0);
assert.equal(excludedRecommendationCompanionIds.has(companion.id), false);
await discover.load();
assert.equal(discover.data.companions[0].id, companion.id,
  "restoring from profile settings must re-enable later recommendation eligibility");
failRecommendationExclusionsLoad = true;
await profile.load();
assert.equal(profile.data.recommendationExclusionsUnavailable, true,
  "an exclusion-list outage must be shown as unavailable rather than misrepresented as no preference");
failRecommendationExclusionsLoad = false;
await profile.load();
assert.equal(profile.data.recommendationExclusionsUnavailable, false);
availabilityReminderChannelAvailable = false;
await profile.load();
assert.equal(profile.data.availabilityReminderChannel.available, false,
  "the profile must fail closed when the code-level reminder channel is not enabled");
const subscriptionRequestsBeforeUnavailableReminder = subscriptionRequests.length;
const reminderWritesBeforeUnavailableReminder = calls.filter((call) =>
  call.path === `/favorites/companions/${companion.id}/availability-reminder` && call.method === "PUT"
).length;
await profile.setFavoriteAvailabilityReminder({ currentTarget: { dataset: { id: companion.id } }, detail: { value: true } });
assert.equal(profile.data.favoriteCompanions[0].availabilityReminderEnabled, false);
assert.equal(subscriptionRequests.length, subscriptionRequestsBeforeUnavailableReminder,
  "an unavailable code-level channel must not request a WeChat subscription grant");
assert.equal(calls.filter((call) =>
  call.path === `/favorites/companions/${companion.id}/availability-reminder` && call.method === "PUT"
).length, reminderWritesBeforeUnavailableReminder,
"an unavailable code-level channel must not persist an enabled preference");
availabilityReminderChannelAvailable = true;
await profile.load();
const subscriptionRequestsBeforeFavoriteReminder = subscriptionRequests.length;
const subscriptionGrantsBeforeFavoriteReminder = subscriptionGrants.length;
await profile.setFavoriteAvailabilityReminder({ currentTarget: { dataset: { id: companion.id } }, detail: { value: true } });
assert.equal(profile.data.favoriteCompanions[0].availabilityReminderEnabled, true, "a customer can arm only their saved companion after an explicit subscription prompt");
assert.deepEqual(subscriptionRequests.slice(subscriptionRequestsBeforeFavoriteReminder), [["template-availabilityReminder"]],
  "arming a favorite reminder must request only the explicit availability template");
assert.deepEqual(subscriptionGrants.slice(subscriptionGrantsBeforeFavoriteReminder), ["availabilityReminder"]);
const favoriteReminderEnableCall = calls.filter((call) =>
  call.path === `/favorites/companions/${companion.id}/availability-reminder` && call.method === "PUT" && call.data.enabled === true
).at(-1);
assert.equal(typeof favoriteReminderEnableCall?.data.subscriptionGrantId, "string", "the persisted preference must carry the fresh opaque grant");
const subscriptionRequestsBeforeFavoriteReminderDisable = subscriptionRequests.length;
await profile.setFavoriteAvailabilityReminder({ currentTarget: { dataset: { id: companion.id } }, detail: { value: false } });
assert.equal(profile.data.favoriteCompanions[0].availabilityReminderEnabled, false, "the customer can revoke their own reminder preference without another prompt");
assert.equal(subscriptionRequests.length, subscriptionRequestsBeforeFavoriteReminderDisable,
  "disarming a favorite reminder must not request another subscription authorization");
assert.ok(calls.some((call) =>
  call.path === `/favorites/companions/${companion.id}/availability-reminder` && call.method === "PUT" && call.data.enabled === false
), "revocation must use the customer-scoped preference route");
profile.openFavoriteCompanion({ currentTarget: { dataset: { id: companion.id } } });
assert.equal(navigations.at(-1), `/pages/companion/detail?id=${encodeURIComponent(companion.id)}`);
assert.equal(profile.data.recentlyViewedCompanions.length, 1, "a customer should see only their private recent views");
assert.equal(profile.data.recentlyViewedCompanions[0].id, companion.id);
profile.openRecentlyViewedCompanion({ currentTarget: { dataset: { id: companion.id } } });
assert.equal(navigations.at(-1), `/pages/companion/detail?id=${encodeURIComponent(companion.id)}`);
profile.openSafetyCenter();
assert.equal(navigations.at(-1), "/pages/safety/index");
profile.openCompanionOnboarding();
assert.equal(navigations.at(-1), "/pages/companion/onboarding/index", "ordinary users must have a self-service companion onboarding route");
const safety = await loadPage("safety/index");
safety.onLoad({ caseId: moderationAppeals[0].caseId, appealId: moderationAppeals[0].id });
await safety.loadAppeals();
await safety.loadAppealableCases();
assert.equal(safety.data.appeals.length, 1, "the safety center must expose the user's content-appeal status");
assert.match(safety.data.appeals[0].reviewStateText, /前完成复核/);
assert.equal(safety.data.appealableCases.length, 0,
  "a notification-focused moderation case must not silently expand to unrelated appealable cases");
assert.ok(calls.some((call) => call.path === "/moderation/appeals/me"
  && call.query.caseId === moderationAppeals[0].caseId
  && call.query.appealId === moderationAppeals[0].id));
safety.setData({ focusCaseId: "", focusAppealId: "", focusRestrictionId: "" });
await safety.loadAppeals(1);
await safety.loadAppealableCases(1);
assert.equal(safety.data.appealableCases.length, 1, "appealable content actions must remain discoverable after leaving chat");
assert.match(safety.data.appealableCases[0].appealDeadlineText, /\d{4}-\d{2}-\d{2}/);
failModerationAppealsLoad = true;
await safety.loadAppeals();
assert.match(safety.data.appealsError, /状态未知/, "an appeal-status outage must never look like an empty appeal list");
failModerationAppealsLoad = false;
await safety.loadAppeals();
failModerationAppealableCasesLoad = true;
await safety.loadAppealableCases();
assert.match(safety.data.appealableCasesError, /资格未知/, "an eligibility outage must never look like no appealable action");
failModerationAppealableCasesLoad = false;
await safety.loadAppealableCases();
const safetyCallsBeforeNavigation = calls.length;
safety.leaveCurrentInteraction();
assert.equal(navigations.at(-1), "/pages/home/index");
safety.openMessages();
assert.equal(navigations.at(-1), "/pages/messages/index");
safety.openOrders();
assert.equal(navigations.at(-1), "/pages/orders/index");
safety.openSupportCenter();
assert.equal(navigations.at(-1), "/pages/support/index");
safety.openSafetyReport();
assert.match(navigations.at(-1), /^\/pages\/support\/index\?category=safety/);
safety.openPrivacy();
assert.equal(navigations.at(-1), "/pages/legal/index?type=privacy");
safety.openTerms();
assert.equal(navigations.at(-1), "/pages/legal/index?type=terms");
assert.equal(calls.length, safetyCallsBeforeNavigation, "the safety overview must not submit a report until the user confirms a form");

const orderDetail = await loadPage("order/detail");
orderDetail.onLoad({ id: order.id });
await orderDetail.load();
assert.equal(orderDetail.data.order.id, order.id);
assert.equal(orderDetail.data.view.canAftercare, true, "completed orders must expose an independent aftercare page");
assert.ok(orderDetail.data.timeline.length > 0, "order detail must render the authoritative timeline");
assert.equal(orderDetail.data.timelineState, "available", "order detail must label a successfully loaded timeline");
assert.equal(orderDetail.data.paymentDisputeState, "available", "order detail must correlate the customer-safe complaint status by order id");
assert.equal(orderDetail.data.paymentDispute.statusText, "处理中");
assert.equal("providerStatus" in orderDetail.data.paymentDispute, false, "the UI view must not retain provider-only fields");
assert.ok(calls.some((call) => call.path === `/payments/disputes/by-order/${order.id}` && call.method === "GET"),
  "order detail must use the stable by-order lookup instead of scanning a bounded personal list");
timelineLoadError = { statusCode: 503, code: "TIMELINE_UNAVAILABLE", message: "timeline unavailable" };
await orderDetail.loadTimeline();
assert.equal(orderDetail.data.order.id, order.id, "timeline failure must not hide the authoritative order body");
assert.equal(orderDetail.data.timelineState, "error", "timeline failure must remain distinct from a real empty timeline");
assert.equal(orderDetail.data.timeline.length, 0);
assert.match(orderDetail.data.timelineError, /不代表没有进度记录/);
timelineLoadError = null;
await orderDetail.retryTimeline();
assert.equal(orderDetail.data.timelineState, "available", "the timeline must recover through its own retry without reloading the order");
const timelineItemsBeforeEmptyState = customerOrderTimeline.items;
customerOrderTimeline.items = [];
await orderDetail.loadTimeline();
assert.equal(orderDetail.data.timelineState, "empty", "a successful empty response must stay distinct from an outage");
customerOrderTimeline.items = timelineItemsBeforeEmptyState;
await orderDetail.retryTimeline();
assert.equal(orderDetail.data.timelineState, "available");
orderDetail.showWechatComplaintGuide();
assert.equal(modalInvocations.at(-1).title, "如何发起微信支付投诉");
assert.match(modalInvocations.at(-1).content, /微信.*钱包.*账单/);
failPaymentDisputesLoad = true;
await orderDetail.load();
assert.equal(orderDetail.data.order.id, order.id, "payment-dispute status failure must not hide the authoritative order");
assert.equal(orderDetail.data.paymentDisputeState, "error", "status outage must stay distinct from no complaint");
assert.equal(orderDetail.data.paymentDispute, null);
failPaymentDisputesLoad = false;
await orderDetail.load();
assert.equal(orderDetail.data.paymentDisputeState, "available", "payment-dispute status must recover on refresh");
orderDetail.openAftercare();
assert.equal(navigations.at(-1), `/pages/order/aftercare?orderId=${order.id}`);
order.status = "cancelled";
order.cancelledAt = new Date().toISOString();
order.completedAt = null;
await orderDetail.load();
assert.equal(orderDetail.data.view.canFindReplacement, true,
  "cancelled order detail must expose the same bounded replacement recovery path");
orderDetail.findReplacement();
assert.equal(smokeApp.globalData.discoveryIntent.recovery.sourceOrderId, order.id);
assert.equal("amountCents" in smokeApp.globalData.discoveryIntent, false);
assert.equal("serviceOfferingId" in smokeApp.globalData.discoveryIntent, false);
Object.assign(order, replacementOrderState);
smokeApp.globalData.discoveryIntent = null;

const customerOrderScheduleBeforeEligibilityCheck = order.scheduledAt;
order.status = "completed";
order.scheduledAt = new Date(Date.now() - 60 * 60_000).toISOString();
await orderDetail.load();
assert.equal(orderDetail.data.view.canOpenAttendanceDispute, true,
  "a completed participant order must use the server eligibility result instead of a client-derived window");
assert.match(orderDetail.data.view.attendanceDisputeNotice, /前提交/);
orderDetail.openAttendanceDispute();
assert.equal(navigations.at(-1), `/pages/order/dispute?orderId=${order.id}`);
const newDisputeDetail = await loadPage("order/dispute");
newDisputeDetail.onLoad({ orderId: order.id });
await newDisputeDetail.load();
assert.equal(newDisputeDetail.data.dispute, null);
assert.equal(newDisputeDetail.data.policyState, "available");
assert.equal(newDisputeDetail.data.eligibilityState, "available");
assert.equal(newDisputeDetail.data.eligibility.eligible, true,
  "the create surface must render only the authoritative participant eligibility returned by the order API");
assert.equal(newDisputeDetail.data.eligibility.createDeadlineAt,
  attendanceDisputeEligibilityFor(order).createDeadlineAt,
  "the customer-facing deadline must exactly match the server-owned deadline");
order.scheduledAt = customerOrderScheduleBeforeEligibilityCheck;

const companionDetail = {
  ...orderDetail,
  data: structuredClone(orderDetail.data),
  setData(patch) { Object.assign(this.data, patch); }
};
const companionDetailOriginal = {
  status: serviceOrder.status,
  scheduledAt: serviceOrder.scheduledAt,
  durationMinutes: serviceOrder.durationMinutes,
  companionConfirmedAt: serviceOrder.companionConfirmedAt,
  paymentReservationExpiresAt: serviceOrder.paymentReservationExpiresAt,
  serviceStartedAt: serviceOrder.serviceStartedAt,
  completedAt: serviceOrder.completedAt,
  cancelledAt: serviceOrder.cancelledAt
};
serviceOrder.status = "pending";
serviceOrder.scheduledAt = new Date(Date.now() + 60 * 60_000).toISOString();
serviceOrder.durationMinutes = 30;
serviceOrder.companionConfirmedAt = null;
serviceOrder.paymentReservationExpiresAt = null;
serviceOrder.serviceStartedAt = null;
serviceOrder.completedAt = null;
serviceOrder.cancelledAt = null;
const paymentDisputeReadsBeforeCompanionDetail = calls.filter((call) =>
  call.path.startsWith("/payments/disputes/by-order/") && call.method === "GET"
).length;
companionDetail.onLoad({ id: serviceOrder.id });
await companionDetail.load();
assert.equal(companionDetail.data.view.viewerRole, "companion", "the order detail role must come from the server response");
assert.equal(companionDetail.data.view.participantName, serviceOrder.customer.name);
assert.equal(companionDetail.data.view.canConfirmServiceOrder, true);
assert.equal(companionDetail.data.view.canRejectServiceOrder, true);
assert.equal(companionDetail.data.paymentDisputeState, "none", "a companion detail must not render or fetch customer payment complaints");
assert.equal(calls.filter((call) => call.path.startsWith("/payments/disputes/by-order/") && call.method === "GET").length,
  paymentDisputeReadsBeforeCompanionDetail, "companion detail must not query the customer-only payment-dispute feed");
assert.equal(companionDetail.data.view.hasAttendanceDispute, true, "the assigned companion needs a persistent linked dispute entry");
companionDetail.openAttendanceDispute();
assert.equal(navigations.at(-1), `/pages/order/dispute?id=${attendanceDispute.id}`);
modalConfirm = true;
await companionDetail.confirmServiceOrder();
assert.ok(serviceOrder.companionConfirmedAt, "companion detail must reuse the authoritative accept endpoint");

serviceOrder.status = "pending";
serviceOrder.companionConfirmedAt = null;
serviceOrder.paymentReservationExpiresAt = null;
await companionDetail.load();
await companionDetail.rejectServiceOrder();
assert.equal(serviceOrder.status, "cancelled", "companion detail must reuse the authoritative reject endpoint");

serviceOrder.status = "paid";
serviceOrder.companionConfirmedAt = new Date().toISOString();
serviceOrder.scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
serviceOrder.serviceStartedAt = null;
await companionDetail.load();
assert.equal(companionDetail.data.view.canStartService, true, "start must appear only inside the server-compatible 15-minute window");
await companionDetail.startService();
assert.equal(serviceOrder.status, "inService", "companion detail must reuse the authoritative start endpoint");

serviceOrder.status = "inService";
serviceOrder.scheduledAt = new Date(Date.now() - 40 * 60_000).toISOString();
serviceOrder.serviceStartedAt = serviceOrder.scheduledAt;
serviceOrder.durationMinutes = 30;
await companionDetail.load();
assert.equal(companionDetail.data.view.canCompleteService, true, "complete must appear only after the promised duration has elapsed");
await companionDetail.completeService();
assert.equal(serviceOrder.status, "completed", "companion detail must reuse the authoritative complete endpoint");
assert.ok(calls.some((call) => call.path === `/orders/service/${serviceOrder.id}/reject` && call.method === "POST"));
assert.ok(calls.some((call) => call.path === `/orders/service/${serviceOrder.id}/start` && call.method === "POST"));
assert.ok(calls.some((call) => call.path === `/orders/service/${serviceOrder.id}/complete` && call.method === "POST"));

Object.assign(serviceOrder, companionDetailOriginal);
const disputeDetail = {
  ...newDisputeDetail,
  data: structuredClone(newDisputeDetail.data),
  setData(patch) { Object.assign(this.data, patch); }
};
attendanceDispute.status = "counterpartyResponse";
attendanceDispute.decision = null;
attendanceDispute.appeal = null;
attendanceDispute.statements = [];
attendanceDispute.deadlines.appealDeadlineAt = null;
attendanceDispute.deadlines.appealResponseDueAt = null;
serviceOrder.attendanceDispute.status = attendanceDispute.status;
disputeDetail.onLoad({ id: attendanceDispute.id });
await disputeDetail.load();
assert.equal(disputeDetail.data.dispute.viewerRole, "companion");
assert.equal(disputeDetail.data.view.canRespond, true, "the assigned companion must be able to answer the bilateral case");
disputeDetail.inputStatement({ detail: { value: "我已按预约时间进入服务房间，补充平台内履约事实。" } });
await disputeDetail.submitStatement();
assert.equal(attendanceDispute.status, "review");
assert.equal(attendanceDispute.statements.at(-1).participantRole, "companion");

attendanceDispute.status = "decided";
attendanceDispute.decision = {
  outcome: "fullRefund",
  reason: "初审认为客户一方主张成立。",
  decidedAt: new Date().toISOString()
};
attendanceDispute.deadlines.appealDeadlineAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
serviceOrder.attendanceDispute.status = attendanceDispute.status;
await disputeDetail.load();
assert.equal(disputeDetail.data.view.canAppeal, true, "an adversely affected companion must see the bounded appeal action");
disputeDetail.inputStatement({ detail: { value: "我申请独立复核，并补充已进入房间的可信时间记录。" } });
await disputeDetail.appeal();
assert.equal(attendanceDispute.status, "appealed");
assert.equal(attendanceDispute.appeal.appealedByRole, "companion");
attendanceDispute.status = "decided";
attendanceDispute.appeal = null;
attendanceDispute.deadlines.appealDeadlineAt = new Date(Date.now() - 60_000).toISOString();
serviceOrder.attendanceDispute.status = attendanceDispute.status;
await disputeDetail.load();
assert.equal(disputeDetail.data.view.canAppeal, false,
  "an expired appeal deadline must hide the action instead of offering a guaranteed server rejection");

const aftercare = await loadPage("order/aftercare");
aftercare.onLoad({ orderId: order.id });
const publicReviewCallsBeforeAftercare = calls.filter((call) =>
  call.path === `/reviews/companion/${companion.id}` && call.method === "GET"
).length;
await aftercare.load();
assert.equal(aftercare.data.order.id, order.id);
assert.equal(aftercare.data.loading, false);
assert.equal(aftercare.data.rating, order.experienceFeedback.rating, "aftercare must restore the private feedback already held by the order");
assert.equal(aftercare.data.feedbackState, "available", "embedded private feedback must have an explicit loaded state");
assert.equal(aftercare.data.reviewState, "empty", "a successful review lookup may establish a real not-yet-reviewed state");
assert.ok(calls.some((call) => call.path === `/reviews/orders/${order.id}/me` && call.method === "GET"),
  "aftercare must use the authenticated order-scoped review endpoint instead of a truncated public companion feed");
assert.equal(calls.filter((call) =>
  call.path === `/reviews/companion/${companion.id}` && call.method === "GET"
).length, publicReviewCallsBeforeAftercare,
"aftercare must not infer the caller's review from the bounded public companion feed");
ownOrderReviewLoadError = { statusCode: 503, code: "REVIEWS_UNAVAILABLE", message: "reviews unavailable" };
await aftercare.load();
assert.equal(aftercare.data.order.id, order.id, "review lookup failure must not hide the order or private feedback");
assert.equal(aftercare.data.reviewState, "error", "review lookup failure must not masquerade as not yet reviewed");
assert.equal(aftercare.data.canSubmitReview, false, "unknown review state must close the public-review submission path");
assert.match(aftercare.data.reviewError, /不代表尚未评价/);
const reviewCallsBeforeUnknownStateSubmit = calls.filter((call) => call.path === "/reviews" && call.method === "POST").length;
aftercare.data.publicReviewContent = "状态未知时不应提交";
await aftercare.submitPublicReview();
assert.equal(calls.filter((call) => call.path === "/reviews" && call.method === "POST").length,
  reviewCallsBeforeUnknownStateSubmit, "an unknown review state must fail closed before a duplicate submission request");
ownOrderReviewLoadError = null;
await aftercare.retryReview();
assert.equal(aftercare.data.reviewState, "empty", "public-review state must recover through its own scoped retry");
assert.equal(aftercare.data.canSubmitReview, true);
ownOrderReview = {
  id: "review-own-1",
  orderId: order.id,
  companionId: companion.id,
  userName: "小雨",
  rating: 5,
  content: "很耐心",
  createdAt: new Date().toISOString()
};
await aftercare.loadReview();
assert.equal(aftercare.data.reviewState, "available", "the authoritative endpoint must restore an existing own review");
assert.equal(aftercare.data.existingReview.id, "review-own-1");
assert.equal(aftercare.data.canSubmitReview, false, "an existing own review must close duplicate submission");
ownOrderReview = null;
await aftercare.loadReview();
orderReadError = { statusCode: 503, code: "ORDER_UNAVAILABLE", message: "order unavailable" };
await aftercare.load();
assert.equal(aftercare.data.feedbackState, "error", "order/feedback lookup failure must not masquerade as no private feedback");
assert.equal(aftercare.data.reviewState, "error");
assert.equal(aftercare.data.canSubmitExperience, false, "unknown private-feedback state must close the submission path");
const aftercareCallsBeforeUnknownFeedbackSubmit = calls.filter((call) =>
  (call.path === `/orders/${order.id}/experience-feedback` || call.path === "/reviews") && call.method === "POST"
).length;
await aftercare.submitPrivateFeedback();
await aftercare.submitPublicReview();
assert.equal(calls.filter((call) =>
  (call.path === `/orders/${order.id}/experience-feedback` || call.path === "/reviews") && call.method === "POST"
).length, aftercareCallsBeforeUnknownFeedbackSubmit,
"unknown feedback/review state must fail closed before any submission request");
orderReadError = null;
await aftercare.load();
assert.equal(aftercare.data.feedbackState, "available");
assert.equal(aftercare.data.reviewState, "empty");
aftercare.openSupport();
assert.match(navigations.at(-1), /^\/pages\/support\/index\?orderId=order-1&category=orderIssue/);
const completedFeedback = order.experienceFeedback;
order.status = "refunded";
order.experienceFeedback = null;
await aftercare.load();
assert.equal(aftercare.data.canSubmitExperience, false, "refunded orders must not reopen private experience feedback");
assert.equal(aftercare.data.canSubmitReview, false, "refunded orders must not accept a new public review");
assert.equal(aftercare.data.canConfirmCompletion, false, "refunded orders must not expose completion confirmation");
const aftercareMutationCallsBeforeRefundedActions = calls.filter((call) =>
  call.path === `/orders/${order.id}/experience-feedback`
  || call.path === `/orders/${order.id}/completion-confirmations`
  || call.path === "/reviews"
).length;
aftercare.data.rating = 5;
aftercare.data.publicReviewContent = "退款后不应被提交";
await aftercare.submitPrivateFeedback();
await aftercare.submitPublicReview();
await aftercare.confirmCompletion();
assert.equal(calls.filter((call) =>
  call.path === `/orders/${order.id}/experience-feedback`
  || call.path === `/orders/${order.id}/completion-confirmations`
  || call.path === "/reviews"
).length, aftercareMutationCallsBeforeRefundedActions, "refunded aftercare mutations must fail closed before any API request");
order.status = "completed";
order.experienceFeedback = completedFeedback;
await aftercare.load();

const previousCompanionConfirmation = order.companionConfirmedAt;
const previousOrderStatus = order.status;
order.status = "pending";
order.companionConfirmedAt = new Date().toISOString();
const payment = await loadPage("order/payment");
payment.onLoad({ orderId: order.id });
await payment.load();
assert.equal(payment.data.paymentState, "ready", "a confirmed pending order must expose an independent payment state");
assert.equal(payment.data.view.refundPolicyVersion, "2026.08-v1", "payment must disclose the order's immutable refund policy version");
assert.equal(payment.data.view.refundRequestWindowHours, 72, "payment must disclose the order's exact refund request window");
const previousRefundPolicyVersionSnapshot = order.refundPolicyVersionSnapshot;
order.refundPolicyVersionSnapshot = "";
await payment.load();
assert.equal(payment.data.paymentState, "error", "payment must fail closed when the order refund policy snapshot is malformed");
assert.match(payment.data.stateMessage, /请勿支付并联系平台客服/);
order.refundPolicyVersionSnapshot = previousRefundPolicyVersionSnapshot;
await payment.load();
assert.equal(payment.data.paymentState, "ready", "payment may recover only after the authoritative order returns a valid snapshot");
payment.toggleTerms();
modalConfirm = true;
await payment.pay();
assert.equal(payment.data.paymentState, "success", "payment success must be based on backend synchronization");
assert.ok(calls.some((call) => call.path === `/orders/${order.id}/payment/sync` && call.method === "POST"));
assert.ok(calls.some((call) => call.path === "/payments/wechat/mock-notify" && call.method === "POST"));
payment.openOrderDetail();
assert.equal(navigations.at(-1), `/pages/order/detail?id=${order.id}`);
order.status = previousOrderStatus;
if (previousCompanionConfirmation === undefined) delete order.companionConfirmedAt;
else order.companionConfirmedAt = previousCompanionConfirmation;

const supportCenter = await loadPage("support/index");
supportCenter.onLoad({ category: "general", subject: "使用问题" });
await supportCenter.load();
assert.ok(supportCenter.data.safetyCases.some((item) => item.kind === "safety"), "case center must paginate reporter-safe cases independently");
assert.ok(supportCenter.data.cases.some((item) => item.kind === "support"), "case center must paginate customer support tickets independently");
assert.equal(supportCenter.data.paymentDisputeState, "available", "support center must list all customer-safe payment dispute statuses");
assert.equal(supportCenter.data.paymentDisputes[0].orderId, order.id);
assert.deepEqual(supportCenter.data.paymentDisputes[0].ownedOrderIds, [order.id, "owned-order-2"],
  "a multi-order complaint must expose every actor-owned order, not only its primary display order");
supportCenter.openPaymentDisputeOrder({ currentTarget: { dataset: { orderId: order.id } } });
assert.equal(navigations.at(-1), `/pages/order/detail?id=${order.id}`);
supportCenter.openPaymentDisputeOrder({ currentTarget: { dataset: { orderId: "owned-order-2" } } });
assert.equal(navigations.at(-1), "/pages/order/detail?id=owned-order-2");
failPaymentDisputesLoad = true;
await supportCenter.load();
assert.equal(supportCenter.data.paymentDisputeState, "error", "support center must not turn a status outage into an empty list");
assert.equal(supportCenter.data.paymentDisputes.length, 0);
assert.match(supportCenter.data.partialWarning, /微信支付投诉状态/);
failPaymentDisputesLoad = false;
paymentDisputes[0].status = "resolved";
paymentDisputes[0].providerStatus = "PROCESSED";
paymentDisputes[0].resolvedAt = new Date().toISOString();
await supportCenter.load();
assert.match(supportCenter.data.paymentDisputes[0].summary, /正式结果仍以微信账单为准.*继续反馈或投诉/);
paymentDisputes[0].status = "processing";
paymentDisputes[0].providerStatus = "PROCESSING";
paymentDisputes[0].resolvedAt = null;
supportCenter.setBody({ detail: { value: "我需要确认一个平台使用问题。" } });
await supportCenter.submit();
assert.ok(supportTickets.some((item) => item.category === "general" && item.subject === "使用问题"));
assert.match(navigations.at(-1), /^\/pages\/support\/detail\?kind=support&id=support-/);

const safetySupportCenter = {
  ...supportCenter,
  data: structuredClone(supportCenter.data),
  setData(patch) { Object.assign(this.data, patch); }
};
safetySupportCenter.onLoad({ category: "safety", subject: "安全举报" });
await safetySupportCenter.load();
safetySupportCenter.setBody({ detail: { value: "对方在平台内持续要求我私下转账。" } });
await safetySupportCenter.submit();
assert.equal(reporterCases[0].category, "safety_center");
assert.match(navigations.at(-1), /^\/pages\/support\/detail\?kind=safety&id=report-/);

const safetyCaseDetail = await loadPage("support/detail");
safetyCaseDetail.onLoad({ kind: "safety", id: reporterCases[0].id });
await safetyCaseDetail.load();
assert.equal(safetyCaseDetail.data.canAdd, true, "an open reporter case must accept bounded follow-up facts");
safetyCaseDetail.setFollowUp({ detail: { value: "补充：对方还发送了站外收款方式。" } });
await safetyCaseDetail.addFollowUp();
assert.equal(reporterCases[0].followUps.length, 1);

const activeOrderTicket = supportTickets.find((item) =>
  item.orderId === order.id
  && ["orderIssue", "refund"].includes(item.category)
  && ["open", "inProgress"].includes(item.status)
);
assert.ok(activeOrderTicket, "the runtime flow should retain an order-linked support ticket");
const supportCaseDetail = {
  ...safetyCaseDetail,
  data: structuredClone(safetyCaseDetail.data),
  setData(patch) { Object.assign(this.data, patch); }
};
supportCaseDetail.onLoad({ kind: "support", id: activeOrderTicket.id });
await supportCaseDetail.load();
assert.equal(supportCaseDetail.data.canAdd, true);
supportCaseDetail.setFollowUp({ detail: { value: "补充：订单页面仍显示支付结果待核对。" } });
await supportCaseDetail.addFollowUp();
assert.ok(activeOrderTicket.orderFacts.length > 0);

const notificationCenter = await loadPage("notifications/index");
await notificationCenter.load();
assert.equal(notificationCenter.data.notifications.length, 1);
assert.equal(notificationCenter.data.unreadCount, 1);
assert.equal(notificationCenter.data.unreadState, "available");
failNotificationUnreadLoad = true;
await notificationCenter.load();
assert.equal(notificationCenter.data.notifications.length, 1, "unread-count failure must not hide the notification list");
assert.equal(notificationCenter.data.unreadState, "error", "unread-count failure must not be rendered as zero unread");
assert.match(notificationCenter.data.unreadError, /不代表没有未读/);
const markAllCallsBeforeUnknownUnread = calls.filter((call) => call.path === "/notifications/read-all" && call.method === "POST").length;
await notificationCenter.markAllRead();
assert.equal(calls.filter((call) => call.path === "/notifications/read-all" && call.method === "POST").length,
  markAllCallsBeforeUnknownUnread, "unknown unread count must fail closed before a bulk read mutation");
failNotificationUnreadLoad = false;
await notificationCenter.retryUnreadCount();
assert.equal(notificationCenter.data.unreadState, "available");
assert.equal(notificationCenter.data.unreadCount, 1);
await notificationCenter.openNotification({ currentTarget: { dataset: { id: notifications[0].id } } });
assert.equal(notificationCenter.data.unreadCount, 0);
assert.equal(navigations.at(-1), `/pages/order/detail?id=${order.id}`);
notifications.push(
  {
    id: "notification-attendance-priority",
    type: "supportUpdate",
    title: "履约争议等待答辩",
    body: "请查看案件并在期限内回应。",
    data: {
      attendanceDisputeId: attendanceDispute.id,
      orderId: serviceOrder.id,
      ticketId: "must-not-win-over-attendance"
    },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "notification-support-priority",
    type: "supportUpdate",
    title: "客服工单有更新",
    body: "请查看案件处理状态。",
    data: { ticketId: activeOrderTicket.id, orderId: order.id },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "notification-safety-report",
    type: "safetyAlert",
    title: "安全案件有更新",
    body: "独立审核部门已更新案件。",
    data: { reportId: reporterCases[0].id },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "notification-moderation-label",
    type: "moderationAlert",
    title: "内容安全提醒",
    body: "请核对平台规则。",
    data: { caseId: "internal-moderation-case-1" },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "notification-companion-lifecycle",
    type: "supportUpdate",
    title: "陪伴者申诉已有结果",
    body: "独立复核已完成，请查看处理结果。",
    data: {
      route: "companionDevelopment",
      actionId: "lifecycle-action-1",
      appealId: "lifecycle-appeal-1"
    },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "notification-account-appeal",
    type: "supportUpdate",
    title: "账号申诉已有进度",
    body: "请查看当前账号处置和复核状态。",
    data: {
      route: "account",
      actionId: "account-action-1",
      appealId: "account-appeal-1"
    },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  },
  {
    id: "notification-availability-reminder",
    type: "availabilityReminder",
    title: "收藏的陪伴者有新档期",
    body: "请进入资料页查看当前可约时间。",
    data: { companionId: companion.id, route: "https://evil.example/redirect" },
    readAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  }
);
await notificationCenter.load();
assert.equal(notificationCenter.data.notifications.find((item) => item.id === "notification-safety-report").typeText, "安全案件");
assert.equal(notificationCenter.data.notifications.find((item) => item.id === "notification-moderation-label").typeText, "内容安全");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-attendance-priority" } } });
assert.equal(navigations.at(-1), `/pages/order/dispute?id=${encodeURIComponent(attendanceDispute.id)}`,
  "attendanceDisputeId must outrank ticket and order fallbacks and open the stable participant-owned case detail");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-support-priority" } } });
assert.equal(navigations.at(-1), `/pages/support/detail?kind=support&id=${encodeURIComponent(activeOrderTicket.id)}`,
  "support notifications carrying an order id must still open the ticket, not the order");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-safety-report" } } });
assert.equal(navigations.at(-1), `/pages/support/detail?kind=safety&id=${encodeURIComponent(reporterCases[0].id)}`,
  "reporter-safe notification payloads must route by reportId");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-moderation-label" } } });
assert.equal(navigations.at(-1), "/pages/safety/index?caseId=internal-moderation-case-1",
  "a moderation case notification must open the exact privacy-limited appeal scope, not a reporter-only detail route");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-companion-lifecycle" } } });
assert.equal(navigations.at(-1), "/pages/companion/development/index?actionId=lifecycle-action-1&appealId=lifecycle-appeal-1",
  "companion lifecycle notifications must open the exact owner-only action and appeal scope");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-account-appeal" } } });
assert.equal(navigations.at(-1), "/pages/account/index?actionId=account-action-1&appealId=account-appeal-1",
  "ordinary account appeals must route to the exact current-user action scope");
await notificationCenter.openNotification({ currentTarget: { dataset: { id: "notification-availability-reminder" } } });
assert.equal(navigations.at(-1), `/pages/companion/detail?id=${encodeURIComponent(companion.id)}`,
  "availability reminders must ignore arbitrary route hints and use the allowlisted companion detail page");

const accountCenter = await loadPage("account/index");
accountCenter.onLoad({ actionId: "account-action-1", appealId: "account-appeal-1" });
await accountCenter.load();
assert.equal(accountCenter.data.user.id, "user-1");
assert.equal(accountCenter.data.bills.length, 1, "account billing history must derive from authoritative orders");
assert.equal(accountCenter.data.blockedConversations.length, 1, "account security must expose the current user's conversation blocks");
assert.equal(accountCenter.data.sessionState, "available");
assert.equal(accountCenter.data.sessions.length, 2, "account security must use the real session inventory");
assert.equal(accountCenter.data.sessions[0].current, true);
assert.ok(calls.some((call) => call.path === "/me/account-actions"
  && call.query.actionId === "account-action-1"
  && call.query.appealId === "account-appeal-1"),
"the account notification focus must stay inside the caller-owned exact action query");
accountCenter.openAdultEligibility();
assert.equal(navigations.at(-1), "/pages/account/adult-eligibility");

const adultEligibilityPage = await loadPage("account/adult-eligibility");
await adultEligibilityPage.load();
assert.equal(adultEligibilityPage.data.status.status, "notSubmitted");
assert.equal(adultEligibilityPage.data.status.canSubmit, true);
adultEligibilityPage.toggleForm();
adultEligibilityPage.setEvidenceReference({ detail: { value: "provider:opaque-smoke-token" } });
adultEligibilityPage.setEvidenceConfirmation({ detail: { value: ["confirmed"] } });
modalConfirm = true;
await adultEligibilityPage.submit();
assert.equal(adultEligibilityPage.data.status.status, "pending", "submission must stay pending until independent review");
assert.equal(adultEligibilityPage.data.status.currentAdult, false);
assert.ok(calls.some((call) => call.path === "/me/adult-eligibility/submissions" && call.method === "POST"));
order.refund = {
  id: "refund-account-filter",
  outRefundNo: "R-ACCOUNT-FILTER",
  amountCents: order.amountCents,
  status: "pendingReview",
  reason: "售后处理中",
  reviewNote: null,
  failureReason: null
};
await accountCenter.load();
assert.equal(
  accountCenter.data.invoiceOrderOptions.length,
  0,
  "orders with an active or successful refund must not be offered for invoice submission"
);
order.refund.status = "failed";
await accountCenter.load();
assert.equal(accountCenter.data.invoiceOrderOptions.length, 0,
  "orders with an unresolved failed refund execution must not be offered for invoice submission");
order.refund = null;
await accountCenter.load();
assert.equal(accountCenter.data.invoiceOrderOptions.length, 1);
await accountCenter.revokeSession({ currentTarget: { dataset: { id: "session-other" } } });
assert.deepEqual(accountSessions.map((item) => item.id), ["session-current"], "revoking another device must persist through the backend contract");
assert.equal(accountCenter.data.sessions.length, 1);
accountSessions.push({
  id: "session-batch",
  sessionLabel: "待批量下线设备",
  clientPlatform: "Web",
  lastUsedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  createdAt: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 25 * 24 * 60 * 60_000).toISOString(),
  current: false
});
await accountCenter.loadSessions();
assert.equal(accountCenter.data.otherSessionCount, 1);
await accountCenter.revokeOtherSessions();
assert.deepEqual(accountSessions.map((item) => item.id), ["session-current"],
  "bulk revocation must preserve only the current server-bound session");
assert.equal(accountCenter.data.otherSessionCount, 0);
assert.equal(accountCenter.data.dataRightsState, "available", accountCenter.data.dataRightsError || accountCenter.data.error);
assert.equal(accountCenter.data.dataRights[0].status, "completed");
accountCenter.openPrivacyRequest();
accountCenter.setDataRightDescription({ detail: { value: "数".repeat(600) } });
assert.equal(accountCenter.data.dataRightDescription.length, 500, "data-rights descriptions must match the backend 500-character limit");
accountCenter.setDataRightDescription({ detail: { value: "请导出我在平台内保存的订单与账户资料。" } });
await accountCenter.submitDataRightRequest();
assert.equal(dataRightsRequests[0].status, "submitted", "a new data-rights request must remain submitted rather than appearing completed");
assert.equal(accountCenter.data.dataRights[0].status, "submitted");
dataRightsRequests[0].status = "needsInformation";
dataRightsRequests[0].statusReason = "请补充希望导出的时间范围。";
dataRightsRequests[0].updatedAt = new Date(Date.now() + 1000).toISOString();
await accountCenter.loadDataRights();
accountCenter.openDataRightFollowUp({ currentTarget: { dataset: { id: dataRightsRequests[0].id } } });
assert.equal(accountCenter.data.dataRightFollowUpRequestId, dataRightsRequests[0].id);
accountCenter.setDataRightFollowUpStatement({ detail: { value: "补".repeat(600) } });
assert.equal(accountCenter.data.dataRightFollowUpStatement.length, 500, "data-rights follow-ups must share the server's 500-character limit");
accountCenter.setDataRightFollowUpStatement({ detail: { value: "请导出最近十二个月的订单与账户资料。" } });
await accountCenter.submitDataRightFollowUp();
assert.equal(dataRightsRequests[0].status, "inReview");
assert.equal(dataRightsRequests[0].followUps.length, 1);
assert.equal(dataRightsRequests[0].followUps[0].requestedInformation, "请补充希望导出的时间范围。");
assert.equal(accountCenter.data.dataRightFollowUpRequestId, "", "a successful data-rights follow-up must close its inline form");
assert.equal(accountCenter.data.dataRights[0].followUps.length, 1, "the follow-up history must reload from the backend response");
assert.equal(accountCenter.data.invoiceState, "available");
assert.equal(accountCenter.data.invoices[0].status, "issued");
accountCenter.openInvoiceRequest();
accountCenter.setInvoiceTitle({ detail: { value: "抬".repeat(120) } });
assert.equal(accountCenter.data.invoiceTitle.length, 100, "invoice titles must match the backend 100-character limit");
accountCenter.setInvoiceTitle({ detail: { value: "微信用户个人抬头" } });
await accountCenter.submitInvoiceRequest();
assert.equal(invoiceRequests[0].status, "submitted", "a new invoice request must not be shown as issued");
assert.equal(accountCenter.data.invoices[0].status, "submitted");
await accountCenter.cancelInvoiceRequest({ currentTarget: { dataset: { id: invoiceRequests[0].id } } });
assert.equal(invoiceRequests[0].status, "cancelled", "only an unreviewed invoice request may be withdrawn by the customer");
assert.ok(invoiceRequests[0].cancelledAt);
assert.equal(accountCenter.data.invoices[0].status, "cancelled");
invoiceRequests[1].status = "voided";
invoiceRequests[1].statusReason = "原票据信息需要更正。";
invoiceRequests[1].voidedAt = new Date(Date.now() + 2000).toISOString();
invoiceRequests[1].updatedAt = invoiceRequests[1].voidedAt;
await accountCenter.loadInvoices();
assert.equal(accountCenter.data.invoices[0].status, "voided", "issued invoices later invalidated by operations must render as voided");
assert.match(accountCenter.data.invoices[0].voidedText, /\d{4}/);
accountCenter.openBill({ currentTarget: { dataset: { id: order.id } } });
assert.equal(navigations.at(-1), `/pages/order/detail?id=${order.id}`);

modalConfirm = true;
await profile.clearRecentlyViewedCompanions();
assert.equal(profile.data.recentlyViewedCompanions.length, 0, "clearing should remove the local private recall list");
assert.deepEqual(recentlyViewedCompanionIds, []);
assert.ok(calls.some((call) => call.path === "/recently-viewed/companions" && call.method === "DELETE"));
modalConfirm = false;

currentUserRole = "companion";
await profile.load();
assert.equal(profile.data.user.role, "companion");
assert.equal(profile.data.hasCompanionProfile, true);
profile.openCompanionWorkbench();
assert.ok(navigations.includes("/pages/companion/workbench/index"));
assert.equal(profile.data.recommendationPreferences.personalizationEnabled, true);
profile.toggleRecommendationTopic({ currentTarget: { dataset: { id: "t2" } } });
await profile.saveRecommendations();
assert.ok(recommendationPreference.topicIds.includes("t2"));
await profile.deleteRecommendationTag({ currentTarget: { dataset: { id: "inferred:t1" } } });
assert.equal(recommendationPreference.behavioralTags.length, 0);
profile.setGender({ detail: { value: "0" } });
profile.data.displayName = "微信用户";
await profile.saveProfile();
assert.equal(updatedProfilePayload.gender, null, "暂不透露 must clear the stored field instead of inventing a third gender value");
assert.equal(profile.data.genderLabel, "暂不透露");
await profile.load();
assert.equal(profile.data.genderIndex, 0, "a cleared gender must round-trip as not provided");
profile.setGender({ detail: { value: "2" } });
profile.data.displayName = "微信用户";
await profile.saveProfile();
assert.equal(updatedProfilePayload.gender, "male");
assert.equal(storage.get("talkandtalk.legalConsent").userId, "user-1");

const companionOnboarding = await loadPage("companion/onboarding/index");
await companionOnboarding.load();
assert.equal(companionOnboarding.data.state, "ready", "companion onboarding must restore the server lifecycle overview");
assert.equal(companionOnboarding.data.overview.commercialProfile.status, "verified");
companionOnboarding.data.profile.livedExperience = "完成平台培训并持续遵守服务边界。";
await companionOnboarding.saveProfile();
assert.ok(calls.some((call) => call.path === "/companions/me/profile" && call.method === "PATCH"),
  "self-onboarding must persist profile edits through the owner-scoped route");
companionOnboarding.openTraining();
assert.equal(navigations.at(-1), "/pages/companion/development/index");

const companionDevelopment = await loadPage("companion/development/index");
companionDevelopment.onLoad({ actionId: lifecycleActions[0].id, appealId: "lifecycle-appeal-1" });
await companionDevelopment.load();
assert.equal(companionDevelopment.data.modules.length, 1, "development must load the current server training catalog");
assert.equal(companionDevelopment.data.actions.length, 1, "development must expose server account actions");
assert.ok(calls.some((call) => call.path === "/commercial/companion/actions"
  && call.query.actionId === lifecycleActions[0].id),
"the companion notification focus must use the exact owner-scoped action query");
companionDevelopment.openAppeal({ currentTarget: { dataset: { id: lifecycleActions[0].id } } });
companionDevelopment.setAppealStatement({ detail: { value: "本次响应记录存在时间差，希望平台复核完整订单时间线。" } });
companionDevelopment.setAppealEvidence({ detail: { value: "evidence://appeal-1" } });
await companionDevelopment.submitAppeal();
assert.equal(lifecycleActions[0].appeals.length, 1);
assert.equal(companionDevelopment.data.appealActionId, "", "a successful appeal must close the modal even while its request flag is active");

const companionSchedule = await loadPage("companion/schedule/index");
await companionSchedule.load();
assert.equal(companionSchedule.data.scheduleMutationBlocked, false, "verified companions may manage schedule supply");
const recurringRuleCreatesBefore = calls.filter((call) =>
  call.path === "/companions/me/availability-schedule/rules" && call.method === "POST"
).length;
await companionSchedule.createRule();
assert.equal(calls.filter((call) =>
  call.path === "/companions/me/availability-schedule/rules" && call.method === "POST"
).length, recurringRuleCreatesBefore + 1, "verified schedule writes must reach the backend");
failCompanionLifecycleOverview = true;
await companionSchedule.load();
assert.equal(companionSchedule.data.loading, false);
assert.equal(companionSchedule.data.scheduleMutationBlocked, true, "an overview outage must fail schedule writes closed");
assert.match(companionSchedule.data.eligibilityWarning, /安全锁定/);
const scheduleMutationsBeforeFailClosedActions = calls.filter((call) =>
  (call.path === "/companions/me/availability-schedule/rules" && call.method === "POST")
  || (call.path === "/companions/me/availability-schedule/blackouts" && call.method === "POST")
  || (call.path === "/companions/me/availability-schedule/drafts/materialize" && call.method === "POST")
  || (/\/companions\/me\/availability-schedule\/drafts\/[^/]+\/activate$/.test(call.path) && call.method === "PATCH")
).length;
await companionSchedule.createRule();
await companionSchedule.createBlackout();
await companionSchedule.generateDrafts();
await companionSchedule.activateDraft({ currentTarget: { dataset: { id: recurringAvailabilityDrafts[0].id } } });
assert.equal(calls.filter((call) =>
  (call.path === "/companions/me/availability-schedule/rules" && call.method === "POST")
  || (call.path === "/companions/me/availability-schedule/blackouts" && call.method === "POST")
  || (call.path === "/companions/me/availability-schedule/drafts/materialize" && call.method === "POST")
  || (/\/companions\/me\/availability-schedule\/drafts\/[^/]+\/activate$/.test(call.path) && call.method === "PATCH")
).length, scheduleMutationsBeforeFailClosedActions, "eligibility uncertainty must stop every schedule-opening mutation locally");
failCompanionLifecycleOverview = false;

const companionEarningsPage = await loadPage("companion/earnings/index");
await companionEarningsPage.load();
assert.equal(companionEarningsPage.data.availableTotalText, "¥58.00");
assert.equal(companionEarningsPage.data.commercialStatus, "verified");
companionEarningsPage.data.earnings[0].selected = true;
companionEarningsPage.updateSelectedTotal();
assert.deepEqual(companionEarningsPage.data.selectedIds, ["earning-available-1"]);
modalConfirm = true;
await companionEarningsPage.requestWithdrawal();
assert.equal(lifecycleWithdrawals[0].status, "requested", "earnings must create a reviewable withdrawal record, not claim a payout");
assert.equal(companionEarningsPage.data.withdrawals[0].status, "requested");
await companionEarningsPage.cancelWithdrawal({ currentTarget: { dataset: { id: lifecycleWithdrawals[0].id } } });
assert.equal(lifecycleWithdrawals[0].status, "cancelled");

const companionSafetyPage = await loadPage("companion/safety/index");
await companionSafetyPage.load();
assert.ok(companionSafetyPage.data.incidents.length > 0, "companion safety must load incident history");
const companionTicket = companionSafetyPage.data.tickets.find((item) => item.id === activeOrderTicket.id);
assert.ok(companionTicket, "companion safety must load owned order support tickets");
const orderFactsBeforeCompanionFollowUp = activeOrderTicket.orderFacts.length;
companionSafetyPage.openFact({ currentTarget: { dataset: { id: activeOrderTicket.id } } });
companionSafetyPage.setFactStatement({ detail: { value: "补充：服务开始前已在订单会话中说明临时网络异常。" } });
await companionSafetyPage.addFact();
assert.equal(activeOrderTicket.orderFacts.length, orderFactsBeforeCompanionFollowUp + 1);
assert.equal(companionSafetyPage.data.factTicketId, "", "a saved order fact must close the safety modal even while saving is true");

modalConfirm = true;
await profile.requestDeletion();
assert.ok(calls.some((call) => call.path === "/me/deletion-request"));
await accountCenter.loadDeletionRequest();
assert.equal(accountCenter.data.deletionRequest.status, "pending");
assert.equal(accountCenter.data.deletionRequest.canCancel, true, "a pending deletion must expose the caller-owned cancellation entry");
await accountCenter.cancelDeletionRequest();
assert.equal(accountCenter.data.deletionRequest.status, "cancelled");
assert.equal(accountCenter.data.deletionRequest.companionReactivationRequired, true);
assert.match(accountCenter.data.deletionRequest.reactivationMessage, /不会自动恢复/);
assert.ok(calls.some((call) => call.path === "/me/deletion-request/cancel" && call.method === "POST"));
await profile.withdrawConsent();
assert.ok(calls.some((call) => call.path === "/users/me/legal-consents/current" && call.method === "DELETE"));
assert.equal(storage.has("talkandtalk.legalConsent"), false);
assert.equal(storage.has("talkandtalk.accessToken"), false);
assert.ok(navigations.includes("/pages/consent/index"));

const apiModule = await import(`${pathToFileURL(join(output, "utils/api.js")).href}`);
const configModule = await import(`${pathToFileURL(join(output, "utils/config.js")).href}`);
assert.equal(configModule.backendConfig().baseUrl, "https://api.talkandtalk.app/api/v1");
environmentVersion = "trial";
assert.equal(configModule.backendConfig().baseUrl, "https://api-staging.talkandtalk.app/api/v1");
const cloudResponse = await apiModule.dispatchBackendRequest(
  { transport: "cloudRun", envId: "smoke-env", service: "talk-and-talk-api", apiPrefix: "/api/v1" },
  "/health",
  { method: "GET", authenticated: false },
  { "content-type": "application/json" }
);
assert.equal(cloudResponse.data.data.status, "ok");
assert.equal(cloudRunCall.path, "/api/v1/health");
assert.equal(cloudRunCall.header["X-WX-SERVICE"], "talk-and-talk-api");
assert.equal(cloudRunCall.config.env, "smoke-env");
assert.ok(recommendationEvents.some((event) => event.type === "view"), "recommendation card views should be reported");

console.log(`Mini Program runtime smoke passed: consent/legal gates, ${calls.length} API calls, mock/real payment branches and HTTPS/Cloud Run transport coverage`);
