export const USER_GENDERS = ["female", "male"] as const;
export type UserGender = typeof USER_GENDERS[number];

export type AuthUser = {
  id: string;
  role: "user" | "companion" | "moderator" | "admin";
  profile?: { displayName?: string | null; phone?: string | null; gender?: UserGender | null; isVerified?: boolean } | null;
};

export type AuthSession = { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser };

export type Companion = {
  id: string; name: string; role: string; initials: string; bio: string;
  rating: number; reviewCount: number; pricePerHalfHour: number; isOnline: boolean;
  isVerified: boolean; availability: string; tags?: string[]; serviceTags?: string[]; availableTimes?: string[];
  topicIds?: string[]; specialties?: string[]; cityDistrict?: string;
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

export type Review = { id: string; orderId?: string; companionId: string; userName: string; rating: number; content: string; createdAt: string };

export type Order = {
  id: string; companionId: string; themeId: string; durationMinutes: number; amountCents: number; status: string;
  scheduledAt?: string; createdAt: string; companion?: Companion; companionSnapshot?: { name: string; role: string; initials: string };
  companionConfirmedAt?: string | null;
  companionResponseDeadlineAt?: string | null;
  paymentReservationExpiresAt?: string | null;
  serviceStartedAt?: string | null;
  refundRequestDeadlineAt?: string | null;
  customerConfirmedAt?: string | null;
  platformFeeBps?: number;
  platformFeeCents?: number;
  companionPayableCents?: number;
};

export type Conversation = {
  id: string;
  participant: { id: string; name: string; role: string; initials: string; isOnline: boolean; isVerified: boolean };
  lastMessage?: ChatMessage | null;
  unreadCount: number;
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
