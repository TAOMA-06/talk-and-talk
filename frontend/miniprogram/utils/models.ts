export type AuthUser = {
  id: string;
  role: "user" | "companion" | "moderator" | "admin";
  profile?: { displayName?: string | null; phone?: string | null; gender?: string | null; isVerified?: boolean } | null;
};

export type AuthSession = { accessToken: string; refreshToken: string; expiresIn: number; user: AuthUser };

export type Companion = {
  id: string; name: string; role: string; initials: string; bio: string;
  rating: number; reviewCount: number; pricePerHalfHour: number; isOnline: boolean;
  isVerified: boolean; availability: string; serviceTags?: string[]; availableTimes?: string[];
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
};

export type Conversation = {
  id: string;
  participant: { id: string; name: string; role: string; initials: string; isOnline: boolean; isVerified: boolean };
  lastMessage?: ChatMessage | null;
  unreadCount: number;
  updatedAt: string;
};

export type ChatMessage = { id: string; content: string; senderId: string; senderName?: string; type: string; timestamp: string };

export type Notification = { id: string; type: string; title: string; body: string; readAt?: string | null; createdAt: string };

export type MiniProgramPayParams = { timeStamp: string; nonceStr: string; package: string; signType: "RSA"; paySign: string };
