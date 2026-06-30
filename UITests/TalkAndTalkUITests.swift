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
        XCTAssertTrue(app.buttons["全部"].exists)
        XCTAssertTrue(app.buttons["情绪倾听"].exists)
        XCTAssertTrue(app.buttons["发布笔记"].exists)
        XCTAssertTrue(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].exists)
    }

    @MainActor
    func testMessagesTabUsesConversationListAndOpensChat() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        app.tabBars.buttons["消息"].tap()
        XCTAssertTrue(app.textFields["搜索"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["平台内安全沟通"].exists)
        XCTAssertTrue(app.staticTexts["林屿"].exists)
        XCTAssertTrue(app.staticTexts["那我们先不急着解决。你觉得最压着你的，是事情多，还是没人理解？"].exists)

        app.buttons.containing(.staticText, identifier: "林屿").firstMatch.tap()
        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["发送"].exists)
        XCTAssertTrue(app.buttons["finishChatButton"].exists)
    }

    @MainActor
    func testFreeTrialStartsChatWithoutOrderAndThenPromptsPayment() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        completeVerification(in: app)
        app.buttons["看看谁在线"].tap()

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        companion.tap()

        XCTAssertTrue(app.buttons["免费试聊"].waitForExistence(timeout: 3))
        app.buttons["免费试聊"].tap()

        XCTAssertTrue(app.textFields["messageInput"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.staticTexts["确认订单"].exists)
        XCTAssertTrue(app.staticTexts["免费试聊剩余 5/5 条"].exists)

        for index in 1...5 {
            let input = app.textFields["messageInput"]
            XCTAssertTrue(input.waitForExistence(timeout: 3))
            input.tap()
            input.typeText("你好\(index)")
            app.buttons["发送"].tap()
        }

        XCTAssertTrue(app.staticTexts["免费试聊剩余 0/5 条"].waitForExistence(timeout: 5))

        let input = app.textFields["messageInput"]
        input.tap()
        input.typeText("还想继续聊")
        app.buttons["发送"].tap()

        let alert = app.alerts["免费试聊已用完"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.buttons["继续沟通"].tap()
        XCTAssertTrue(app.staticTexts["确认订单"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testFreeTrialRequiresVerificationFromDetail() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        let companion = app.buttons.containing(.staticText, identifier: "林屿").firstMatch
        XCTAssertTrue(companion.waitForExistence(timeout: 3))
        if !companion.isHittable {
            app.swipeUp()
        }
        companion.tap()

        XCTAssertTrue(app.buttons["免费试聊"].waitForExistence(timeout: 3))
        app.buttons["免费试聊"].tap()

        XCTAssertTrue(app.staticTexts["确认 18+ 身份"].waitForExistence(timeout: 3))
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
        app.buttons["免费试聊"].tap()

        let input = app.textFields["messageInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["免费试聊剩余 5/5 条"].exists)
        input.tap()
        input.typeText("加微信")
        app.buttons["发送"].tap()

        XCTAssertTrue(app.staticTexts["消息未发送：疑似违规内容"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["加微信"].exists)
        XCTAssertTrue(app.staticTexts["免费试聊剩余 5/5 条"].exists)

        let backButton = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(backButton.waitForExistence(timeout: 3))
        backButton.tap()

        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 3))
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

        XCTAssertTrue(app.buttons["直接下单"].waitForExistence(timeout: 3))
        app.buttons["直接下单"].tap()

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
