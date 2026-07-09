import Foundation

struct AuthTokensResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let user: AuthUserResponse
}

struct AuthUserResponse: Decodable {
    let id: String
    let role: String
    let profile: AuthUserProfileResponse?
}

struct AuthUserProfileResponse: Decodable {
    let displayName: String?
    let phone: String?
    let gender: String?
    let isVerified: Bool
    let safetyScore: Int
}

struct SendCodeResponse: Decodable {
    let expiresInSeconds: Int
}

struct BackendErrorResponse: Decodable {
    let error: BackendErrorDetail
}

struct BackendErrorDetail: Decodable {
    let code: String
    let message: String
}

enum AuthDTOMapper {
    static func user(from response: AuthUserResponse) -> User {
        let profile = response.profile
        return User(
            id: response.id,
            name: profile?.displayName ?? "用户",
            phone: profile?.phone ?? "",
            age: 18,
            gender: profile?.gender.flatMap { UserGender(rawValue: $0) },
            isVerified: profile?.isVerified ?? false,
            safetyScore: profile?.safetyScore ?? 80,
            accountStatus: .active,
            violationCount: 0,
            lastViolationAt: nil,
            warnGraceStrikeCount: 0
        )
    }
}
