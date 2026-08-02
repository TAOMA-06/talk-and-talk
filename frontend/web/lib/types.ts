export type UserRole = "user" | "companion" | "moderator" | "admin";

export type AuthUser = {
  id: string;
  role: UserRole;
  profile?: {
    displayName?: string | null;
    phone?: string | null;
    age?: number | null;
    gender?: "female" | "male" | null;
    isVerified?: boolean;
    safetyScore?: number;
  } | null;
};

export type SessionPayload = {
  user: AuthUser | null;
};

export type PublicCatalogSummary = {
  sellable: boolean;
  startingPriceCents: number | null;
  startingDurationMinutes: number | null;
  currency: string | null;
  deliveryModes: Array<"text" | "voice">;
  nextAvailableAt: string | null;
};

export type Companion = {
  id: string;
  name: string;
  role: string;
  initials: string;
  bio: string;
  rating: number;
  reviewCount: number;
  pricePerHalfHour?: number;
  isOnline: boolean;
  isVerified: boolean;
  availability: string;
  tags?: string[];
  serviceTags?: string[];
  topicIds?: string[];
  specialties?: string[];
  cityDistrict?: string;
  catalog?: PublicCatalogSummary;
  reasonText?: string;
  impressionId?: string;
};

export type ServiceOffering = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  deliveryMode: "text" | "voice";
  durationMinutes: number;
  priceCents: number;
  currency: string;
  topicIds: string[];
  isActive?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AvailabilityCandidate = {
  id: string;
  availabilityWindowId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reservedCount: number;
  availableCapacity: number;
};

export type AvailabilityResponse = {
  source: "structured" | "legacy";
  timezone: string;
  serviceOfferingId: string | null;
  durationMinutes: number;
  legacyAvailableTimes: string[];
  items: AvailabilityCandidate[];
};

export type CommunityPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
  companionId?: string | null;
  kind: "femaleRequest" | "malePromotion";
  topic: string;
  content: string;
  likeCount: number;
  isLiked: boolean;
  moderationStatus: string;
  createdAt: string;
};

export type Order = {
  id: string;
  companionId: string;
  themeId: string;
  durationMinutes: number;
  amountCents: number;
  status: string;
  scheduledAt?: string;
  createdAt: string;
  updatedAt?: string;
  companionSnapshot?: { name: string; role: string; initials: string };
  companion?: Companion;
  conversationId?: string | null;
  customer?: { id: string; name: string; initials: string } | null;
  serviceOfferingSnapshot?: {
    id: string | null;
    code: string;
    title: string;
    deliveryMode: "text" | "voice" | string | null;
    durationMinutes: number;
    priceCents: number;
    currency: string;
  } | null;
  companionConfirmedAt?: string | null;
  companionResponseDeadlineAt?: string | null;
  paymentReservationExpiresAt?: string | null;
  serviceStartedAt?: string | null;
  paidAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  customerConfirmedAt?: string | null;
  customerServiceGuidelinesConfirmedAt?: string | null;
  companionServiceGuidelinesConfirmedAt?: string | null;
};

export type ChatMessage = {
  id: string;
  content: string;
  senderId: string;
  senderName?: string;
  type: string;
  moderationStatus?: "queued" | "pendingReview" | "published" | "blocked" | "removed";
  visibility?: "participants" | "senderOnly" | "staffOnly";
  timestamp: string;
};

export type Conversation = {
  id: string;
  participant: {
    id: string;
    name: string;
    role: string;
    initials: string;
    isOnline: boolean;
    isVerified: boolean;
  };
  lastMessage?: ChatMessage | null;
  unreadCount: number;
  messageNotificationsMuted: boolean;
  conversationBlockedByYou: boolean;
  messageHistoryAvailable: boolean;
  messageInteractionAvailable: boolean;
  updatedAt: string;
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

export type CompanionTodayServiceEntry = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  serviceTitle: string;
};

export type CompanionTodaySchedule = {
  date: string;
  timezone: string;
  pendingConfirmationCount: number;
  items: CompanionTodayServiceEntry[];
};

export type ConsentReceipt = {
  version: string;
  acceptedAt: string;
  privacyAccepted: true;
  termsAccepted: true;
  adultConfirmed: true;
  privacyUrl: string;
  termsUrl: string;
  source: "web";
};
