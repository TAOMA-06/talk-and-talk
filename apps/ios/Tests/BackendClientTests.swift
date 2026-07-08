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

    func testBackendConfigSupportsProductionChatCompanions() {
        XCTAssertTrue(BackendConfig.supportsChat(for: "c1"))
        XCTAssertTrue(BackendConfig.supportsChat(for: "c2"))
        XCTAssertTrue(BackendConfig.supportsChat(for: "c3"))
        XCTAssertFalse(BackendConfig.supportsChat(for: "c4"))
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
}

private struct FailingBackendAPIClient: BackendAPIClient {
    func health() async throws -> BackendServiceStatus {
        throw BackendError.unavailable
    }

    func fetchMessages(conversationId: String) async throws -> [Message] {
        throw BackendError.unavailable
    }

    func fetchModerationCases() async throws -> [ModerationCase] {
        throw BackendError.unavailable
    }

    func sendMessage(conversationId: String, content: String, senderId: String) async throws -> BackendSendMessageResponse {
        throw BackendError.unavailable
    }
}

private final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var nextResponse: (String, Int)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
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
