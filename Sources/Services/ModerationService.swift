import Foundation

protocol ModerationService: Sendable {
    func moderate(text: String, source: ModerationSource, context: ModerationContext?) async -> ModerationResult
}

enum ModerationScoring {
    static func decision(for score: Double) -> ModerationDecision {
        switch score {
        case 0.85...: .block
        case 0.55..<0.85: .warn
        case 0.35..<0.55: .review
        default: .allow
        }
    }

    static func riskLevel(for score: Double) -> RiskLevel {
        switch score {
        case 0.85...: .high
        case 0.55..<0.85: .medium
        default: .low
        }
    }

    static func result(score: Double, reasons: [String], matchedRules: [String], usedAI: Bool) -> ModerationResult {
        ModerationResult(
            decision: decision(for: score),
            riskLevel: riskLevel(for: score),
            score: score,
            reasons: reasons,
            matchedRules: matchedRules,
            usedAI: usedAI
        )
    }
}
