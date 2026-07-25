import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const output = join(tmpdir(), "talkandtalk-miniprogram-smoke");
mkdirSync(output, { recursive: true });

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
let paymentIsMock = true;
let failNextOrderCreate = false;
let failServiceOfferingsLoad = false;
let returnMalformedServiceOffering = false;
let failAvailabilityLoad = false;
let availabilityMode = "structured";
let returnEmptyAvailability = false;
let returnMalformedAvailability = false;
let nextOrderApiErrorCode = "";
let managedServiceOfferingLoadError = null;
let managedServiceOfferingSaveError = null;
let managedAvailabilityWindowLoadError = null;
let managedAvailabilityWindowSaveError = null;
let managedAvailabilityWindowUpdateError = null;
let companionEarningsLoadError = null;
let companionTodayServiceScheduleLoadError = null;
let timelineLoadError = null;
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
let conversationMessageWindowOpen = true;
let communityReportSubmissionCount = 0;
let communityWriteRateLimited = false;
let communityReportReceipts = [{
  id: "community-report-existing",
  submittedAt: "2030-01-01T08:00:00.000Z",
  status: "received"
}];
let nextSupportTicketNumber = 1;
let nextOrderSupportFactNumber = 1;
const supportTickets = [];
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
let cloudRunCall = null;
let environmentVersion = "release";
let currentUserRole = "companion";
const recommendationEvents = [];
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
  availability: "online", tags: ["情绪倾听"], availableTimes: ["今晚"], topicIds: ["t1"], specialties: ["情绪倾听"]
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
  serviceOfferingId: "service-text-30",
  serviceOfferingSnapshot: {
    id: "service-text-30", code: "text-30", title: "安静文字陪伴", deliveryMode: "text",
    durationMinutes: 30, priceCents: 3900, currency: "CNY"
  },
  companionSnapshot: { name: companion.name, role: companion.role, initials: companion.initials },
  conversationId: companion.id,
  customer: { id: "customer-1", name: "小雨", initials: "小雨" },
  customerServiceGuidelinesConfirmedAt: null,
  companionServiceGuidelinesConfirmedAt: null,
  experienceFeedback: null,
  createdAt: new Date().toISOString()
};
const serviceOrder = {
  ...order,
  id: "service-order-1",
  scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  companionConfirmedAt: null,
  companionResponseDeadlineAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
};
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
    id: "earning-available-1", payableCents: 5800, status: "available",
    availableAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "earning-held-1", payableCents: 3900, status: "held",
    availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }
];
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

function responseFor(path, method, data, query = new URLSearchParams()) {
  calls.push({ path, method, data, query: Object.fromEntries(query.entries()) });
  if (path === "/auth/wechat/mini-program") {
    return { accessToken: "access", refreshToken: "refresh", expiresIn: 900, user: { id: "user-1", role: currentUserRole, profile: { displayName: "微信用户" } } };
  }
  if (path === "/users/me/legal-consents" && method === "POST") {
    assert.equal(data.version, "2.0-2026-07-20");
    assert.equal(data.privacyAccepted, true);
    assert.equal(data.termsAccepted, true);
    assert.equal(data.adultConfirmed, true);
    assert.equal(data.source, "wechatMiniProgram");
    return { receipt: { id: "consent-1", version: data.version } };
  }
  if (path === "/users/me/legal-consents" && method === "GET") {
    return { valid: true, receipt: { id: "consent-1", version: "2.0-2026-07-20" } };
  }
  if (path === "/recommendations/topics" && method === "GET") {
    return { algorithmVersion: "companion-ranking-v1", items: [
      { id: "t1", name: "情绪倾听" }, { id: "t2", name: "职场减压" }, { id: "t3", name: "睡前语音" }
    ] };
  }
  if (path === "/recommendations/me/preferences" && method === "GET") return recommendationPreference;
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
  if (path === "/recommendations/companions" && method === "GET") {
    return {
      algorithmVersion: "companion-ranking-v1", personalized: true, items: [recommendedCompanion],
      pagination: { pageSize: 20, total: 1, nextCursor: null }
    };
  }
  if (path === "/recommendations/events" && method === "POST") {
    assert.ok(Array.isArray(data.events), "recommendation events must be batched");
    recommendationEvents.push(...data.events);
    return { updated: data.events.length };
  }
  if (path === "/companions" && method === "GET") {
    const keyword = (query.get("keyword") || "").toLocaleLowerCase();
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
    const hasResult = hasMatchingActiveService && hasMatchingStructuredCapacity && hasKeywordMatch;
    return { items: hasResult ? [companion] : [], pagination: { total: hasResult ? 1 : 0 } };
  }
  if (path === "/favorites/companions" && method === "GET") {
    return {
      items: favoriteCompanionIds.has(companion.id) ? [{
        ...companion,
        availabilityReminderEnabled: favoriteReminderEnabledIds.has(companion.id),
        availabilityReminderUpdatedAt: favoriteReminderUpdatedAts.get(companion.id) || null,
        availabilityReminderMinimumIntervalHours: 24
      }] : []
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
      return { items: [{ ...serviceOfferings[0], durationMinutes: 45 }] };
    }
    return { items: serviceOfferings };
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
    return {
      items: [...managedServiceOfferings].sort((left, right) =>
        left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
      )
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
    return { items: managedAvailabilityWindows };
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
  if (path === "/companions/me/profile") return companion;
  if (path === `/companions/${companion.id}`) return companion;
  if (path === `/reviews/companion/${companion.id}`) return { items: [] };
  if (path === "/community/posts" && method === "GET") return { items: [
    {
      id: "post-1", authorId: "user-2", authorName: "小雨", authorInitials: "小雨", kind: "femaleRequest",
      topic: "睡前放松", content: "想找人聊聊", likeCount: 0, isLiked: false, moderationStatus: "approved", createdAt: new Date().toISOString()
    },
    {
      id: "post-2", authorId: "user-3", authorName: "小晨", authorInitials: "小晨", kind: "femaleRequest",
      topic: "周末放松", content: "想找人安静说说话", likeCount: 0, isLiked: false, moderationStatus: "approved", createdAt: new Date().toISOString()
    }
  ] };
  if (path === "/community/reports/mine" && method === "GET") {
    return { items: communityReportReceipts.map((item) => ({ ...item })) };
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
  if (path === "/orders" && method === "GET") return { items: [order] };
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
  if (path === "/orders/service") return { items: [serviceOrder] };
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
    return customerOrderTimeline;
  }
  if (path === `/orders/${serviceOrder.id}/timeline` && method === "GET") {
    if (timelineLoadError) return { __smokeError: timelineLoadError };
    return serviceOrderTimeline;
  }
  if (path === "/commercial/earnings/me") {
    if (companionEarningsLoadError) return { __smokeError: companionEarningsLoadError };
    return { items: companionEarnings };
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
  if (path === "/support/tickets/me" && method === "GET") return { items: supportTickets };
  if (path === "/support/tickets" && method === "GET") return { items: supportTickets };
  if (path === "/support/tickets" && method === "POST") {
    const timestamp = new Date().toISOString();
    if (data.category === "refund") {
      assert.equal(data.subject, "退款申请补充", "refund follow-up needs a distinct support subject");
    } else if (data.category === "orderIssue") {
      assert.equal(data.subject, "订单客服请求", "experience feedback assistance must use the existing order support queue");
    } else {
      assert.fail(`unexpected support category: ${data.category}`);
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
  if (path === "/conversations") return { conversations: [
    {
      id: companion.id, participant: { ...companion }, lastMessage: conversationBlockedByYou ? null : message,
      unreadCount: conversationBlockedByYou ? 0 : 1,
      messageNotificationsMuted,
      conversationBlockedByYou,
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
  ] };
  if (path === `/conversations/${companion.id}/status` && method === "GET") {
    return {
      mediaEnabled: false,
      messageNotificationsMuted,
      conversationBlockedByYou,
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
  if (path === "/me" && method === "PATCH") {
    updatedProfilePayload = data;
    assert.ok(["female", "male"].includes(data.gender), "profile update must use the shared gender contract");
    return { id: "user-1", role: currentUserRole, profile: { displayName: data.displayName, gender: data.gender } };
  }
  if (path === "/me/deletion-request" && method === "POST") return { id: "deletion-1", status: "pending", message: "注销申请已提交" };
  if (path === "/users/me/legal-consents/current" && method === "DELETE") return { withdrawn: true, withdrawnAt: new Date().toISOString() };
  if (path === "/me") return { id: "user-1", role: currentUserRole, profile: { displayName: "微信用户", gender: "female" } };
  if (path === "/auth/logout" && method === "POST") return { success: true };
  if (path === "/notifications/subscription-templates" && method === "GET") {
    const keys = (query.get("keys") || "").split(",").filter(Boolean);
    return { enabled: true, templates: keys.map((key) => ({ key, templateId: `template-${key}` })) };
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
  if (path === "/notifications") return { items: [] };
  if (path === "/health") return { status: "ok", service: "talk-and-talk-api" };
  throw new Error(`Unhandled smoke route: ${method} ${path}`);
}

globalThis.Page = (options) => { registeredPage = options; };
globalThis.App = () => undefined;
globalThis.__TALK_AND_TALK_TRTC_SDK__ = class SmokeTrtc {
  constructor(page) {
    this.page = page;
    this.EVENT = {
      LOCAL_JOIN: "LOCAL_JOIN",
      KICKED_OUT: "KICKED_OUT",
      ERROR: "ERROR",
      REMOTE_AUDIO_ADD: "REMOTE_AUDIO_ADD",
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
        const apiPath = path.replace(/^\/api\/v1/, "");
        const payload = responseFor(apiPath, method, data);
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
  requestPayment: (options) => { paymentInvocations.push(options); queueMicrotask(options.success); },
  createLivePusherContext: () => ({ setMICVolume: (volume) => microphoneVolumes.push(volume) }),
  requestSubscribeMessage: ({ tmplIds, success }) => {
    subscriptionRequests.push([...tmplIds]);
    queueMicrotask(() => success(Object.fromEntries(tmplIds.map((templateId) => [templateId, "accept"]))));
  },
  showToast: (options) => { toasts.push(options); },
  stopPullDownRefresh: () => { pullDownRefreshStops += 1; },
  navigateTo: (options) => { navigations.push(options.url); },
  navigateBack: ({ delta = 1 } = {}) => { navigations.push(`__back:${delta}`); },
  switchTab: (options) => { navigations.push(options.url); },
  reLaunch: (options) => { navigations.push(options.url); queueMicrotask(() => options.complete?.()); },
  setNavigationBarTitle: () => undefined,
  openPrivacyContract: ({ success }) => queueMicrotask(() => success?.()),
  showModal: (options) => { modalInvocations.push(options); queueMicrotask(() => options.success({ confirm: modalConfirm, content: modalContent })); },
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
assert.equal(consentRecord.version, "2.0-2026-07-20");
assert.equal(consentRecord.privacyAccepted, true);
assert.equal(consentRecord.termsAccepted, true);
assert.equal(consentRecord.source, "wechatMiniProgram");
assert.ok(Date.parse(consentRecord.acceptedAt));
assert.equal(privacyAuthorizationRequests, 1);
assert.ok(navigations.includes("/pages/discover/index"));

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
assert.equal(discover.data.topicFilters.length, 3, "discovery should expose only the platform's small public topic taxonomy");
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
assert.match(detail.data.trustFacts[0].description, /公开展示条件/);
assert.match(detail.data.trustFacts[0].description, /不表示医疗/);
assert.match(detail.data.trustFacts[1].description, /只在平台内进行/);
assert.match(detail.data.trustFacts[2].description, /创建订单时的当前选择/);
assert.match(detail.data.trustFacts[2].description, /订单内联系平台客服/);
assert.equal(detail.data.canManageFavorites, true, "only a customer profile should receive the private bookmark control");
assert.deepEqual(recentlyViewedCompanionIds, [companion.id], "opening a public detail page should update only the customer's private recall list");
assert.ok(calls.some((call) => call.path === `/recently-viewed/companions/${companion.id}` && call.method === "PUT"));
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
assert.equal(detail.data.availabilityStatus, "structured");
assert.equal(detail.data.canBook, false, "a structured booking must require an explicit slot choice");
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
// The smoke output is CommonJS-cached by Node, so instantiate a fresh page
// object explicitly to model a Mini Program page/process restart.
const detailAfterRestart = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
detailAfterRestart.companionId = companion.id;
detailAfterRestart.themeId = detail.themeId;
detailAfterRestart.setData({ bookingDate: detail.data.bookingDate, bookingTime: detail.data.bookingTime });
await detailAfterRestart.book();
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

failServiceOfferingsLoad = true;
const legacyDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
legacyDetail.companionId = companion.id;
legacyDetail.themeId = "";
await legacyDetail.load();
assert.equal(legacyDetail.data.serviceCatalogStatus, "legacy");
assert.equal(legacyDetail.data.selectedServiceOffering, null);
assert.equal(legacyDetail.data.canBook, true);
assert.match(legacyDetail.data.serviceCatalogMessage, /旧版半小时服务/);
await legacyDetail.book();
assert.equal(createdOrderPayload.serviceOfferingId, undefined);
assert.equal(createdOrderPayload.durationMinutes, 30);
failServiceOfferingsLoad = false;

availabilityMode = "legacy";
const serverLegacyDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
serverLegacyDetail.companionId = companion.id;
serverLegacyDetail.themeId = "";
await serverLegacyDetail.load();
assert.equal(serverLegacyDetail.data.serviceCatalogStatus, "available");
assert.equal(serverLegacyDetail.data.availabilityStatus, "legacy");
assert.equal(serverLegacyDetail.data.canBook, true);
assert.match(serverLegacyDetail.data.availabilityMessage, /常见可约时段/);
await serverLegacyDetail.book();
assert.equal(createdOrderPayload.serviceOfferingId, "service-text-30");
assert.equal(createdOrderPayload.availabilityWindowId, undefined);
availabilityMode = "structured";

const staleAvailabilityDetail = {
  ...detail,
  data: { ...structuredClone(detail.data), orderClientRequestId: "" },
  setData(patch) { Object.assign(this.data, patch); }
};
staleAvailabilityDetail.companionId = companion.id;
staleAvailabilityDetail.themeId = "";
await staleAvailabilityDetail.load();
const staleSlot = staleAvailabilityDetail.data.availabilityCandidates[0];
staleAvailabilityDetail.selectAvailabilityCandidate({ currentTarget: { dataset: { id: staleSlot.id } } });
nextOrderApiErrorCode = "COMPANION_SLOT_UNAVAILABLE";
await staleAvailabilityDetail.book();
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
assert.equal(community.data.recommendations.length, 1);
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
assert.match(orders.data.orders[0].scheduledAtText, /\d{4}年\d{2}月\d{2}日/, "orders must display a localized appointment time");
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
const trtcEntersBeforeBackgroundCredentialRace = trtcEnterInvocations.length;
const trtcStartsBeforeBackgroundCredentialRace = trtcPusherStarts.length;
voice.onLoad({ orderId: serviceOrder.id });
voice.onHide();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(
  trtcEnterInvocations.length,
  trtcEntersBeforeBackgroundCredentialRace,
  "backgrounding while a credential request is in flight must never enter a room"
);
assert.equal(
  trtcPusherStarts.length,
  trtcStartsBeforeBackgroundCredentialRace,
  "backgrounding while a credential request is in flight must never enable the microphone"
);
assert.equal(voice.data.roomState, "ended");
assert.equal(voice.data.canRetry, true, "returning from background must still require an explicit reconnect");
await voice.retry();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(voice.data.roomState, "connected");
assert.equal(trtcEnterInvocations.length, 1, "the page must pass only the server-issued order credential to TRTC");
assert.equal(trtcEnterInvocations[0].strRoomID, "tt_voice_smoke_service_order_1");
assert.equal(trtcEnterInvocations[0].recvMode, 2, "the real-time voice room must be audio receive mode");
assert.equal(trtcEnterInvocations[0].enableCamera, false, "the RTC pusher must remain audio-only");
assert.equal(trtcEnterInvocations[0].enableMic, true, "the RTC pusher must start with microphone enabled");
assert.equal(trtcPusherStarts.length, 1, "the native pusher must start after the TRTC attributes bind to the page");
assert.equal(Object.hasOwn(voice.data, "userSig"), false, "raw UserSig must never be retained as a page field");
assert.equal(Object.hasOwn(voice.data, "privateMapKey"), false, "raw PrivateMapKey must never be retained as a page field");
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
await voice.leaveVoice();
assert.equal(voice.data.roomState, "ended", "the smoke test must release the retried RTC transport and its service timer");
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
assert.equal(orders.data.orders[0].canSubmitExperienceFeedback, true,
  "only the customer should receive a private experience-feedback entry after completion");
assert.equal(orders.data.orders[0].hasExperienceFeedback, false);
assert.equal(orders.data.serviceOrders[0].canSubmitExperienceFeedback, false,
  "companion cards must never expose the customer's private feedback workflow");
assert.equal(orders.data.serviceOrders[0].hasExperienceFeedback, false,
  "companion cards must not receive the customer's individual feedback record");
assert.equal(orders.data.serviceOrders[0].canRebook, false,
  "only the customer, never the companion view, may start a new booking from a completed order");
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
rebookDetail.selectAvailabilityCandidate({ currentTarget: { dataset: { id: rebookCandidate.id } } });
await rebookDetail.book();
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
const safety = await loadPage("safety/index");
const safetyCallsBeforeNavigation = calls.length;
safety.leaveCurrentInteraction();
assert.equal(navigations.at(-1), "/pages/discover/index");
safety.openMessages();
assert.equal(navigations.at(-1), "/pages/messages/index");
safety.openOrders();
assert.equal(navigations.at(-1), "/pages/orders/index");
safety.openPrivacy();
assert.equal(navigations.at(-1), "/pages/legal/index?type=privacy");
safety.openTerms();
assert.equal(navigations.at(-1), "/pages/legal/index?type=terms");
assert.equal(calls.length, safetyCallsBeforeNavigation, "the safety center must only explain and route; it must not read private data or submit actions");
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
profile.setGender({ detail: { value: "1" } });
profile.data.displayName = "微信用户";
await profile.saveProfile();
assert.equal(updatedProfilePayload.gender, "male");
assert.equal(storage.get("talkandtalk.legalConsent").userId, "user-1");
modalConfirm = true;
await profile.requestDeletion();
assert.ok(calls.some((call) => call.path === "/me/deletion-request"));
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
