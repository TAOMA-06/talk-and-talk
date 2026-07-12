import Foundation

struct BackendEnvelope<T: Decodable>: Decodable {
    let data: T
}

struct BackendHealthData: Decodable {
    let status: String
    let service: String?
    let version: String?
    let uptimeSeconds: Int?
    let dependencies: BackendHealthDependencies?
}

struct BackendHealthDependencies: Decodable {
    let database: BackendDependencyStatus?
    let redis: BackendDependencyStatus?
}

struct BackendDependencyStatus: Decodable {
    let status: String
    let latencyMs: Int?
    let message: String?
}

struct BackendServiceStatus: Decodable {
    let connected: Bool
    let version: String?
    let status: String
}

struct BackendPaginationDTO: Decodable {
    let page: Int
    let pageSize: Int
    let total: Int
    let totalPages: Int
}

struct BackendCompanionsData: Decodable {
    let items: [BackendCompanionDTO]
    let pagination: BackendPaginationDTO
}

struct BackendCompanionDTO: Decodable {
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
    let availability: String
    let cityDistrict: String
}

struct BackendMessagesData: Decodable {
    let messages: [BackendMessageDTO]
}

struct BackendConversationsData: Decodable {
    let conversations: [BackendConversationDTO]
}

struct BackendConversationDTO: Decodable {
    let id: String
    let participant: BackendConversationParticipantDTO
    let lastMessage: BackendMessageDTO?
    let unreadCount: Int
    let updatedAt: String
}

struct BackendConversationParticipantDTO: Decodable {
    let id: String
    let name: String
    let role: String?
    let initials: String?
    let isOnline: Bool?
    let isVerified: Bool?
    let availability: String?
    let responseTime: String?
}

struct BackendReportData: Decodable {
    let report: BackendReportSummaryDTO?
    let moderationCase: BackendModerationCaseDTO
}

struct BackendOrdersData: Decodable {
    let items: [BackendOrderDTO]
}

struct BackendOrderDTO: Decodable {
    let id: String
    let userId: String?
    let companionId: String
    let themeId: String
    let durationMinutes: Int
    let amountCents: Int
    let amountYuan: Int?
    let currency: String?
    let status: String
    let conversationId: String?
    let paidAt: String?
    let cancelledAt: String?
    let completedAt: String?
    let createdAt: String
    let updatedAt: String?
}

struct BackendWeChatAppParamsDTO: Decodable {
    let appId: String
    let partnerId: String
    let prepayId: String
    let package: String
    let nonceStr: String
    let timeStamp: String
    let sign: String
}

struct BackendPaymentDTO: Decodable {
    let id: String?
    let outTradeNo: String
    let status: String
    let mock: Bool
    let wechatAppParams: BackendWeChatAppParamsDTO?
}

struct BackendPrepayData: Decodable {
    let order: BackendOrderDTO
    let payment: BackendPaymentDTO
}

struct BackendMockNotifyData: Decodable {
    let code: String
    let message: String?
    let data: BackendMockNotifyInnerDTO?
}

struct BackendMockNotifyInnerDTO: Decodable {
    let alreadyProcessed: Bool?
    let orderId: String?
    let conversationCreated: Bool?
    let orderStatus: String?
}

struct BackendNotificationsData: Decodable {
    let items: [BackendNotificationDTO]
}

struct BackendNotificationDTO: Decodable {
    let id: String
    let type: String
    let title: String
    let body: String
    let readAt: String?
    let createdAt: String
}

struct BackendUnreadCountData: Decodable {
    let count: Int
}

struct BackendReadAllData: Decodable {
    let updated: Int?
}

struct BackendDeletionRequestData: Decodable {
    let id: String?
    let status: String?
    let message: String
}

struct BackendReportSummaryDTO: Decodable {
    let id: String
    let status: String
    let source: String
}

struct BackendMessageDTO: Decodable {
    let id: String
    let conversationId: String
    let senderId: String
    let senderName: String?
    let content: String
    let type: String
    let timestamp: String
}

struct BackendSendMessageData: Decodable {
    let moderation: BackendModerationDTO
    let message: BackendMessageDTO?
    let safetyMessage: BackendMessageDTO?
    let companionReply: BackendMessageDTO?
    let moderationCase: BackendModerationCaseDTO?
}

struct BackendModerationDTO: Decodable {
    let decision: String
    let riskLevel: String
    let score: Double
    let reasons: [String]
    let matchedRules: [String]
    let usedAI: Bool
}

struct BackendModerationCaseDTO: Decodable {
    let id: String
    let title: String
    let category: String
    let riskLevel: String
    let status: String
    let source: String
    let content: String
    let targetId: String?
    let aiScore: Double
    let aiReason: String
    let decision: String
    let matchedRules: [String]
    let usedAI: Bool
    let resolvedAt: String?
}

enum BackendDTOMapper {
    static func parseDate(_ value: String) -> Date {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFractional.date(from: value) {
            return date
        }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value) ?? Date()
    }

    static func message(from dto: BackendMessageDTO) -> Message? {
        guard let type = messageType(from: dto.type) else { return nil }
        return Message(
            id: dto.id,
            conversationId: dto.conversationId,
            senderId: dto.senderId,
            content: dto.content,
            type: type,
            timestamp: parseDate(dto.timestamp)
        )
    }

    static func conversation(from dto: BackendConversationDTO) -> ConversationSummary {
        ConversationSummary(
            id: dto.id,
            target: .companion(id: dto.participant.id),
            displayName: dto.participant.name,
            lastMessage: dto.lastMessage.flatMap(message(from:)),
            unreadCount: dto.unreadCount,
            updatedAt: parseDate(dto.updatedAt)
        )
    }

    static func companion(from dto: BackendCompanionDTO) -> Companion {
        Companion(
            id: dto.id,
            name: dto.name,
            role: dto.role,
            initials: dto.initials,
            tags: dto.tags,
            rating: dto.rating,
            reviewCount: dto.reviewCount,
            pricePerHalfHour: dto.pricePerHalfHour,
            isOnline: dto.isOnline,
            isVerified: dto.isVerified,
            bio: dto.bio,
            availableTimes: dto.availableTimes,
            languages: dto.languages,
            specialties: dto.specialties,
            completedOrders: dto.completedOrders,
            responseTime: dto.responseTime,
            distanceKm: dto.distanceKm,
            availability: AvailabilityStatus(rawValue: dto.availability) ?? .available,
            cityDistrict: dto.cityDistrict
        )
    }

    static func order(from dto: BackendOrderDTO) -> Order? {
        guard let status = OrderStatus(rawValue: dto.status) else { return nil }
        let totalPrice = dto.amountYuan ?? (dto.amountCents / 100)
        let createdAt = parseDate(dto.createdAt)
        return Order(
            id: dto.id,
            companionId: dto.companionId,
            themeId: dto.themeId,
            durationMinutes: dto.durationMinutes,
            totalPrice: totalPrice,
            status: status,
            createdAt: createdAt,
            scheduledAt: createdAt,
            conversationId: dto.conversationId
        )
    }

    static func wechatParams(from dto: BackendWeChatAppParamsDTO) -> WeChatAppPayParams {
        WeChatAppPayParams(
            appId: dto.appId,
            partnerId: dto.partnerId,
            prepayId: dto.prepayId,
            package: dto.package,
            nonceStr: dto.nonceStr,
            timeStamp: dto.timeStamp,
            sign: dto.sign
        )
    }

    static func notification(from dto: BackendNotificationDTO) -> AppNotification? {
        guard let type = AppNotificationType(rawValue: dto.type) else { return nil }
        return AppNotification(
            id: dto.id,
            type: type,
            title: dto.title,
            body: dto.body,
            readAt: dto.readAt.map(parseDate),
            createdAt: parseDate(dto.createdAt)
        )
    }

    static func moderationResult(from dto: BackendModerationDTO) -> ModerationResult {
        ModerationResult(
            decision: ModerationDecision(rawValue: dto.decision) ?? .allow,
            riskLevel: riskLevel(from: dto.riskLevel),
            score: dto.score,
            reasons: dto.reasons,
            matchedRules: dto.matchedRules,
            usedAI: dto.usedAI
        )
    }

    static func moderationCase(from dto: BackendModerationCaseDTO) -> ModerationCase? {
        guard
            let status = ModerationCaseStatus(rawValue: dto.status),
            let source = ModerationSource(rawValue: dto.source),
            let decision = ModerationDecision(rawValue: dto.decision)
        else {
            return nil
        }

        return ModerationCase(
            id: dto.id,
            title: dto.title,
            category: dto.category,
            riskLevel: riskLevel(from: dto.riskLevel),
            status: status,
            source: source,
            content: dto.content,
            targetId: dto.targetId,
            aiScore: dto.aiScore,
            aiReason: dto.aiReason,
            decision: decision,
            matchedRules: dto.matchedRules,
            usedAI: dto.usedAI,
            resolvedAt: dto.resolvedAt.map(parseDate)
        )
    }

    private static func messageType(from raw: String) -> MessageType? {
        switch raw {
        case "text": .text
        case "system": .system
        case "safety": .safety
        default: nil
        }
    }

    private static func riskLevel(from raw: String) -> RiskLevel {
        switch raw.lowercased() {
        case "high", "高": .high
        case "medium", "中": .medium
        default: .low
        }
    }
}
