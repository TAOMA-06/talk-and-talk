import Foundation

struct RefreshTokensResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
}

protocol AuthAPIClient: Sendable {
    func sendVerificationCode(phone: String) async throws -> SendCodeResponse
    func loginWithPhone(phone: String, code: String) async throws -> AuthTokensResponse
    func loginWithApple(identityToken: String) async throws -> AuthTokensResponse
    func refreshTokens(refreshToken: String) async throws -> RefreshTokensResponse
    func logout(accessToken: String, refreshToken: String) async throws
    func fetchCurrentUser(accessToken: String) async throws -> AuthUserResponse
}

struct BackendAuthClient: AuthAPIClient, Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func sendVerificationCode(phone: String) async throws -> SendCodeResponse {
        try await post(path: "/api/v1/auth/sms/send-code", body: ["phone": phone])
    }

    func loginWithPhone(phone: String, code: String) async throws -> AuthTokensResponse {
        try await post(path: "/api/v1/auth/phone/login", body: ["phone": phone, "code": code])
    }

    func loginWithApple(identityToken: String) async throws -> AuthTokensResponse {
        try await post(path: "/api/v1/auth/apple", body: ["identityToken": identityToken])
    }

    func refreshTokens(refreshToken: String) async throws -> RefreshTokensResponse {
        try await post(path: "/api/v1/auth/refresh", body: ["refreshToken": refreshToken])
    }

    func logout(accessToken: String, refreshToken: String) async throws {
        let _: LogoutResponse = try await post(
            path: "/api/v1/auth/logout",
            body: ["refreshToken": refreshToken],
            accessToken: accessToken
        )
    }

    func fetchCurrentUser(accessToken: String) async throws -> AuthUserResponse {
        try await get(path: "/api/v1/users/me", accessToken: accessToken)
    }

    private func get<T: Decodable>(path: String, accessToken: String? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw BackendError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        return try await execute(request)
    }

    private func post<T: Decodable>(
        path: String,
        body: [String: String],
        accessToken: String? = nil
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw BackendError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        return try await execute(request)
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw BackendError.unavailable
        }

        guard (200...299).contains(http.statusCode) else {
            throw parseError(data: data, statusCode: http.statusCode)
        }

        do {
            let envelope = try JSONDecoder().decode(BackendEnvelope<T>.self, from: data)
            return envelope.data
        } catch {
            throw BackendError.decodingFailed
        }
    }

    private func parseError(data: Data, statusCode: Int) -> BackendError {
        if let envelope = try? JSONDecoder().decode(BackendErrorEnvelope.self, from: data) {
            return .apiError(
                code: envelope.error.code,
                message: envelope.error.message,
                statusCode: statusCode
            )
        }
        return .httpError(statusCode)
    }
}

private struct LogoutResponse: Decodable {
    let success: Bool
}

private struct BackendErrorEnvelope: Decodable {
    let error: BackendErrorDetail
}
