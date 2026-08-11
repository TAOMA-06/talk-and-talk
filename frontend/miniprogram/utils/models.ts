export const USER_GENDERS = ["female", "male"] as const;
export type UserGender = typeof USER_GENDERS[number];

export type AuthUser = {
  id: string;
  role: "user" | "companion" | "moderator" | "admin";
  profile?: { displayName?: string | null; phone?: string | null; gender?: UserGender | null; isVerified?: boolean } | null;
};

export type AuthSession = { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser };

/** Local-only generic notice. It deliberately carries no previous account
 * status, deletion dates, policy version, or re-registration date. */
export type LoginIdentityUnavailableNotice = {
  code: "LOGIN_IDENTITY_UNAVAILABLE";
  message: string;
};

export type PublicCatalogSummary = {
  sellable: boolean;
  startingPriceCents: number | null;
  startingDurationMinutes: number | null;
  currency: string | null;
  deliveryModes: Array<"text" | "voice">;
  nextAvailableAt: string | null;
};

export type PublicCompanionVoiceIntro = {
  available: boolean;
  status: "approved" | "unavailable";
  durationSeconds: number | null;
  playbackStatus: "secureShortLivedUrlRequired" | "notAvailable";
  /** Null until the backend can issue a customer-scoped short-lived HTTPS URL. */
  playbackUrl: string | null;
};

export type PublicCompanionTrust = {
  training: {
    status: "current" | "renewalDue";
    currentModules: number;
    requiredModules: number;
    validUntil: string | null;
  };
  platformReview: {
    status: "current" | "reviewDue";
    verifiedAt: string | null;
    nextReviewDueAt: string | null;
  };
};

export type Companion = {
  id: string; name: string; role: string; initials: string; bio: string;
  rating: number; reviewCount: number; pricePerHalfHour: number; isOnline: boolean;
  isVerified: boolean; availability: string; tags?: string[]; serviceTags?: string[]; availableTimes?: string[];
  topicIds?: string[]; languages?: string[]; specialties?: string[]; cityDistrict?: string;
  livedExperience?: string | null; serviceBoundaries?: string[];
  voiceIntro?: PublicCompanionVoiceIntro;
  completedOrders?: number; responseTime?: string;
  publicTrust?: PublicCompanionTrust;
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

export type AvailabilityReminderChannel = {
  available: boolean;
  channelEnabled: boolean;
  preparationRunnerEnabled: boolean;
  deliveryRunnerEnabled: boolean;
  templateConfigured: boolean;
  reasonCode: "CHANNEL_DISABLED" | "TEMPLATE_UNAVAILABLE" | "PREPARATION_DISABLED" | "DELIVERY_DISABLED" | null;
  message: string;
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

/** Private and recommendation-only. It is not a block, report, bookmark or
 * companion-visible relationship, and public catalog search remains available. */
export type RecommendationCompanionExclusion = {
  companionId: string;
  excludedAt: string;
  companion: {
    id: string;
    name: string;
    role: string;
    initials: string;
    currentlyPublic: boolean;
  };
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
  reviewDueAt?: string | null;
  resolutionDueAt?: string | null;
};

/** Customer-safe status returned by GET /payments/disputes/me. Provider
 * references, complaint text, evidence and staff assignment stay server-side. */
export type PaymentDisputeStatus = "pendingSync" | "open" | "processing" | "resolved" | "syncFailed";

export type PaymentDispute = {
  id: string;
  channel: "wechat";
  type: "consumer_complaint";
  orderId: string | null;
  /** Every linked order the current actor actually owns. The API deliberately
   * omits other participants' order ids from a multi-order complaint. */
  ownedOrderIds: string[];
  ownedOrders: Array<{ orderId: string }>;
  status: PaymentDisputeStatus;
  providerStatus: "PENDING" | "PROCESSING" | "PROCESSED" | null;
  complaintOccurredAt: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
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

export type OrderServiceIntentCode =
  | "listen"
  | "comfort"
  | "organize"
  | "advice"
  | "lightCompanionship";

export type Order = {
  id: string; companionId: string; themeId: string; durationMinutes: number; amountCents: number; status: string;
  /** Present on participant-scoped order responses. It is server-derived and
   * must be used instead of inferring the active role from local profile state. */
  viewerRole?: "customer" | "companion";
  /** Participant-safe fulfillment gate. Companion responses never expose the
   * customer's refund statement or review notes. */
  fulfillmentBlockedByRefund?: boolean;
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
  serviceIntent?: {
    code: OrderServiceIntentCode;
    label: string;
    policyVersion: string;
  } | null;
  companionConfirmedAt?: string | null;
  companionResponseDeadlineAt?: string | null;
  paymentReservationExpiresAt?: string | null;
  serviceStartedAt?: string | null;
  paidAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  refundRequestDeadlineAt?: string | null;
  refundPolicyVersionSnapshot: string;
  refundRequestWindowHoursSnapshot: number;
  customerConfirmedAt?: string | null;
  customerServiceGuidelinesConfirmedAt?: string | null;
  companionServiceGuidelinesConfirmedAt?: string | null;
  updatedAt?: string;
  refund?: OrderRefund | null;
  attendanceDispute?: {
    id: string;
    issue: string;
    status: string;
    updatedAt: string;
  } | null;
  attendanceDisputeEligibility?: {
    eligible: boolean;
    opensAt: string;
    createDeadlineAt: string;
    reasonCode: "existingCase" | "orderStateInvalid" | "waitingPeriod" | "windowClosed" | null;
    reason: string | null;
  };
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
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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
  status: "reserved" | "uploaded" | "scanning" | "approved" | "reviewRequired" | "blocked" | "failed" | "expired";
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  url?: string | null;
  expiresAt?: string | null;
};

export type ChatMessage = {
  id: string;
  /** Server-scoped conversation identifier; required by the v1 message contract. */
  conversationId: string;
  content: string;
  senderId: string;
  senderName?: string | null;
  type: "text" | "image" | "audio" | "system" | "safety";
  moderationStatus: "queued" | "pendingReview" | "published" | "blocked" | "removed";
  visibility: "participants" | "senderOnly" | "staffOnly";
  attachments: MediaAttachment[];
  timestamp: string;
};

export type CrisisInterventionSource =
  | "homeIntent"
  | "homeBrowseAll"
  | "homeRecommendation"
  | "discover"
  | "companionDetail"
  | "order"
  | "chatSafetyRule"
  | "directEmergencyHelp";

export type CrisisInterventionRiskCode =
  | "userRequested"
  | "selfHarmSignal"
  | "violenceSignal"
  | "immediateDangerSignal"
  | "chatSafetyRule";

export type CrisisIntervention = {
  id: string;
  source: CrisisInterventionSource;
  riskCode: CrisisInterventionRiskCode;
  region: string;
  resourcePolicyVersion: string;
  status: "resourcesPending" | "resourcesViewed";
  resourcesViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrisisResource = {
  code: string;
  name: string;
  kind: "policeEmergency" | "medicalEmergency" | "mentalHealthSupport" | string;
  phone: string;
  region: string;
  availability: string;
  officialSourceOrganization: string;
  officialSourceTitle: string;
  officialSourceUrl: string;
  lastVerifiedOn: string;
};

export type CrisisResourceCatalog = {
  policyVersion: string;
  requestedRegion: string;
  coverageRegion: string;
  coverageStatus: "emergencyBaselineOnly" | "approvedNationalBaseline";
  approved: boolean;
  coverageStatement: string;
  disclaimers: {
    platformCannotDispatch: true;
    platformCannotDispatchText: string;
    ordinarySupportNotEmergencyText: string;
  };
  resources: CrisisResource[];
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

export type SupportTicketCategory = "orderIssue" | "refund" | "safety" | "privacy" | "general";

export type SupportTicketOrderFact = {
  id: string;
  statement: string;
  evidenceAttachments: MediaAttachment[];
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  orderId: string | null;
  category: SupportTicketCategory;
  status: string;
  subject: string;
  body: string;
  resolution: string | null;
  resolutionCode: string | null;
  dueAt: string | null;
  updatedAt: string;
  orderFacts: SupportTicketOrderFact[];
};

export type ReporterCaseFollowUp = {
  id: string;
  statement: string;
  createdAt: string;
};

export type ReporterCase = {
  id: string;
  category: string;
  riskLevel: string;
  priority: number;
  status: string;
  outcome: "received" | "reviewing" | "actionTaken" | "closed";
  outcomeSummary: string;
  submittedSummary: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  followUpCount: number;
  followUps: ReporterCaseFollowUp[];
};

export type ReporterCaseSummary = Omit<ReporterCase, "followUps">;

export type ModerationAppeal = {
  id: string;
  caseId: string;
  status: "pending" | "upheld" | "overturned" | "dismissed" | string;
  reason: string;
  appealDeadlineAt: string | null;
  reviewDueAt: string;
  overdue: boolean;
  policyVersion: string;
  resolution: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type ModerationAppealableCase = {
  caseId: string;
  kind: "contentAction" | "chatRestriction" | string;
  source: string;
  summary: string;
  contentPreview: string;
  restrictionEndsAt: string | null;
  appealDeadlineAt: string;
  policyVersion: string;
  createdAt: string;
};

export type AccountSession = {
  id: string;
  sessionLabel: string | null;
  clientPlatform: string | null;
  lastUsedAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export type UserAccountAppeal = {
  id: string;
  status: "pending" | "upheld" | "overturned" | "dismissed" | string;
  statement: string;
  reviewDueAt: string;
  overdue: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  policyVersion: string;
  createdAt: string;
};

export type UserAccountAction = {
  id: string;
  kind: "restriction" | "ban" | string;
  reasonCode: string;
  message: string;
  policyVersion: string;
  startsAt: string;
  endsAt: string | null;
  appealDeadlineAt: string;
  revokedAt: string | null;
  canAppeal: boolean;
  appeal: UserAccountAppeal | null;
};

export type AccountDeletionRequest = {
  id: string;
  status: "pending" | "processing" | "completed" | "cancelled" | string;
  dueAt: string;
  overdue: boolean;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
  processingStartedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  canCancel: boolean;
  companionReactivationRequired: boolean;
};

export type AccountDeletionPolicy = {
  version: string;
  businessDays: number;
  timezone: string;
  calendarRule: string;
  holidayNotice: string;
};

export type CustomerAdultEligibilityMethod =
  | "externalProvider"
  | "governmentNetworkIdentity"
  | "secureManualReview";

export type CustomerAdultEligibilityStatus = {
  currentAdult: boolean;
  status: "notSubmitted" | "pending" | "adult" | "expired" | "ineligible";
  recordedStatus: "pending" | "adult" | "ineligible" | null;
  verificationMethod: CustomerAdultEligibilityMethod | null;
  evidenceReferenceMasked: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  validUntil: string | null;
  reviewReason: string | null;
  canSubmit: boolean;
  recovery: {
    submissionPath: string;
    existingOrdersPath: string;
    accountRightsRemainAvailable: boolean;
    unpaidOrderCancellationRemainsAvailable: boolean;
    paidUnfulfilledRefundRequestsRemainAvailable: boolean;
  };
};

export type DataRightsRequestType = "access" | "export" | "correction" | "deletion";
export type DataRightsFollowUp = {
  id: string;
  requestedInformation: string;
  statement: string;
  createdAt: string;
};

export type DataRightsRequest = {
  id: string;
  type: DataRightsRequestType;
  status: "submitted" | "inReview" | "needsInformation" | "completed" | "rejected";
  description: string;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionEvidenceAvailable: boolean;
  followUps: DataRightsFollowUp[];
};

export type PublicSupportInfo = {
  operatorName: string;
  channel: string;
  email: string;
  phone: string;
  serviceHours: string;
  expectedFirstResponseHours: number;
  statusUrl: string | null;
  authenticatedTicketPath: string;
  ticketAccessRequiresLogin: boolean;
  emergencyBoundary: string;
};

export type InvoiceRequest = {
  id: string;
  orderId: string;
  status: "submitted" | "inReview" | "issued" | "rejected" | "voided" | "cancelled";
  invoiceTitle: string;
  amountCents: number;
  currency: string;
  paymentPaidAt: string;
  service: {
    title: string;
    deliveryMode: string | null;
    durationMinutes: number;
    companionName: string;
  };
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  voidedAt: string | null;
  cancelledAt: string | null;
};

export type InvoiceCandidateOrder = {
  id: string;
  status: "paid" | "inService" | "completed";
  scheduledAt: string;
  amountCents: number;
  currency: string;
  serviceTitle: string;
  companionName: string;
  eligible: boolean;
  ineligibleReason: "paymentNotConfirmed" | "refundInProgressOrCompleted" | "requestAlreadyExists" | null;
};

export type MiniProgramPayParams = { timeStamp: string; nonceStr: string; package: string; signType: "RSA"; paySign: string };
