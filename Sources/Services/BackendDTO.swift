import Foundation

struct BackendEnvelope<T: Decodable>: Decodable {
    let data: T
}

struct BackendHealthData: Decodable {
    let status: String
    let moderation: BackendModerationStatus?
}

struct BackendModerationStatus: Decodable {
    let provider: String?
    let connected: Bool
    let model: String?
    let reason: String?
}

struct BackendMessagesData: Decodable {
    let messages: [BackendMessageDTO]
}

struct BackendModerationCasesData: Decodable {
    let cases: [BackendModerationCaseDTO]
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
