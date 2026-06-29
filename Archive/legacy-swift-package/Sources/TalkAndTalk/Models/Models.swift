import Foundation

public struct Companion: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let avatar: String
    public let tags: [String]
    public let rating: Double
    public let reviewCount: Int
    public let pricePerHour: Int
    public let isOnline: Bool
    public let isVerified: Bool
    public let bio: String
    public let availableTimes: [String]
    public let languages: [String]
    public let specialties: [String]
    
    public init(id: String, name: String, avatar: String, tags: [String], rating: Double, reviewCount: Int, pricePerHour: Int, isOnline: Bool, isVerified: Bool, bio: String, availableTimes: [String], languages: [String], specialties: [String]) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.tags = tags
        self.rating = rating
        self.reviewCount = reviewCount
        self.pricePerHour = pricePerHour
        self.isOnline = isOnline
        self.isVerified = isVerified
        self.bio = bio
        self.availableTimes = availableTimes
        self.languages = languages
        self.specialties = specialties
    }
}

public struct Theme: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let icon: String
    public let description: String
    
    public init(id: String, name: String, icon: String, description: String) {
        self.id = id
        self.name = name
        self.icon = icon
        self.description = description
    }
}

public struct Order: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let companionId: String
    public let themeId: String
    public let duration: Double
    public let totalPrice: Int
    public let status: OrderStatus
    public let createdAt: Date
    public let scheduledAt: Date
    
    public init(id: String, companionId: String, themeId: String, duration: Double, totalPrice: Int, status: OrderStatus, createdAt: Date, scheduledAt: Date) {
        self.id = id
        self.companionId = companionId
        self.themeId = themeId
        self.duration = duration
        self.totalPrice = totalPrice
        self.status = status
        self.createdAt = createdAt
        self.scheduledAt = scheduledAt
    }
}

public enum OrderStatus: String, Codable, CaseIterable, Sendable {
    case pending = "pending"
    case confirmed = "confirmed"
    case inProgress = "in_progress"
    case completed = "completed"
    case cancelled = "cancelled"
    
    public var displayName: String {
        switch self {
        case .pending: return "待确认"
        case .confirmed: return "已确认"
        case .inProgress: return "进行中"
        case .completed: return "已完成"
        case .cancelled: return "已取消"
        }
    }
}

public struct Review: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let companionId: String
    public let userName: String
    public let rating: Int
    public let content: String
    public let createdAt: Date
    
    public init(id: String, companionId: String, userName: String, rating: Int, content: String, createdAt: Date) {
        self.id = id
        self.companionId = companionId
        self.userName = userName
        self.rating = rating
        self.content = content
        self.createdAt = createdAt
    }
}

public struct Message: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let senderId: String
    public let content: String
    public let type: MessageType
    public let timestamp: Date
    
    public init(id: String, senderId: String, content: String, type: MessageType, timestamp: Date) {
        self.id = id
        self.senderId = senderId
        self.content = content
        self.type = type
        self.timestamp = timestamp
    }
}

public enum MessageType: String, Codable, Sendable {
    case text = "text"
    case voice = "voice"
    case system = "system"
}

public struct User: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let avatar: String
    public let isVerified: Bool
    public let phone: String?
    
    public init(id: String, name: String, avatar: String, isVerified: Bool, phone: String?) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.isVerified = isVerified
        self.phone = phone
    }
}
