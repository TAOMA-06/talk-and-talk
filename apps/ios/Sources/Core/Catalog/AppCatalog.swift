import Foundation

enum AppCatalog {
    static let themes: [Theme] = [
        Theme(id: "t1", name: "情绪倾听", icon: "heart.text.square", description: "有人认真听你说完今天", tintName: "teal"),
        Theme(id: "t2", name: "职场减压", icon: "briefcase", description: "拆解压力、复盘沟通", tintName: "coral"),
        Theme(id: "t3", name: "学习陪伴", icon: "book.closed", description: "番茄钟式专注陪跑", tintName: "lilac"),
        Theme(id: "t4", name: "睡前语音", icon: "moon.stars", description: "低刺激、安静的晚间陪伴", tintName: "gold"),
        Theme(id: "t5", name: "兴趣聊天", icon: "sparkles", description: "电影、旅行、美食、摄影", tintName: "teal"),
        Theme(id: "t6", name: "运动鼓励", icon: "figure.run", description: "计划、打卡、正反馈", tintName: "coral")
    ]

    static let placeholderUser = User(
        id: "",
        name: "",
        phone: "",
        age: 0,
        gender: nil,
        isVerified: false,
        safetyScore: 80,
        accountStatus: .active,
        violationCount: 0,
        lastViolationAt: nil,
        warnGraceStrikeCount: 0
    )
}