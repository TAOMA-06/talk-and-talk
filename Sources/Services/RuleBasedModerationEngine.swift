import Foundation

struct RuleBasedModerationEngine: Sendable {
    private struct Rule {
        let id: String
        let patterns: [String]
        let score: Double
        let reason: String
    }

    private let blockRules: [Rule] = [
        Rule(id: "contact.wechat", patterns: ["加微信", "加v", "加V", "vx", "v信", "薇信", "微信号", "私加"], score: 0.92, reason: "疑似引导私下联系"),
        Rule(id: "contact.offline", patterns: ["线下", "见面", "见个面", "出来见", "酒店", "宾馆"], score: 0.9, reason: "疑似线下邀约"),
        Rule(id: "finance.transfer", patterns: ["转账", "打款", "红包", "支付宝", "收款码"], score: 0.93, reason: "疑似私下交易"),
        Rule(id: "sexual.explicit", patterns: ["裸聊", "色情", "开房"], score: 0.95, reason: "疑似低俗或越界内容")
    ]

    private let warnRules: [Rule] = [
        Rule(id: "harass.pua", patterns: ["听话", "乖一点", "别装", "你不行"], score: 0.62, reason: "疑似不尊重或 PUA 表达"),
        Rule(id: "privacy.request", patterns: ["住址", "身份证", "真实姓名", "你在哪"], score: 0.58, reason: "疑似索要隐私信息"),
        Rule(id: "offline.implicit", patterns: ["今晚见", "能不能见", "出来聊"], score: 0.6, reason: "疑似变相线下邀约")
    ]

    private let reviewRules: [Rule] = [
        Rule(id: "ads.promo", patterns: ["代理", "兼职赚钱", "加我了解", "推广"], score: 0.42, reason: "疑似广告或引流"),
        Rule(id: "conflict.bait", patterns: ["滚", "废物", "傻"], score: 0.38, reason: "疑似引战或攻击性表达")
    ]

    func moderate(text: String, source: ModerationSource, context: ModerationContext?) -> ModerationResult {
        let normalized = normalize(text)
        var score = 0.0
        var reasons: [String] = []
        var matchedRules: [String] = []

        for rule in blockRules + warnRules + reviewRules {
            if matches(rule: rule, in: normalized) {
                score = max(score, rule.score)
                reasons.append(rule.reason)
                matchedRules.append(rule.id)
            }
        }

        if let context, !context.recentMessages.isEmpty {
            let contextScore = contextualRiskScore(current: normalized, history: context.recentMessages.map(normalize))
            if contextScore > 0 {
                score = max(score, contextScore)
                reasons.append("近期会话存在连续风险表达")
                matchedRules.append("context.accumulation")
            }
        }

        if source == .community, normalized.contains("广告") || normalized.contains("引流") {
            score = max(score, 0.7)
            reasons.append("社区内容疑似广告引流")
            matchedRules.append("community.ads")
        }

        if reasons.isEmpty {
            return ModerationScoring.result(score: 0.05, reasons: ["内容正常"], matchedRules: [], usedAI: false)
        }

        return ModerationScoring.result(
            score: score,
            reasons: Array(Set(reasons)),
            matchedRules: matchedRules,
            usedAI: false
        )
    }

    private func matches(rule: Rule, in text: String) -> Bool {
        rule.patterns.contains { pattern in
            let normalizedPattern = normalize(pattern)
            return text.localizedStandardContains(normalizedPattern)
        }
    }

    private func contextualRiskScore(current: String, history: [String]) -> Double {
        let riskyHistory = history.suffix(2).filter { text in
            let result = moderate(text: text, source: .chat, context: nil)
            return result.score >= 0.35
        }
        guard !riskyHistory.isEmpty else { return 0 }
        let currentResult = moderate(text: current, source: .chat, context: nil)
        return currentResult.score >= 0.35 ? min(1.0, currentResult.score + 0.15) : 0
    }

    func normalize(_ text: String) -> String {
        var value = text.lowercased()
        value = value.replacingOccurrences(of: " ", with: "")
        value = value.replacingOccurrences(of: "　", with: "")
        value = value.replacingOccurrences(of: "＋", with: "+")

        value = value.replacingOccurrences(of: "vx", with: "微信")
        value = value.replacingOccurrences(of: "wx", with: "微信")
        value = value.replacingOccurrences(of: "加v", with: "加微")

        let homoglyphs: [String: String] = [
            "薇": "微", "v": "微", "V": "微"
        ]
        for (from, to) in homoglyphs {
            value = value.replacingOccurrences(of: from, with: to)
        }

        return value
    }
}
