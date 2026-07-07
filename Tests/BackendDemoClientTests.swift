import Foundation
import XCTest
@testable import TalkAndTalk

final class BackendDemoClientTests: XCTestCase {
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

        let client = BackendDemoClient(baseURL: URL(string: "http://127.0.0.1:8787")!, session: session)
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

        let client = BackendDemoClient(baseURL: URL(string: "http://127.0.0.1:8787")!, session: session)
        let response = try await client.sendMessage(conversationId: "c1", content: "今天有点累", senderId: "u1")

        XCTAssertEqual(response.moderation.decision, .allow)
        XCTAssertTrue(response.moderation.usedAI)
        XCTAssertEqual(response.messages.count, 2)
        XCTAssertEqual(response.messages.last?.senderId, "c1")
        XCTAssertNil(response.moderationCase)
    }

    func testHealthRequiresOkStatus() async {
        StubURLProtocol.nextResponse = (
            """
            {
              "data": {
                "status": "ok",
                "moderation": {
                  "provider": "deepseek",
                  "connected": true,
                  "model": "deepseek-chat",
                  "reason": null
                }
              },
              "meta": { "timestamp": "2026-07-07T02:00:00.000Z", "requestId": "req-3" }
            }
            """,
            200
        )

        let client = BackendDemoClient(baseURL: URL(string: "http://127.0.0.1:8787")!, session: session)
        let status = try? await client.health()
        XCTAssertEqual(status?.connected, true)
        XCTAssertEqual(status?.model, "deepseek-chat")
    }
}

private final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var nextResponse: (String, Int)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let (body, statusCode) = Self.nextResponse else {
            client?.urlProtocol(self, didFailWithError: BackendDemoError.unavailable)
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
