import XCTest
@testable import TalkAndTalk

final class ModerationTests: XCTestCase {
    private let engine = RuleBasedModerationEngine()

    func testLegacyKeywordsStillBlock() {
        let result = engine.moderate(text: "我们加微信聊吧", source: .chat, context: nil)
        XCTAssertEqual(result.decision, .block)
        XCTAssertTrue(result.matchedRules.contains("contact.wechat"))
    }

    func testVariantWeChatPatternsBlock() {
        let variants = ["加v", "vx联系", "私下转账"]
        for text in variants {
            let result = engine.moderate(text: text, source: .chat, context: nil)
            XCTAssertNotEqual(result.decision, .allow, "Expected risk for: \(text)")
        }
    }

    func testSpacedOfflinePatternTriggersRisk() {
        let result = engine.moderate(text: "线 下 见个面", source: .chat, context: nil)
        XCTAssertNotEqual(result.decision, .allow)
    }

    func testNormalEmotionalMessageAllowed() {
        let result = engine.moderate(text: "今天有点累，想有人认真听我说完", source: .chat, context: nil)
        XCTAssertEqual(result.decision, .allow)
    }

    func testCommunityAdRejected() {
        let result = engine.moderate(text: "代理兼职赚钱，加我了解", source: .community, context: nil)
        XCTAssertNotEqual(result.decision, .allow)
    }

    func testScoreToDecisionMapping() {
        XCTAssertEqual(ModerationScoring.decision(for: 0.9), .block)
        XCTAssertEqual(ModerationScoring.decision(for: 0.6), .warn)
        XCTAssertEqual(ModerationScoring.decision(for: 0.4), .review)
        XCTAssertEqual(ModerationScoring.decision(for: 0.1), .allow)
    }

    func testCreditServiceAppliesBlockPenalty() {
        var user = MockData.user
        let result = ModerationResult(
            decision: .block,
            riskLevel: .high,
            score: 0.9,
            reasons: ["测试"],
            matchedRules: ["test"],
            usedAI: false
        )
        let service = CreditService()
        _ = service.applyModerationResult(result, to: &user)
        XCTAssertEqual(user.safetyScore, 52)
        XCTAssertEqual(user.violationCount, 1)
    }

    func testCreditServiceRestrictsAfterThreeViolations() {
        var user = MockData.user
        let service = CreditService()
        let result = ModerationResult(
            decision: .warn,
            riskLevel: .medium,
            score: 0.6,
            reasons: ["测试"],
            matchedRules: ["test"],
            usedAI: false
        )
        _ = service.applyModerationResult(result, to: &user)
        _ = service.applyModerationResult(result, to: &user)
        _ = service.applyModerationResult(result, to: &user)
        XCTAssertEqual(user.accountStatus, .restricted)
    }

    func testWarnGraceStrikeCountDefaultsToZero() {
        XCTAssertEqual(MockData.user.warnGraceStrikeCount, 0)
    }
}
