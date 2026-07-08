import Foundation

enum BackendError: Error, Equatable {
    case invalidURL
    case httpError(Int)
    case decodingFailed
    case unavailable
}

struct BackendSendMessageResponse: Sendable {
    let moderation: ModerationResult
    let messages: [Message]
    let moderationCase: ModerationCase?
}

protocol BackendAPIClient {
    func health() async throws -> BackendServiceStatus
    func fetchMessages(conversationId: String) async throws -> [Message]
    func fetchModerationCases() async throws -> [ModerationCase]
    func sendMessage(conversationId: String, content: String, senderId: String) async throws -> BackendSendMessageResponse
}

struct BackendClient: BackendAPIClient, Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func health() async throws -> BackendServiceStatus {
        let data: BackendHealthData = try await request(path: "/api/v1/health")
        guard data.status == "ok" || data.status == "degraded" else { throw BackendError.unavailable }
        return BackendServiceStatus(connected: true, version: data.version, status: data.status)
    }

    func fetchMessages(conversationId: String) async throws -> [Message] {
        let encoded = conversationId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? conversationId
        let data: BackendMessagesData = try await request(path: "/api/v1/conversations/\(encoded)/messages")
        return data.messages.compactMap(BackendDTOMapper.message(from:))
    }

    func fetchModerationCases() async throws -> [ModerationCase] {
        let data: BackendModerationCasesData = try await request(path: "/api/v1/moderation/cases")
        return data.cases.compactMap(BackendDTOMapper.moderationCase(from:))
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

    private func request<T: Decodable>(
        path: String,
        method: String = "GET",
        body: [String: String]? = nil
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw BackendError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendError.unavailable
        }
        guard (200...299).contains(http.statusCode) else {
            throw BackendError.httpError(http.statusCode)
        }

        do {
            let envelope = try JSONDecoder().decode(BackendEnvelope<T>.self, from: data)
            return envelope.data
        } catch {
            throw BackendError.decodingFailed
        }
    }
}
