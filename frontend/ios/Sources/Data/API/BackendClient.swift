import Foundation

enum BackendError: Error, Equatable {
    case invalidURL
    case httpError(Int)
    case decodingFailed
    case unavailable
    case apiError(code: String, message: String, statusCode: Int)

    var userFacingMessage: String {
        switch self {
        case .apiError(let code, let message, _):
            switch code {
            case "RATE_LIMITED": return "操作过于频繁，请稍后再试"
            case "INVALID_VERIFICATION_CODE": return "验证码错误或已过期"
            case "INVALID_PHONE": return "请输入正确的手机号"
            case "UNAUTHORIZED": return "登录已过期，请重新登录"
            case "FORBIDDEN": return "没有权限执行此操作"
            case "PAYMENT_AMOUNT_MISMATCH", "PAYMENT_NOT_SUCCESS", "PAYMENT_INVALID":
                return "支付校验失败，请稍后重试或联系客服"
            case "ORDER_INVALID_STATE": return "订单状态已变化，请刷新后重试"
            case "ORDER_NOT_FOUND": return "订单不存在或无权查看"
            case "WECHAT_SIGN_INVALID": return "支付回调验证失败，请勿重复支付"
            case "MOCK_PAY_DISABLED": return "当前环境不支持模拟支付"
            default: return message.isEmpty ? "操作失败，请稍后重试" : message
            }
        case .unavailable: return "无法连接服务器，请检查网络后重试"
        case .httpError(let code): return "服务器错误（\(code)），请稍后重试"
        case .invalidURL: return "请求地址无效"
        case .decodingFailed: return "数据解析失败，请稍后重试"
        }
    }
}

struct BackendSendMessageResponse: Sendable {
    let moderation: ModerationResult
    let messages: [Message]
    let moderationCase: ModerationCase?
}

struct BackendPrepayResult: Sendable {
    let order: Order
    let outTradeNo: String
    let isMock: Bool
    let wechatParams: WeChatAppPayParams?
}

protocol BackendAPIClient: Sendable {
    func health() async throws -> BackendServiceStatus
    func fetchCompanions(page: Int, pageSize: Int, tag: String?, availability: AvailabilityStatus?, isOnline: Bool?) async throws -> [Companion]
    func fetchCompanion(id: String) async throws -> Companion
    func fetchConversations() async throws -> [ConversationSummary]
    func fetchMessages(conversationId: String, cursor: String?, limit: Int?) async throws -> [Message]
    func sendMessage(conversationId: String, content: String, senderId: String) async throws -> BackendSendMessageResponse
    func submitReport(reason: String, conversationId: String?, targetId: String?, recentContext: String?) async throws -> ModerationCase
    func createOrder(companionId: String, themeId: String, durationMinutes: Int) async throws -> Order
    func fetchOrders() async throws -> [Order]
    func fetchOrder(id: String) async throws -> Order
    func cancelOrder(id: String) async throws -> Order
    func prepayOrder(id: String) async throws -> BackendPrepayResult
    func mockWechatNotify(outTradeNo: String, amountCents: Int?) async throws
    func fetchNotifications(unreadOnly: Bool) async throws -> [AppNotification]
    func fetchNotificationUnreadCount() async throws -> Int
    func markNotificationRead(id: String) async throws -> AppNotification
    func markAllNotificationsRead() async throws
    func requestAccountDeletion() async throws -> String
}

extension BackendAPIClient {
    func fetchMessages(conversationId: String) async throws -> [Message] {
        try await fetchMessages(conversationId: conversationId, cursor: nil, limit: nil)
    }
}

struct BackendClient: BackendAPIClient, Sendable {
    private let baseURL: URL
    private let session: URLSession
    private let tokenProvider: @Sendable () -> String?
    private let unauthorizedHandler: @Sendable () async -> Bool

    init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenProvider: @escaping @Sendable () -> String? = { nil },
        unauthorizedHandler: @escaping @Sendable () async -> Bool = { false }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
        self.unauthorizedHandler = unauthorizedHandler
    }

    func health() async throws -> BackendServiceStatus {
        let data: BackendHealthData = try await request(path: "/api/v1/health")
        guard data.status == "ok" || data.status == "degraded" else { throw BackendError.unavailable }
        return BackendServiceStatus(connected: true, version: data.version, status: data.status)
    }

    func fetchCompanions(
        page: Int = 1,
        pageSize: Int = 20,
        tag: String? = nil,
        availability: AvailabilityStatus? = nil,
        isOnline: Bool? = nil
    ) async throws -> [Companion] {
        var queryItems = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize))
        ]
        if let tag {
            queryItems.append(URLQueryItem(name: "tag", value: tag))
        }
        if let availability {
            queryItems.append(URLQueryItem(name: "availability", value: availability.rawValue))
        }
        if let isOnline {
            queryItems.append(URLQueryItem(name: "isOnline", value: isOnline ? "true" : "false"))
        }

        let data: BackendCompanionsData = try await request(path: queryPath("/api/v1/companions", queryItems: queryItems))
        return data.items.map(BackendDTOMapper.companion(from:))
    }

    func fetchCompanion(id: String) async throws -> Companion {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data: BackendCompanionDTO = try await request(path: "/api/v1/companions/\(encoded)")
        return BackendDTOMapper.companion(from: data)
    }

    func fetchConversations() async throws -> [ConversationSummary] {
        let data: BackendConversationsData = try await request(path: "/api/v1/conversations")
        return data.conversations.map(BackendDTOMapper.conversation(from:))
    }

    func fetchMessages(conversationId: String, cursor: String? = nil, limit: Int? = nil) async throws -> [Message] {
        let encoded = conversationId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? conversationId
        var queryItems: [URLQueryItem] = []
        if let cursor {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        if let limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        let path = queryItems.isEmpty
            ? "/api/v1/conversations/\(encoded)/messages"
            : queryPath("/api/v1/conversations/\(encoded)/messages", queryItems: queryItems)
        let data: BackendMessagesData = try await request(path: path)
        return data.messages.compactMap(BackendDTOMapper.message(from:))
    }

    func submitReport(
        reason: String,
        conversationId: String?,
        targetId: String?,
        recentContext: String?
    ) async throws -> ModerationCase {
        var body: [String: Any] = ["reason": reason]
        if let conversationId, !conversationId.isEmpty {
            body["conversationId"] = conversationId
        }
        if let targetId, !targetId.isEmpty {
            body["targetId"] = targetId
        }
        if let recentContext, !recentContext.isEmpty {
            body["recentContext"] = recentContext
        }

        let data: BackendReportData = try await request(
            path: "/api/v1/moderation/reports",
            method: "POST",
            body: body
        )
        guard let moderationCase = BackendDTOMapper.moderationCase(from: data.moderationCase) else {
            throw BackendError.decodingFailed
        }
        return moderationCase
    }

    func sendMessage(
        conversationId: String,
        content: String,
        senderId: String
    ) async throws -> BackendSendMessageResponse {
        let encoded = conversationId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? conversationId
        let body: [String: String] = [
            "content": content,
            "senderId": senderId
        ]
        let data: BackendSendMessageData = try await request(
            path: "/api/v1/conversations/\(encoded)/messages",
            method: "POST",
            body: body
        )

        var messages: [Message] = []
        if let message = data.message.flatMap(BackendDTOMapper.message(from:)) {
            messages.append(message)
        }
        if let safetyMessage = data.safetyMessage.flatMap(BackendDTOMapper.message(from:)) {
            messages.append(safetyMessage)
        }
        if let companionReply = data.companionReply.flatMap(BackendDTOMapper.message(from:)) {
            messages.append(companionReply)
        }

        return BackendSendMessageResponse(
            moderation: BackendDTOMapper.moderationResult(from: data.moderation),
            messages: messages,
            moderationCase: data.moderationCase.flatMap(BackendDTOMapper.moderationCase(from:))
        )
    }

    func createOrder(companionId: String, themeId: String, durationMinutes: Int) async throws -> Order {
        let body: [String: Any] = [
            "companionId": companionId,
            "themeId": themeId,
            "durationMinutes": durationMinutes
        ]
        let data: BackendOrderDTO = try await request(
            path: "/api/v1/orders",
            method: "POST",
            body: body
        )
        guard let order = BackendDTOMapper.order(from: data) else {
            throw BackendError.decodingFailed
        }
        return order
    }

    func fetchOrders() async throws -> [Order] {
        let data: BackendOrdersData = try await request(path: "/api/v1/orders")
        return data.items.compactMap(BackendDTOMapper.order(from:))
    }

    func fetchOrder(id: String) async throws -> Order {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data: BackendOrderDTO = try await request(path: "/api/v1/orders/\(encoded)")
        guard let order = BackendDTOMapper.order(from: data) else {
            throw BackendError.decodingFailed
        }
        return order
    }

    func cancelOrder(id: String) async throws -> Order {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data: BackendOrderDTO = try await request(
            path: "/api/v1/orders/\(encoded)/cancel",
            method: "POST",
            body: [:]
        )
        guard let order = BackendDTOMapper.order(from: data) else {
            throw BackendError.decodingFailed
        }
        return order
    }

    func prepayOrder(id: String) async throws -> BackendPrepayResult {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data: BackendPrepayData = try await request(
            path: "/api/v1/orders/\(encoded)/prepay",
            method: "POST",
            body: [:]
        )
        guard let order = BackendDTOMapper.order(from: data.order) else {
            throw BackendError.decodingFailed
        }
        return BackendPrepayResult(
            order: order,
            outTradeNo: data.payment.outTradeNo,
            isMock: data.payment.mock,
            wechatParams: data.payment.wechatAppParams.map(BackendDTOMapper.wechatParams(from:))
        )
    }

    func mockWechatNotify(outTradeNo: String, amountCents: Int? = nil) async throws {
        var body: [String: Any] = ["outTradeNo": outTradeNo]
        if let amountCents {
            body["amountCents"] = amountCents
        }
        let _: BackendMockNotifyData = try await request(
            path: "/api/v1/payments/wechat/mock-notify",
            method: "POST",
            body: body
        )
    }

    func fetchNotifications(unreadOnly: Bool = false) async throws -> [AppNotification] {
        var path = "/api/v1/notifications"
        if unreadOnly {
            path = queryPath(path, queryItems: [URLQueryItem(name: "unreadOnly", value: "true")])
        }
        let data: BackendNotificationsData = try await request(path: path)
        return data.items.compactMap(BackendDTOMapper.notification(from:))
    }

    func fetchNotificationUnreadCount() async throws -> Int {
        let data: BackendUnreadCountData = try await request(path: "/api/v1/notifications/unread-count")
        return data.count
    }

    func markNotificationRead(id: String) async throws -> AppNotification {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let data: BackendNotificationDTO = try await request(
            path: "/api/v1/notifications/\(encoded)/read",
            method: "POST",
            body: [:]
        )
        guard let item = BackendDTOMapper.notification(from: data) else {
            throw BackendError.decodingFailed
        }
        return item
    }

    func markAllNotificationsRead() async throws {
        let _: BackendReadAllData = try await request(
            path: "/api/v1/notifications/read-all",
            method: "POST",
            body: [:]
        )
    }

    func requestAccountDeletion() async throws -> String {
        let data: BackendDeletionRequestData = try await request(
            path: "/api/v1/me/deletion-request",
            method: "POST",
            body: [:]
        )
        return data.message
    }

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        allowRetry: Bool = true
    ) async throws -> T {
        do {
            return try await performRequest(path: path, method: method, body: body)
        } catch let error as BackendError {
            if allowRetry, case .httpError(401) = error, await unauthorizedHandler() {
                return try await performRequest(path: path, method: method, body: body, allowRetry: false)
            }
            throw error
        }
    }

    private func performRequest<T: Decodable>(
        path: String,
        method: String,
        body: [String: Any]?,
        allowRetry: Bool = true
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw BackendError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendError.unavailable
        }
        guard (200...299).contains(http.statusCode) else {
            if let envelope = try? JSONDecoder().decode(BackendErrorEnvelope.self, from: data) {
                throw BackendError.apiError(
                    code: envelope.error.code,
                    message: envelope.error.message,
                    statusCode: http.statusCode
                )
            }
            throw BackendError.httpError(http.statusCode)
        }

        do {
            let envelope = try JSONDecoder().decode(BackendEnvelope<T>.self, from: data)
            return envelope.data
        } catch {
            throw BackendError.decodingFailed
        }
    }

    private func queryPath(_ path: String, queryItems: [URLQueryItem]) -> String {
        var components = URLComponents()
        components.path = path
        components.queryItems = queryItems
        return components.string ?? path
    }
}

private struct BackendErrorEnvelope: Decodable {
    let error: BackendErrorDetail
}
