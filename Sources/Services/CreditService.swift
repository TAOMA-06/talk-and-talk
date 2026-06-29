import Foundation

struct CreditService {
    func restrictions(for user: User) -> AccountRestrictions {
        switch user.accountStatus {
        case .banned:
            return AccountRestrictions(
                canSendMessages: false,
                canPostCommunity: false,
                reducedMatchingWeight: true,
                summary: "账号已封禁，暂时无法发消息和发帖。"
            )
        case .restricted:
            return AccountRestrictions(
                canSendMessages: true,
                canPostCommunity: false,
                reducedMatchingWeight: true,
                summary: "账号受限，暂时无法在社区发帖，匹配曝光会降低。"
            )
        case .active:
            return AccountRestrictions(
                canSendMessages: true,
                canPostCommunity: true,
                reducedMatchingWeight: false,
                summary: "账号状态正常。"
            )
        }
    }

    func scoreLevel(for score: Int) -> String {
        switch score {
        case 85...: "优秀"
        case 70..<85: "良好"
        case 50..<70: "需关注"
        case 20..<50: "受限"
        default: "封禁风险"
        }
    }

    func applyVerification(to user: inout User) -> CreditEvent {
        user.safetyScore = max(user.safetyScore, 85)
        refreshAccountStatus(for: &user)
        return CreditEvent(
            id: UUID().uuidString,
            delta: 0,
            reason: "完成实名认证，基础信任分设为 85",
            createdAt: Date()
        )
    }

    func applyOrderCompletion(to user: inout User) -> CreditEvent? {
        guard user.safetyScore < 100 else { return nil }
        let delta = min(2, 100 - user.safetyScore)
        user.safetyScore += delta
        refreshAccountStatus(for: &user)
        return CreditEvent(
            id: UUID().uuidString,
            delta: delta,
            reason: "正常完成订单",
            createdAt: Date()
        )
    }

    @discardableResult
    func applyModerationResult(_ result: ModerationResult, to user: inout User) -> CreditEvent? {
        guard result.decision == .warn || result.decision == .block else { return nil }

        let delta: Int
        let reason: String
        switch result.decision {
        case .block:
            delta = -20
            reason = "触发高风险内容：\(result.reasons.first ?? "违规内容")"
        case .warn:
            delta = -8
            reason = "触发安全提醒：\(result.reasons.first ?? "疑似违规")"
        default:
            return nil
        }

        user.safetyScore = max(0, min(100, user.safetyScore + delta))
        user.violationCount += 1
        user.lastViolationAt = Date()
        refreshAccountStatus(for: &user)

        return CreditEvent(id: UUID().uuidString, delta: delta, reason: reason, createdAt: Date())
    }

    @discardableResult
    func applyAdminResolution(_ action: AdminAction, to user: inout User, caseDecision: ModerationDecision) -> CreditEvent? {
        switch action {
        case .confirmViolation:
            let delta = caseDecision == .block ? -15 : -10
            user.safetyScore = max(0, user.safetyScore + delta)
            user.violationCount += 1
            user.lastViolationAt = Date()
            refreshAccountStatus(for: &user)
            return CreditEvent(
                id: UUID().uuidString,
                delta: delta,
                reason: "后台确认违规",
                createdAt: Date()
            )
        case .dismiss:
            user.safetyScore = min(100, user.safetyScore + 5)
            refreshAccountStatus(for: &user)
            return CreditEvent(
                id: UUID().uuidString,
                delta: 5,
                reason: "误报驳回，信用分恢复",
                createdAt: Date()
            )
        case .escalate:
            return nil
        }
    }

    func refreshAccountStatus(for user: inout User) {
        if user.safetyScore < 20 || user.violationCount >= 5 {
            user.accountStatus = .banned
        } else if user.safetyScore < 50 || user.violationCount >= 3 {
            user.accountStatus = .restricted
        } else {
            user.accountStatus = .active
        }
    }
}
