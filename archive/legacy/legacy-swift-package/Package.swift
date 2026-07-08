// swift-tools-version: 6.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "TalkAndTalk",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(
            name: "TalkAndTalk",
            targets: ["TalkAndTalk"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-algorithms.git", from: "1.2.0"),
    ],
    targets: [
        .target(
            name: "TalkAndTalk",
            dependencies: [
                .product(name: "Algorithms", package: "swift-algorithms"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("StrictConcurrency"),
            ]
        ),
        .testTarget(
            name: "TalkAndTalkTests",
            dependencies: ["TalkAndTalk"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
