export const USER_GENDERS = ["female", "male"] as const;
export type UserGender = typeof USER_GENDERS[number];

export type AuthUser = {
  id: string;
  role: "user" | "companion" | "moderator" | "admin";
  profile?: { displayName?: string | null; phone?: string | null; gender?: UserGender | null; isVerified?: boolean } | null;
};

export type AuthSession = { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser };

export type PublicCatalogSummary = {
  sellable: boolean;
  startingPriceCents: number | null;
  startingDurationMinutes: number | null;
  currency: string | null;
  deliveryModes: Array<"text" | "voice">;
  nextAvailableAt: string | null;
};

export type Companion = {
  id: string; name: string; role: string; initials: string; bio: string;
  rating: number; reviewCount: number; pricePerHalfHour: number; isOnline: boolean;
  isVerified: boolean; availability: string; tags?: string[]; serviceTags?: string[]; availableTimes?: string[];
  topicIds?: string[]; specialties?: string[]; cityDistrict?: string;
  catalog?: PublicCatalogSummary;
};

/** Customer-only bookmark fields. The opaque subscription grant is never
 * returned to the Mini Program, a companion profile, recommendations, or an
 * order. A stored preference is not a promise that a notification was sent. */
export type FavoriteCompanion = Companion & {
  availabilityReminderEnabled: boolean;
  availabilityReminderUpdatedAt: string | null;
  availabilityReminderMinimumIntervalHours: number;
};

export type FavoriteAvailabilityReminderPreference = {
  companionId: string;
  enabled: boolean;
  updatedAt: string;
  minimumIntervalHours: number;
};

export type ServiceOffering = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  deliveryMode: "text" | "voice";
  durationMinutes: number;
  priceCents: number;
  currency: "CNY" | string;
  topicIds: string[];
};

/** Owner-only catalog fields. Public catalog responses deliberately omit these
 * so customers cannot infer a companion's drafts or operating order. */
export type OwnServiceOffering = ServiceOffering & {
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateOwnServiceOfferingInput = {
  title: string;
  description?: string | null;
  deliveryMode: "text" | "voice";
  durationMinutes: number;
  priceCents: number;
  topicIds?: string[];
  isActive?: boolean;
  sortOrder?: number;
};

export type UpdateOwnServiceOfferingInput = Partial<CreateOwnServiceOfferingInput>;

/** Owner-only calendar configuration. Unlike customer-facing candidates, this
 * records the raw availability range and its configured capacity. */
export type OwnAvailabilityWindow = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateOwnAvailabilityWindowInput = {
  startsAt: string;
  endsAt: string;
  capacity?: number;
  isActive?: boolean;
};

export type UpdateOwnAvailabilityWindowInput = Partial<CreateOwnAvailabilityWindowInput>;

export type CompanionAvailabilityCandidate = {
  id: string;
  availabilityWindowId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reservedCount: number;
  availableCapacity: number;
};

export type CompanionAvailabilityResponse = {
  source: "structured" | "legacy";
  timezone: string;
  serviceOfferingId: string | null;
  durationMinutes: number;
  legacyAvailableTimes: string[];
  items: CompanionAvailabilityCandidate[];
};

export type RecommendationPlacement = "discoverHome" | "communityRelated" | "orderFollowup";
export type RecommendationTopic = { id: string; name: string };
export type RecommendationBehavioralTag = {
  id: string; topicId: string; name: string; weight: number; source: "behavioral" | "inferredOrder"; updatedAt: string | null;
};
export type RecommendationPreference = {
  personalizationEnabled: boolean;
  topicIds: string[];
  city: string | null;
  maxPricePerHalfHour: number | null;
  preferredTimeSlots: string[];
  behavioralTags: RecommendationBehavioralTag[];
};
export type RecommendedCompanion = Companion & {
  impressionId: string;
  position: number;
  score: number;
  reasonCodes: string[];
  reasonText: string;
};

export type CommunityPost = {
  id: string; authorId: string; authorName: string; authorInitials: string; companionId?: string | null;
  kind: "femaleRequest" | "malePromotion"; topic: string; content: string; coverImageUrl?: string | null;
  likeCount: number; isLiked: boolean; moderationStatus: string; createdAt: string;
};

/** A private submission receipt, not a public case status or a judgment. */
export type CommunityPostReportReceipt = {
  id: string;
  submittedAt: string;
  duplicate: boolean;
};

/** The reporter can only recall a receipt, never a target or case outcome. */
export type CommunityReportReceipt = {
  id: string;
  submittedAt: string;
  status: "received";
};

export type Review = { id: string; orderId?: string; companionId: string; userName: string; rating: number; content: string; createdAt: string };

export type RefundStatus = "pendingReview" | "pending" | "processing" | "success" | "failed" | "rejected";

export type OrderRefund = {
  id: string;
  outRefundNo: string;
  amountCents: number;
  status: RefundStatus;
  reason: string | null;
  reviewNote: string | null;
  failureReason: string | null;
};

export type OrderExperienceFeedbackTag =
  | "communicationClear"
  | "boundaryRespected"
  | "onTime"
  | "asExpected"
  | "needsImprovement";

export type OrderExperienceFeedback = {
  id: string;
  rating: number;
  tags: OrderExperienceFeedbackTag[];
  note: string | null;
  createdAt: string;
};

/** Narrow owner-only workbench feed. It intentionally omits customer,
 * conversation, refund, settlement and other full-order details. */
export type CompanionTodayServiceEntry = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: "pending" | "paying" | "paid" | "inService" | "completed" | string;
  serviceTitle: string;
};

export type CompanionTodayServiceSchedule = {
  date: string;
  timezone: "Asia/Shanghai" | string;
  pendingConfirmationCount: number;
  items: CompanionTodayServiceEntry[];
};

export type Order = {
  id: string; companionId: string; themeId: string; durationMinutes: number; amountCents: number; status: string;
  scheduledAt?: string; createdAt: string; companion?: Companion; companionSnapshot?: { name: string; role: string; initials: string };
  conversationId?: string | null;
  customer?: { id: string; name: string; initials: string } | null;
  experienceFeedback?: OrderExperienceFeedback | null;
  serviceOfferingId?: string | null;
  serviceOfferingSnapshot?: {
    id: string | null;
    code: string;
    title: string;
    deliveryMode: "text" | "voice" | string | null;
    durationMinutes: number;
    priceCents: number;
    currency: string;
  } | null;
  availabilityWindowId?: string | null;
  availabilitySnapshot?: { availabilityWindowId: string | null; startsAt: string | null; endsAt: string | null; capacity: number | null } | null;
  companionConfirmedAt?: string | null;
  companionResponseDeadlineAt?: string | null;
  paymentReservationExpiresAt?: string | null;
  serviceStartedAt?: string | null;
  paidAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  refundRequestDeadlineAt?: string | null;
  customerConfirmedAt?: string | null;
  customerServiceGuidelinesConfirmedAt?: string | null;
  companionServiceGuidelinesConfirmedAt?: string | null;
  platformFeeBps?: number;
  platformFeeCents?: number;
  companionPayableCents?: number;
  updatedAt?: string;
  refund?: OrderRefund | null;
};

/** Server-issued only after the order is accepted, paid and manually started.
 * UserSig and privateMapKey are intentionally short-lived and must never be
 * persisted in Mini Program storage, analytics, or logs. */
export type VoiceRoomAccess = {
  provider: "trtc";
  sdkAppId: number;
  roomId: string;
  userId: string;
  userSig: string;
  privateMapKey: string;
  participantRole: "customer" | "companion";
  expiresAt: string;
  serviceEndsAt: string;
  participant: { name: string; initials: string };
};

export type RefundRequestResult = {
  refund: OrderRefund;
  order: Order;
  created: boolean;
};

export type OrderRescheduleRequest = {
  id: string;
  requestedByRole: "customer" | "companion";
  originalScheduledAt: string;
  requestedScheduledAt: string;
  requestedAvailabilitySnapshot: {
    availabilityWindowId: string | null;
    startsAt: string | null;
    endsAt: string | null;
    capacity: number | null;
  } | null;
  status: "pending" | "accepted" | "rejected" | "expired" | "cancelled";
  expiresAt: string;
  respondedAt: string | null;
};

export type OrderTimelineEvent = {
  id: string;
  type: "orderCreated" | "rescheduleRequested" | "rescheduleAccepted" | "rescheduleRejected" | "rescheduleExpired" | "rescheduleCancelled" | string;
  actorRole: "customer" | "companion" | "system" | string;
  occurredAt: string;
  rescheduleRequest: OrderRescheduleRequest | null;
};

export type OrderTimeline = {
  orderId: string;
  items: OrderTimelineEvent[];
};

export type Conversation = {
  id: string;
  participant: { id: string; name: string; role: string; initials: string; isOnline: boolean; isVerified: boolean };
  lastMessage?: ChatMessage | null;
  unreadCount: number;
  /** Viewer-owned only; never reflects the other participant's preference. */
  messageNotificationsMuted: boolean;
  /** Viewer-owned only; exposes an unblock control without naming the other participant's choice. */
  conversationBlockedByYou: boolean;
  /** False only for a privacy boundary; completed-order history remains readable. */
  messageHistoryAvailable: boolean;
  /** True only during the paid order's bounded communication window. */
  messageInteractionAvailable: boolean;
  updatedAt: string;
};

export type MediaAttachment = {
  id: string;
  kind: "image" | "audio";
  status: "reserved" | "uploaded" | "scanning" | "approved" | "blocked" | "failed" | "expired";
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  url?: string | null;
  expiresAt?: string | null;
};

export type ChatMessage = {
  id: string;
  content: string;
  senderId: string;
  senderName?: string;
  type: "text" | "image" | "audio" | "system" | "safety" | string;
  moderationStatus?: "queued" | "pendingReview" | "published" | "blocked" | "removed";
  visibility?: "participants" | "senderOnly" | "staffOnly";
  attachments?: MediaAttachment[];
  timestamp: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt: string;
};

export type MiniProgramPayParams = { timeStamp: string; nonceStr: string; package: string; signType: "RSA"; paySign: string };
