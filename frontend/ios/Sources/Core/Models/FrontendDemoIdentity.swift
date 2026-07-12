import Foundation

#if DEBUG
enum FrontendDemoIdentity {
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
}
#endif
