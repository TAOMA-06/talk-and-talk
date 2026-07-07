import SwiftUI

@MainActor
final class AppStore: ObservableObject {
    @Published var selectedTab: AppTab = .discover
    @Published var discoverPath = NavigationPath()
    @Published var communityPath = NavigationPath()
    @Published var ordersPath = NavigationPath()
    @Published var messagesPath = NavigationPath()
    @Published var profilePath = NavigationPath()

    @Published var user = MockData.user
    @Published var companions = MockData.companions
    @Published var themes = MockData.themes
    @Published var orders = MockData.orders
    @Published var reviews = MockData.reviews
    @Published var messages = MockData.messages
    @Published var moderationCases = MockData.moderationCases
    @Published var communityPosts = MockData.communityPosts
    @Published var creditEvents: [CreditEvent] = MockData.initialCreditEvents
    @Published var activeOrderId: String?
    @Published var trialMessageCountsByCompanionId: [String: Int] = [:]
    @Published var lastModerationFeedback: String?
    @Published var agreementPrompt: AgreementPrompt?
    @Published var isBackendConnected = false
    @Published var backendModerationModel = ""

    let freeTrialMessageLimit = 5

    private let moderationService: ModerationService = HybridModerationService()
    private let creditService = CreditService()

    var currentUserCompanionId: String {
        "self-\(user.id)"
    }

    var accountRestrictions: AccountRestrictions {
        creditService.restrictions(for: user)
    }

    var onlineCompanionCount: Int {
        companions.filter { $0.availability == .online || $0.availability == .available }.count
    }

    var availableCompanionCount: Int {
        companions.filter { $0.availability != .busy }.count
    }

    var pendingModerationCount: Int {
        moderationCases.filter { $0.status == .pending || $0.status == .humanReview || $0.status == .autoReviewing }.count
    }

    var blockedTodayCount: Int {
        moderationCases.filter {
            guard $0.decision == .block, let resolvedAt = $0.resolvedAt else { return false }
            return Calendar.current.isDateInToday(resolvedAt)
        }.count
    }

    func navigate(_ route: AppRoute) {
        switch selectedTab {
        case .discover: discoverPath.append(route)
        case .community: communityPath.append(route)
        case .orders: ordersPath.append(route)
        case .messages: messagesPath.append(route)
        case .profile: profilePath.append(route)
        }
    }

    func popToRoot() {
        switch selectedTab {
        case .discover: discoverPath = NavigationPath()
        case .community: communityPath = NavigationPath()
        case .orders: ordersPath = NavigationPath()
        case .messages: messagesPath = NavigationPath()
        case .profile: profilePath = NavigationPath()
        }
    }

    func theme(by id: String?) -> Theme? {
        guard let id else { return nil }
        return themes.first { $0.id == id }
    }

    func companions(for themeId: String?) -> [Companion] {
        guard let theme = theme(by: themeId) else { return companions }
        return companions.filter { $0.specialties.contains(theme.name) }
    }

    func companion(by id: String) -> Companion? {
        companions.first { $0.id == id }
    }

    func reviews(for companionId: String) -> [Review] {
        reviews.filter { $0.companionId == companionId }
    }

    func displayName(for target: ContactTarget) -> String {
        switch target {
        case .companion(let id):
            companion(by: id)?.name ?? "沟通"
        case .communityUser(_, let name, _):
            name
        }
    }

    func messages(for companionId: String) -> [Message] {
        messages(for: .companion(id: companionId))
    }

    func messages(for target: ContactTarget) -> [Message] {
        messages
            .filter { $0.conversationId == target.conversationId }
            .sorted { $0.timestamp < $1.timestamp }
    }

    func latestMessage(for target: ContactTarget) -> Message? {
        messages(for: target).last
    }

    func latestMessage(for companionId: String) -> Message? {
        latestMessage(for: .companion(id: companionId))
    }

    func remainingTrialMessages(for companionId: String) -> Int {
        max(0, freeTrialMessageLimit - (trialMessageCountsByCompanionId[companionId] ?? 0))
    }

    func hasActivePaidChat(with companionId: String) -> Bool {
        orders.contains { order in
            order.companionId == companionId && (order.status == .confirmed || order.status == .inProgress)
        }
    }

    func canSendTrialMessage(to companionId: String) -> Bool {
        remainingTrialMessages(for: companionId) > 0
    }

    func refreshBackendConnection() async {
        guard BackendConfig.isEnabled, let client = backendClient() else {
            isBackendConnected = false
            backendModerationModel = ""
            return
        }

        do {
            let status = try await client.health()
            isBackendConnected = status.connected
            backendModerationModel = status.model ?? ""
        } catch {
            isBackendConnected = false
            backendModerationModel = ""
        }
    }

    func syncMessagesFromBackend(for companionId: String) async {
        guard BackendConfig.supportsChat(for: companionId), let client = backendClient() else { return }

        do {
            let fetched = try await client.fetchMessages(conversationId: companionId)
            messages.removeAll { $0.conversationId == companionId }
            messages.append(contentsOf: fetched)
            isBackendConnected = true
        } catch {
            isBackendConnected = false
        }
    }

    func approvedCommunityPosts() -> [CommunityPost] {
        communityPosts.filter { $0.moderationStatus == .approved }
    }

    func pendingCommunityPosts() -> [CommunityPost] {
        communityPosts.filter { $0.authorId == user.id && $0.moderationStatus == .pending }
    }

    func pendingServiceOrdersForCurrentCompanion() -> [Order] {
        guard user.gender == .male else { return [] }
        return orders
            .filter { order in
                order.companionId == currentUserCompanionId
                    && order.status != .completed
                    && order.status != .refunded
            }
            .sorted { $0.scheduledAt < $1.scheduledAt }
    }

    func createOrder(companionId: String, themeId: String, durationMinutes: Int) -> Order? {
        guard let companion = companion(by: companionId) else { return nil }
        let totalPrice = companion.pricePerHalfHour * max(1, (durationMinutes + 29) / 30)
        let order = Order(
            id: "o-\(Int(Date().timeIntervalSince1970))",
            companionId: companionId,
            themeId: themeId,
            durationMinutes: durationMinutes,
            totalPrice: totalPrice,
            status: .confirmed,
            createdAt: Date(),
            scheduledAt: Date().addingTimeInterval(60),
            customerTarget: .communityUser(id: user.id, name: user.name, initials: String(user.name.prefix(2)))
        )
        orders.insert(order, at: 0)
        activeOrderId = order.id
        insertSystemMessage("订单已由平台担保，沟通开始前请勿交换私人联系方式。", target: .companion(id: companionId), type: .system)
        return order
    }

    func startActiveOrder(with companionId: String) {
        guard let index = orderIndex(for: companionId, allowedStatuses: [.confirmed]) else { return }
        orders[index].status = .inProgress
        activeOrderId = orders[index].id
    }

    func completeActiveOrder(with companionId: String) {
        guard let index = orderIndex(for: companionId, allowedStatuses: [.inProgress]) else { return }
        orders[index].status = .completed
        activeOrderId = nil
        if let event = creditService.applyOrderCompletion(to: &user) {
            creditEvents.insert(event, at: 0)
        }
    }

    func completeOrder(id: String) {
        guard let index = orders.firstIndex(where: { $0.id == id }) else { return }
        orders[index].status = .completed
        if activeOrderId == id {
            activeOrderId = nil
        }
    }

    private func orderIndex(for companionId: String, allowedStatuses: [OrderStatus]) -> Int? {
        if let activeId = activeOrderId,
           let index = orders.firstIndex(where: { $0.id == activeId && $0.companionId == companionId && allowedStatuses.contains($0.status) }) {
            return index
        }
        return orders.firstIndex { $0.companionId == companionId && allowedStatuses.contains($0.status) }
    }

    func setUserGender(_ gender: UserGender) {
        user.gender = gender
    }

    func verifyUser(name: String, phone: String, age: Int) {
        user.name = name.isEmpty ? user.name : name
        user.phone = phone.isEmpty ? user.phone : Self.maskedPhone(phone)
        user.age = max(age, 18)
        user.isVerified = true
        let event = creditService.applyVerification(to: &user)
        creditEvents.insert(event, at: 0)
    }

    private static func maskedPhone(_ phone: String) -> String {
        let digits = phone.filter(\.isNumber)
        guard digits.count == 11 else { return phone }
        let prefix = digits.prefix(3)
        let suffix = digits.suffix(4)
        return "\(prefix)****\(suffix)"
    }

    @discardableResult
    func sendMessage(_ content: String, to companionId: String) async -> ModerationDecision {
        guard hasActivePaidChat(with: companionId) || canSendTrialMessage(to: companionId) else {
            lastModerationFeedback = "免费试聊已用完，请下单后继续沟通。"
            return .block
        }
        return await sendMessage(content, to: .companion(id: companionId))
    }

    @discardableResult
    func sendMessage(_ content: String, to target: ContactTarget) async -> ModerationDecision {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .allow }

        guard accountRestrictions.canSendMessages else {
            lastModerationFeedback = "账号当前无法发送消息，请前往安全中心查看。"
            return .block
        }

        if BackendConfig.supportsChat(for: target), BackendConfig.isEnabled, let client = backendClient() {
            do {
                return try await sendMessageViaBackend(trimmed, to: target, client: client)
            } catch {
                isBackendConnected = false
                lastModerationFeedback = "后端暂不可用，已切换本地审查"
            }
        }

        let recentMessages = messages(for: target)
            .filter { $0.senderId == user.id && $0.type == .text }
            .suffix(4)
            .map(\.content)
        let context = ModerationContext(
            recentMessages: recentMessages,
            safetyScore: user.safetyScore,
            isVerified: user.isVerified
        )
        let service = moderationService
        let result = await service.moderate(text: trimmed, source: .chat, context: context)

        switch result.decision {
        case .block:
            lastModerationFeedback = "消息未发送：疑似违规内容"
            insertSystemMessage("安全提醒：平台不支持线下邀约、私下转账或敏感交易，请在平台内完成沟通。", target: target, type: .safety)
            insertModerationCase(from: result, title: "聊天拦截：\(trimmed)", source: .chat, content: trimmed, targetId: target.conversationId, status: .humanReview)
            if let event = creditService.applyModerationResult(result, to: &user) {
                creditEvents.insert(event, at: 0)
            }
        case .warn:
            if applyWarnGraceIfNeeded(result: result) {
                appendUserMessage(trimmed, target: target)
                insertSystemMessage("友善提醒：你的表达可能接近边界，请阅读用户协议并保持平台内沟通。", target: target, type: .safety)
                lastModerationFeedback = "已记录第 \(user.warnGraceStrikeCount) 次提醒，请阅读用户协议"
            } else {
                appendUserMessage(trimmed, target: target)
                insertSystemMessage("安全提醒：请保持在平台内沟通，避免交换私人联系方式。", target: target, type: .safety)
                insertModerationCase(from: result, title: "聊天预警：\(trimmed)", source: .chat, content: trimmed, targetId: target.conversationId, status: .humanReview)
                if let event = creditService.applyModerationResult(result, to: &user) {
                    creditEvents.insert(event, at: 0)
                }
                lastModerationFeedback = nil
            }
        case .review:
            appendUserMessage(trimmed, target: target)
            insertModerationCase(from: result, title: "聊天待复核：\(trimmed)", source: .chat, content: trimmed, targetId: target.conversationId, status: .pending)
            lastModerationFeedback = nil
        case .allow:
            appendUserMessage(trimmed, target: target)
            lastModerationFeedback = nil
        }

        if result.decision != .block {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                guard let self else { return }
                guard !BackendConfig.supportsChat(for: target) else { return }
                let reply = self.reply(for: target)
                self.messages.append(Message(
                    id: UUID().uuidString,
                    conversationId: target.conversationId,
                    senderId: target.participantId,
                    content: reply,
                    type: .text,
                    timestamp: Date()
                ))
            }
        }

        return result.decision
    }

    @discardableResult
    func sendTrialMessage(_ content: String, to companionId: String) async -> ModerationDecision {
        guard canSendTrialMessage(to: companionId) else {
            lastModerationFeedback = "免费试聊已用完，请下单后继续沟通。"
            return .block
        }

        let decision = await sendMessage(content, to: companionId)
        if decision != .block {
            trialMessageCountsByCompanionId[companionId, default: 0] += 1
        }
        return decision
    }

    func sendRecommendationCard(to target: ContactTarget) {
        guard user.gender == .male, user.isVerified else { return }
        guard case .communityUser = target else { return }

        let companion = ensureCurrentUserCompanion()
        messages.append(Message(
            id: UUID().uuidString,
            conversationId: target.conversationId,
            senderId: user.id,
            content: "推荐卡片",
            type: .recommendationCard,
            timestamp: Date(),
            companionCardId: companion.id
        ))
    }

    @discardableResult
    func submitCommunityPost(
        kind: CommunityPostKind,
        topic: String,
        content: String,
        coverImageData: Data?,
        coverAspectRatio: Double?
    ) async -> CommunityModerationStatus {
        let trimmedTopic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTopic.isEmpty, !trimmedContent.isEmpty else { return .rejected }

        guard accountRestrictions.canPostCommunity else {
            lastModerationFeedback = "账号受限，暂时无法在社区发帖。"
            return .rejected
        }

        if kind == .malePromotion && !(user.gender == .male && user.isVerified) {
            lastModerationFeedback = "男生发布自荐需先完成实名认证。"
            return .rejected
        }

        let effectiveCoverImageData = kind == .femaleRequest ? nil : coverImageData
        let effectiveCoverAspectRatio = kind == .femaleRequest ? nil : coverAspectRatio
        let contactTarget: ContactTarget
        switch kind {
        case .femaleRequest:
            contactTarget = .communityUser(id: user.id, name: user.name, initials: String(user.name.prefix(2)))
        case .malePromotion:
            contactTarget = .companion(id: ensureCurrentUserCompanion(promotionContent: trimmedContent).id)
        }

        let post = CommunityPost(
            id: UUID().uuidString,
            authorId: user.id,
            authorName: user.name,
            authorInitials: String(user.name.prefix(2)),
            contactTarget: contactTarget,
            kind: kind,
            topic: trimmedTopic,
            content: trimmedContent,
            coverImageData: effectiveCoverImageData,
            coverAspectRatio: effectiveCoverAspectRatio,
            likeCount: 0,
            moderationStatus: .pending,
            createdAt: Date()
        )
        communityPosts.insert(post, at: 0)

        let service = moderationService
        let result = await service.moderate(
            text: "\(trimmedTopic) \(trimmedContent)",
            source: .community,
            context: ModerationContext(safetyScore: user.safetyScore, isVerified: user.isVerified)
        )

        guard let index = communityPosts.firstIndex(where: { $0.id == post.id }) else { return .rejected }

        switch result.decision {
        case .block, .review:
            communityPosts[index].moderationStatus = .rejected
            insertModerationCase(
                from: result,
                title: "社区内容未通过：\(trimmedTopic)",
                source: .community,
                content: trimmedContent,
                targetId: post.id,
                status: result.decision == .block ? .resolved : .humanReview
            )
            if result.decision == .block, let event = creditService.applyModerationResult(result, to: &user) {
                creditEvents.insert(event, at: 0)
            }
            lastModerationFeedback = result.decision == .block ? "帖子未通过审核" : "帖子已转人工复核"
            return .rejected
        case .warn, .allow:
            if result.decision == .warn, applyWarnGraceIfNeeded(result: result) {
                communityPosts[index].moderationStatus = .approved
                lastModerationFeedback = "帖子已发布，但请阅读用户协议（第 \(user.warnGraceStrikeCount) 次提醒）"
                return .approved
            }
            communityPosts[index].moderationStatus = .approved
            if result.decision == .warn {
                insertModerationCase(
                    from: result,
                    title: "社区内容预警：\(trimmedTopic)",
                    source: .community,
                    content: trimmedContent,
                    targetId: post.id,
                    status: .pending
                )
                if let event = creditService.applyModerationResult(result, to: &user) {
                    creditEvents.insert(event, at: 0)
                }
            }
            lastModerationFeedback = "帖子已通过审核"
            return .approved
        }
    }

    func submitReview(companionId: String, rating: Int, content: String) {
        reviews.insert(Review(
            id: UUID().uuidString,
            companionId: companionId,
            userName: user.name,
            rating: rating,
            content: content.isEmpty ? "沟通过程很安心，平台流程清晰。" : content,
            createdAt: Date()
        ), at: 0)
    }

    func report(companionId: String, reason: String) {
        report(target: .companion(id: companionId), reason: reason)
    }

    func report(target: ContactTarget, reason: String) {
        let targetName = displayName(for: target)
        let recent = messages(for: target).suffix(4).map(\.content).joined(separator: " ")
        let reportText = "\(reason) \(recent)"
        lastModerationFeedback = "举报已提交，演示后台会生成复核工单。"

        Task { [moderationService] in
            let result = await moderationService.moderate(
                text: reportText,
                source: .report,
                context: ModerationContext(safetyScore: user.safetyScore, isVerified: user.isVerified)
            )
            let status: ModerationCaseStatus = result.score >= 0.55 ? .humanReview : .pending
            insertModerationCase(
                from: result,
                title: "\(targetName)：\(reason)",
                source: .report,
                content: reportText,
                targetId: target.conversationId,
                status: status
            )
        }
    }

    func resolveModerationCase(id: String, action: AdminAction) {
        guard let index = moderationCases.firstIndex(where: { $0.id == id }) else { return }
        var item = moderationCases[index]

        switch action {
        case .confirmViolation:
            item.status = .resolved
            item.resolvedAt = Date()
            if let event = creditService.applyAdminResolution(.confirmViolation, to: &user, caseDecision: item.decision) {
                creditEvents.insert(event, at: 0)
            }
        case .dismiss:
            item.status = .dismissed
            item.resolvedAt = Date()
            if let event = creditService.applyAdminResolution(.dismiss, to: &user, caseDecision: item.decision) {
                creditEvents.insert(event, at: 0)
            }
        case .escalate:
            item.status = .humanReview
        }

        moderationCases[index] = item
    }

    func dismissAgreementPrompt() {
        agreementPrompt = nil
    }

    /// 在正式 warn 扣分前给予两次协议提醒。返回 true 表示本次走了提醒流程。
    @discardableResult
    private func applyWarnGraceIfNeeded(result: ModerationResult) -> Bool {
        guard result.decision == .warn, user.warnGraceStrikeCount < 2 else { return false }

        user.warnGraceStrikeCount += 1
        let requiredReadSeconds = user.warnGraceStrikeCount == 2 ? 15 : 0
        agreementPrompt = AgreementPrompt(
            id: UUID().uuidString,
            title: PlatformAgreement.title,
            message: user.warnGraceStrikeCount == 1
                ? "这是你的第 1 次友善提醒。请阅读用户协议，了解平台沟通边界。"
                : "这是你的第 2 次提醒。请认真阅读用户协议至少 15 秒，后续违规将扣减安全分。",
            requiredReadSeconds: requiredReadSeconds,
            strikeNumber: user.warnGraceStrikeCount
        )
        creditEvents.insert(
            CreditEvent(
                id: UUID().uuidString,
                delta: 0,
                reason: "第 \(user.warnGraceStrikeCount) 次协议提醒（暂未扣分）",
                createdAt: Date()
            ),
            at: 0
        )
        return true
    }

    private func appendUserMessage(_ content: String, target: ContactTarget) {
        messages.append(Message(
            id: UUID().uuidString,
            conversationId: target.conversationId,
            senderId: user.id,
            content: content,
            type: .text,
            timestamp: Date()
        ))
    }

    private func appendMessage(_ message: Message) {
        guard !messages.contains(where: { $0.id == message.id }) else { return }
        messages.append(message)
    }

    private func backendClient() -> BackendDemoClient? {
        guard let baseURL = BackendConfig.baseURL else { return nil }
        return BackendDemoClient(baseURL: baseURL)
    }

    private func sendMessageViaBackend(
        _ content: String,
        to target: ContactTarget,
        client: BackendDemoClient
    ) async throws -> ModerationDecision {
        let response = try await client.sendMessage(
            conversationId: target.conversationId,
            content: content,
            senderId: user.id
        )

        isBackendConnected = true

        for message in response.messages {
            appendMessage(message)
        }

        if let moderationCase = response.moderationCase {
            insertBackendModerationCase(moderationCase)
        }

        let result = response.moderation

        switch result.decision {
        case .block:
            lastModerationFeedback = "消息未发送：疑似违规内容"
            if let event = creditService.applyModerationResult(result, to: &user) {
                creditEvents.insert(event, at: 0)
            }
        case .warn:
            if applyWarnGraceIfNeeded(result: result) {
                lastModerationFeedback = "已记录第 \(user.warnGraceStrikeCount) 次提醒，请阅读用户协议"
            } else {
                if let event = creditService.applyModerationResult(result, to: &user) {
                    creditEvents.insert(event, at: 0)
                }
                lastModerationFeedback = nil
            }
        case .review, .allow:
            lastModerationFeedback = nil
        }

        return result.decision
    }

    private func insertBackendModerationCase(_ item: ModerationCase) {
        moderationCases.removeAll { $0.id == item.id }
        moderationCases.insert(item, at: 0)
    }

    private func insertSystemMessage(_ content: String, target: ContactTarget, type: MessageType = .safety) {
        messages.append(Message(
            id: UUID().uuidString,
            conversationId: target.conversationId,
            senderId: "system",
            content: content,
            type: type,
            timestamp: Date()
        ))
    }

    private func insertModerationCase(
        from result: ModerationResult,
        title: String,
        source: ModerationSource,
        content: String,
        targetId: String?,
        status: ModerationCaseStatus
    ) {
        moderationCases.insert(
            ModerationCase(
                id: UUID().uuidString,
                title: title,
                category: category(for: source),
                riskLevel: result.riskLevel,
                status: status,
                source: source,
                content: content,
                targetId: targetId,
                aiScore: result.score,
                aiReason: result.reasons.joined(separator: "；"),
                decision: result.decision,
                matchedRules: result.matchedRules,
                usedAI: result.usedAI,
                resolvedAt: nil
            ),
            at: 0
        )
    }

    private func category(for source: ModerationSource) -> String {
        switch source {
        case .chat: "实时风控"
        case .community: "社区审核"
        case .report: "用户举报"
        case .profile: "资料审核"
        }
    }

    private func reply(for target: ContactTarget) -> String {
        let companion = displayName(for: target)
        let replies = [
            "我在，先慢慢说。我们可以把现在最困扰你的点拆成一小步一小步看。",
            "听起来你今天消耗很大。要不要先做一个30秒呼吸放松，再继续聊？",
            "谢谢你愿意说出来。\(companion)会跟着你的节奏，不急着给结论。",
            "我会保持边界和尊重，如果有任何不舒服，可以随时结束或举报。"
        ]
        return replies.randomElement() ?? replies[0]
    }

    @discardableResult
    private func ensureCurrentUserCompanion(promotionContent: String? = nil) -> Companion {
        let companionId = currentUserCompanionId
        if let existing = companion(by: companionId) {
            return existing
        }

        let specialty = themes.first?.name ?? "情绪倾听"
        let companion = Companion(
            id: companionId,
            name: user.name,
            role: "认证陪伴者",
            initials: String(user.name.prefix(2)),
            tags: ["已实名", "平台内沟通", "边界清晰"],
            rating: 4.8,
            reviewCount: 0,
            pricePerHalfHour: 39,
            isOnline: true,
            isVerified: true,
            bio: promotionContent.flatMap { $0.isEmpty ? nil : $0 } ?? "已完成实名认证，支持平台内文字与语音陪伴。沟通过程遵守平台边界，不线下、不私联。",
            availableTimes: ["20:00", "21:30", "23:00"],
            languages: ["中文"],
            specialties: [specialty],
            completedOrders: 0,
            responseTime: "约1分钟",
            distanceKm: 0,
            availability: .online,
            cityDistrict: "平台内"
        )
        companions.insert(companion, at: 0)
        return companion
    }
}

enum MockData {
    static let user = User(
        id: "u1",
        name: "小楷",
        phone: "183****0012",
        age: 18,
        gender: nil,
        isVerified: false,
        safetyScore: 72,
        accountStatus: .active,
        violationCount: 0,
        lastViolationAt: nil,
        warnGraceStrikeCount: 0
    )

    static let initialCreditEvents: [CreditEvent] = [
        CreditEvent(id: "ce1", delta: 0, reason: "欢迎使用 Talk&Talk，初始安全分 72", createdAt: .now.addingTimeInterval(-86400))
    ]

    static let themes: [Theme] = [
        Theme(id: "t1", name: "情绪倾听", icon: "heart.text.square", description: "有人认真听你说完今天", tintName: "teal"),
        Theme(id: "t2", name: "职场减压", icon: "briefcase", description: "拆解压力、复盘沟通", tintName: "coral"),
        Theme(id: "t3", name: "学习陪伴", icon: "book.closed", description: "番茄钟式专注陪跑", tintName: "lilac"),
        Theme(id: "t4", name: "睡前语音", icon: "moon.stars", description: "低刺激、安静的晚间陪伴", tintName: "gold"),
        Theme(id: "t5", name: "兴趣聊天", icon: "sparkles", description: "电影、旅行、美食、摄影", tintName: "teal"),
        Theme(id: "t6", name: "运动鼓励", icon: "figure.run", description: "计划、打卡、正反馈", tintName: "coral")
    ]

    static let companions: [Companion] = [
        Companion(id: "c1", name: "林屿", role: "温柔倾听者", initials: "LY", tags: ["心理学背景", "深夜在线", ], rating: 4.9, reviewCount: 168, pricePerHalfHour: 39, isOnline: true, isVerified: true, bio: "擅长把复杂情绪慢慢梳理清楚，提供稳定、尊重边界的线上陪伴。不做诊断，不替你做决定，只陪你把问题说亮。", availableTimes: ["20:00", "21:30", "23:00"], languages: ["中文", "英语"], specialties: ["情绪倾听", "睡前语音"], completedOrders: 426, responseTime: "约30秒", distanceKm: 1.2, availability: .online, cityDistrict: "南山区"),
        Companion(id: "c2", name: "许澈", role: "职场沟通陪伴", initials: "XC", tags: ["职业沟通", "疏解压力", "高效"], rating: 4.8, reviewCount: 116, pricePerHalfHour: 49, isOnline: true, isVerified: true, bio: "适合聊职场压力、向上沟通、面试准备。用结构化问题帮你把混乱变成可执行的小动作。", availableTimes: ["12:30", "19:00", "22:00"], languages: ["中文"], specialties: ["职场减压", "学习陪伴"], completedOrders: 318, responseTime: "约1分钟", distanceKm: 2.8, availability: .available, cityDistrict: "宝安区"),
        Companion(id: "c3", name: "周映", role: "睡前声音陪伴", initials: "ZY", tags: ["情绪稳定", "慢节奏", ], rating: 4.9, reviewCount: 204, pricePerHalfHour: 45, isOnline: false, isVerified: true, bio: "晚间低刺激陪伴，适合想找人轻声聊聊、整理一天、从高压状态里慢慢下来。", availableTimes: ["22:30", "23:30", "00:30"], languages: ["中文", "粤语"], specialties: ["睡前语音", "情绪倾听"], completedOrders: 512, responseTime: "约5分钟", distanceKm: 4.5, availability: .busy, cityDistrict: "前海"),
        Companion(id: "c4", name: "沈一", role: "专注陪跑伙伴", initials: "SY", tags: ["互相监督", "考研陪伴", ], rating: 4.7, reviewCount: 92, pricePerHalfHour: 29, isOnline: true, isVerified: true, bio: "不鸡血、不PUA，陪你设定一个真实可完成的小目标，开始、暂停、复盘都有人在。", availableTimes: ["08:00", "14:00", "20:00"], languages: ["中文"], specialties: ["学习陪伴", "运动鼓励"], completedOrders: 180, responseTime: "约45秒", distanceKm: 0.8, availability: .online, cityDistrict: "南山区"),
        Companion(id: "c5", name: "闻舟", role: "兴趣聊天搭子", initials: "WZ", tags: ["电影", "旅行", "摄影"], rating: 4.6, reviewCount: 74, pricePerHalfHour: 35, isOnline: true, isVerified: false, bio: "适合轻松聊天、灵感交换、旅行和影像话题。不提供任何线下见面服务，所有沟通都在平台内完成。", availableTimes: ["10:00", "16:00", "21:00"], languages: ["中文", "日语"], specialties: ["兴趣聊天", "情绪倾听"], completedOrders: 139, responseTime: "约2分钟", distanceKm: 3.1, availability: .available, cityDistrict: "西城区")
    ]

    static let orders: [Order] = [
        Order(id: "o1", companionId: "c1", themeId: "t1", durationMinutes: 30, totalPrice: 39, status: .completed, createdAt: .now.addingTimeInterval(-86400), scheduledAt: .now.addingTimeInterval(-82800)),
        Order(id: "o2", companionId: "c3", themeId: "t4", durationMinutes: 60, totalPrice: 90, status: .confirmed, createdAt: .now.addingTimeInterval(-3600), scheduledAt: .now.addingTimeInterval(1800)),
        Order(id: "o3", companionId: "self-u1", themeId: "t2", durationMinutes: 30, totalPrice: 39, status: .confirmed, createdAt: .now.addingTimeInterval(-1800), scheduledAt: .now.addingTimeInterval(2400), customerTarget: .communityUser(id: "u3", name: "李四", initials: "李四"))
    ]

    static let reviews: [Review] = [
        Review(id: "r1", companionId: "c1", userName: "张三", rating: 5, content: "没有被催着变好，只是被认真听见了。", createdAt: .now.addingTimeInterval(-7200)),
        Review(id: "r2", companionId: "c1", userName: "李四", rating: 5, content: "流程很安心，提醒也清楚，适合晚上情绪很满的时候。", createdAt: .now.addingTimeInterval(-172800)),
        Review(id: "r3", companionId: "c2", userName: "王五", rating: 5, content: "把职场沟通拆得很具体，聊完知道下一步怎么做。", createdAt: .now.addingTimeInterval(-54000))
    ]

    static let messages: [Message] = [
        Message(id: "m1", conversationId: "c1", senderId: "system", content: "平台已开启安全提醒：请勿交换私人联系方式或进行线下邀约。", type: .system, timestamp: .now.addingTimeInterval(-720)),
        Message(id: "m2", conversationId: "c1", senderId: "c1", content: "晚上好，我是林屿。你可以从任何一个小片段开始说。", type: .text, timestamp: .now.addingTimeInterval(-680)),
        Message(id: "m3", conversationId: "c1", senderId: "u1", content: "今天有点累，感觉脑子里都是工作的事。", type: .text, timestamp: .now.addingTimeInterval(-610)),
        Message(id: "m4", conversationId: "c1", senderId: "c1", content: "那我们先不急着解决。你觉得最压着你的，是事情多，还是没人理解？", type: .text, timestamp: .now.addingTimeInterval(-560))
    ]

    static let moderationCases: [ModerationCase] = [
        ModerationCase(
            id: "mc1", title: "头像审核：闻舟", category: "资料审核", riskLevel: .low,
            status: .pending, source: .profile, content: "待补充人脸核验", targetId: "c5",
            aiScore: 0.2, aiReason: "资料待补充", decision: .review, matchedRules: ["profile.pending"],
            usedAI: false, resolvedAt: nil
        ),
        ModerationCase(
            id: "mc2", title: "订单 o2 服务前提醒已发送", category: "安全流程", riskLevel: .low,
            status: .resolved, source: .chat, content: "服务前提醒", targetId: "o2",
            aiScore: 0.1, aiReason: "流程提醒", decision: .allow, matchedRules: [],
            usedAI: false, resolvedAt: .now.addingTimeInterval(-3600)
        ),
        ModerationCase(
            id: "mc3", title: "敏感词库：线下交易规则", category: "内容风控", riskLevel: .medium,
            status: .autoReviewing, source: .chat, content: "规则引擎自动拦截中", targetId: nil,
            aiScore: 0.45, aiReason: "规则引擎运行中", decision: .review, matchedRules: ["rules.offline"],
            usedAI: false, resolvedAt: nil
        )
    ]

    static let communityPosts: [CommunityPost] = [
        CommunityPost(id: "p1", authorId: "u2", authorName: "张三", authorInitials: "张三", contactTarget: .communityUser(id: "u2", name: "张三", initials: "张三"), kind: .femaleRequest, topic: "情绪倾听", content: "第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。", coverImageData: nil, coverAspectRatio: 0.82, likeCount: 128, moderationStatus: .approved, createdAt: .now.addingTimeInterval(-7200)),
        CommunityPost(id: "p2", authorId: "u3", authorName: "李四", authorInitials: "李四", contactTarget: .communityUser(id: "u3", name: "李四", initials: "李四"), kind: .femaleRequest, topic: "睡前聊天", content: "睡前把灯光调暗，放一段轻音乐，给自己一个不被打扰的十分钟。安静的夜晚有人陪着说说话，真的会安心很多。", coverImageData: nil, coverAspectRatio: 1.0, likeCount: 86, moderationStatus: .approved, createdAt: .now.addingTimeInterval(-14400)),
        CommunityPost(id: "p4", authorId: "c1", authorName: "林屿", authorInitials: "LY", contactTarget: .companion(id: "c1"), kind: .malePromotion, topic: "职场减压", content: "已实名，擅长稳定倾听和边界清晰的文字陪伴。希望匹配需要安静沟通的人。", coverImageData: nil, coverAspectRatio: 0.72, likeCount: 203, moderationStatus: .approved, createdAt: .now.addingTimeInterval(-28800)),
        CommunityPost(id: "p5", authorId: "c2", authorName: "许澈", authorInitials: "XC", contactTarget: .companion(id: "c2"), kind: .malePromotion, topic: "陪伴故事", content: "喜欢电影和旅行话题，沟通节奏轻松，不线下、不私联，只在平台内交流。", coverImageData: nil, coverAspectRatio: 1.18, likeCount: 97, moderationStatus: .approved, createdAt: .now.addingTimeInterval(-36000))
    ]
}
