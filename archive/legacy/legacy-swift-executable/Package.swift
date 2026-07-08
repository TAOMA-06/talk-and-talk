// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "TalkAndTalkApp",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .executable(name: "TalkAndTalkApp", targets: ["TalkAndTalkApp"])
    ],
    dependencies: [
        .package(path: "../TalkAndTalk")
    ],
    targets: [
        .executableTarget(
            name: "TalkAndTalkApp",
            dependencies: [
                .product(name: "TalkAndTalk", package: "TalkAndTalk")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        )
    ]
)
