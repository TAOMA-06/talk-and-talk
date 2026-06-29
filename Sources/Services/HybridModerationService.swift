import Foundation

struct HybridModerationService: ModerationService, Sendable {
    private let rules = RuleBasedModerationEngine()
    private let apiClient = APIModerationClient()

    func moderate(text: String, source: ModerationSource, context: ModerationContext?) async -> ModerationResult {
        let ruleResult = rules.moderate(text: text, source: source, context: context)
        if ruleResult.decision == .block {
            return ruleResult
        }

        if let apiResult = await apiClient.moderate(text: text) {
            let mergedScore = max(ruleResult.score, apiResult.score)
            let reasons = Array(Set(ruleResult.reasons + apiResult.reasons))
            let matchedRules = ruleResult.matchedRules + apiResult.matchedRules
            return ModerationScoring.result(
                score: mergedScore,
                reasons: reasons,
                matchedRules: matchedRules,
                usedAI: true
            )
        }

        return ruleResult
    }
}
