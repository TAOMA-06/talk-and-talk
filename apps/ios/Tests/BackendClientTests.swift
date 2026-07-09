import Foundation
import XCTest
@testable import TalkAndTalk

final class BackendClientTests: XCTestCase {
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        session = URLSession(configuration: configuration)
    }

    override func tearDown() {
        StubURLProtocol.nextResponse = nil
        session = nil
        super.tearDown()
    }

    func testFetchMessagesMapsBackendPayload() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "messages": [
                  {
                    "id": "m1",
                    "conversationId": "c1",
                    "senderId": "u1",
                    "senderName": "小楷",
                    "content": "今天有点累",
                    "type": "text",
                    "timestamp": "2026-07-07T02:00:00.000Z"
                  }
                ]
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-1" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let messages = try await client.fetchMessages(conversationId: "c1")

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].conversationId, "c1")
        XCTAssertEqual(messages[0].content, "今天有点累")
        XCTAssertEqual(messages[0].type, .text)
    }

    func testFetchConversationsMapsBackendPayload() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "conversations": [
                  {
                    "id": "c1",
                    "participant": {
                      "id": "c1",
                      "name": "林屿",
                      "role": "温柔倾听者",
                      "initials": "LY",
                      "isOnline": true,
                      "isVerified": true,
                      "availability": "online",
                      "responseTime": "约30秒"
                    },
                    "lastMessage": {
                      "id": "m1",
                      "conversationId": "c1",
                      "senderId": "c1",
                      "senderName": "林屿",
                      "content": "我在，先慢慢说。",
                      "type": "text",
                      "timestamp": "2026-07-07T02:00:00.000Z"
                    },
                    "unreadCount": 1,
                    "updatedAt": "2026-07-07T02:00:00.000Z"
                  }
                ]
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-conversations" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let conversations = try await client.fetchConversations()

        XCTAssertEqual(conversations.count, 1)
        XCTAssertEqual(conversations[0].id, "c1")
        XCTAssertEqual(conversations[0].displayName, "林屿")
        XCTAssertEqual(conversations[0].lastMessage?.content, "我在，先慢慢说。")
        XCTAssertEqual(conversations[0].unreadCount, 1)
    }

    func testSendMessageMapsModerationAndCompanionReply() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "moderation": {
                  "decision": "allow",
                  "riskLevel": "low",
                  "score": 0.1,
                  "reasons": ["内容正常"],
                  "matchedRules": [],
                  "usedAI": true
                },
                "message": {
                  "id": "m-user",
                  "conversationId": "c1",
                  "senderId": "u1",
                  "senderName": "小楷",
                  "content": "今天有点累",
                  "type": "text",
                  "timestamp": "2026-07-07T02:00:01.000Z"
                },
                "safetyMessage": null,
                "companionReply": {
                  "id": "m-reply",
                  "conversationId": "c1",
                  "senderId": "c1",
                  "senderName": "林屿",
                  "content": "我在，先慢慢说。",
                  "type": "text",
                  "timestamp": "2026-07-07T02:00:02.000Z"
                },
                "moderationCase": null
              },
              "meta": { "timestamp": "2026-07-07T02:00:02.000Z", "requestId": "req-2" }
            }
            """,
            201
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let response = try await client.sendMessage(conversationId: "c1", content: "今天有点累", senderId: "u1")

        XCTAssertEqual(response.moderation.decision, .allow)
        XCTAssertTrue(response.moderation.usedAI)
        XCTAssertEqual(response.messages.count, 2)
        XCTAssertEqual(response.messages.last?.senderId, "c1")
        XCTAssertNil(response.moderationCase)
    }

    func testSendMessageMapsBlockedSafetyPayloadWithoutOriginalMessage() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "moderation": {
                  "decision": "block",
                  "riskLevel": "high",
                  "score": 0.92,
                  "reasons": ["疑似引导私下联系"],
                  "matchedRules": ["contact.wechat"],
                  "usedAI": false
                },
                "message": null,
                "safetyMessage": {
                  "id": "m-safety",
                  "conversationId": "c1",
                  "senderId": "system",
                  "senderName": "系统",
                  "content": "安全提醒：平台不支持线下邀约。",
                  "type": "safety",
                  "timestamp": "2026-07-07T02:00:01.000Z"
                },
                "companionReply": null,
                "moderationCase": {
                  "id": "mc1",
                  "title": "聊天拦截：加微信",
                  "category": "实时风控",
                  "riskLevel": "high",
                  "status": "humanReview",
                  "source": "chat",
                  "content": "加微信",
                  "targetId": "c1",
                  "aiScore": 0.92,
                  "aiReason": "疑似引导私下联系",
                  "decision": "block",
                  "matchedRules": ["contact.wechat"],
                  "usedAI": false,
                  "resolvedAt": null
                }
              },
              "meta": { "timestamp": "2026-07-07T02:00:02.000Z", "requestId": "req-block" }
            }
            """,
            201
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let response = try await client.sendMessage(conversationId: "c1", content: "加微信", senderId: "u1")

        XCTAssertEqual(response.moderation.decision, .block)
        XCTAssertEqual(response.messages.count, 1)
        XCTAssertEqual(response.messages[0].type, .safety)
        XCTAssertEqual(response.moderationCase?.decision, .block)
    }

    func testFetchModerationCasesMapsBackendPayload() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "cases": [
                  {
                    "id": "mc1",
                    "title": "聊天拦截：线下见面",
                    "category": "内容风控",
                    "riskLevel": "high",
                    "status": "humanReview",
                    "source": "chat",
                    "content": "我们加微信聊吧",
                    "targetId": "c1",
                    "aiScore": 0.9,
                    "aiReason": "疑似交换联系方式",
                    "decision": "block",
                    "matchedRules": ["contact.offline"],
                    "usedAI": true,
                    "resolvedAt": null
                  }
                ]
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-4" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let cases = try await client.fetchModerationCases()

        XCTAssertEqual(cases.count, 1)
        XCTAssertEqual(cases[0].id, "mc1")
        XCTAssertEqual(cases[0].decision, .block)
        XCTAssertTrue(cases[0].usedAI)
    }

    func testHealthRequiresOkStatus() async {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "status": "ok",
                "service": "talk-and-talk-api",
                "version": "0.1.0",
                "uptimeSeconds": 3,
                "dependencies": {
                  "database": { "status": "ok", "latencyMs": 1 },
                  "redis": { "status": "ok", "latencyMs": 1 }
                }
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-3" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let status = try? await client.health()
        XCTAssertEqual(status?.connected, true)
        XCTAssertEqual(status?.version, "0.1.0")
    }

    func testHealthAcceptsDegradedWhenApiIsReachable() async {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "status": "degraded",
                "service": "talk-and-talk-api",
                "version": "0.1.0",
                "uptimeSeconds": 3,
                "dependencies": {
                  "database": { "status": "error", "latencyMs": 1, "message": "offline" },
                  "redis": { "status": "ok", "latencyMs": 1 }
                }
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-5" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let status = try? await client.health()
        XCTAssertEqual(status?.connected, true)
        XCTAssertEqual(status?.status, "degraded")
    }

    func testFetchCompanionsMapsBackendPayload() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "items": [
                  {
                    "id": "c1",
                    "name": "林屿",
                    "role": "温柔倾听者",
                    "initials": "LY",
                    "tags": ["心理学背景", "深夜在线"],
                    "rating": 4.9,
                    "reviewCount": 168,
                    "pricePerHalfHour": 39,
                    "isOnline": true,
                    "isVerified": true,
                    "bio": "擅长倾听和梳理情绪，尊重边界，仅平台内沟通。",
                    "availableTimes": ["20:00", "21:30"],
                    "languages": ["中文"],
                    "specialties": ["情绪倾听"],
                    "completedOrders": 426,
                    "responseTime": "约30秒",
                    "distanceKm": 1.2,
                    "availability": "online",
                    "cityDistrict": "南山区"
                  }
                ],
                "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-companions" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let companions = try await client.fetchCompanions(page: 1, pageSize: 20, tag: "心理学背景", availability: .online, isOnline: true)

        XCTAssertEqual(companions.count, 1)
        XCTAssertEqual(companions[0].id, "c1")
        XCTAssertEqual(companions[0].availability, .online)
        XCTAssertEqual(companions[0].pricePerHalfHour, 39)
    }

    func testFetchCompanionMapsBackendPayload() async throws {
        StubURLProtocol.nextResponse = (
            companionEnvelope(id: "c2", name: "许澈"),
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let companion = try await client.fetchCompanion(id: "c2")

        XCTAssertEqual(companion.id, "c2")
        XCTAssertEqual(companion.name, "许澈")
        XCTAssertEqual(companion.specialties, ["职场减压"])
    }

    func testFetchMeMapsUserProfile() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "id": "u1",
                "role": "user",
                "profile": {
                  "displayName": "小楷",
                  "phone": "138****8000",
                  "age": 23,
                  "gender": "male",
                  "isVerified": true,
                  "safetyScore": 88
                }
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-me" }
            }
            """,
            200
        )

        let client = BackendClient(baseURL: URL(string: "http://127.0.0.1:3000")!, session: session)
        let user = try await client.fetchMe()

        XCTAssertEqual(user.name, "小楷")
        XCTAssertEqual(user.age, 23)
        XCTAssertEqual(user.gender, .male)
        XCTAssertTrue(user.isVerified)
    }

    func testBackendConfigSupportsProductionChatCompanions() {
        XCTAssertTrue(BackendConfig.supportsChat(for: "c1"))
        XCTAssertTrue(BackendConfig.supportsChat(for: "c2"))
        XCTAssertTrue(BackendConfig.supportsChat(for: "c3"))
        XCTAssertFalse(BackendConfig.supportsChat(for: "c4"))
    }

    func testRequestSetsAuthorizationHeaderWhenTokenProvided() async throws {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "status": "ok",
                "service": "talk-and-talk-api",
                "version": "0.1.0",
                "uptimeSeconds": 1,
                "dependencies": {
                  "database": { "status": "ok", "latencyMs": 1 },
                  "redis": { "status": "ok", "latencyMs": 1 }
                }
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-auth" }
            }
            """,
            200
        )
        StubURLProtocol.captureAuthorization = true

        let client = BackendClient(
            baseURL: URL(string: "http://127.0.0.1:3000")!,
            session: session,
            tokenProvider: { "test-access-token" }
        )
        _ = try await client.health()

        XCTAssertEqual(StubURLProtocol.lastAuthorization, "Bearer test-access-token")
        StubURLProtocol.captureAuthorization = false
    }

    func testApiErrorMapsUserFacingMessage() {
        let error = BackendError.apiError(
            code: "RATE_LIMITED",
            message: "too frequent",
            statusCode: 429
        )
        XCTAssertEqual(error.userFacingMessage, "验证码发送太频繁，请稍后再试")
    }

    @MainActor
    func testBackendChatFailureFallsBackToLocalMessage() async {
        let store = AppStore(backendClientFactory: { _ in FailingBackendAPIClient() })
        let before = store.messages(for: "c1").count

        let decision = await store.sendTrialMessage("今天有点累，想有人听我说。", to: "c1")
        let messages = store.messages(for: "c1")

        XCTAssertEqual(decision, .allow)
        XCTAssertFalse(store.isBackendConnected)
        XCTAssertEqual(messages.count, before + 1)
        XCTAssertTrue(messages.contains { $0.senderId == store.user.id && $0.content == "今天有点累，想有人听我说。" })
    }

    @MainActor
    func testLoadCompanionsSuccessUpdatesStore() async {
        let store = AppStore(backendClientFactory: { _ in SuccessfulBackendAPIClient() })
        store.companions = []

        await store.loadCompanions(pageSize: 50)

        XCTAssertEqual(store.companionListLoadState, .loaded)
        XCTAssertEqual(store.companions.map(\.id), ["c-test"])
    }

    @MainActor
    func testLoadCompanionsFailureFallsBackToLocalMockInDebug() async {
        let store = AppStore(backendClientFactory: { _ in FailingBackendAPIClient() })
        store.companions = []

        await store.loadCompanions(pageSize: 50)

        XCTAssertEqual(store.companionListLoadState, .loaded)
        XCTAssertTrue(store.companions.contains { $0.id == "c1" })
    }

    @MainActor
    func testLoadCompanionDetailSuccessUpdatesStore() async {
        let store = AppStore(backendClientFactory: { _ in SuccessfulBackendAPIClient() })
        store.companions = []

        await store.loadCompanionDetail(id: "c-test")

        XCTAssertEqual(store.companionDetailLoadState(for: "c-test"), .loaded)
        XCTAssertEqual(store.companion(by: "c-test")?.name, "测试陪伴者")
    }

    @MainActor
    func testBackendChatSuccessAppendsReturnedMessages() async {
        let store = AppStore(backendClientFactory: { _ in ChatBackendAPIClient(mode: .allow) })
        store.messages.removeAll { $0.conversationId == "c1" }

        let decision = await store.sendTrialMessage("今天有点累", to: "c1")
        let messages = store.messages(for: "c1")

        XCTAssertEqual(decision, .allow)
        XCTAssertEqual(messages.map(\.content), ["今天有点累", "我在，先慢慢说。"])
        XCTAssertNil(store.sendFailureText(for: .companion(id: "c1")))
    }

    @MainActor
    func testBackendBlockDoesNotAppendOriginalMessage() async {
        let store = AppStore(backendClientFactory: { _ in ChatBackendAPIClient(mode: .block) })
        store.messages.removeAll { $0.conversationId == "c1" }

        let decision = await store.sendTrialMessage("加微信", to: "c1")
        let messages = store.messages(for: "c1")

        XCTAssertEqual(decision, .block)
        XCTAssertFalse(messages.contains { $0.content == "加微信" })
        XCTAssertTrue(messages.contains { $0.type == .safety })
        XCTAssertEqual(store.lastModerationFeedback, "消息未发送：疑似违规内容")
        XCTAssertEqual(store.moderationCases.first?.decision, .block)
    }

    @MainActor
    func testBackendReviewSetsPlatformReviewFeedback() async {
        let store = AppStore(backendClientFactory: { _ in ChatBackendAPIClient(mode: .review) })
        store.messages.removeAll { $0.conversationId == "c1" }

        let decision = await store.sendTrialMessage("代理兼职赚钱", to: "c1")
        let messages = store.messages(for: "c1")

        XCTAssertEqual(decision, .review)
        XCTAssertTrue(messages.contains { $0.content == "代理兼职赚钱" })
        XCTAssertTrue(messages.contains { $0.type == .safety })
        XCTAssertEqual(store.lastModerationFeedback, "内容已进入平台复核")
        XCTAssertEqual(store.moderationCases.first?.decision, .review)
        XCTAssertFalse(messages.contains { $0.senderId == "c1" && $0.type == .text })
    }
}

private struct FailingBackendAPIClient: BackendAPIClient, Sendable {
    func health() async throws -> BackendServiceStatus {
        throw BackendError.unavailable
    }

    func fetchCompanions(page: Int, pageSize: Int, tag: String?, availability: AvailabilityStatus?, isOnline: Bool?) async throws -> [Companion] {
        throw BackendError.unavailable
    }

    func fetchCompanion(id: String) async throws -> Companion {
        throw BackendError.unavailable
    }

    func fetchMe() async throws -> User {
        throw BackendError.unavailable
    }

    func updateMe(displayName: String?, gender: UserGender?, age: Int?) async throws -> User {
        throw BackendError.unavailable
    }

    func fetchConversations() async throws -> [ConversationSummary] {
        throw BackendError.unavailable
    }

    func fetchMessages(conversationId: String, cursor: String?, limit: Int?) async throws -> [Message] {
        throw BackendError.unavailable
    }

    func fetchModerationCases() async throws -> [ModerationCase] {
        throw BackendError.unavailable
    }

    func sendMessage(conversationId: String, content: String, senderId: String) async throws -> BackendSendMessageResponse {
        throw BackendError.unavailable
    }
}

private struct SuccessfulBackendAPIClient: BackendAPIClient, Sendable {
    func health() async throws -> BackendServiceStatus {
        BackendServiceStatus(connected: true, version: "0.1.0", status: "ok")
    }

    func fetchCompanions(page: Int, pageSize: Int, tag: String?, availability: AvailabilityStatus?, isOnline: Bool?) async throws -> [Companion] {
        [Self.companion]
    }

    func fetchCompanion(id: String) async throws -> Companion {
        Self.companion
    }

    func fetchMe() async throws -> User {
        MockData.user
    }

    func updateMe(displayName: String?, gender: UserGender?, age: Int?) async throws -> User {
        MockData.user
    }

    func fetchConversations() async throws -> [ConversationSummary] {
        []
    }

    func fetchMessages(conversationId: String, cursor: String?, limit: Int?) async throws -> [Message] {
        []
    }

    func fetchModerationCases() async throws -> [ModerationCase] {
        []
    }

    func sendMessage(conversationId: String, content: String, senderId: String) async throws -> BackendSendMessageResponse {
        throw BackendError.unavailable
    }

    private static let companion = Companion(
        id: "c-test",
        name: "测试陪伴者",
        role: "测试角色",
        initials: "CS",
        tags: ["测试"],
        rating: 4.8,
        reviewCount: 1,
        pricePerHalfHour: 30,
        isOnline: true,
        isVerified: true,
        bio: "用于测试。",
        availableTimes: ["20:00"],
        languages: ["中文"],
        specialties: ["情绪倾听"],
        completedOrders: 1,
        responseTime: "约1分钟",
        distanceKm: 0,
        availability: .online,
        cityDistrict: "平台内"
    )
}

private struct ChatBackendAPIClient: BackendAPIClient, Sendable {
    enum Mode: Sendable {
        case allow
        case block
        case review
    }

    let mode: Mode

    func health() async throws -> BackendServiceStatus {
        BackendServiceStatus(connected: true, version: "0.1.0", status: "ok")
    }

    func fetchCompanions(page: Int, pageSize: Int, tag: String?, availability: AvailabilityStatus?, isOnline: Bool?) async throws -> [Companion] {
        []
    }

    func fetchCompanion(id: String) async throws -> Companion {
        MockData.companions[0]
    }

    func fetchMe() async throws -> User {
        MockData.user
    }

    func updateMe(displayName: String?, gender: UserGender?, age: Int?) async throws -> User {
        MockData.user
    }

    func fetchConversations() async throws -> [ConversationSummary] {
        []
    }

    func fetchMessages(conversationId: String, cursor: String?, limit: Int?) async throws -> [Message] {
        []
    }

    func fetchModerationCases() async throws -> [ModerationCase] {
        []
    }

    func sendMessage(conversationId: String, content: String, senderId: String) async throws -> BackendSendMessageResponse {
        switch mode {
        case .allow:
            return BackendSendMessageResponse(
                moderation: ModerationResult(decision: .allow, riskLevel: .low, score: 0.05, reasons: ["内容正常"], matchedRules: [], usedAI: false),
                messages: [
                    Message(id: "m-user", conversationId: conversationId, senderId: senderId, content: content, type: .text, timestamp: Date(timeIntervalSince1970: 1)),
                    Message(id: "m-reply", conversationId: conversationId, senderId: conversationId, content: "我在，先慢慢说。", type: .text, timestamp: Date(timeIntervalSince1970: 2))
                ],
                moderationCase: nil
            )
        case .block:
            return BackendSendMessageResponse(
                moderation: ModerationResult(decision: .block, riskLevel: .high, score: 0.92, reasons: ["疑似引导私下联系"], matchedRules: ["contact.wechat"], usedAI: false),
                messages: [
                    Message(id: "m-safety", conversationId: conversationId, senderId: "system", content: "安全提醒：平台不支持线下邀约。", type: .safety, timestamp: Date(timeIntervalSince1970: 1))
                ],
                moderationCase: ModerationCase(
                    id: "mc1",
                    title: "聊天拦截：加微信",
                    category: "实时风控",
                    riskLevel: .high,
                    status: .humanReview,
                    source: .chat,
                    content: content,
                    targetId: conversationId,
                    aiScore: 0.92,
                    aiReason: "疑似引导私下联系",
                    decision: .block,
                    matchedRules: ["contact.wechat"],
                    usedAI: false,
                    resolvedAt: nil
                )
            )
        case .review:
            return BackendSendMessageResponse(
                moderation: ModerationResult(decision: .review, riskLevel: .low, score: 0.42, reasons: ["疑似广告或引流"], matchedRules: ["ads.promo"], usedAI: false),
                messages: [
                    Message(id: "m-user", conversationId: conversationId, senderId: senderId, content: content, type: .text, timestamp: Date(timeIntervalSince1970: 1)),
                    Message(id: "m-safety", conversationId: conversationId, senderId: "system", content: "安全提醒：这条消息已进入平台复核，请继续保持平台内沟通。", type: .safety, timestamp: Date(timeIntervalSince1970: 2))
                ],
                moderationCase: ModerationCase(
                    id: "mc-review",
                    title: "聊天待复核：代理兼职赚钱",
                    category: "实时风控",
                    riskLevel: .low,
                    status: .pending,
                    source: .chat,
                    content: content,
                    targetId: conversationId,
                    aiScore: 0.42,
                    aiReason: "疑似广告或引流",
                    decision: .review,
                    matchedRules: ["ads.promo"],
                    usedAI: false,
                    resolvedAt: nil
                )
            )
        }
    }
}

private func companionEnvelope(id: String, name: String) -> String {
    """
    {
      "data": {
        "id": "\(id)",
        "name": "\(name)",
        "role": "职场沟通陪伴",
        "initials": "XC",
        "tags": ["职业沟通"],
        "rating": 4.8,
        "reviewCount": 116,
        "pricePerHalfHour": 49,
        "isOnline": true,
        "isVerified": true,
        "bio": "聊职场压力和沟通卡点。",
        "availableTimes": ["19:00"],
        "languages": ["中文"],
        "specialties": ["职场减压"],
        "completedOrders": 318,
        "responseTime": "约1分钟",
        "distanceKm": 2.8,
        "availability": "available",
        "cityDistrict": "宝安区"
      },
      "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-companion" }
    }
    """
}

private final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var nextResponse: (String, Int)?
    nonisolated(unsafe) static var captureAuthorization = false
    nonisolated(unsafe) static var lastAuthorization: String?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        if Self.captureAuthorization {
            Self.lastAuthorization = request.value(forHTTPHeaderField: "Authorization")
        }

        guard let (body, statusCode) = Self.nextResponse else {
            client?.urlProtocol(self, didFailWithError: BackendError.unavailable)
            return
        }

        let data = Data(body.utf8)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        guard let client else { return }
        client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client.urlProtocol(self, didLoad: data)
        client.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
