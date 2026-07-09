import Foundation
import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case discover
    case community
    case orders
    case messages
    case profile

    var title: String {
        switch self {
        case .discover: "发现"
        case .community: "广场"
        case .orders: "订单"
        case .messages: "消息"
        case .profile: "我的"
        }
    }

    var symbol: String {
        switch self {
        case .discover: "sparkles"
        case .community: "heart.text.square"
        case .orders: "calendar.badge.clock"
        case .messages: "bubble.left.and.bubble.right"
        case .profile: "person.crop.circle"
        }
    }
}

enum ListPreset: String, Hashable, Codable {
    case availableTonight
    case budgetFriendly
}

enum AppRoute: Hashable {
    case companionList(themeId: String?, preset: ListPreset?)
    case companionDetail(String)
    case companionHomepage(String)
    case order(String)
    case chat(ContactTarget)
    case review(String)
    case verify
    case safetyCenter
#if DEBUG
    case admin
#endif
}

enum AvailabilityStatus: String, Codable, Hashable {
    case online
    case available
    case busy

    var displayName: String {
        switch self {
        case .online: "在线"
        case .available: "可约"
        case .busy: "忙碌"
        }
    }
}

enum ModerationSource: String, Codable, Hashable {
    case chat
    case community
    case report
    case profile
}

enum ModerationDecision: String, Codable, Hashable {
    case allow
    case warn
    case block
    case review
}

enum ModerationCaseStatus: String, Codable, Hashable {
    case pending
    case autoReviewing
    case humanReview
    case resolved
    case dismissed

    var displayName: String {
        switch self {
        case .pending: "待处理"
        case .autoReviewing: "机审中"
        case .humanReview: "人工复核"
        case .resolved: "已处理"
        case .dismissed: "已驳回"
        }
    }
}

enum AccountStatus: String, Codable, Hashable {
    case active
    case restricted
    case banned

    var displayName: String {
        switch self {
        case .active: "正常"
        case .restricted: "受限"
        case .banned: "封禁"
        }
    }
}

enum CommunityModerationStatus: String, Codable, Hashable {
    case pending
    case approved
    case rejected

    var displayName: String {
        switch self {
        case .pending: "审核中"
        case .approved: "已发布"
        case .rejected: "未通过"
        }
    }
}

enum UserGender: String, Codable, Hashable, CaseIterable {
    case female
    case male

    var displayName: String {
        switch self {
        case .female: "女生"
        case .male: "男生"
        }
    }
}

enum CommunityPostKind: String, Codable, Hashable, CaseIterable {
    case femaleRequest
    case malePromotion
}

extension CommunityPostKind: Identifiable {
    var id: String { rawValue }
}

enum ContactTarget: Codable, Hashable, Identifiable {
    case companion(id: String)
    case communityUser(id: String, name: String, initials: String)

    var conversationId: String {
        switch self {
        case .companion(let id):
            id
        case .communityUser(let id, _, _):
            "community-\(id)"
        }
    }

    var id: String { conversationId }

    var participantId: String {
        switch self {
        case .companion(let id), .communityUser(let id, _, _):
            id
        }
    }

    var allowsPaidActions: Bool {
        if case .companion = self { return true }
        return false
    }

    var communityInitials: String? {
        if case .communityUser(_, _, let initials) = self { return initials }
        return nil
    }
}

enum AdminAction: String, Codable, Hashable {
    case confirmViolation
    case dismiss
    case escalate
}

struct ModerationResult: Hashable {
    let decision: ModerationDecision
    let riskLevel: RiskLevel
    let score: Double
    let reasons: [String]
    let matchedRules: [String]
    let usedAI: Bool
}

struct ModerationContext: Hashable {
    var recentMessages: [String] = []
    var safetyScore: Int = 72
    var isVerified: Bool = false
}

struct AccountRestrictions: Hashable {
    let canSendMessages: Bool
    let canPostCommunity: Bool
    let reducedMatchingWeight: Bool
    let summary: String
}

struct CreditEvent: Identifiable, Codable, Hashable {
    let id: String
    let delta: Int
    let reason: String
    let createdAt: Date
}

struct AgreementPrompt: Identifiable, Equatable {
    let id: String
    let title: String
    let message: String
    let requiredReadSeconds: Int
    let strikeNumber: Int
}

enum PlatformAgreement {
    static let title = "Talk&Talk 用户协议与安全规范"
    static let sections: [(String, String)] = [
        ("服务边界", "本平台仅提供线上文字与语音陪伴服务，不提供线下见面、私下交易或医疗诊断承诺。"),
        ("沟通规范", "禁止诱导添加私人联系方式、转账、线下邀约，以及骚扰、低俗、PUA 等越界表达。"),
        ("广场氛围", "广场内容需尊重他人，禁止广告引流、引战辱骂；越界内容会被拦截。"),
        ("信用与处置", "首次与再次轻度违规将收到协议提醒；累计违规将扣减安全分并限制发帖或沟通权限。"),
        ("申诉与举报", "如遇不适可立即结束沟通并举报；误报经核实后可恢复信用分。")
    ]
}

struct User: Identifiable, Codable, Hashable {
    let id: String
    var name: String
    var phone: String
    var age: Int
    var gender: UserGender?
    var isVerified: Bool
    var safetyScore: Int
    var accountStatus: AccountStatus
    var violationCount: Int
    var lastViolationAt: Date?
    var warnGraceStrikeCount: Int
}

struct Theme: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let icon: String
    let description: String
    let tintName: String
}

struct Companion: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let role: String
    let initials: String
    let tags: [String]
    let rating: Double
    let reviewCount: Int
    let pricePerHalfHour: Int
    let isOnline: Bool
    let isVerified: Bool
    let bio: String
    let availableTimes: [String]
    let languages: [String]
    let specialties: [String]
    let completedOrders: Int
    let responseTime: String
    let distanceKm: Double
    let availability: AvailabilityStatus
    let cityDistrict: String
}

struct CommunityPost: Identifiable, Codable, Hashable {
    let id: String
    let authorId: String
    let authorName: String
    let authorInitials: String
    let contactTarget: ContactTarget?
    let kind: CommunityPostKind
    let topic: String
    let content: String
    let coverImageData: Data?
    let coverAspectRatio: Double?
    let likeCount: Int
    var moderationStatus: CommunityModerationStatus
    let createdAt: Date

    var isModerated: Bool { moderationStatus == .approved }
}

struct Order: Identifiable, Codable, Hashable {
    let id: String
    let companionId: String
    let themeId: String
    let durationMinutes: Int
    let totalPrice: Int
    var status: OrderStatus
    let createdAt: Date
    let scheduledAt: Date
    let customerTarget: ContactTarget?

    init(
        id: String,
        companionId: String,
        themeId: String,
        durationMinutes: Int,
        totalPrice: Int,
        status: OrderStatus,
        createdAt: Date,
        scheduledAt: Date,
        customerTarget: ContactTarget? = nil
    ) {
        self.id = id
        self.companionId = companionId
        self.themeId = themeId
        self.durationMinutes = durationMinutes
        self.totalPrice = totalPrice
        self.status = status
        self.createdAt = createdAt
        self.scheduledAt = scheduledAt
        self.customerTarget = customerTarget
    }
}

enum OrderStatus: String, Codable, CaseIterable {
    case pending
    case confirmed
    case inProgress
    case completed
    case refunded

    var displayName: String {
        switch self {
        case .pending: "待确认"
        case .confirmed: "待开始"
        case .inProgress: "沟通中"
        case .completed: "已完成"
        case .refunded: "已退款"
        }
    }

    var symbol: String {
        switch self {
        case .pending: "clock"
        case .confirmed: "checkmark.seal"
        case .inProgress: "waveform"
        case .completed: "checkmark.circle"
        case .refunded: "arrow.uturn.left.circle"
        }
    }
}

struct Review: Identifiable, Codable, Hashable {
    let id: String
    let companionId: String
    let userName: String
    let rating: Int
    let content: String
    let createdAt: Date
}

struct Message: Identifiable, Codable, Hashable {
    let id: String
    let conversationId: String
    let senderId: String
    let content: String
    let type: MessageType
    let timestamp: Date
    let companionCardId: String?

    init(
        id: String,
        conversationId: String,
        senderId: String,
        content: String,
        type: MessageType,
        timestamp: Date,
        companionCardId: String? = nil
    ) {
        self.id = id
        self.conversationId = conversationId
        self.senderId = senderId
        self.content = content
        self.type = type
        self.timestamp = timestamp
        self.companionCardId = companionCardId
    }
}

struct ConversationSummary: Identifiable, Hashable {
    let id: String
    let target: ContactTarget
    let displayName: String
    let lastMessage: Message?
    let unreadCount: Int
    let updatedAt: Date
}

enum MessageType: String, Codable {
    case text
    case system
    case safety
    case recommendationCard
}

struct ModerationCase: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let category: String
    let riskLevel: RiskLevel
    var status: ModerationCaseStatus
    var source: ModerationSource
    var content: String
    var targetId: String?
    var aiScore: Double
    var aiReason: String
    var decision: ModerationDecision
    var matchedRules: [String]
    var usedAI: Bool
    var resolvedAt: Date?
}

enum RiskLevel: String, Codable {
    case low = "低"
    case medium = "中"
    case high = "高"
}

extension Companion {
    var pricePerHour: Int { pricePerHalfHour * 2 }

    var availabilityColor: Color {
        switch availability {
        case .online: Color.dsPrimary
        case .available: Color.dsSuccess
        case .busy: Color.dsTextSecondary
        }
    }
}
