struct LocalModerationService: ModerationService, Sendable {
    private let rules = RuleBasedModerationEngine()

    func moderate(
        text: String,
        source: ModerationSource,
        context: ModerationContext?
    ) async -> ModerationResult {
        rules.moderate(text: text, source: source, context: context)
    }
}
