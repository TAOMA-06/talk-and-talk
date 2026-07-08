export interface Companion {
  id: string;
  name: string;
  avatar: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  pricePerHour: number;
  isOnline: boolean;
  isVerified: boolean;
  bio: string;
  availableTimes: string[];
  languages: string[];
  specialties: string[];
}

export interface Theme {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface Order {
  id: string;
  companionId: string;
  themeId: string;
  duration: number;
  totalPrice: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: string;
  scheduledAt: string;
}

export interface Review {
  id: string;
  companionId: string;
  userName: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  content: string;
  type: 'text' | 'voice' | 'system';
  timestamp: string;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  isVerified: boolean;
  phone?: string;
}
