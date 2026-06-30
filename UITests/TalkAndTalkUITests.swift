import XCTest

final class TalkAndTalkUITests: XCTestCase {
    @MainActor
    func testHomeScreenLaunchesWithPrimaryCTA() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        XCTAssertTrue(app.staticTexts["选择你的身份"].waitForExistence(timeout: 5))
        app.buttons["女生"].tap()
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

        chooseInitialGender(in: app)
        app.tabBars.buttons["社区"].tap()
        XCTAssertTrue(app.staticTexts["这是属于我们的地方"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["推荐内容"].exists)
        XCTAssertFalse(app.staticTexts["女生需求"].exists)
        XCTAssertFalse(app.buttons["男生自荐"].exists)
        XCTAssertTrue(app.buttons["全部"].exists)
        XCTAssertTrue(app.buttons["情绪倾听"].exists)
        XCTAssertTrue(app.buttons["发布"].exists)
        XCTAssertTrue(app.staticTexts["已实名，擅长稳定倾听和边界清晰的文字陪伴。希望匹配需要安静沟通的人。"].exists)
        XCTAssertFalse(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].exists)
    }

    @MainActor
    func testFemaleCommunityPublishingUsesDemandComposerWithoutCover() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        app.tabBars.buttons["社区"].tap()
        XCTAssertTrue(app.buttons["发布"].waitForExistence(timeout: 3))
        app.buttons["发布"].tap()

        XCTAssertTrue(app.staticTexts["发布"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["内容"].exists)
        XCTAssertFalse(app.staticTexts["选择封面"].exists)
        XCTAssertFalse(app.staticTexts["发布需求"].exists)
        XCTAssertFalse(app.staticTexts["发布自荐"].exists)
    }

    @MainActor
    func testUnverifiedMaleCommunityPromotionRoutesToVerification() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        app.tabBars.buttons["社区"].tap()
        app.buttons["发布"].tap()

        XCTAssertTrue(app.staticTexts["确认 18+ 身份"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testVerifiedMaleCommunityPromotionShowsOptionalCover() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        completeVerification(in: app)
        app.tabBars.buttons["社区"].tap()
        app.buttons["发布"].tap()

        XCTAssertTrue(app.staticTexts["发布"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["内容"].exists)
        XCTAssertTrue(app.staticTexts["选择封面"].exists)
        XCTAssertTrue(app.buttons["发布"].exists)
    }

    @MainActor
    func testCommunityFeedShowsOppositeGenderPosts() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        app.tabBars.buttons["社区"].tap()
        XCTAssertTrue(app.staticTexts["已实名，擅长稳定倾听和边界清晰的文字陪伴。希望匹配需要安静沟通的人。"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].exists)
    }

    @MainActor
    func testMaleCommunityFeedShowsFemalePosts() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app, gender: "男生")
        app.tabBars.buttons["社区"].tap()
        XCTAssertTrue(app.staticTexts["第一次在这里找人聊完一整晚的委屈，没有被说教，也没有被催着变好。原来被认真听见，本身就是一种治愈。"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["已实名，擅长稳定倾听和边界清晰的文字陪伴。希望匹配需要安静沟通的人。"].exists)
    }

    @MainActor
    func testProfileGenderSettingsCanChangeIdentity() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
        app.tabBars.buttons["我的"].tap()
        XCTAssertTrue(app.buttons["genderSettingsRow"].waitForExistence(timeout: 3))
        app.buttons["genderSettingsRow"].tap()

        XCTAssertTrue(app.staticTexts["身份设置"].waitForExistence(timeout: 3))
        app.buttons["男生"].tap()
        app.buttons["完成"].tap()
        XCTAssertTrue(app.staticTexts["男生"].waitForExistence(timeout: 3))
    }

    @MainActor
    func testMessagesTabUsesConversationListAndOpensChat() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        defer { app.terminate() }

        chooseInitialGender(in: app)
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

        chooseInitialGender(in: app)
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

        chooseInitialGender(in: app)
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

        chooseInitialGender(in: app)
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

        chooseInitialGender(in: app)
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
    private func chooseInitialGender(in app: XCUIApplication, gender: String = "女生") {
        XCTAssertTrue(app.staticTexts["选择你的身份"].waitForExistence(timeout: 5))
        app.buttons[gender].tap()
        XCTAssertTrue(app.staticTexts["今晚，有人愿意听你说"].waitForExistence(timeout: 3))
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
