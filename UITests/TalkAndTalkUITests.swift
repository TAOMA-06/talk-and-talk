import XCTest

final class TalkAndTalkUITests: XCTestCase {
    @MainActor
    func testHomeScreenLaunchesWithPrimaryCTA() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.staticTexts["Talk&Talk"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["今晚，有人愿意听你说"].exists)
        XCTAssertTrue(app.buttons["先完成 18+ 认证"].exists || app.buttons["看看谁在线"].exists)
        XCTAssertTrue(app.tabBars.buttons["发现"].exists)
        XCTAssertTrue(app.tabBars.buttons["社区"].exists)
        XCTAssertTrue(app.tabBars.buttons["订单"].exists)
        XCTAssertTrue(app.tabBars.buttons["消息"].exists)
        XCTAssertTrue(app.tabBars.buttons["我的"].exists)
    }

    @MainActor
    func testCommunityTabShowsBelongingBanner() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        app.tabBars.buttons["社区"].tap()
        XCTAssertTrue(app.staticTexts["这是属于我们的地方"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["她的故事"].exists)
    }

    @MainActor
    func testBlockedMessageDoesNotSendAndReducesSafetyScore() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        completeVerification(in: app)
        app.buttons["看看谁在线"].tap()

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        companion.tap()
        app.buttons["发起沟通"].tap()
        app.switches["我已阅读并同意平台安全规范"].tap()
        app.buttons["确认并进入沟通"].tap()

        let input = app.textFields["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 4))
        input.tap()
        input.typeText("加微信")
        app.buttons["发送"].tap()

        XCTAssertTrue(app.staticTexts["消息未发送：疑似违规内容"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["加微信"].exists)

        app.tabBars.buttons["我的"].tap()
        XCTAssertTrue(app.staticTexts["65"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testPrimaryDemoFlowFromVerificationToReview() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        completeVerification(in: app)
        app.buttons["看看谁在线"].tap()

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        companion.tap()

        XCTAssertTrue(app.buttons["发起沟通"].waitForExistence(timeout: 3))
        app.buttons["发起沟通"].tap()

        XCTAssertTrue(app.staticTexts["确认订单"].waitForExistence(timeout: 3))
        app.switches["我已阅读并同意平台安全规范"].tap()
        app.buttons["确认并进入沟通"].tap()

        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        app.buttons["finishChatButton"].tap()
        XCTAssertTrue(app.staticTexts["这次沟通体验怎么样？"].waitForExistence(timeout: 3))
        app.buttons["提交评价"].tap()
        XCTAssertTrue(app.staticTexts["评价已提交"].waitForExistence(timeout: 3))
    }

    @MainActor
    private func completeVerification(in app: XCUIApplication) {
        app.buttons["先完成 18+ 认证"].tap()
        XCTAssertTrue(app.staticTexts["确认 18+ 身份"].waitForExistence(timeout: 3))
        app.buttons["下一步"].tap()
        app.buttons["点击开始模拟检测"].tap()
        app.buttons["下一步"].tap()
        app.buttons["完成模拟认证"].tap()
        XCTAssertTrue(app.buttons["看看谁在线"].waitForExistence(timeout: 3))
    }
}
